"""Replay sample_media/real_demo.mp4 through StreamService with a fake clock and the REAL best.onnx.

Checks the CLEAR -> burst -> CRITICAL -> settled -> cleared cycle with exactly one incident that
closes, and writes .agents/tasks/demo-replay-report.md. No detections are faked.
"""
import argparse
import asyncio
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import settings  # noqa: E402
from app.core.database import init_db  # noqa: E402
from app.services.stream_service import StreamService  # noqa: E402

VIDEO = ROOT / "sample_media" / "real_demo.mp4"
MANIFEST = ROOT / "sample_media" / "real_demo" / "manifest.json"
REPORT = ROOT / ".agents" / "tasks" / "demo-replay-report.md"


class FakeClock:
    def __init__(self, start: float = 1_700_000_000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


def stage_windows(manifest: dict) -> list[tuple[str, float, float]]:
    """(stage, start_s, end_s) in video time, including the 1 s crossfades between photos."""
    out, t = [], 0.0
    for i, st in enumerate(manifest["stages"]):
        out.append((st["stage"], t, t + st["hold_seconds"]))
        t += st["hold_seconds"] + (manifest["crossfade_seconds"] if i + 1 < len(manifest["stages"]) else 0)
    return out


def incidents() -> list[dict]:
    conn = sqlite3.connect(str(settings.DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT id, status, is_open, occlusion_ratio FROM incidents")]
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--strict", action="store_true", help="exit 1 unless every stage passes")
    ap.add_argument("--weights", type=Path, default=settings.WEIGHTS_PATH, help="ONNX weights to replay (default: shipped)")
    ap.add_argument("--out", type=Path, default=REPORT, help="report path (default: demo-replay-report.md)")
    args = ap.parse_args()
    shipped = args.weights == settings.WEIGHTS_PATH
    settings.WEIGHTS_PATH = args.weights
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    fps = manifest["fps"]
    tmp = Path(tempfile.mkdtemp(prefix="agos_replay_"))
    settings.DATABASE_PATH = tmp / "replay.db"
    settings.STORAGE_DIR = tmp / "incidents"
    settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    asyncio.run(init_db())

    clock = FakeClock()
    service = StreamService(clock=clock)
    cap = cv2.VideoCapture(str(VIDEO))
    rows, last_seen, i = [], None, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = i / fps
        clock.now = 1_700_000_000.0 + t
        service._run_inference_if_due(frame)
        det = service.latest_detection
        if det.get("timestamp") != last_seen and det.get("camera_id"):
            last_seen = det["timestamp"]
            inc = incidents()
            rows.append({
                "t": round(t, 1), "raw_ratio": det["raw_ratio"], "smoothed": det["occlusion_ratio"],
                "raw_status": det["raw_status"], "status": det["status"], "interval": det["interval_seconds"],
                "mode": service._cadence.mode.name, "boxes": det["debris_count"],
                "incidents": len(inc), "open": sum(r["is_open"] for r in inc),
            })
        i += 1
    cap.release()

    wins = stage_windows(manifest)

    def in_stage(name: str, only_idx: int | None = None):
        sel = [w for w in wins if w[0] == name]
        return sel[0] if name != "filling" else (sel[0][1], sel[-1][2])

    def rng(name):
        w = in_stage(name)
        s, e = (w[1], w[2]) if name != "filling" else w
        return [r for r in rows if s <= r["t"] < e]

    results: dict[str, tuple[bool, str]] = {}
    empty = rng("empty")
    ok = bool(empty) and all(r["status"] == "CLEAR" and r["interval"] == 15.0 for r in empty)
    results["empty"] = (ok, f"{len(empty)} inferences, all CLEAR at 15 s" if ok else
                        f"statuses={[ (r['status'], r['interval']) for r in empty]}")

    filling = rng("filling")
    fill_start = in_stage("filling")[0]
    burst = [r for r in filling if r["interval"] == 3.0]
    ok = bool(burst)
    results["filling"] = (ok, f"burst (3 s) first at t={burst[0]['t'] if burst else None}, filling starts t={fill_start}")

    blocked = rng("blocked")
    crit = [r for r in blocked if r["status"] == "CRITICAL"]
    settled = [r for r in blocked if r["mode"] == "SETTLED"]
    inc_blocked = max((r["incidents"] for r in blocked), default=0)
    ok = bool(crit) and inc_blocked == 1 and any(r["open"] == 1 for r in crit) and bool(settled)
    results["blocked"] = (ok, f"CRITICAL confirmed at t={crit[0]['t'] if crit else None}, "
                              f"incidents={inc_blocked}, settled(10 s) first at t={settled[0]['t'] if settled else None}, "
                              f"max raw ratio={max((r['raw_ratio'] for r in blocked), default=0)}")

    cleared = rng("cleared")
    final = incidents()
    ok = (bool(cleared) and any(r["status"] == "CLEAR" for r in cleared) and len(final) == 1
          and final[0]["is_open"] == 0 and cleared[-1]["status"] == "CLEAR")
    results["cleared"] = (ok, f"confirmed CLEAR first at t="
                              f"{next((r['t'] for r in cleared if r['status'] == 'CLEAR'), None)}, "
                              f"incidents={len(final)}, is_open={[r['is_open'] for r in final]}")

    all_ok = all(v[0] for v in results.values())
    lines = ["# Demo replay report", "",
             f"Video: sample_media/real_demo.mp4, fake clock, REAL {args.weights}, default ROI {settings.DEFAULT_ROI}.",
             "", "## Stage results", ""]
    for name, (passed, note) in results.items():
        lines.append(f"- {name}: {'PASS' if passed else 'FAIL'} ({note})")
    lines += ["", f"OVERALL: {'PASS' if all_ok else 'FAIL'}"]
    if not all_ok and shipped:
        lines += ["", "REVERIFY_AFTER_RETRAIN: the shipped weights fail on this real set (baseline box recall 0.0376, "
                      "negative FP rate 0.667). Fixes tried on the blocked image: 5 re-crops of blocked.jpg (full frame to tight on the pile; model found 0-1 low-confidence boxes, 0% ROI), then a swap to a canal-trash photo (best crop reached only WARNING at 27%). Nothing was faked. Re-run `python sample_media/verify_real_demo.py` after FEAT-005 deploys a retrained model."]
    lines += ["", "## Timeline (one row per inference)", "",
              "| t(s) | raw % | smoothed % | raw status | confirmed | interval | mode | boxes | incidents | open |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['t']} | {r['raw_ratio']:.2f} | {r['smoothed']:.2f} | {r['raw_status']} | {r['status']} | "
                     f"{r['interval']} | {r['mode']} | {r['boxes']} | {r['incidents']} | {r['open']} |")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for name, (passed, note) in results.items():
        print(f"{name}: {'PASS' if passed else 'FAIL'} - {note}")
    print(f"OVERALL: {'PASS' if all_ok else 'FAIL'}; report: {args.out}")
    # A documented real-model failure is a result, not a crash: exit non-zero only with --strict.
    return 0 if (all_ok or not args.strict) else 1


if __name__ == "__main__":
    raise SystemExit(main())
