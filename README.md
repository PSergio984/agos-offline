# 🌊 AGOS-Offline

**Local-AI Drainage Inflow & Flood Mitigation Console for Philippine LGU Command Centers**

Built for the **AppBuildersPH Hackathon 2026** (Theme: *Local AI*).

---

## 🎯 Overview

**AGOS-Offline** is an on-premises, edge-resilient vision system designed for Philippine Local Government Unit (LGU) Disaster Risk Reduction and Management Offices (DRRMO). 

Instead of fragile outdoor IoT microcontrollers, AGOS-Offline connects directly to **existing municipal CCTV camera feeds** (or video loops) over the local intranet. An on-device **YOLOv8 ONNX model** continuously monitors drainage grates and canal culverts, measuring solid waste occlusion and surface water ponding in real time.

When tropical storms knock down cellular towers, fiber backhauls, and cloud services, AGOS-Offline runs **100% offline** on local command center hardware with zero cloud dependencies.

---

## ✨ Key Features

- **Direct CCTV / Video Ingestion:** Ingests live RTSP streams from LGU IP cameras, local MP4 video loops, or USB webcams via OpenCV.
- **Local YOLOv8 ONNX Inference:** Runs on standard CPU or integrated GPU with zero cloud API latency or egress costs.
- **Grate Region of Interest (ROI) Calibration:** Operators can adjust the drainage grate bounding box directly on the live UI canvas.
- **Occlusion Ratio & Temporal Smoothing:** Quantifies trash coverage percentage ($<25\%$ Clear, $25-60\%$ Warning, $\ge 60\%$ Critical Blocked) with a 2-of-3 frame smoothing window to reject false positives.
- **Audible Emergency Siren & Visual Banners:** Immediate local operator notification via Web Audio API.
- **VHF/UHF Radio Dispatch Tickets:** Auto-generates standard voice radio scripts for command center dispatchers to alert mobile patrol units and barangay tanods.
- **Embedded SQLite & Local Storage:** Stores incident snapshots and logs locally on disk (`agos.db`) with an optional store-and-forward queue for Supabase cloud sync when connectivity is restored.
- **Single-Click Runner:** Start both backend and operator console with one script (`run.bat` or `run.ps1`).

---

## 🏗️ Architecture

```
agos-offline/
├── backend/
│   ├── app/
│   │   ├── api/             # REST endpoints (cameras, incidents, weather) & WebSocket
│   │   ├── core/            # Config, SQLite database engine
│   │   ├── ml/              # YOLOv8 ONNX model, preprocessing, occlusion math
│   │   │   └── weights/     # best.onnx (12MB)
│   │   ├── services/        # Stream ingestion manager & background processor
│   │   └── main.py          # FastAPI application
│   ├── storage/             # Locally stored incident frames
│   └── requirements.txt
├── frontend/                # Vite + React + TypeScript + Tailwind operator console
├── sample_media/            # Preloaded drainage demo clips for hackathon judging
├── run.bat                  # Windows 1-click launcher
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+

### Setup & Launch

Run the launch script from the root directory:

```powershell
.\run.ps1
```

Or manually:

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m app.main

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` to access the Operator Console.


---

## Inference Cadence

Frames are acquired continuously, but the model only runs on a schedule to save CPU and battery.

| Mode | Interval | Entered when | Left when |
| --- | --- | --- | --- |
| Clear | 15 s | default | n/a |
| Burst | 3 s | raw occlusion >= 2.0% of the ROI, or confirmed status is not CLEAR | confirmed CLEAR, 3 clean inferences, 15 s dwell and 60 s since the last alert |
| Settled | 10 s | confirmed CRITICAL held for 15 s | any non-critical raw reading drops back to Burst |

A blockage produces one open incident per camera. It stays open, with its occlusion and duration updating, until the status is confirmed CLEAR.

## Rain Hazard

Weather is fetched every 10 minutes (`WEATHER_FETCH_INTERVAL_SECONDS`) and each successful reading is stored in `weather_readings` with a UTC timestamp and WMO weather code. The rain hazard turns on when precipitation reaches `RAIN_HAZARD_THRESHOLD_MM` (default 15 mm/h, the lower bound of PAGASA's orange rainfall warning, which covers 15 to 30 mm in the last hour; see [GMA News](https://www.gmanetwork.com/news/scitech/science/268941/pagasa-revises-rainfall-warning-system-changes-code-green-to-orange/story/) and [Cebu Daily News](https://cebudailynews.inquirer.net/546122/explainer-what-do-color-coded-rainfall-warnings-mean)).

The hazard only adds a badge to the console and a warning in the radio dispatch dialog. It never suppresses or changes an alarm, the inference cadence or incident creation. Operators can force it with `PUT /api/v1/weather/hazard/override` and body `{"active": true}`, `{"active": false}` or `{"active": null}` for automatic. `GET /api/v1/weather/hazard` returns the current state. The override lives in memory and resets on restart.

Settings: `WEATHER_FETCH_INTERVAL_SECONDS`, `WEATHER_LAT`, `WEATHER_LON`, `RAIN_HAZARD_THRESHOLD_MM`.

## Model Status

`backend/app/ml/weights/best.onnx.json` records the version, training source, SHA-256 and licence of the weights. `GET /api/v1/health` returns a `model` object (also sent as a `model_status` WebSocket message) that includes `sidecar_hash_match`, which is false if the weights file no longer matches the sidecar. The current weights are tagged `legacy-unknown` because their provenance was not recorded. The weights come from Ultralytics YOLOv8 (AGPL-3.0).

## Security Notes

- The WebSocket at `/ws` has no authentication.
- `CORS_ORIGINS` defaults to `["*"]`.
- No API route requires authentication.

Run AGOS-Offline on a trusted LAN only. Do not expose port 8000 to the internet.
