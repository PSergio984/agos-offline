import os
import sys
import math
import time
from pathlib import Path
import cv2
import numpy as np

def generate_drainage_demo_video(
    output_path: Path,
    width: int = 640,
    height: int = 480,
    fps: int = 20,
    duration_seconds: int = 10
) -> Path:
    """
    Generates a realistic 10-second looping demo video of a drainage curb inlet
    with dynamic water runoff and accumulating simulated debris (plastic bottles,
    bags, styrofoam, and organic waste).
    
    ROI is aligned with standard AGOS coordinates: [0.2, 0.4, 0.8, 0.9]
    """
    output_path = Path(output_path).resolve()
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fallback to local storage if sample_media is restricted
        output_path = Path(__file__).resolve().parent / "storage" / "drainage_demo.mp4"
        output_path.parent.mkdir(parents=True, exist_ok=True)
    
    total_frames = fps * duration_seconds
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, float(fps), (width, height))
    
    if not out.isOpened():
        raise RuntimeError(f"Failed to initialize cv2.VideoWriter with fourcc 'mp4v' at {output_path}")

    # ROI boundaries in pixel coordinates
    # Normalized: [0.20, 0.40, 0.80, 0.90]
    rx1 = int(0.20 * width)   # 128
    ry1 = int(0.40 * height)  # 192
    rx2 = int(0.80 * width)   # 512
    ry2 = int(0.90 * height)  # 432
    
    curb_y = int(0.35 * height) # 168 (sidewalk concrete edge)

    print(f"Generating drainage demo video ({duration_seconds}s, {total_frames} frames @ {fps}fps)...")
    print(f"Target file: {output_path}")

    # Pre-generate asphalt road texture noise
    np.random.seed(42)
    noise_base = np.random.randint(-8, 9, (height, width, 3), dtype=np.int16)

    for f_idx in range(total_frames):
        # Progress ratio 0.0 to 1.0
        progress = f_idx / float(total_frames)
        t = f_idx * 0.25 # time factor for animations

        # 1. Road Asphalt Base
        base_color = np.full((height, width, 3), (50, 52, 54), dtype=np.int16)
        frame_int = np.clip(base_color + noise_base, 0, 255).astype(np.uint8)

        # 2. Sidewalk / Concrete Curb (Top Section)
        cv2.rectangle(frame_int, (0, 0), (width, curb_y), (150, 153, 155), -1)
        cv2.line(frame_int, (0, curb_y), (width, curb_y), (185, 188, 190), 3)
        cv2.line(frame_int, (0, curb_y + 1), (width, curb_y + 1), (90, 92, 95), 2)

        # 3. Drainage Culvert Cavity (Recessed Intake Under Curb)
        cv2.rectangle(frame_int, (rx1, ry1), (rx2, ry2), (18, 20, 22), -1)
        cv2.rectangle(frame_int, (rx1 + 4, ry1 + 4), (rx2 - 4, ry1 + 25), (10, 12, 14), -1)

        # 4. Animated Water Flow along Gutter & toward Grate
        for wy in range(curb_y + 4, height, 12):
            wave_amp = 6.0
            wave_phase = t + wy * 0.1
            shift = int(wave_amp * math.sin(wave_phase))
            
            water_b = int(120 + 20 * math.sin(t * 0.5 + wy * 0.05))
            water_g = int(105 + 15 * math.sin(t * 0.5 + wy * 0.05))
            water_r = int(85 + 10 * math.sin(t * 0.5 + wy * 0.05))
            
            overlay = frame_int.copy()
            cv2.line(overlay, (0, wy + shift), (width, wy + (shift // 2)), (water_b, water_g, water_r), 2)
            cv2.addWeighted(overlay, 0.45, frame_int, 0.55, 0, frame_int)

        # 5. Metal Drainage Grate Grill Bars (ROI)
        cv2.rectangle(frame_int, (rx1, ry1), (rx2, ry2), (80, 85, 90), 5)
        cv2.rectangle(frame_int, (rx1 - 2, ry1 - 2), (rx2 + 2, ry2 + 2), (130, 135, 140), 1)

        num_bars = 12
        bar_spacing = (rx2 - rx1) / (num_bars + 1)
        for b in range(1, num_bars + 1):
            bx = int(rx1 + b * bar_spacing)
            cv2.line(frame_int, (bx, ry1), (bx, ry2), (95, 100, 105), 5)
            cv2.line(frame_int, (bx - 1, ry1), (bx - 1, ry2), (160, 165, 170), 1)
            cv2.line(frame_int, (bx + 2, ry1), (bx + 2, ry2), (40, 42, 45), 2)

        mid_y = (ry1 + ry2) // 2
        cv2.line(frame_int, (rx1, mid_y), (rx2, mid_y), (100, 105, 110), 4)

        # 6. Progressive Debris Accumulation
        leaf1_x = int(rx1 + 40 + 6 * math.sin(t))
        leaf1_y = int(ry1 + 35 + 4 * math.cos(t * 0.7))
        cv2.ellipse(frame_int, (leaf1_x, leaf1_y), (22, 10), 30, 0, 360, (25, 75, 40), -1)

        twig_pts = np.array([
            [rx1 + 60, ry1 + 45],
            [rx1 + 95, ry1 + 55],
            [rx1 + 110, ry1 + 50]
        ], np.int32)
        cv2.polylines(frame_int, [twig_pts], False, (40, 60, 80), 3)

        if progress >= 0.15:
            s2_weight = min(1.0, (progress - 0.15) / 0.15)
            drift_x = int((1.0 - s2_weight) * 120)
            b1_x = rx1 + 75 - drift_x
            b1_y = int(ry1 + 65 + 3 * math.sin(t * 1.2))
            
            cv2.rectangle(frame_int, (b1_x, b1_y), (b1_x + 60, b1_y + 22), (215, 225, 235), -1)
            cv2.rectangle(frame_int, (b1_x, b1_y), (b1_x + 60, b1_y + 22), (160, 180, 200), 1)
            cv2.circle(frame_int, (b1_x + 63, b1_y + 11), 6, (220, 120, 40), -1)

            bag1_center_x = rx1 + 180 - int(drift_x * 0.8)
            bag1_center_y = ry1 + 80
            bag1_pts = np.array([
                [bag1_center_x - 35, bag1_center_y - 20],
                [bag1_center_x + 40, bag1_center_y - 25],
                [bag1_center_x + 55, bag1_center_y + 25],
                [bag1_center_x + 10, bag1_center_y + 45],
                [bag1_center_x - 40, bag1_center_y + 20],
            ], np.int32)
            cv2.fillPoly(frame_int, [bag1_pts], (60, 210, 230))
            cv2.polylines(frame_int, [bag1_pts], True, (40, 170, 190), 2)

            b2_x = rx1 + 140
            b2_y = ry1 + 130 + int(2 * math.sin(t))
            cv2.rectangle(frame_int, (b2_x, b2_y), (b2_x + 55, b2_y + 20), (50, 180, 80), -1)
            cv2.circle(frame_int, (b2_x + 58, b2_y + 10), 5, (230, 230, 230), -1)

        if progress >= 0.45:
            s3_weight = min(1.0, (progress - 0.45) / 0.15)
            drift3 = int((1.0 - s3_weight) * 150)
            
            styro_x = rx1 + 220 - drift3
            styro_y = ry1 + 100
            cv2.rectangle(frame_int, (styro_x, styro_y), (styro_x + 85, styro_y + 60), (245, 248, 250), -1)
            cv2.rectangle(frame_int, (styro_x, styro_y), (styro_x + 85, styro_y + 60), (180, 190, 200), 2)
            cv2.line(frame_int, (styro_x + 5, styro_y + 30), (styro_x + 80, styro_y + 30), (190, 200, 210), 2)

            clump_x = rx1 + 100
            clump_y = ry1 + 140
            clump_pts = np.array([
                [clump_x - 40, clump_y - 15],
                [clump_x + 120, clump_y - 20],
                [clump_x + 160, clump_y + 60],
                [clump_x + 80, clump_y + 85],
                [clump_x - 30, clump_y + 70],
            ], np.int32)
            cv2.fillPoly(frame_int, [clump_pts], (140, 120, 100))
            cv2.polylines(frame_int, [clump_pts], True, (90, 75, 60), 2)

            cup1_x = rx2 - 110 + int(2 * math.sin(t))
            cup1_y = ry1 + 90
            cv2.circle(frame_int, (cup1_x, cup1_y), 18, (220, 230, 240), -1)
            cv2.circle(frame_int, (cup1_x, cup1_y), 18, (170, 180, 190), 2)

            cup2_x = rx2 - 75
            cup2_y = ry1 + 130
            cv2.rectangle(frame_int, (cup2_x, cup2_y), (cup2_x + 40, cup2_y + 40), (200, 210, 230), -1)

            redbag_pts = np.array([
                [rx1 + 160, ry2 - 60],
                [rx1 + 270, ry2 - 70],
                [rx1 + 320, ry2 - 15],
                [rx1 + 220, ry2 - 5],
                [rx1 + 140, ry2 - 25],
            ], np.int32)
            cv2.fillPoly(frame_int, [redbag_pts], (50, 60, 210))
            cv2.polylines(frame_int, [redbag_pts], True, (30, 40, 160), 2)

        sim_sec = int(f_idx / fps)
        time_str = f"2026-10-09 15:13:{sim_sec:02d} PHT"
        cv2.putText(frame_int, "CCTV-01: BRGY. POBLACION DRAINAGE INLET", (16, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame_int, time_str, (16, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 220, 255), 1, cv2.LINE_AA)
        cv2.putText(frame_int, "AGOS-OFFLINE DEMO FEED [AUTO-LOOP]", (width - 290, height - 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, (160, 160, 160), 1, cv2.LINE_AA)

        out.write(frame_int)

    out.release()
    file_size_bytes = os.path.getsize(str(output_path))
    file_size_kb = file_size_bytes / 1024.0
    print(f"Generated {total_frames} frames successfully!")
    print(f"File size: {file_size_kb:.1f} KB at {output_path}")
    return output_path

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent
    target = base_dir / "sample_media" / "drainage_demo.mp4"
    generate_drainage_demo_video(target)
