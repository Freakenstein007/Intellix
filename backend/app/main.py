import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, inspect, text
from sqlalchemy.orm import Session, joinedload

from .allocator import allocate_fcfs, allocate_power
from .database import Base, SessionLocal, engine, get_db
from .models import Alert, Allocation, Booking, Rating, Station, User, Vehicle
from .schemas import BookingInput, EstimateInput, FaultInput, LoginRequest, RatingInput, StationSettings, VehicleInput
from .services import (
    allocator_settings, booking_dict, finalize_bill, nearby_alternatives,
    recalculate_all, recalculate_station, station_dict,
)
from .seed import seed_database


def require_admin(db: Session, user_id: int | None) -> User:
    user = db.get(User, user_id) if user_id else None
    if user is None or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required for this action.")
    return user


def get_operator(db: Session, operator_id: int) -> User:
    operator = db.get(User, operator_id)
    if operator is None:
        raise HTTPException(status_code=404, detail="Operator not found.")
    if operator.role != "operator":
        raise HTTPException(status_code=403, detail="Choose an operator account.")
    return operator


def _utc_naive(value: datetime | None) -> datetime | None:
    if value and value.tzinfo:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _active_bookings(db: Session, station_id: int) -> list[Booking]:
    return (
        db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.allocation))
        .filter(Booking.station_id == station_id, Booking.status.in_(["queued", "charging"]))
        .all()
    )


def _simulate_tick() -> None:
    speed = max(0.0, float(os.getenv("SIM_SPEED", "1")))
    elapsed_hours = 2 * speed / 60  # two real seconds represent two simulated minutes at SIM_SPEED=1.
    with SessionLocal() as db:
        try:
            now = datetime.utcnow()
            active = (
                db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.allocation), joinedload(Booking.station))
                .filter(Booking.status == "charging")
                .all()
            )
            for booking in active:
                allocation = booking.allocation
                if allocation is None or allocation.allocated_kw <= 0:
                    continue
                remaining_kwh = max(0, (booking.target_pct - booking.current_battery_pct) * booking.vehicle.battery_capacity_kwh / 100)
                delivered = min(remaining_kwh, allocation.allocated_kw * elapsed_hours)
                if delivered <= 0:
                    continue
                booking.energy_delivered_kwh += delivered
                booking.current_battery_pct = min(booking.target_pct, booking.current_battery_pct + delivered / booking.vehicle.battery_capacity_kwh * 100)
                if booking.current_battery_pct >= booking.target_pct - 0.01:
                    booking.current_battery_pct = booking.target_pct
                    booking.status = "completed"
                    booking.completed_at = now
                    finalize_bill(booking)
            # Scores and emergency safe-level transitions are recalculated at each simulation tick.
            recalculate_all(db)
            db.commit()
        except Exception:
            db.rollback()
            raise


async def simulation_loop() -> None:
    while True:
        await asyncio.sleep(2)
        try:
            await asyncio.to_thread(_simulate_tick)
        except Exception as error:
            print(f"AMPWISE simulation tick failed: {error}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Additive migration keeps existing local SQLite demos and PostgreSQL installs
    # working when the emergency-dispatch flag is introduced.
    booking_columns = {column["name"] for column in inspect(engine).get_columns("bookings")}
    if "emergency_override" not in booking_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE bookings ADD COLUMN emergency_override BOOLEAN NOT NULL DEFAULT FALSE"))
    with SessionLocal() as db:
        seed_database(db)
        recalculate_all(db)
        db.commit()
    task = asyncio.create_task(simulation_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="AMPWISE API", version="1.0.0", lifespan=lifespan)
origins = [item.strip() for item in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "app": "AMPWISE", "database": "connected"}


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.get(User, payload.user_id) if payload.user_id else db.query(User).filter(User.role == payload.role).order_by(User.id).first()
    if user is None or user.role != payload.role:
        raise HTTPException(status_code=404, detail="Demo account not found. Run the seed script.")
    return {"id": user.id, "name": user.name, "role": user.role}


@app.get("/api/auth/users")
def users(role: str | None = None, db: Session = Depends(get_db)):
    query = db.query(User)
    if role in {"operator", "admin"}:
        query = query.filter(User.role == role)
    return [{"id": user.id, "name": user.name, "role": user.role} for user in query.order_by(User.id).all()]


@app.get("/api/stations")
def list_stations(db: Session = Depends(get_db)):
    return [station_dict(db, station) for station in db.query(Station).order_by(Station.city).all()]


@app.get("/api/stations/{station_id}")
def get_station(station_id: int, db: Session = Depends(get_db)):
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    return station_dict(db, station)


@app.put("/api/stations/{station_id}")
def update_station(station_id: int, payload: StationSettings, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    if payload.w1 + payload.w2 <= 0:
        raise HTTPException(status_code=422, detail="At least one priority weight must be greater than zero.")
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    for field, value in payload.model_dump().items():
        setattr(station, field, value)
    recalculate_station(db, station)
    db.commit()
    return station_dict(db, station)


@app.post("/api/stations/{station_id}/fault")
def mark_faulty(station_id: int, payload: FaultInput, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    station.is_faulty = True
    station.fault_message = payload.message.strip()
    operator_ids = {
        row[0] for row in db.query(Booking.operator_id).filter(Booking.station_id == station_id).distinct().all()
    }
    for operator_id in operator_ids:
        db.add(Alert(station_id=station_id, operator_id=operator_id, message=station.fault_message))
    db.commit()
    return station_dict(db, station)


@app.post("/api/stations/{station_id}/clear-fault")
def clear_fault(station_id: int, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    station.is_faulty = False
    station.fault_message = None
    db.commit()
    return station_dict(db, station)


@app.get("/api/stations/{station_id}/nearby-alternatives")
def station_alternatives(station_id: int, db: Session = Depends(get_db)):
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    return nearby_alternatives(db, station)


@app.get("/api/vehicles")
def list_vehicles(operator_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Vehicle)
    if operator_id is not None:
        query = query.filter(Vehicle.operator_id == operator_id)
    return [{
        "id": row.id, "reg": row.reg, "vehicle_type": row.vehicle_type, "model": row.model,
        "battery_capacity_kwh": row.battery_capacity_kwh, "connector_type": row.connector_type,
        "operator_id": row.operator_id,
    } for row in query.order_by(Vehicle.reg).all()]


@app.get("/api/vehicles/lookup")
def lookup_vehicle(reg: str, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter(Vehicle.reg == reg.strip().upper()).first()
    if vehicle is None:
        raise HTTPException(status_code=404, detail="New vehicle. Enter its type, model, and battery details.")
    return {
        "id": vehicle.id, "reg": vehicle.reg, "vehicle_type": vehicle.vehicle_type,
        "model": vehicle.model, "battery_capacity_kwh": vehicle.battery_capacity_kwh,
        "connector_type": vehicle.connector_type, "operator_id": vehicle.operator_id,
    }


@app.post("/api/vehicles", status_code=201)
def create_vehicle(payload: VehicleInput, db: Session = Depends(get_db)):
    get_operator(db, payload.operator_id)
    existing = db.query(Vehicle).filter(Vehicle.reg == payload.reg).first()
    if existing:
        for field, value in payload.model_dump(exclude={"operator_id"}).items():
            setattr(existing, field, value)
        db.commit()
        return {"id": existing.id, "reg": existing.reg, "vehicle_type": existing.vehicle_type, "model": existing.model,
                "battery_capacity_kwh": existing.battery_capacity_kwh, "connector_type": existing.connector_type, "operator_id": existing.operator_id}
    vehicle = Vehicle(**payload.model_dump())
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return {"id": vehicle.id, "reg": vehicle.reg, "vehicle_type": vehicle.vehicle_type, "model": vehicle.model,
            "battery_capacity_kwh": vehicle.battery_capacity_kwh, "connector_type": vehicle.connector_type, "operator_id": vehicle.operator_id}


@app.post("/api/bookings/estimate")
def estimate_booking(payload: EstimateInput, db: Session = Depends(get_db)):
    station = db.get(Station, payload.station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    current = _active_bookings(db, station.id)
    draft = {
        "id": "draft", "reg": payload.reg, "range_km": payload.range_km,
        "distance_to_next_station_km": payload.distance_to_next_station_km,
        "battery_pct": payload.battery_pct, "target_pct": payload.target_pct,
        "battery_capacity_kwh": payload.battery_capacity_kwh,
        "emergency_override": payload.emergency_flag,
        "created_at": datetime.utcnow().isoformat(), "wait_minutes": 0,
    }
    inputs = [{
        "id": str(row.id), "reg": row.vehicle.reg, "range_km": row.range_km,
        "distance_to_next_station_km": row.distance_to_next_station_km,
        "battery_pct": row.current_battery_pct, "target_pct": row.target_pct,
        "emergency_override": row.emergency_override,
        "battery_capacity_kwh": row.vehicle.battery_capacity_kwh,
        "created_at": row.created_at.isoformat(), "wait_minutes": max(0, (datetime.utcnow() - row.created_at).total_seconds() / 60),
    } for row in current] + [draft]
    results = allocate_power(
        inputs,
        allocator_settings(station),
        max_range_km=float(os.getenv("MAX_RANGE_KM", "250")),
        max_dist_km=float(os.getenv("MAX_DIST_KM", "100")),
        safe_margin_km=float(os.getenv("SAFE_MARGIN_KM", "15")),
    )
    estimate = next(row for row in results if row["id"] == "draft")
    remaining_kwh = max(0, (payload.target_pct - payload.battery_pct) * payload.battery_capacity_kwh / 100)
    eta = remaining_kwh / estimate["allocated_kw"] * 60 if estimate["allocated_kw"] else None
    return {**estimate, "estimated_completion_minutes": round(eta, 1) if eta is not None else None,
            "queue_length": max(0, len(results) - station.num_ports), "ports_free": station_dict(db, station)["ports_free"]}


@app.post("/api/bookings", status_code=201)
def create_booking(payload: BookingInput, db: Session = Depends(get_db)):
    operator = get_operator(db, payload.operator_id)
    station = db.get(Station, payload.station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    if station.is_faulty:
        raise HTTPException(status_code=409, detail=f"Station unavailable: {station.fault_message or 'marked faulty'}")
    vehicle = db.query(Vehicle).filter(Vehicle.reg == payload.reg).first()
    if vehicle is None:
        vehicle = Vehicle(
            reg=payload.reg, vehicle_type=payload.vehicle_type, model=payload.model,
            battery_capacity_kwh=payload.battery_capacity_kwh, connector_type=payload.connector_type,
            operator_id=operator.id,
        )
        db.add(vehicle)
        db.flush()
    else:
        vehicle.vehicle_type = payload.vehicle_type
        vehicle.model = payload.model
        vehicle.battery_capacity_kwh = payload.battery_capacity_kwh
        vehicle.connector_type = payload.connector_type
    booking = Booking(
        operator_id=operator.id, vehicle_id=vehicle.id, station_id=station.id,
        range_km=payload.range_km, distance_to_next_station_km=payload.distance_to_next_station_km,
        battery_pct=payload.battery_pct, current_battery_pct=payload.battery_pct,
        target_pct=payload.target_pct, preferred_arrival=_utc_naive(payload.preferred_arrival),
        emergency_override=payload.emergency_flag,
        status="queued", created_at=datetime.utcnow(), energy_delivered_kwh=0,
        prepaid_estimate=round(vehicle.battery_capacity_kwh * (payload.target_pct - payload.battery_pct) / 100 * station.tariff, 2),
    )
    db.add(booking)
    db.flush()
    recalculate_station(db, station)
    db.commit()
    db.refresh(booking)
    return {"booking": booking_dict(db, booking), "alternatives": nearby_alternatives(db, station)}


@app.get("/api/bookings")
def list_bookings(operator_id: int | None = None, include_history: bool = True, db: Session = Depends(get_db)):
    query = db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.station), joinedload(Booking.allocation))
    if operator_id is not None:
        query = query.filter(Booking.operator_id == operator_id)
    if not include_history:
        query = query.filter(Booking.status.in_(["queued", "charging"]))
    return [booking_dict(db, row) for row in query.order_by(desc(Booking.created_at)).all()]


@app.get("/api/bookings/{booking_id}")
def get_booking(booking_id: int, db: Session = Depends(get_db)):
    booking = db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.station), joinedload(Booking.allocation)).filter(Booking.id == booking_id).first()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")
    return booking_dict(db, booking)


def _cancel_booking(booking_id: int, db: Session, operator_id: int | None):
    booking = db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.station), joinedload(Booking.allocation)).filter(Booking.id == booking_id).first()
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if operator_id is not None and booking.operator_id != operator_id:
        current = db.get(User, operator_id)
        if current is None or current.role != "admin":
            raise HTTPException(status_code=403, detail="You can only update your own booking.")
    if booking.status == "completed":
        raise HTTPException(status_code=409, detail="Completed sessions cannot be cancelled.")
    if booking.status != "cancelled":
        booking.status = "cancelled"
        booking.completed_at = datetime.utcnow()
        finalize_bill(booking)
        recalculate_station(db, booking.station)
        db.commit()
    return booking_dict(db, booking)


@app.post("/api/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    return _cancel_booking(booking_id, db, x_user_id)


@app.post("/api/bookings/{booking_id}/leave")
def leave_early(booking_id: int, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    return _cancel_booking(booking_id, db, x_user_id)


@app.get("/api/stations/{station_id}/queue")
def station_queue(station_id: int, db: Session = Depends(get_db)):
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    rows = _active_bookings(db, station_id)
    rows.sort(key=lambda row: (row.allocation.rank if row.allocation else 9999, row.created_at))
    data = station_dict(db, station)
    return {
        "station": data,
        "normal_pool_kw": data["normal_pool_kw"], "reserve_pool_kw": data["reserve_pool_kw"],
        "reserve_used_kw": data["reserve_used_kw"], "reserve_released_kw": round(max(0, data["reserve_pool_kw"] - data["reserve_used_kw"]), 1),
        "queue": [booking_dict(db, row) for row in rows],
    }


def _comparison_metrics(rows: list[dict], original: list[Booking]) -> dict:
    by_id = {str(row.id): row for row in original}
    active_rows = [row for row in rows if row["status"] == "charging"]
    waiting_rows = [row for row in rows if row["status"] == "waiting"]
    delays = []
    for row in waiting_rows:
        if row["is_emergency"]:
            continue
        ahead = [other for other in active_rows if other["rank"] < row["rank"]]
        delay = 0.0
        for active_row in ahead:
            booking = by_id.get(str(active_row.get("booking_id", active_row.get("id"))))
            if booking and active_row["allocated_kw"] > 0:
                remaining = max(0, (booking.target_pct - booking.current_battery_pct) * booking.vehicle.battery_capacity_kwh / 100)
                delay += remaining / active_row["allocated_kw"] * 60
        delays.append(delay)
    return {
        "buses_ready": len(active_rows),
        "buses_waiting": len(waiting_rows),
        "peak_load_kw": round(sum(row["allocated_kw"] for row in active_rows), 1),
        "avg_non_emergency_delay_minutes": round(sum(delays) / len(delays), 1) if delays else 0,
        "allocations": [{"reg": row.get("reg"), "rank": row["rank"], "status": row["status"], "allocated_kw": row["allocated_kw"], "is_emergency": row["is_emergency"]} for row in rows],
    }


@app.get("/api/stations/{station_id}/compare")
def compare_allocators(station_id: int, db: Session = Depends(get_db)):
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    bookings = _active_bookings(db, station_id)
    now = datetime.utcnow()
    inputs = [{
        "id": str(row.id), "booking_id": row.id, "reg": row.vehicle.reg,
        "range_km": row.range_km, "distance_to_next_station_km": row.distance_to_next_station_km,
        "battery_pct": row.current_battery_pct, "target_pct": row.target_pct,
        "battery_capacity_kwh": row.vehicle.battery_capacity_kwh,
        "created_at": row.created_at.isoformat(), "wait_minutes": max(0, (now - row.created_at).total_seconds() / 60),
    } for row in bookings]
    settings = allocator_settings(station)
    ampwise = allocate_power(inputs, settings)
    fcfs = allocate_fcfs(inputs, settings)
    return {"ampwise": _comparison_metrics(ampwise, bookings), "fcfs": _comparison_metrics(fcfs, bookings)}


@app.get("/api/analytics/operator/{operator_id}")
def operator_analytics(operator_id: int, db: Session = Depends(get_db)):
    get_operator(db, operator_id)
    sessions = db.query(Booking).options(joinedload(Booking.vehicle), joinedload(Booking.station), joinedload(Booking.allocation)).filter(
        Booking.operator_id == operator_id, Booking.status.in_(["completed", "cancelled"])
    ).order_by(desc(Booking.completed_at)).all()
    series: dict[str, dict] = {}
    for booking in reversed(sessions):
        day = (booking.completed_at or booking.created_at).strftime("%Y-%m-%d")
        point = series.setdefault(day, {"date": day, "energy_kwh": 0.0, "cost_rs": 0.0, "power_kw": 0.0, "sessions": 0})
        point["energy_kwh"] += booking.energy_delivered_kwh
        point["cost_rs"] += booking.final_bill or 0
        point["power_kw"] = max(point["power_kw"], booking.allocation.allocated_kw if booking.allocation else 0)
        point["sessions"] += 1
    avg_by_station = {}
    for station in db.query(Station).all():
        avg, count = None, 0
        ratings = db.query(Rating).filter(Rating.station_id == station.id).all()
        if ratings:
            avg, count = round(sum(r.stars for r in ratings) / len(ratings), 1), len(ratings)
        avg_by_station[str(station.id)] = {"station_id": station.id, "station_name": station.name, "average_stars": avg, "rating_count": count}
    return {
        "sessions": [booking_dict(db, row) for row in sessions],
        "daily": [{"date": row["date"], "energy_kwh": round(row["energy_kwh"], 2), "cost_rs": round(row["cost_rs"], 2), "power_kw": round(row["power_kw"], 1), "sessions": row["sessions"]} for row in series.values()],
        "station_ratings": list(avg_by_station.values()),
    }


@app.post("/api/ratings", status_code=201)
def create_rating(payload: RatingInput, db: Session = Depends(get_db)):
    booking = db.query(Booking).options(joinedload(Booking.station)).filter(Booking.id == payload.booking_id).first()
    if booking is None or booking.operator_id != payload.operator_id:
        raise HTTPException(status_code=404, detail="Completed booking not found for this operator.")
    if booking.status not in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Rate the station after the session is finished.")
    rating = Rating(booking_id=booking.id, station_id=booking.station_id, operator_id=payload.operator_id, stars=payload.stars, comment=payload.comment.strip())
    db.add(rating)
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="This session already has a rating.") from error
    return {"id": rating.id, "booking_id": rating.booking_id, "station_id": rating.station_id, "stars": rating.stars, "comment": rating.comment}


@app.get("/api/alerts")
def get_alerts(operator_id: int, db: Session = Depends(get_db)):
    return [{"id": row.id, "station_id": row.station_id, "station_name": row.station.name,
             "message": row.message, "created_at": row.created_at, "is_read": row.is_read}
            for row in db.query(Alert).options(joinedload(Alert.station)).filter(Alert.operator_id == operator_id).order_by(desc(Alert.created_at)).all()]


@app.get("/api/demo/fleet")
def demo_fleet(db: Session = Depends(get_db)):
    rows = db.query(Vehicle).order_by(Vehicle.reg).all()
    result = []
    for vehicle in rows:
        latest = db.query(Booking).filter(Booking.vehicle_id == vehicle.id).order_by(desc(Booking.created_at)).first()
        result.append({"id": vehicle.id, "reg": vehicle.reg, "vehicle_type": vehicle.vehicle_type,
                       "model": vehicle.model, "battery_capacity_kwh": vehicle.battery_capacity_kwh,
                       "connector_type": vehicle.connector_type, "availability": "Booked" if latest and latest.status in {"queued", "charging"} else "Available",
                       "next_departure": latest.preferred_arrival if latest else None,
                       "range_km": latest.range_km if latest else None})
    return result


@app.post("/api/demo/emergency-bus", status_code=201)
def demo_emergency_bus(station_id: int | None = None, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    operator = db.query(User).filter(User.role == "operator").order_by(User.id).first()
    station = db.get(Station, station_id) if station_id else db.query(Station).filter(Station.city == "Chennai").first()
    if operator is None or station is None:
        raise HTTPException(status_code=404, detail="Seed operators or stations are missing.")
    reg = f"TNAMP{int(datetime.utcnow().timestamp()) % 100000:05d}"
    vehicle = Vehicle(reg=reg, vehicle_type="bus", model="AMPWISE Demo Electric Bus", battery_capacity_kwh=360, connector_type="CCS2", operator_id=operator.id)
    db.add(vehicle)
    db.flush()
    booking = Booking(operator_id=operator.id, vehicle_id=vehicle.id, station_id=station.id,
                      range_km=8, distance_to_next_station_km=48, battery_pct=6, current_battery_pct=6,
                      target_pct=75, emergency_override=True, status="queued", created_at=datetime.utcnow(), energy_delivered_kwh=0,
                      prepaid_estimate=360 * .69 * station.tariff)
    db.add(booking)
    db.flush()
    recalculate_station(db, station)
    db.commit()
    return {"booking": booking_dict(db, booking), "station": station_dict(db, station)}


@app.post("/api/demo/reduce-capacity")
def demo_reduce_capacity(station_id: int, x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    station = db.get(Station, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found.")
    station.total_power_kw = round(station.total_power_kw * .7, 1)
    recalculate_station(db, station)
    db.commit()
    return station_dict(db, station)


@app.post("/api/demo/reset")
def demo_reset(x_user_id: int | None = Header(None), db: Session = Depends(get_db)):
    require_admin(db, x_user_id)
    for model in (Rating, Alert, Allocation, Booking, Vehicle, Station, User):
        db.query(model).delete(synchronize_session=False)
    db.commit()
    seed_database(db)
    return {"ok": True, "message": "AMPWISE demo data reset."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "9000")), reload=True)
