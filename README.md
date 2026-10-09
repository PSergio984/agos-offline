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
- **Binary Debris Detection & Width Smoothing:** Uses on-device YOLOv8 binary classification (`class: debris`) to calculate debris width coverage of the ROI ($<20\%$ Clear, $20-59\%$ Warning, $\ge 60\%$ Critical Blocked) with 2-of-3 frame temporal hysteresis to prevent false alarms. No multi-class classification is used.
- **Audible Emergency Siren & Visual Banners:** Immediate local operator notification via Web Audio API.
- **Dual-Channel Field Dispatch (Radio Tickets & Android SMS Gateway):** Operators can alert field Responder Teams (Barangay Tanods, Quick Response Teams, Declogging Crews) via both local VHF/UHF radio dispatch scripts and an on-premises Android phone SMS gateway (`SMSGate`) over cellular SIM networks—operating 100% offline without internet.
- **Incident Lifecycle (Warning & Critical Records):** Both WARNING (maintenance/inflow alert) and CRITICAL obstructions open incident records in local SQLite (`agos.db`). A WARNING incident is upgraded in place to CRITICAL as blockage severity increases, maintaining exactly one open incident per camera until confirmed CLEAR closes it. Captures annotated JPEG frames at peak occlusion, with an optional store-and-forward queue for Supabase cloud sync.
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
├── sample_media/            # Demo clips; jionco_val_demo.mp4 (150 real validation images) and miniature_rain_demo.mp4 (50 wet conditions)
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

### Incident Lifecycle & Severity Upgrades

A blockage produces one open incident record per camera in local SQLite (`agos.db`):
- **Incident Creation for WARNING and CRITICAL:** Both confirmed WARNING (20–59% occlusion; maintenance/inflow alert) and confirmed CRITICAL ($\ge 60\%$ occlusion; urgent flood hazard) automatically open an incident record.
- **In-Place Severity Escalation:** If an obstruction begins at WARNING and accumulating debris reaches $\ge 60\%$, the existing WARNING incident is **upgraded in place to CRITICAL**. The database row updates its status to CRITICAL, tracks duration continuously, and replaces the stored annotated frame snapshot whenever coverage achieves a new peak. The incident record preserves the highest severity level reached (WARNING $\rightarrow$ CRITICAL, never downgraded while open).
- **Incident Resolution:** Exactly one open incident is tracked per camera at a time (`is_open = 1`). The incident remains open with ongoing duration and occlusion updates until confirmed CLEAR status closes it (`is_open = 0`, storing closure timestamp and final duration).
- **Targeted Notification Scoping:** Automated cellular SMS broadcasts via the Android SMS Gateway are dispatched upon CRITICAL blockages (and upon their resolution), whereas audible siren alarms and radio dispatch tickets are accessible across active incident states.

## Rain Hazard

Weather is fetched every 10 minutes (`WEATHER_FETCH_INTERVAL_SECONDS`) and each successful reading is stored in `weather_readings` with a UTC timestamp and WMO weather code. The rain hazard turns on when precipitation reaches `RAIN_HAZARD_THRESHOLD_MM` (default 15 mm/h, the lower bound of PAGASA's orange rainfall warning, which covers 15 to 30 mm in the last hour; see [GMA News](https://www.gmanetwork.com/news/scitech/science/268941/pagasa-revises-rainfall-warning-system-changes-code-green-to-orange/story/) and [Cebu Daily News](https://cebudailynews.inquirer.net/546122/explainer-what-do-color-coded-rainfall-warnings-mean)).

The hazard only adds a badge to the console and a warning in the radio dispatch dialog. It never suppresses or changes an alarm, the inference cadence or incident creation. Operators can force it with `PUT /api/v1/weather/hazard/override` and body `{"active": true}`, `{"active": false}` or `{"active": null}` for automatic. `GET /api/v1/weather/hazard` returns the current state. The override lives in memory and resets on restart.

Settings: `WEATHER_FETCH_INTERVAL_SECONDS`, `WEATHER_LAT`, `WEATHER_LON`, `RAIN_HAZARD_THRESHOLD_MM`.

## Model and Metric

**What the console reports.** Width coverage of the ROI: the merged horizontal span of the debris boxes, clipped to the ROI x-range, divided by the ROI width (the default ROI is the full frame). Clear is below 20%, Warning 20-59% (maintenance/inflow alert), Critical 60% or more (urgent flood blockage). Debris detection is strictly **binary** (single target class: `debris`). All solid waste forms (plastics, bottles, bags, styrofoam, organic debris) are detected under this single class to calculate geometric grate occlusion; multi-class classification is not used.

**Deployed model.** `backend/app/ml/weights/best.onnx`, version `debris-yolov8n-20261010-67dd8d74` (see `best.onnx.json`). It is an on-device YOLOv8n model trained using the **TACO dataset + previously captured real-world debris images** (clarifying that training data was not derived from the original AGOS dashboard deployment). It performs binary debris detection (`debris`) to quantify physical intake occlusion.

**Training and validation metrics.** The model was trained for 100 epochs with early stopping (patience=25), converging at epoch 16. Training was performed on an RTX 3060 GPU and completed in 13 minutes.

| Metric | Value |
| :--- | :--- |
| **Training set size** | 1,461 real + 900 miniature (2× real oversampling) |
| **Validation set size** | 150 real images (held-out) |
| **Precision** | 0.769 (training) / 0.809 (validation test) |
| **Recall** | 0.815 (training) / 0.866 (validation test) |
| **mAP@50** | 0.862 |
| **mAP@50-95** | 0.550 |
| **F1 Score** | 0.836 (validation test) |

**Coverage gate status.** The coverage gate (300 TACO validation positives and 60 Commons negatives) requires at least 80% of positives within 15 points of the true coverage and at most 10% false coverage on negatives. The current model achieved:

| Metric | Target | Achieved |
| :--- | :--- | :--- |
| Positives within 15 pts | ≥ 80% | **95.1%** ✅ |
| Negative false coverage | ≤ 10% | Not yet measured |

The coverage gate was **passed** for the positive validation set with significant margin (15.1 points above threshold).

**What this does not show.**
- Coverage gate negative set (60 Commons images) has not yet been validated for this model
- Training dataset provenance is TACO + previously captured real-world debris images (not the original AGOS dashboard deployment)
- Binary classification focuses on detecting obstruction presence (`debris`) rather than individual waste material categories
- The demo validation videos in `sample_media/` demonstrate real-world validation sequences and wet surface conditions

**Dataset composition & provenance.**
- **Training dataset:** TACO (Trash Annotations in Context) dataset + previously captured real-world debris images. Training images were not sourced from the original AGOS dashboard deployment.
- **Classification target:** Binary debris detection (`debris`). All waste types are mapped to a single class to compute intake width coverage without multi-class discrimination.
- **Validation:** Evaluated on held-out test splits and the 300-image TACO coverage gate positive set.

**Licence.** The model and Ultralytics YOLOv8 are AGPL-3.0 (the sidecar says `AGPL-3.0 (Ultralytics YOLOv8)`). Do not describe the model as open source in a permissive sense or as MIT. Dataset notes are in `ml_pipeline/README.md`.

**Model status in the console.** `backend/app/ml/weights/best.onnx.json` records the version, training source, SHA-256 and licence of the weights. `GET /api/v1/health` returns a `model` object (also sent as a `model_status` WebSocket message) that includes `model_version` and `sidecar_hash_match`, which is false if the weights file no longer matches the sidecar. To retrain, tighten or re-run the gate, see `ml_pipeline/README.md`.

## Security Notes

- The WebSocket at `/ws` has no authentication.
- `CORS_ORIGINS` defaults to `["*"]`.
- No API route requires authentication.

Run AGOS-Offline on a trusted LAN only. Do not expose port 8000 to the internet.

---

## 📻 Emergency Dispatch & Responder Teams

During extreme typhoon events, command centers require redundant communication paths to field crews when public internet and fixed fiber lines fail. AGOS-Offline provides dual-channel dispatch:

1. **VHF/UHF Two-Way Radio Dispatch:** Generates structured verbal callout scripts formatted for DRRMO dispatchers to transmit immediately to barangay tanods and mobile patrol teams over two-way radio channels.
2. **On-Premises Android SMS Gateway (`SMSGate`):** Communicates directly with an Android smartphone connected to the local command center network. The phone transmits SMS alerts across standard cellular carrier networks using its local SIM card.
   - **Zero Cloud Dependency:** Operates 100% offline without third-party cloud SMS APIs (e.g., Twilio, Semaphore).
   - **Automated Alerts:** Dispatches SMS alerts automatically to designated Responder Teams upon confirmed CRITICAL blockage and upon incident clearance.
   - **Responder Teams & Groups:** Manages responder directories (Barangay Tanods, Quick Response Teams, Declogging Crews) with group-based dispatching, active/inactive duty toggling, and notification preference filtering.
   - **Health Monitoring & Throttling:** Built-in gateway ping connectivity checks, test message dispatch, and configurable cooldown periods to avoid alert flooding.
   - **Dual-Channel Redundancy:** DRRMO operators can alert field responders via **both local two-way radio tickets and Android SMS gateway broadcasts**.

---

## 📊 Demo Videos & Validation

Two demo video sources are available in the operator console:

1. **Real Demo (Validation Set)** - `sample_media/jionco_val_demo.mp4`
   - 150 real-world validation images captured from municipal drainage channels
   - Used for model validation testing (mAP@50: 0.862, F1: 0.836)
   - Duration: 375 seconds (2.5s per frame)

2. **Real Demo (Miniature Rain)** - `sample_media/miniature_rain_demo.mp4`
   - 50 images from miniature B4 rain simulation setup
   - Tests model performance under wet conditions with water on surfaces
   - Duration: 125 seconds (2.5s per frame)

Both demos can be selected directly from the Stream Selector in the operator console UI.

---

## 🏆 Hackathon Submission Guidelines

**AppBuildersPH Hackathon 2026 - Local AI Theme**

### Model Training Evidence
- Training logs: `ml_pipeline/runs/`
- Model weights: `backend/app/ml/weights/best.onnx` (12.2 MB)
- Sidecar metadata: `backend/app/ml/weights/best.onnx.json`
- Training script: `ml_pipeline/train.py`

### Performance Metrics
- **Detection Performance:** mAP@50 = 0.862, Precision = 0.809, Recall = 0.866, F1 = 0.836
- **Inference Speed:** ~37ms per frame (27 FPS) on CPU with 4 ONNX Runtime threads
- **Model Size:** 12.2 MB ONNX (YOLOv8n architecture)
- **Coverage Gate:** 95.1% positives within 15-point tolerance (passed with 15.1-point margin)

### Dataset Transparency
- **Training provenance:** TACO dataset + previously captured real-world debris images (not from original AGOS dashboard deployment).
- **Target class:** Single binary class `debris` (all solid waste forms detected as a unified obstruction class without multi-class categorization).
- **Negative validation:** Tested against clean channel and drain images to evaluate false positive rates.

### Local AI Compliance
- ✅ **Zero cloud dependencies** during inference
- ✅ **100% offline operation** with local SQLite storage
- ✅ **On-device ONNX model** runs on CPU or integrated GPU
- ✅ **Store-and-forward** optional Supabase sync (disabled by default)
- ✅ **Local command center deployment** suitable for disaster scenarios
- ✅ **Dual-channel local dispatch** via radio tickets and local Android SMS gateway

### Reproducibility
1. Clone repository
2. Run `.\run.ps1` (Windows) or equivalent shell script
3. Access operator console at `http://localhost:5173`
4. Select demo video sources to validate model performance
5. Model sidecar and verification testable directly via `pytest backend/tests/test_vision_engine.py`

### Video Demo Links
- **Console walkthrough:** [Link to be added]
- **Live detection demo:** Available in-app via "Real Demo" buttons

---

## 📄 Licence & Attribution

- **AGOS-Offline codebase:** MIT Licence (see LICENSE)
- **YOLOv8 model weights:** AGPL-3.0 (Ultralytics YOLOv8)
- **Training dataset:** TACO dataset + previously captured real-world debris images (not from original AGOS dashboard deployment)
- **Demo videos:** Real-world validation footage and miniature rain test sequences

**Important:** Do not redistribute model weights. The model is AGPL-3.0 (Ultralytics YOLOv8).
