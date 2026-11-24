from fastapi.testclient import TestClient

from app.main import app


def test_seeded_network_and_booking_api():
    with TestClient(app) as client:
        # The SQLite demo database may already have advanced through simulator ticks.
        # Reset first so the integration assertions always start from a known seed.
        reset = client.post("/api/demo/reset", headers={"X-User-Id": "3"})
        assert reset.status_code == 200
        stations = client.get("/api/stations").json()
        assert len(stations) == 5
        assert {row["city"] for row in stations} == {"Coimbatore", "Chennai", "Madurai", "Tiruchirappalli", "Salem"}

        chennai = next(row for row in stations if row["city"] == "Chennai")
        queue = client.get(f"/api/stations/{chennai['id']}/queue").json()
        assert len(queue["queue"]) == 9
        assert sum(row["status"] == "charging" for row in queue["queue"]) <= chennai["num_ports"]

        coimbatore = next(row for row in stations if row["city"] == "Coimbatore")
        payload = {
            "operator_id": 1, "station_id": coimbatore["id"], "reg": "TNAPI001",
            "vehicle_type": "bus", "model": "API Test Electric Bus", "battery_capacity_kwh": 360,
            "connector_type": "CCS2", "range_km": 100, "distance_to_next_station_km": 18,
            "battery_pct": 30, "target_pct": 80,
        }
        created = client.post("/api/bookings", json=payload)
        assert created.status_code == 201
        booking = created.json()["booking"]
        assert booking["allocated_kw"] > 0
        assert booking["rank"] == 1
        assert client.get("/api/vehicles/lookup?reg=TNAPI001").json()["model"] == "API Test Electric Bus"

        # Leave the local database in its original, seeded demo state after this API check.
        reset = client.post("/api/demo/reset", headers={"X-User-Id": "3"})
        assert reset.status_code == 200
