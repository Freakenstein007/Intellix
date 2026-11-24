from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import Booking, Station, User, Vehicle
from .services import recalculate_all


STATIONS = [
    {"name": "Gandhipuram Hub", "city": "Coimbatore", "lat": 11.0168, "lng": 76.9558, "num_ports": 3, "total_power_kw": 180, "reserve_pct": 12, "max_charger_kw": 90, "floor_pct": 20, "tariff": 18, "w1": .6, "w2": .4},
    {"name": "Guindy Transit Depot", "city": "Chennai", "lat": 13.0067, "lng": 80.2206, "num_ports": 4, "total_power_kw": 300, "reserve_pct": 12, "max_charger_kw": 120, "floor_pct": 20, "tariff": 22, "w1": .6, "w2": .4},
    {"name": "Mattuthavani Terminal", "city": "Madurai", "lat": 9.9391, "lng": 78.1256, "num_ports": 3, "total_power_kw": 210, "reserve_pct": 12, "max_charger_kw": 100, "floor_pct": 20, "tariff": 19, "w1": .6, "w2": .4},
    {"name": "Srirangam Depot", "city": "Tiruchirappalli", "lat": 10.8624, "lng": 78.6947, "num_ports": 3, "total_power_kw": 180, "reserve_pct": 12, "max_charger_kw": 90, "floor_pct": 20, "tariff": 18, "w1": .6, "w2": .4},
    {"name": "New Bus Stand Charge Point", "city": "Salem", "lat": 11.6643, "lng": 78.1460, "num_ports": 2, "total_power_kw": 120, "reserve_pct": 12, "max_charger_kw": 80, "floor_pct": 20, "tariff": 17, "w1": .6, "w2": .4},
]

VEHICLE_ROWS = [
    ("TN38AB1001", "bus", "Ashok Leyland Circuit S", 350, "CCS2"),
    ("TN38AB1002", "bus", "Olectra X1", 360, "CCS2"),
    ("TN38AB1003", "bus", "Switch EiV 12", 400, "CCS2"),
    ("TN38AB1004", "bus", "Tata Starbus EV", 320, "CCS2"),
    ("TN38AB1005", "bus", "Ashok Leyland Circuit S", 350, "CCS2"),
    ("TN38AB1006", "bus", "Olectra X1", 360, "CCS2"),
    ("TN38AB1007", "bus", "Switch EiV 12", 400, "CCS2"),
    ("TN38AB1008", "bus", "Tata Starbus EV", 320, "CCS2"),
    ("TN38AB1009", "bus", "Ashok Leyland Circuit S", 350, "CCS2"),
    ("TN38AB1010", "bus", "Olectra X1", 360, "CCS2"),
    ("TN38AB1011", "bus", "Switch EiV 12", 400, "CCS2"),
    ("TN38AB1012", "bus", "Tata Starbus EV", 320, "CCS2"),
    ("TN37CAB0201", "cab", "Tata Nexon EV", 40, "CCS2"),
    ("TN37CAB0202", "cab", "MG ZS EV", 50, "CCS2"),
    ("TN09HOSP301", "hospital vehicle", "Mahindra eVerito Ambulance", 32, "CCS2"),
    ("TN09PRIV401", "private", "Hyundai Kona Electric", 64, "CCS2"),
    ("TN33PRIV402", "private", "Tata Punch EV", 35, "CCS2"),
    ("TN45PRIV403", "private", "BYD Atto 3", 60, "CCS2"),
]


def seed_database(db: Session) -> None:
    if db.query(Station).count():
        return
    op1 = User(name="Kavya Raman", role="operator")
    op2 = User(name="Arjun Selvam", role="operator")
    admin = User(name="Meena Iyer", role="admin")
    db.add_all([op1, op2, admin])
    db.flush()
    stations = [Station(**row) for row in STATIONS]
    db.add_all(stations)
    db.flush()
    vehicles = []
    for index, (reg, kind, model, capacity, connector) in enumerate(VEHICLE_ROWS):
        operator_id = op1.id if index % 2 == 0 else op2.id
        vehicles.append(Vehicle(reg=reg, vehicle_type=kind, model=model, battery_capacity_kwh=capacity, connector_type=connector, operator_id=operator_id))
    db.add_all(vehicles)
    db.flush()

    # Nine live appointments at Chennai create a visible charging and wait queue on first launch.
    chennai = stations[1]
    now = datetime.utcnow()
    start_levels = [12, 28, 36, 20, 42, 31, 16, 50, 24]
    ranges = [18, 64, 72, 38, 95, 61, 22, 130, 44]
    next_distances = [40, 22, 18, 34, 27, 42, 32, 24, 51]
    for index in range(9):
        vehicle = vehicles[index]
        battery = start_levels[index]
        db.add(Booking(
            operator_id=vehicle.operator_id,
            vehicle_id=vehicle.id,
            station_id=chennai.id,
            range_km=ranges[index],
            distance_to_next_station_km=next_distances[index],
            battery_pct=battery,
            current_battery_pct=battery,
            target_pct=82 if index < 6 else 75,
            preferred_arrival=now + timedelta(minutes=8 + index * 4),
            status="queued",
            created_at=now - timedelta(minutes=3 * (9 - index)),
            energy_delivered_kwh=0,
            prepaid_estimate=0,
        ))
    db.flush()
    for booking in db.query(Booking).all():
        booking.prepaid_estimate = round(
            booking.vehicle.battery_capacity_kwh * (booking.target_pct - booking.battery_pct) / 100 * booking.station.tariff,
            2,
        )
    recalculate_all(db)
    db.commit()


def init_and_seed() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db)


if __name__ == "__main__":
    init_and_seed()
    print("AMPWISE database seeded.")
