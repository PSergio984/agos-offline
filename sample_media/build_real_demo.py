"""Build sample_media/real_demo.mp4 from the licensed real photos in sample_media/real_demo/.

Each photo is cropped to its source_crop_px (a 4:3 rectangle around the drain/grate/pile the stage is
about; see crop_rationale in manifest.json) and scaled to the 640x480 frame, so the scene fills the
default full-frame ROI [0, 0, 1, 1]. No border fill is used and nothing is composited onto the photos.
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


def crop_to_frame(img: np.ndarray, crop) -> np.ndarray:
    """Crop img to the 4:3 source rectangle and scale it to W x H (no padding or fill)."""
    x1, y1, x2, y2 = crop
    h, w = img.shape[:2]
    if not (0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h) or (x2 - x1) * H != (y2 - y1) * W:
        raise SystemExit(f"source_crop_px {crop} must be a 4:3 rectangle inside the {w}x{h} photo")
    return cv2.resize(img[y1:y2, x1:x2], (W, H), interpolation=cv2.INTER_AREA)


def frame_sequence(frames, nfade: int):
    """Each photo held for its frame count, with a linear crossfade of nfade frames to the next."""
    for i, (frame, count) in enumerate(frames):
        for _ in range(count):
            yield frame
        if i + 1 < len(frames):
            nxt = frames[i + 1][0]
            for k in range(1, nfade + 1):
                a = k / (nfade + 1)
                yield cv2.addWeighted(frame, 1 - a, nxt, a, 0)


def main() -> None:
    manifest = json.loads((DEMO_DIR / "manifest.json").read_text(encoding="utf-8"))
    fps, fade = manifest["fps"], manifest["crossfade_seconds"]
    frames, hold_starts, t = [], [], 0.0
    for st in manifest["stages"]:
        img = cv2.imread(str(DEMO_DIR / st["file"]))
        if img is None:
            raise SystemExit(f"cannot read {st['file']}")
        frames.append((crop_to_frame(img, st["source_crop_px"]), int(st["hold_seconds"] * fps)))
        hold_starts.append(t)
        t += st["hold_seconds"] + fade
    nfade = int(fade * fps)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        # Raw frames go straight into H.264 (no lossy intermediate). One keyframe at the start of each hold
        # (none inside it), no B-frames, constant QP 20 with ipratio=4 so keyframes are coded at about QP 8:
        # the P-frames of a held photo have no residual worth coding, so every held frame decodes identically
        # (checked: 1 distinct decode per hold; CRF 18 and the old CRF 30 still drift for up to 60 frames).
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
               "-framerate", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-qp", "20",
               "-x264-params", "ipratio=4", "-bf", "0", "-g", "1000", "-sc_threshold", "0",
               "-force_key_frames", ",".join(f"{s:g}" for s in hold_starts), "-pix_fmt", "yuv420p", str(OUT)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for frame in frame_sequence(frames, nfade):
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait() != 0:
            raise SystemExit("ffmpeg encode failed")
    else:
        # OpenCV mp4v cannot set a bitrate (~10 MB for this clip), so the size check below will fail.
        writer = cv2.VideoWriter(str(OUT), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
        for frame in frame_sequence(frames, nfade):
            writer.write(frame)
        writer.release()
    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 1e6:.2f} MB)")
    if size >= 6_000_000:
        raise SystemExit("mp4 exceeds 6 MB")


if __name__ == "__main__":
    main()
