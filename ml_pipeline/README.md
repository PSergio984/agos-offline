# 🌊 AGOS-Offline: YOLOv8 Debris ML Pipeline

Specialized dataset assembly, fine-tuning, ONNX export, and CPU benchmarking toolchain for urban drainage grate obstruction detection.

---

## 🎯 Overview

This pipeline trains and optimizes lightweight **YOLOv8n** models to run on standard Philippine LGU DRRMO laptop CPUs (Intel/AMD multi-core, no dedicated GPU required) with zero cloud dependencies.

### Key Capabilities
- **Debris Taxonomy Standardization:** Merges aquatic litter datasets (TACO, FloW, custom street runoff captures) into a single high-confidence `debris` class (id `0`).
- **False-Alarm Suppression:** Systematically injects 10–15% clean drainage background images (grates with rushing water, asphalt, night glare) with zero bounding boxes.
- **Unified Output Contract:** Exports standard `[1, 5, 8400]` single-class ONNX weights, directly compatible with both:
  - **AGOS-Offline** (2D Grate Region of Interest raster union occlusion calculation).
  - **AGOS-Backend** (Cloud/edge image upload & multi-sensor risk fusion).
- **Adaptive Cadence Synergy:** Complements AGOS-Offline's adaptive inference scheduler (30s CLEAR idle, bursting to 3s when debris enters the grate ROI).

---

## 🚀 Quick Start

### 1. Environment Setup (Isolated Virtualenv)

Create a dedicated virtual environment so heavy PyTorch/Ultralytics dependencies do not bloat the lean production console:

```powershell
cd ml_pipeline
python -m venv venv-train
venv-train\Scripts\activate
pip install -r requirements-train.txt
```

### 2. Assemble the Dataset

Generate a verification starter dataset with clean grate negatives and drainage frames:

```powershell
python prepare_dataset.py --generate-starter --samples 150
```

To use custom datasets, place images and YOLO txt labels into `ml_pipeline/dataset/` and run:

```powershell
python prepare_dataset.py --output-dir ml_pipeline/dataset
```

### 3. Fine-Tune YOLOv8n

Train with flood/drainage augmentations (lighting variation, perspective, mosaic):

```powershell
python train.py --epochs 30 --batch 16 --device cpu
```

*(Note: If an NVIDIA GPU is available on your development workstation, use `--device 0` for significantly faster training).*

### 4. Export to ONNX, Benchmark CPU Latency & Deploy

Export `best.pt` to CPU-optimized ONNX, measure laptop latency and FPS, and automatically deploy to `backend/app/ml/weights/best.onnx`:

```powershell
python export_and_benchmark.py --weights ml_pipeline/runs/debris_yolov8n/weights/best.pt --iterations 50 --deploy
```

To also deploy the model directly into `agos-backend`:

```powershell
python export_and_benchmark.py --weights ml_pipeline/runs/debris_yolov8n/weights/best.pt --deploy --sync-backend
```

---

## 📊 Expected Performance on Laptop Hardware

| Metric | Quad-Core Laptop CPU (i5/i7/Ryzen 5) | Dual-Core Budget Laptop (i3/Celeron) |
| :--- | :--- | :--- |
| **Model Size** | 12.2 MB (FP32 ONNX) | 12.2 MB (FP32 ONNX) |
| **Inference Latency** | 30 – 45 ms / frame | 70 – 110 ms / frame |
| **Max Sustained FPS** | 22 – 33 FPS | 9 – 14 FPS |
| **CLEAR Mode CPU Load (30s)** | **$< 3\%$ CPU** | **$< 6\%$ CPU** |
| **Burst Mode CPU Load (3s)** | **$< 8\%$ CPU** | **$< 15\%$ CPU** |
