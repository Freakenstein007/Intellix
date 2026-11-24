from datetime import datetime
from math import asin, cos, radians, sin, sqrt
import os

from sqlalchemy.orm import Session, joinedload

from .allocator import allocate_fcfs, allocate_power
from .models import Allocation, Booking, Rating, Station


def allocator_settings(station: Station) -> dict:
    return {
        "total_power_kw": station.total_power_kw,
        "reserve_pct": station.reserve_pct,
        "num_ports": station.num_ports,
        "max_charger_kw": station.max_charger_kw,
        "floor_pct": station.floor_pct,
        "w1": station.w1,
        "w2": station.w2,
    }


def _bus_input(booking: Booking, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    wait = max(0, (now - booking.created_at).total_seconds() / 60)
    return {
        "id": str(booking.id),
        "booking_id": booking.id,
        "reg": booking.vehicle.reg,
        "range_km": booking.range_km,
        "distance_to_next_station_km": booking.distance_to_next_station_km,
        "battery_pct": booking.current_battery_pct,
        "emergency_override": booking.emergency_override,
        "target_pct": booking.target_pct,
        "battery_capacity_kwh": booking.vehicle.battery_capacity_kwh,
        "created_at": booking.created_at.isoformat(),
        "wait_minutes": wait,
    }


def recalculate_station(db: Session, station: Station) -> list[dict]:
    now = datetime.utcnow()
    bookings = (
        db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.allocation))
        .filter(Booking.station_id == station.id, Booking.status.in_(["queued", "charging"]))
        .all()
    )
    settings = allocator_settings(station)
    result = allocate_power(
        [_bus_input(booking, now) for booking in bookings],
        settings,
        max_range_km=float(os.getenv("MAX_RANGE_KM", "250")),
        max_dist_km=float(os.getenv("MAX_DIST_KM", "100")),
        safe_margin_km=float(os.getenv("SAFE_MARGIN_KM", "15")),
    )
    by_id = {int(row["booking_id"]): row for row in result}
    for booking in bookings:
        row = by_id[booking.id]
        was_charging = booking.status == "charging"
        booking.status = "charging" if row["status"] == "charging" else "queued"
        if booking.status == "charging" and not was_charging:
            booking.started_at = booking.started_at or now
        allocation = booking.allocation
        if allocation is None:
            allocation = Allocation(booking_id=booking.id)
            booking.allocation = allocation
            db.add(allocation)
        allocation.allocated_kw = row["allocated_kw"]
        allocation.reserve_allocated_kw = row.get("reserve_allocated_kw", 0)
        allocation.borrowed_kw = row.get("borrowed_kw", 0)
        allocation.rank = row["rank"]
        allocation.is_emergency = row["is_emergency"]
        allocation.score = row["score"]
        allocation.safe_target_pct = row["safe_target_pct"]
        allocation.explanation = row["explanation"]
        allocation.updated_at = now
    db.flush()
    return result


def recalculate_all(db: Session) -> None:
    for station in db.query(Station).all():
        recalculate_station(db, station)


def _rating_summary(db: Session, station_id: int) -> tuple[float | None, int]:
    ratings = db.query(Rating).filter(Rating.station_id == station_id).all()
    if not ratings:
        return None, 0
    return round(sum(row.stars for row in ratings) / len(ratings), 1), len(ratings)


def station_dict(db: Session, station: Station) -> dict:
    active = db.query(Booking).options(joinedload(Booking.allocation)).filter(
        Booking.station_id == station.id, Booking.status.in_(["queued", "charging"])
    ).all()
    charging = [row for row in active if row.status == "charging"]
    avg_rating, rating_count = _rating_summary(db, station.id)
    reserve_kw = station.total_power_kw * station.reserve_pct / 100
    return {
        "id": station.id, "name": station.name, "city": station.city,
        "lat": station.lat, "lng": station.lng, "num_ports": station.num_ports,
        "total_power_kw": station.total_power_kw, "reserve_pct": station.reserve_pct,
        "reserve_pool_kw": round(reserve_kw, 1), "normal_pool_kw": round(station.total_power_kw - reserve_kw, 1),
        "max_charger_kw": station.max_charger_kw, "floor_pct": station.floor_pct,
        "tariff": station.tariff, "w1": station.w1, "w2": station.w2,
        "is_faulty": station.is_faulty, "fault_message": station.fault_message,
        "active_count": len(active), "queue_length": max(0, len(active) - station.num_ports),
        "ports_busy": len(charging), "ports_free": 0 if station.is_faulty else max(0, station.num_ports - len(charging)),
        "allocated_kw": round(sum(row.allocation.allocated_kw if row.allocation else 0 for row in charging), 1),
        "reserve_used_kw": round(sum(row.allocation.reserve_allocated_kw if row.allocation else 0 for row in charging), 1),
        "avg_rating": avg_rating, "rating_count": rating_count,
    }


def booking_dict(db: Session, booking: Booking) -> dict:
    vehicle = booking.vehicle
    station = booking.station
    allocation = booking.allocation
    start_pct = booking.battery_pct
    delivered_pct = max(0, booking.current_battery_pct - start_pct)
    total_pct = max(0.1, booking.target_pct - start_pct)
    progress = min(100, delivered_pct / total_pct * 100)
    remaining_kwh = max(0, (booking.target_pct - booking.current_battery_pct) * vehicle.battery_capacity_kwh / 100)
    allocated_kw = allocation.allocated_kw if allocation else 0
    eta_minutes = remaining_kwh / allocated_kw * 60 if allocated_kw > 0 else None
    return {
        "id": booking.id, "operator_id": booking.operator_id, "vehicle_id": vehicle.id,
        "reg": vehicle.reg, "vehicle_type": vehicle.vehicle_type, "model": vehicle.model,
        "battery_capacity_kwh": vehicle.battery_capacity_kwh, "connector_type": vehicle.connector_type,
        "station_id": station.id, "station_name": station.name, "city": station.city,
        "range_km": booking.range_km, "distance_to_next_station_km": booking.distance_to_next_station_km,
        "battery_pct": booking.battery_pct, "current_battery_pct": round(booking.current_battery_pct, 2),
        "target_pct": booking.target_pct, "preferred_arrival": booking.preferred_arrival,
        "emergency_override": booking.emergency_override,
        "status": booking.status, "created_at": booking.created_at, "started_at": booking.started_at,
        "completed_at": booking.completed_at, "energy_delivered_kwh": round(booking.energy_delivered_kwh, 2),
        "prepaid_estimate": round(booking.prepaid_estimate, 2), "final_bill": booking.final_bill,
        "refund": booking.refund, "amount_due": booking.amount_due, "progress_pct": round(progress, 1),
        "allocated_kw": round(allocated_kw, 1), "rank": allocation.rank if allocation else None,
        "is_emergency": allocation.is_emergency if allocation else False,
        "score": round(allocation.score, 3) if allocation else None,
        "safe_target_pct": allocation.safe_target_pct if allocation else None,
        "explanation": allocation.explanation if allocation else "Waiting for allocation.",
        "reserve_allocated_kw": allocation.reserve_allocated_kw if allocation else 0,
        "borrowed_kw": allocation.borrowed_kw if allocation else 0,
        "has_rating": db.query(Rating).filter(Rating.booking_id == booking.id, Rating.operator_id == booking.operator_id).first() is not None,
        "remaining_kwh": round(remaining_kwh, 2),
        "estimated_completion_minutes": round(eta_minutes, 1) if eta_minutes is not None else None,
    }


def nearby_alternatives(db: Session, station: Station) -> list[dict]:
    candidates = db.query(Station).filter(Station.id != station.id).all()
    def distance(other: Station) -> float:
        lat1, lat2 = radians(station.lat), radians(other.lat)
        dlat, dlng = lat2 - lat1, radians(other.lng - station.lng)
        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
        return 6371 * 2 * asin(sqrt(a))
    result = []
    for other in candidates:
        data = station_dict(db, other)
        if data["ports_free"] > 0 and not other.is_faulty:
            result.append({**data, "distance_km": round(distance(other), 1)})
    return sorted(result, key=lambda row: row["distance_km"])


def finalize_bill(booking: Booking) -> None:
    station = booking.station
    booking.final_bill = round(booking.energy_delivered_kwh * station.tariff, 2)
    booking.refund = round(max(0, booking.prepaid_estimate - booking.final_bill), 2)
    booking.amount_due = round(max(0, booking.final_bill - booking.prepaid_estimate), 2)
