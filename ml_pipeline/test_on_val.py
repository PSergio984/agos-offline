"""Test the deployed ONNX model on the held-out validation set and report accuracy.

Runs inference on all 150 validation images, compares predictions against ground truth labels,
and reports precision, recall, mAP50, and per-image results. Optionally saves annotated images.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

# Import the inference engine
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.ml.inference import YOLOInference


def compute_iou(box1, box2):
    """Compute IoU between two boxes [x1, y1, x2, y2]."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - inter
    
    return inter / union if union > 0 else 0


def xywh_norm_to_xyxy(xywh_norm, img_w, img_h):
    """Convert YOLO normalized xywh to pixel xyxy."""
    x_center, y_center, w, h = xywh_norm
    x1 = (x_center - w / 2) * img_w
    y1 = (y_center - h / 2) * img_h
    x2 = (x_center + w / 2) * img_w
    y2 = (y_center + h / 2) * img_h
    return [x1, y1, x2, y2]


def load_ground_truth(label_path, img_w, img_h):
    """Load ground truth boxes from YOLO label file."""
    if not label_path.exists():
        return []
    
    boxes = []
    for line in label_path.read_text().strip().splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        cls_id, x, y, w, h = map(float, parts)
        if cls_id == 0:  # debris class
            boxes.append(xywh_norm_to_xyxy([x, y, w, h], img_w, img_h))
    return boxes


def match_predictions(pred_boxes, gt_boxes, iou_threshold=0.5):
    """Match predictions to ground truth using IoU threshold."""
    matched_gt = set()
    true_positives = 0
    
    for pred in pred_boxes:
        best_iou = 0
        best_gt_idx = -1
        
        for i, gt in enumerate(gt_boxes):
            if i in matched_gt:
                continue
            iou = compute_iou(pred, gt)
            if iou > best_iou:
                best_iou = iou
                best_gt_idx = i
        
        if best_iou >= iou_threshold and best_gt_idx >= 0:
            true_positives += 1
            matched_gt.add(best_gt_idx)
    
    false_positives = len(pred_boxes) - true_positives
    false_negatives = len(gt_boxes) - true_positives
    
    return true_positives, false_positives, false_negatives


def main():
    parser = argparse.ArgumentParser(description="Test deployed ONNX model on validation set")
    parser.add_argument("--val-list", default="ml_pipeline/dataset/jionco_mix/val_real_list.txt")
    parser.add_argument("--images-dir", default="ml_pipeline/dataset/jionco_mix/images/val")
    parser.add_argument("--labels-dir", default="ml_pipeline/dataset/jionco_mix/labels/val")
    parser.add_argument("--weights", default="backend/app/ml/weights/best.onnx")
    parser.add_argument("--iou-threshold", type=float, default=0.5, help="IoU threshold for matching")
    parser.add_argument("--conf-threshold", type=float, default=0.25, help="Confidence threshold for predictions")
    parser.add_argument("--save-viz", default=None, help="Directory to save annotated images")
    args = parser.parse_args()
    
    val_list = Path(args.val_list)
    images_dir = Path(args.images_dir)
    labels_dir = Path(args.labels_dir)
    weights_path = Path(args.weights)
    
    # Load model
    print(f"Loading model from {weights_path}...")
    model = YOLOInference(str(weights_path), conf_threshold=args.conf_threshold)
    
    # Load validation stems
    stems = val_list.read_text().strip().splitlines()
    print(f"Testing on {len(stems)} validation images...")
    
    total_tp = 0
    total_fp = 0
    total_fn = 0
    total_gt_boxes = 0
    total_pred_boxes = 0
    
    per_image_results = []
    
    if args.save_viz:
        viz_dir = Path(args.save_viz)
        viz_dir.mkdir(parents=True, exist_ok=True)
    
    for i, stem in enumerate(stems):
        img_path = images_dir / f"real_{stem}.jpg"
        label_path = labels_dir / f"real_{stem}.txt"
        
        # Load image
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"Warning: cannot read {img_path}")
            continue
        
        h, w = img.shape[:2]
        
        # Load ground truth
        gt_boxes = load_ground_truth(label_path, w, h)
        total_gt_boxes += len(gt_boxes)
        
        # Run inference
        detections = model.infer(img)
        pred_boxes = [d.box for d in detections if d.confidence >= args.conf_threshold]
        total_pred_boxes += len(pred_boxes)
        
        # Match predictions
        tp, fp, fn = match_predictions(pred_boxes, gt_boxes, args.iou_threshold)
        total_tp += tp
        total_fp += fp
        total_fn += fn
        
        per_image_results.append({
            "stem": stem,
            "gt_boxes": len(gt_boxes),
            "pred_boxes": len(pred_boxes),
            "tp": tp,
            "fp": fp,
            "fn": fn,
        })
        
        # Save visualization
        if args.save_viz:
            viz_img = img.copy()
            # Draw ground truth in green
            for box in gt_boxes:
                cv2.rectangle(viz_img, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), (0, 255, 0), 2)
            # Draw predictions in red
            for box in pred_boxes:
                cv2.rectangle(viz_img, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), (0, 0, 255), 2)
            
            cv2.imwrite(str(viz_dir / f"{stem}_viz.jpg"), viz_img)
        
        if (i + 1) % 30 == 0:
            print(f"Processed {i + 1}/{len(stems)} images...")
    
    # Compute metrics
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    
    print("\n" + "=" * 60)
    print(f"VALIDATION SET RESULTS (IoU >= {args.iou_threshold})")
    print("=" * 60)
    print(f"Total images:        {len(stems)}")
    print(f"Total GT boxes:      {total_gt_boxes}")
    print(f"Total predictions:   {total_pred_boxes}")
    print(f"True positives:      {total_tp}")
    print(f"False positives:     {total_fp}")
    print(f"False negatives:     {total_fn}")
    print(f"\nPrecision:           {precision:.4f}")
    print(f"Recall:              {recall:.4f}")
    print(f"F1 Score:            {f1:.4f}")
    print("=" * 60)
    
    # Save results
    results = {
        "model": str(weights_path),
        "val_list": str(val_list),
        "images_tested": len(stems),
        "iou_threshold": args.iou_threshold,
        "conf_threshold": args.conf_threshold,
        "total_gt_boxes": total_gt_boxes,
        "total_pred_boxes": total_pred_boxes,
        "true_positives": total_tp,
        "false_positives": total_fp,
        "false_negatives": total_fn,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "per_image": per_image_results,
    }
    
    results_path = Path("ml_pipeline/runs/jionco_mix_v1/val_test_results.json")
    results_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults saved to {results_path}")
    
    if args.save_viz:
        print(f"Visualizations saved to {args.save_viz}")


if __name__ == "__main__":
    main()
