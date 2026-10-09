"""Build sample_media/real_demo.mp4 from the licensed real photos in sample_media/real_demo/.

Each photo's source_roi_px (grate/debris region) is uniformly scaled and centred on the
default ROI [0.20, 0.40, 0.80, 0.90] of a 640x480 frame. Pixels outside the photo are
filled by border reflection (background only). Nothing is composited onto the photos.
"""
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
DEMO_DIR = HERE / "real_demo"
OUT = HERE / "real_demo.mp4"
W, H = 640, 480


def align_to_roi(img: np.ndarray, src_roi, roi) -> np.ndarray:
    """Uniform-scale img so src_roi fits inside the ROI, centred on it."""
    x1, y1, x2, y2 = src_roi
    rx1, ry1, rx2, ry2 = roi[0] * W, roi[1] * H, roi[2] * W, roi[3] * H
    s = min((rx2 - rx1) / (x2 - x1), (ry2 - ry1) / (y2 - y1))
    tx = (rx1 + rx2) / 2 - s * (x1 + x2) / 2
    ty = (ry1 + ry2) / 2 - s * (y1 + y2) / 2
    m = np.array([[s, 0, tx], [0, s, ty]], dtype=np.float32)
    return cv2.warpAffine(img, m, (W, H), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REFLECT)


def main() -> None:
    manifest = json.loads((DEMO_DIR / "manifest.json").read_text(encoding="utf-8"))
    fps, fade = manifest["fps"], manifest["crossfade_seconds"]
    roi = manifest["default_roi"]
    raw = OUT.with_suffix(".raw.mp4")
    writer = cv2.VideoWriter(str(raw), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    frames = []
    for st in manifest["stages"]:
        img = cv2.imread(str(DEMO_DIR / st["file"]))
        if img is None:
            raise SystemExit(f"cannot read {st['file']}")
        frames.append((align_to_roi(img, st["source_roi_px"], roi), int(st["hold_seconds"] * fps)))
    nfade = int(fade * fps)
    for i, (frame, count) in enumerate(frames):
        for _ in range(count):
            writer.write(frame)
        if i + 1 < len(frames):
            nxt = frames[i + 1][0]
            for k in range(1, nfade + 1):
                a = k / (nfade + 1)
                writer.write(cv2.addWeighted(frame, 1 - a, nxt, a, 0))
    writer.release()
    # OpenCV mp4v cannot set a bitrate (~10 MB for this clip); shrink with ffmpeg H.264 when available.
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(raw), "-c:v", "libx264", "-crf", "30",
                        "-g", "50", "-pix_fmt", "yuv420p", str(OUT)], check=True)
        raw.unlink()
    else:
        raw.replace(OUT)
    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 1e6:.2f} MB)")
    if size >= 6_000_000:
        raise SystemExit("mp4 exceeds 6 MB")


if __name__ == "__main__":
    main()
