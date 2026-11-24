from app.allocator import allocate_fcfs, allocate_power


def station(**overrides):
    value = {
        "total_power_kw": 300,
        "reserve_pct": 12,
        "num_ports": 4,
        "max_charger_kw": 120,
        "floor_pct": 20,
        "w1": 0.6,
        "w2": 0.4,
    }
    value.update(overrides)
    return value


def bus(reg, *, range_km=220, distance=8, battery=45, target=85, created_at="2026-01-01T00:00:00", wait=0, capacity=350):
    return {
        "id": reg,
        "reg": reg,
        "range_km": range_km,
        "distance_to_next_station_km": distance,
        "battery_pct": battery,
        "target_pct": target,
        "battery_capacity_kwh": capacity,
        "created_at": created_at,
        "wait_minutes": wait,
    }


def charging(rows):
    return [row for row in rows if row["status"] == "charging"]


def waiting(rows):
    return [row for row in rows if row["status"] == "waiting"]


def test_normal_case_allocates_power_and_ranks_buses():
    rows = allocate_power([bus("NORMAL-A"), bus("NORMAL-B", range_km=180, distance=14)], station())
    assert len(charging(rows)) == 2
    assert all(row["allocated_kw"] >= 24 for row in charging(rows))
    assert rows[0]["score"] >= rows[1]["score"]
    assert all(not row["is_emergency"] for row in rows)


def test_emergency_uses_reserved_pool_first():
    emergency = bus("URGENT", range_km=18, distance=40, battery=10)
    normal = bus("NORMAL")
    rows = allocate_power([normal, emergency], station(total_power_kw=200, reserve_pct=15, num_ports=2, max_charger_kw=100))
    urgent = next(row for row in rows if row["reg"] == "URGENT")
    assert urgent["is_emergency"] is True
    assert urgent["reserve_allocated_kw"] == 30
    assert urgent["allocated_kw"] == 100


def test_emergency_borrowing_preserves_normal_bus_floor():
    emergency = bus("URGENT", range_km=18, distance=40, battery=10)
    normal = bus("NORMAL")
    rows = allocate_power([normal, emergency], station(total_power_kw=180, reserve_pct=10, num_ports=2, max_charger_kw=120, floor_pct=20))
    urgent = next(row for row in rows if row["reg"] == "URGENT")
    regular = next(row for row in rows if row["reg"] == "NORMAL")
    assert urgent["reserve_allocated_kw"] == 18
    assert urgent["borrowed_kw"] == 102
    assert regular["allocated_kw"] >= 24


def test_dispatcher_override_only_gets_emergency_priority_until_safe_level():
    flagged = bus("FLAGGED", range_km=220, distance=40, battery=5)
    flagged["emergency_override"] = True
    urgent = next(row for row in allocate_power([flagged], station(num_ports=1)) if row["reg"] == "FLAGGED")
    assert urgent["is_emergency"] is True
    flagged["battery_pct"] = urgent["safe_target_pct"] + 1
    safe = next(row for row in allocate_power([flagged], station(num_ports=1)) if row["reg"] == "FLAGGED")
    assert safe["is_emergency"] is False


def test_unused_emergency_reserve_is_released_to_normal_buses():
    rows = allocate_power(
        [bus("N1"), bus("N2", range_km=200, distance=10)],
        station(total_power_kw=300, reserve_pct=12, num_ports=2, max_charger_kw=180),
    )
    assert all(not row["is_emergency"] for row in rows)
    assert all(row["reserve_released_kw"] == 36 for row in rows)
    assert sum(row["allocated_kw"] for row in charging(rows)) == 300


def test_more_buses_than_ports_wait_in_priority_order():
    buses = [bus(f"BUS-{i}", range_km=80 + i * 20, distance=10) for i in range(6)]
    rows = allocate_power(buses, station(num_ports=3))
    assert len(charging(rows)) == 3
    assert len(waiting(rows)) == 3
    assert [row["rank"] for row in rows] == list(range(1, 7))


def test_normal_power_floor_can_move_low_score_bus_to_waiting():
    buses = [bus(f"BUS-{i}", range_km=30 + i * 20, distance=30) for i in range(4)]
    rows = allocate_power(buses, station(total_power_kw=100, reserve_pct=10, num_ports=4, max_charger_kw=100, floor_pct=30))
    assert len(charging(rows)) == 3
    assert len(waiting(rows)) == 1
    assert all(row["allocated_kw"] >= 30 for row in charging(rows) if not row["is_emergency"])


def test_total_allocated_power_never_exceeds_station_limit():
    for reserve in (10, 12, 15):
        for count in range(1, 15):
            buses = [bus(f"B-{i}", range_km=12 + (i * 19) % 230, distance=5 + (i * 7) % 75, battery=(i * 11) % 80) for i in range(count)]
            rows = allocate_power(buses, station(total_power_kw=240, reserve_pct=reserve, num_ports=7, max_charger_kw=90, floor_pct=18))
            assert sum(row["allocated_kw"] for row in charging(rows)) <= 240 + 1e-6


def test_fcfs_baseline_uses_oldest_booking_first():
    rows = allocate_fcfs(
        [bus("NEW", created_at="2026-01-02"), bus("OLD", created_at="2026-01-01")],
        station(total_power_kw=90, num_ports=1, max_charger_kw=90),
    )
    assert rows[0]["reg"] == "OLD"
    assert rows[0]["status"] == "charging"
    assert rows[1]["status"] == "waiting"
