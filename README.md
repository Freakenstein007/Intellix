# AMPWISE — smart EV bus charging

Hackathon prototype for operator charging bookings and dynamic station power allocation. All stations, fleet data, tariffs, charging, bills, and ratings are simulated. The app footer marks this clearly.

## Run locally

Requirements: Python 3.11+, Node.js 20+, and npm. The backend uses SQLAlchemy, creates new tables at startup, and applies a small additive migration for the emergency-override field when upgrading an existing local database.

### 1. Install and start the backend

From the project root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 9000
```

On first startup, AMPWISE creates the schema and seeds two operators, one admin, five Tamil Nadu stations, 18 vehicles, and nine active appointments at the Chennai hub. You can also run the seed command explicitly from `backend`:

```powershell
..\.venv\Scripts\python.exe -m app.seed
```

The backend defaults to a local SQLite file so it runs on a machine without PostgreSQL installed. PostgreSQL remains the configured deployment database. To run against PostgreSQL locally, start the included service, copy the example environment file, and restart the backend:

```powershell
docker compose -f backend\docker-compose.yml up -d
Copy-Item backend\.env.example backend\.env
```

The example file uses `postgresql+psycopg://ampwise:ampwise@localhost:5432/ampwise`. Edit it with your own credentials if needed. No Docker installation is available in some local environments; in that case the SQLite fallback supports the full prototype and tests.

### 2. Install and start the frontend

In a second terminal, from the project root:

```powershell
npm install --prefix frontend
npm --prefix frontend run dev
```

Open [http://localhost:5173](http://localhost:5173). The React app polls REST endpoints every three seconds. Set `VITE_API_BASE` in `frontend/.env` if your API is hosted somewhere else; the default is `http://localhost:9000/api`.

The mobile layout is installable as a PWA. On a phone, open the frontend from a reachable host and choose **Add to Home Screen**. HTTPS is required for install prompts on non-localhost deployments.

### Demo roles

The header role switcher uses seeded demo accounts; there is no password or token flow in this prototype.

- Operator: Kavya Raman (ID 1) or Arjun Selvam (ID 2)
- Admin: Meena Iyer (ID 3)

### Tests and production build

Run the allocator and API tests from the `backend` folder:

```powershell
..\.venv\Scripts\python.exe -m pytest -q
```

Build the React frontend from the project root:

```powershell
npm --prefix frontend run build
```

## Allocation logic

The pure `allocate_power()` function lives in `backend/app/allocator.py` and is covered by the tests in `backend/tests/test_allocator.py`.

```text
range_urgency = 1 − min(range_km / MAX_RANGE_KM, 1)
distance_urgency = min(distance_to_next_station_km / MAX_DIST_KM, 1)
score = w1 × range_urgency + w2 × distance_urgency
margin_km = range_km − distance_to_next_station_km
emergency = margin_km < SAFE_MARGIN_KM and current battery is below the safe level
```

Defaults are `w1=0.6`, `w2=0.4`, `MAX_RANGE_KM=250`, `MAX_DIST_KM=100`, and `SAFE_MARGIN_KM=15`. The thresholds and simulation rate can be changed in `backend/.env`.

The allocator orders emergencies before normal buses, then sorts by score and wait time. It assigns up to the configured port count, protects each normal bus’s floor, gives emergencies the reserve first, permits them to borrow only power above those floors, and releases unused reserve back to normal buses. Emergency priority lasts until the bus reaches enough battery to travel to the next station plus a 20% buffer. Every output includes power, rank, status, score, safe target, reserve/borrowed kW, and an explanation. `allocate_fcfs()` is the comparison baseline.

The simulator ticks every two seconds. `SIM_SPEED=1` represents one simulated minute per real second. Delivered kWh updates battery %, and target completion or early departure settles `energy_delivered_kwh × tariff`; any prepaid estimate above the final bill is returned as a refund.

## Pages and endpoints

- **Overview:** Tamil Nadu Leaflet station map, ports, queue counts, fault state, and active fleet snapshot.
- **Book charging:** vehicle lookup/autofill, range and battery validation, route-ranked station selection with reachable/out-of-range warnings, live queue/power estimate, nearby free-port suggestion, and decorative QR confirmation. Route distances are approximations for the prototype.
- **My charging:** polled battery progress, power, rank, ETA, cancel/leave-early bill adjustment, and recent settlement history.
- **Station queue:** rank table, emergency reserve use, allocation explanations, and Recharts power bars.
- **History & analytics:** energy/cost/power charts and completed-session station ratings.
- **Admin console:** station settings, fault alerts, fleet register, demo controls, and AMPWISE vs FCFS metrics.

Main REST routes live under `/api`: `/auth/login`, `/vehicles/lookup`, `/vehicles`, `/stations`, `/bookings`, `/stations/{id}/queue`, `/stations/{id}/compare`, `/analytics/operator/{id}`, `/ratings`, `/alerts`, and `/demo/*`. FastAPI’s interactive API reference is at [http://localhost:9000/docs](http://localhost:9000/docs).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./ampwise-demo.db` | SQLAlchemy connection; PostgreSQL is supported with `psycopg`. |
| `SIM_SPEED` | `1` | Simulated minutes per real second. |
| `MAX_RANGE_KM` | `250` | Range urgency normalization. |
| `MAX_DIST_KM` | `100` | Next-station distance normalization. |
| `SAFE_MARGIN_KM` | `15` | Emergency classification margin. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin (comma-separated list allowed). |
| `VITE_API_BASE` | `http://localhost:9000/api` | Frontend API base URL. |

## Deployment notes

Deploy the Vite frontend to Vercel or Netlify with `VITE_API_BASE` set to the backend URL. Deploy FastAPI to Render or Railway with a managed PostgreSQL database from Neon or Supabase; set `DATABASE_URL`, `FRONTEND_ORIGIN`, and simulation/algorithm variables there. The role switcher is a demo only: add real authentication, authorization, payment handling, and audit logging before public or operational use.

## File tree

```text
backend/
  app/          FastAPI routes, SQLAlchemy models, allocator, seed, services
  tests/        Allocator unit tests and API integration test
  requirements.txt
  docker-compose.yml
  .env.example
frontend/
  src/          React pages, app shell, map, API helper, i18n, Tailwind styles
  public/       PWA manifest and AMPWISE icon
  package.json
  vite.config.js
  tailwind.config.js
  .env.example
```

### Demo-only features

The main operator, queue, charging, history, and admin screens are localized in English, Hindi, Tamil, and Telugu. In-app alerts cover allocation changes, reserve activation, station alerts, and appointment reminders; optional desktop alerts use the browser Notification API after the operator grants permission. A hosted Web Push service is not configured, and the QR image remains decorative.
