"""Build sample_media/jionco_val_demo.mp4 from the 150 held-out Jionco validation images.

Creates a demo video cycling through the real validation set used to evaluate the trained model.
Each image is shown for 2 seconds with 0.5s crossfade. Images are already 4:3 and get scaled to 640x480.
"""
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
VAL_LIST = REPO / "ml_pipeline/dataset/jionco_mix/val_real_list.txt"
IMAGES_DIR = REPO / "ml_pipeline/dataset/jionco_mix/images/val"
OUT = HERE / "jionco_val_demo.mp4"
W, H = 640, 480
FPS = 30
HOLD_SECONDS = 2.0
FADE_SECONDS = 0.5


def load_and_scale(stem: str) -> np.ndarray:
    """Load image by stem and scale to W x H."""
    img_path = IMAGES_DIR / f"real_{stem}.jpg"
    img = cv2.imread(str(img_path))
    if img is None:
        raise SystemExit(f"cannot read {img_path}")
    return cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)


def frame_sequence(frames, nfade: int):
    """Each frame held for its frame count, with a linear crossfade of nfade frames to the next."""
    for i, (frame, count) in enumerate(frames):
        for _ in range(count):
            yield frame
        if i + 1 < len(frames):
            nxt = frames[i + 1][0]
            for k in range(1, nfade + 1):
                a = k / (nfade + 1)
                yield cv2.addWeighted(frame, 1 - a, nxt, a, 0)


def main() -> None:
    stems = VAL_LIST.read_text(encoding="utf-8").strip().splitlines()
    print(f"Loading {len(stems)} validation images...")
    
    frames = []
    hold_starts = []
    t = 0.0
    hold_count = int(HOLD_SECONDS * FPS)
    
    for stem in stems:
        img = load_and_scale(stem)
        frames.append((img, hold_count))
        hold_starts.append(t)
        t += HOLD_SECONDS + FADE_SECONDS
    
    nfade = int(FADE_SECONDS * FPS)
    ffmpeg = shutil.which("ffmpeg")
    
    if ffmpeg:
        # H.264 with keyframes at the start of each hold
        cmd = [
            ffmpeg, "-y", "-loglevel", "error", 
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
            "-framerate", str(FPS), "-i", "-", 
            "-c:v", "libx264", "-preset", "slow", "-qp", "20",
            "-x264-params", "ipratio=4", "-bf", "0", "-g", "1000", "-sc_threshold", "0",
            "-force_key_frames", ",".join(f"{s:g}" for s in hold_starts), 
            "-pix_fmt", "yuv420p", str(OUT)
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for frame in frame_sequence(frames, nfade):
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait() != 0:
            raise SystemExit("ffmpeg encode failed")
    else:
        # Fallback to OpenCV
        writer = cv2.VideoWriter(str(OUT), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
        for frame in frame_sequence(frames, nfade):
            writer.write(frame)
        writer.release()
    
    size = OUT.stat().st_size
    duration = t
    print(f"Wrote {OUT} ({size / 1e6:.2f} MB, {duration:.1f}s duration, {len(stems)} images)")
    
    # Write manifest
    manifest = {
        "source": "Jionco real validation set (150 held-out images)",
        "dataset": "ml_pipeline/dataset/jionco_mix",
        "fps": FPS,
        "hold_seconds": HOLD_SECONDS,
        "crossfade_seconds": FADE_SECONDS,
        "image_count": len(stems),
        "duration_seconds": duration,
    }
    manifest_path = OUT.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main()
