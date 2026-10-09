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
