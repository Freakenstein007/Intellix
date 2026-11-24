"""Pure AMPWISE and first-come-first-served power allocation functions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable


def _fraction(value: float) -> float:
    """Accept either percent values (12) or fractions (0.12) for settings."""
    return value / 100 if value > 1 else value


def _score(bus: dict[str, Any], station: dict[str, Any], max_range_km: float, max_dist_km: float) -> float:
    range_urgency = 1 - min(float(bus["range_km"]) / max_range_km, 1)
    distance_urgency = min(float(bus["distance_to_next_station_km"]) / max_dist_km, 1)
    return float(station.get("w1", 0.6)) * range_urgency + float(station.get("w2", 0.4)) * distance_urgency


def safe_level_pct(bus: dict[str, Any], kwh_per_km: float = 0.9) -> float:
    """Absolute battery level for reaching the next charger plus a 20% energy buffer."""
    capacity = max(0.1, float(bus.get("battery_capacity_kwh", 1)))
    needed_kwh = float(bus["distance_to_next_station_km"]) * kwh_per_km * 1.2
    return min(float(bus.get("target_pct", 100)), needed_kwh / capacity * 100)


def _is_emergency(bus: dict[str, Any], safe_margin_km: float) -> bool:
    margin = float(bus["range_km"]) - float(bus["distance_to_next_station_km"])
    current = float(bus.get("battery_pct", 0))
    return margin < safe_margin_km and current + 1e-8 < safe_level_pct(bus)


def _base_result(bus: dict[str, Any], station: dict[str, Any], score: float, emergency: bool, rank: int, status: str, **extra) -> dict[str, Any]:
    result = dict(bus)
    result.update({
        "allocated_kw": 0.0,
        "rank": rank,
        "status": status,
        "is_emergency": emergency,
        "score": round(score, 4),
        "safe_target_pct": round(safe_level_pct(bus), 2),
        "reserve_allocated_kw": 0.0,
        "borrowed_kw": 0.0,
        "explanation": "",
        **extra,
    })
    return result


def allocate_power(
    buses: Iterable[dict[str, Any]],
    station: dict[str, Any],
    *,
    max_range_km: float = 250,
    max_dist_km: float = 100,
    safe_margin_km: float = 15,
) -> list[dict[str, Any]]:
    """Allocate station power by AMPWISE urgency, reserve, port, and floor rules.

    Emergency status is based on the specified range margin and lasts only until
    the bus reaches the battery level needed for the next station plus 20% buffer.
    Normal buses receive their floor before emergency buses may borrow from normal
    power. The unused reserve is released to normal buses after emergency demand.
    """
    power_limit = max(0.0, float(station["total_power_kw"]))
    reserve_fraction = min(1.0, max(0.0, _fraction(float(station.get("reserve_pct", 12)))))
    reserve_pool = power_limit * reserve_fraction
    normal_pool = power_limit - reserve_pool
    max_charger = max(0.0, float(station["max_charger_kw"]))
    floor_kw = max_charger * max(0.0, _fraction(float(station.get("floor_pct", 20))))
    num_ports = max(0, int(station["num_ports"]))

    prepared = []
    for bus in buses:
        score = _score(bus, station, max_range_km, max_dist_km)
        # A dispatcher flag requests reserve priority too, but only until the
        # safe range target is met; afterward the bus rejoins the normal queue.
        override_active = bool(bus.get("emergency_override")) and float(bus.get("battery_pct", 0)) < safe_level_pct(bus)
        emergency = _is_emergency(bus, safe_margin_km) or override_active
        prepared.append({"source": dict(bus), "score": score, "emergency": emergency})
    prepared.sort(key=lambda row: (not row["emergency"], -row["score"], -float(row["source"].get("wait_minutes", 0)), str(row["source"].get("created_at", ""))))

    candidates, not_selected = prepared[:num_ports], prepared[num_ports:]
    emergencies = [row for row in candidates if row["emergency"]]
    normals = [row for row in candidates if not row["emergency"]]

    # Protect the normal floor. If it cannot fit, remove the lowest-score normal
    # candidate from the charging set and place it back in the ordered wait queue.
    while normals and len(normals) * floor_kw > normal_pool + 1e-8:
        removed = min(normals, key=lambda row: (row["score"], float(row["source"].get("wait_minutes", 0))))
        normals.remove(removed)
        not_selected.append(removed)
    candidates = emergencies + normals
    not_selected.sort(key=lambda row: (not row["emergency"], -row["score"], -float(row["source"].get("wait_minutes", 0))))

    results: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    def bus_key(row: dict[str, Any]) -> str:
        return str(row["source"].get("id", row["source"].get("reg", id(row))))

    for rank, row in enumerate(candidates + not_selected, start=1):
        status = "charging" if row in candidates else "waiting"
        result = _base_result(row["source"], station, row["score"], row["emergency"], rank, status)
        results.append(result)
        by_key[bus_key(row)] = result

    reserve_remaining = reserve_pool
    emergency_shortfall = 0.0
    for row in emergencies:
        result = by_key[bus_key(row)]
        reserve_kw = min(max_charger, reserve_remaining)
        result["allocated_kw"] = reserve_kw
        result["reserve_allocated_kw"] = reserve_kw
        reserve_remaining -= reserve_kw
        emergency_shortfall += max(0.0, max_charger - reserve_kw)

    # Emergency buses may borrow only power left after every selected normal bus
    # receives its floor. That keeps the guarantee intact when emergencies arrive.
    normal_floor_total = len(normals) * floor_kw
    normal_surplus = max(0.0, normal_pool - normal_floor_total)
    borrowed_total = min(emergency_shortfall, normal_surplus)
    borrow_left = borrowed_total
    for row in emergencies:
        result = by_key[bus_key(row)]
        room = max(0.0, max_charger - result["allocated_kw"])
        borrowed = min(room, borrow_left)
        result["allocated_kw"] += borrowed
        result["borrowed_kw"] = borrowed
        borrow_left -= borrowed

    for row in normals:
        by_key[bus_key(row)]["allocated_kw"] = floor_kw

    # Any reserve not used by emergencies returns to the normal pool.
    released_reserve = max(0.0, reserve_remaining)
    normal_remaining = max(0.0, normal_pool - normal_floor_total - borrowed_total) + released_reserve
    for row in normals:
        result = by_key[bus_key(row)]
        top_up = min(max(0.0, max_charger - result["allocated_kw"]), normal_remaining)
        result["allocated_kw"] += top_up
        normal_remaining -= top_up

    emergency_count = len(emergencies)
    for result in results:
        result["allocated_kw"] = round(max(0.0, result["allocated_kw"]), 3)
        result["reserve_pool_kw"] = round(reserve_pool, 3)
        result["reserve_released_kw"] = round(released_reserve, 3)
        source = result
        if result["status"] == "waiting":
            result["explanation"] = f"Waiting: {num_ports} charging ports are occupied or the normal power floor is protected. Score {result['score']:.2f}."
        elif result["is_emergency"]:
            borrowed_note = f" and {result['borrowed_kw']:g} kW borrowed" if result["borrowed_kw"] else ""
            result["explanation"] = (f"Emergency: range {float(source['range_km']):g} km, next station "
                                      f"{float(source['distance_to_next_station_km']):g} km away; given "
                                      f"{result['allocated_kw']:g} kW from reserve{borrowed_note}.")
        else:
            result["explanation"] = f"Charging: {result['allocated_kw']:g} kW allocated by priority score {result['score']:.2f}; normal power floor protected."

    # A defensive cap makes the power-limit guarantee explicit, including tiny float errors.
    active_rows = [row for row in results if row["status"] == "charging"]
    total_allocated = sum(row["allocated_kw"] for row in active_rows)
    if total_allocated > power_limit + 1e-6:
        excess = total_allocated - power_limit
        for row in reversed(active_rows):
            reducible = max(0.0, row["allocated_kw"] - (floor_kw if not row["is_emergency"] else 0))
            reduction = min(excess, reducible)
            row["allocated_kw"] = round(row["allocated_kw"] - reduction, 3)
            excess -= reduction
            if excess <= 1e-6:
                break
    return results


def allocate_fcfs(buses: Iterable[dict[str, Any]], station: dict[str, Any]) -> list[dict[str, Any]]:
    """Simple baseline: oldest booking first, station power used sequentially."""
    power_left = float(station["total_power_kw"])
    max_charger = float(station["max_charger_kw"])
    ports = int(station["num_ports"])
    ordered = sorted(buses, key=lambda bus: str(bus.get("created_at", "")))
    result = []
    for rank, bus in enumerate(ordered, start=1):
        score = _score(bus, station, 250, 100)
        emergency = _is_emergency(bus, 15)
        charging = rank <= ports and power_left > 0
        allocated = min(max_charger, power_left) if charging else 0.0
        power_left -= allocated
        row = _base_result(bus, station, score, emergency, rank, "charging" if allocated > 0 else "waiting")
        row["allocated_kw"] = round(allocated, 3)
        row["explanation"] = "First-come-first-served baseline." if charging else "Waiting: earlier bookings use the available ports."
        result.append(row)
    return result
