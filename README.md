# 🌊 AGOS-Offline

**Local-AI Drainage Inflow & Flood Mitigation Console for Philippine LGU Command Centers**

Built for the **AppBuildersPH Hackathon 2026** (Theme: *Local AI*).

---

## 🎯 Overview

**AGOS-Offline** is an on-premises, edge-resilient vision system designed for Philippine Local Government Unit (LGU) Disaster Risk Reduction and Management Offices (DRRMO). 

Instead of fragile outdoor IoT microcontrollers, AGOS-Offline connects directly to **existing municipal CCTV camera feeds** (or video loops) over the local intranet. An on-device **YOLOv8 ONNX model** continuously monitors drainage grates and canal culverts and reports how much of the ROI width is covered by solid waste.

When tropical storms knock down cellular towers, fiber backhauls, and cloud services, AGOS-Offline runs **100% offline** on local command center hardware with zero cloud dependencies.

---

## ✨ Key Features

- **Direct CCTV / Video Ingestion:** Ingests live RTSP streams from LGU IP cameras, local MP4 video loops, or USB webcams via OpenCV.
- **Local YOLOv8 ONNX Inference:** Runs on standard CPU or integrated GPU with zero cloud API latency or egress costs.
- **Grate Region of Interest (ROI) Calibration:** Operators can adjust the drainage grate bounding box directly on the live UI canvas. The default ROI is the full frame.
- **Width Coverage & Temporal Smoothing:** Reports debris width coverage of the ROI ($<20\%$ Clear, $20-59\%$ Warning, $\ge 60\%$ Critical Blocked) with a 2-of-3 frame smoothing window to reduce false alarms. See [Model and Metric](#model-and-metric) for what this number means and how far it can be trusted.
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
│   │   │   └── weights/     # best.onnx (12MB) + best.onnx.json sidecar
│   │   ├── services/        # Stream ingestion manager & background processor
│   │   └── main.py          # FastAPI application
│   ├── storage/             # Locally stored incident frames
│   └── requirements.txt
├── frontend/                # Vite + React + TypeScript + Tailwind operator console
├── ml_pipeline/             # Training, coverage gate and export scripts (see ml_pipeline/README.md)
├── sample_media/            # Demo clips; real_demo.mp4 is built from licensed real photos
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

## Model and Metric

**What the console reports.** Width coverage of the ROI: the merged horizontal span of the debris boxes, clipped to the ROI x-range, divided by the ROI width (the same formula as the original AGOS system; the default ROI is the full frame). Clear is below 20%, Warning 20-59%, Critical 60% or more. There is a single class, `debris`; the model does not classify debris types.

**Deployed model.** `backend/app/ml/weights/best.onnx`, version `debris-yolov8n-20261009-7e387c29-gate-overridden` (see `best.onnx.json`). It is a YOLOv8n fine-tuned on about 1.2k images from the [TACO](https://github.com/pedropro/TACO) project (images come from Flickr; per-image Flickr licences were not verified, so **do not redistribute the weights**), plus a small set of permissive Wikimedia Commons photos of clean drains and roads as negatives.

**The coverage gate was not passed. It was overridden by the user.** The export gate (300 TACO validation positives and 60 Commons negatives) requires at least 80% of positives within 15 points of the true coverage and at most 10% false coverage on negatives. The tolerances are proposed defaults, not figures from the original system. The deployed model measured:

| Model | Positives within 15 pts (need >= 80%) | Negative false coverage (max 10%) |
| :--- | :--- | :--- |
| Legacy shipped model | 43.3% | 50.0% |
| First fine-tune | 78.7% | 15.0% |
| **Deployed (fine-tune with negatives)** | **77.7%** | **16.7% (10 of 60)** |

Other numbers for the deployed model: median coverage error 4.36 points, 90th percentile 33.59 points, clear/partial/blocked status agreement 75.3%, CPU inference 37 ms mean (about 27 FPS) with 4 ONNX Runtime threads on the development PC; other machines will differ. It was deployed with `--override-gate` because it is the only model that passes all four stages of the stage demo replay (the legacy model fails; its box recall was 0.0376). The override reason, the failing numbers and `gate_passed: false` are recorded in the sidecar, and the model version ends in `-gate-overridden`.

**What this does not show.**
- Validated on public data only. There is no accuracy claim for real municipal CCTV footage.
- The validation split is by image id, not by scene, so the numbers may be optimistic. The 300 validation positives are also the gate positives, and the checkpoint was selected on them.
- The negative set is small and contains some images with real litter, so part of the false coverage may be real.
- Weak on large dense debris piles (most failing positives are big piles predicted near 0%).
- False coverage on some clean drains and canals.
- Small training set (about 1.2k TACO images; 44 training and 20 held-out negatives).
- The stage demo (`sample_media/real_demo.mp4`) is built from licensed real photos, not live cameras.

**Licence.** The model and Ultralytics YOLOv8 are AGPL-3.0 (the sidecar says `AGPL-3.0 (Ultralytics YOLOv8)`). Do not describe the model as open source in a permissive sense or as MIT. Demo photo attribution is in `sample_media/real_demo/ATTRIBUTION.md`; dataset notes are in `ml_pipeline/README.md`.

**Model status in the console.** `backend/app/ml/weights/best.onnx.json` records the version, training source, SHA-256 and licence of the weights. `GET /api/v1/health` returns a `model` object (also sent as a `model_status` WebSocket message) that includes `model_version` and `sidecar_hash_match`, which is false if the weights file no longer matches the sidecar. To retrain, tighten or re-run the gate, see `ml_pipeline/README.md`.

## Security Notes

- The WebSocket at `/ws` has no authentication.
- `CORS_ORIGINS` defaults to `["*"]`.
- No API route requires authentication.

Run AGOS-Offline on a trusted LAN only. Do not expose port 8000 to the internet.
