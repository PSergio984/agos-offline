# AGOS-Offline: debris detector training pipeline

Isolated toolchain to fine-tune YOLOv8n, check the ONNX export against a coverage gate, and deploy to the offline console. Nothing here is imported by the runtime; heavy PyTorch/Ultralytics dependencies stay in `venv-train`.

## Honest status

- **What the console reports.** Width coverage of the ROI: the merged horizontal span of the debris boxes, clipped to the ROI x-range, divided by the ROI width (same formula as the original AGOS system; the default ROI is the full frame). Clear < 20%, Warning 20-59%, Critical >= 60%. Single class `debris`; there is no debris-type classification.
- **The coverage gate was NOT passed. It was overridden by the user.** The deployed model (`backend/app/ml/weights/best.onnx`, version `debris-yolov8n-20261009-7e387c29-gate-overridden`) fails the gate. It was deployed with `--override-gate` because it is the only model that passes all four stages of the stage demo replay. The legacy shipped model fails that replay (box recall 0.0376). The override reason and failing numbers are in `best.onnx.json`.
- **The gate tolerances are proposed defaults, not figures from the original system.** 15 percentage points, 80% of positives within tolerance, at most 10% false coverage on negatives. Nobody has shown that these values are the right bar for real drains.
- **Validated on public data only.** No LGU/CCTV footage was collected or hand-labelled. TACO photos are close-range street and beach litter, a different domain from a drain-grate camera, so the numbers are indicative, not a field accuracy claim.
- **The numbers may be optimistic.** The TACO validation split is by image id (`image_id % 5 == 0`), not by scene, so near-duplicate scenes can appear on both sides. The 300 validation positives are also the gate positives, and the checkpoint was selected on them.
- **The negative set is small and imperfect.** 60 gate negatives (Wikimedia Commons drains, canals, gutters and roads) and 44 training plus 20 held-out negatives. Some negative images contain real litter, so part of the measured false coverage may be real.
- **Licence of the model.** Ultralytics and the trained weights are **AGPL-3.0** (the sidecar says `AGPL-3.0 (Ultralytics YOLOv8)`). Do not describe the model as open source in a permissive sense or as MIT.
- **Do not redistribute the weights.** The positives are TACO images that come from Flickr. TACO annotations are CC BY 4.0, but the per-image Flickr licences were **not verified** for this training run.
- **Privacy.** The earlier `prepare_dataset.py` pipeline blurs faces and plates with OpenCV Haar cascades (partial recall). The TACO and Commons images used for the deployed model were not run through it.

## Results

Gate set: 300 TACO validation positives plus 60 Commons negatives (`ml_pipeline/dataset_gate`, never used for training).

| Model | Positives within 15 pts (gate: >= 80%) | Negative false coverage (gate: <= 10%) |
| :--- | :--- | :--- |
| Legacy shipped model | 43.3% | 50.0% |
| First fine-tune (`debris_yolov8n`) | 78.7% | 15.0% |
| **Deployed: fine-tune with negatives (`debris_yolov8n_neg`)** | **77.7%** | **16.7% (10 of 60)** |

Deployed model, other gate numbers: median coverage error 4.36 points, p90 33.59 points, clear/partial/blocked status agreement 75.3%. CPU benchmark (ONNX Runtime CPUExecutionProvider, 4 intra-op threads, 50 runs, the development PC used for this work): 37 ms mean, about 27 FPS. Other machines will differ.

Legacy baseline (before any retraining), measured with `ml_pipeline/baseline_eval.py` through the production `YOLOInference` at conf 0.35 / NMS IoU 0.50 on the same kind of data: box recall @IoU 0.5 = 0.0376 (33 of 877 boxes), box precision 0.0437, image recall 0.5700, negative FP rate 0.6667.

## Known limitations

- Weak on large dense debris piles: most failing positives are big piles predicted near 0% coverage.
- False coverage on some clean drains and canals.
- Small training set (about 1.2k TACO images) and a small negative set.
- The stage demo (`sample_media/real_demo.mp4`) is built from licensed real photos, not live cameras.
- `best.onnx.json` `training_source` was hand edited. `export_and_benchmark.py --deploy` regenerates it from the dataset manifest and will overwrite that edit (there is no `--training-source` option yet).

## Runtime cadence (for context)

Frames are acquired continuously; inference runs on a schedule: 15 s while CLEAR, 3 s in burst, 10 s once a blockage has stayed CRITICAL (settled). Burst starts when the raw coverage reaches 2.0% of the ROI or the confirmed status leaves CLEAR, and ends only after 3 clean inferences, a 15 s minimum dwell and a 60 s cooldown. Rain data never changes the cadence.

## Setup on the RTX 3060 PC

```powershell
cd d:\Github\agos-offline
python -m venv ml_pipeline\venv-train
ml_pipeline\venv-train\Scripts\Activate.ps1
# Install torch FIRST from the CUDA index that matches your driver (see https://pytorch.org/get-started/locally/):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
pip install -r ml_pipeline\requirements-train.txt
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"   # must print True and the 3060
```

The `cu126` tag is an example; pick the current one for your driver (`requirements-train.txt` notes `cu130` for a recent driver).

## Datasets used for the deployed model (all git-ignored)

| Directory | Contents |
| :--- | :--- |
| `dataset_quick` | TACO images from a local checkout (`D:\Github\TACO\data`), all categories collapsed to class `0: debris`, split by `image_id % 5` (1200 train, 300 val). Built by the git-ignored scratch script `quick_train.py`. |
| `dataset_quick_neg` | `dataset_quick` plus 44 train and 20 held-out Commons negatives with empty labels. Built by `build_negatives_dataset.py` (`fetch`, `sheets`, `assemble`). Never overlaps the gate set (checked by title, SHA-256 and perceptual hash). |
| `dataset_gate` | Gate-only: the 300 `dataset_quick` validation images plus 60 Commons negatives. Built by `build_gate_dataset.py`. Never used for training. |

## Retrain and re-run the gate

Fine-tune from the current best checkpoint with the negatives (`train.py --weights` starts from a previous `best.pt`; use a new `--name` so earlier runs are kept):

```powershell
ml_pipeline\venv-train\Scripts\python.exe ml_pipeline\train.py --data ml_pipeline\dataset_quick_neg\data.yaml --weights ml_pipeline\runs\debris_yolov8n\weights\best.pt --name debris_yolov8n_neg --device 0 --hours 0.75
```

Other `train.py` options: `--epochs`, `--imgsz`, `--batch`, `--workers`, `--patience`, `--project`, `--allow-synthetic`. Output: `ml_pipeline\runs\<name>\weights\best.pt` (git-ignored).

Run the gate against the gate set, without deploying:

```powershell
ml_pipeline\venv-train\Scripts\python.exe ml_pipeline\export_and_benchmark.py --weights ml_pipeline\runs\debris_yolov8n_neg\weights\best.pt --data ml_pipeline\dataset_gate\data.yaml
```

The script exports ONNX (opset 12, 640), checks the contract (`[1,3,640,640]` to `[1,5,8400]`, class `debris`), measures coverage on the validation split with the production inference code and coverage formula, benchmarks CPU latency, and writes `ml_pipeline\runs\gate\gate_report.{json,md}`.

- Gate: at least 80% of positive images within 15 points of the true coverage (`--min-within-fraction`, `--max-coverage-error`), at most 10% of clean negatives showing coverage >= 20% (`--max-neg-fp-rate`), and at least 20 negative images (`--min-neg-images`). Change the thresholds only with a reason; they are proposed defaults.
- Gate failed: exit code 2, `backend\app\ml\weights\best.onnx` is never touched.
- Gate passed and `--deploy` given: the current weights are copied to `best.previous.<sha8>.onnx` (git-ignored), the new weights are copied in, and `best.onnx.json` is rewritten with version, SHA-256, training source, metrics and licence.
- Without `--deploy` nothing is ever replaced.

Deploy after a pass:

```powershell
ml_pipeline\venv-train\Scripts\python.exe ml_pipeline\export_and_benchmark.py --weights ml_pipeline\runs\<name>\weights\best.pt --data ml_pipeline\dataset_gate\data.yaml --deploy
```

Deploy despite a failing gate (an explicit, recorded decision; this is how the current model was deployed):

```powershell
ml_pipeline\venv-train\Scripts\python.exe ml_pipeline\export_and_benchmark.py --weights ml_pipeline\runs\<name>\weights\best.pt --data ml_pipeline\dataset_gate\data.yaml --deploy --override-gate "<reason>"
```

The override records `gate_passed: false`, `gate_overridden: true`, the reason and the failing numbers in the sidecar and gate report, and appends `-gate-overridden` to the model version. Re-running `--deploy` regenerates the sidecar from the dataset manifest, so re-apply any hand-edited `training_source`.

After a deploy, restart the backend and re-run `python sample_media\verify_real_demo.py --strict`. To replay another model without deploying it, pass `--weights <onnx>` and `--out <report.md>` to that script.

## Earlier licence-checked pipeline (not used for the deployed model)

`prepare_dataset.py` and `sources.yaml` describe a licence-gated build (TACO with per-image Flickr checks, an Apache-2.0 trash set, Commons negatives, optional Roboflow, face and plate blurring). That dataset (`dataset_public`) was never built on this machine and no weights were trained from it. Treat it as unverified until it has been run end to end.

## Dataset and licence notes

- **Positives (deployed model):** TACO images from a local checkout. Annotations CC BY 4.0; images come from Flickr with per-image licences that this run did not verify. `ml_pipeline/DATASET_LICENSES_QUICK.md` (git-ignored scratch file) says the same.
- **Negatives:** permissive Wikimedia Commons photos (CC0, CC BY 2.0/3.0/4.0, public domain; SA, NC and ND excluded). Licence evidence per image is in `ml_pipeline/dataset_quick_neg/negatives_manifest.json` (git-ignored, local only).
- **Demo photos:** `sample_media/real_demo/ATTRIBUTION.md` lists author, licence and source URL for each stage image.
- `ml_pipeline/DATASET_LICENSES.md` is only generated when `prepare_dataset.py` runs; it does not exist in the repository and does not describe the deployed model.
