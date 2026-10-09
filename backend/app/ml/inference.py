"""YOLOv8 ONNX inference engine and visual annotation pipeline for AGOS-Offline.

Executes CPU-optimized local inference with graceful fallbacks, letterbox preprocessing,
NMS postprocessing, and visual overlay of drainage Grate ROIs and detected debris.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence, Union

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Fallback defaults
DEFAULT_INPUT_SIZE = 640
DEFAULT_CONF_THRESHOLD = 0.35
DEFAULT_IOU_THRESHOLD = 0.50

# Annotation BGR Color Palette
COLOR_CYAN = (255, 255, 0)      # Default / Calibrating ROI
COLOR_GREEN = (0, 255, 0)       # CLEAR status ROI (<20%)
COLOR_YELLOW = (0, 255, 255)    # WARNING status ROI (20%-59%)
COLOR_RED = (0, 0, 255)         # CRITICAL status ROI (>=60%) & Debris detections
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK = (0, 0, 0)


@dataclass
class Detection:
    """Detected debris object bounding box and classification."""

    box: list[float]  # [x1, y1, x2, y2] in original image pixel coordinates
    confidence: float
    class_id: int = 0
    class_name: str = "debris"

    def to_dict(self) -> dict[str, Any]:
        """Convert detection to JSON-serializable dictionary."""
        return {
            "box": [round(c, 1) for c in self.box],
            "confidence": round(self.confidence, 4),
            "class_id": self.class_id,
            "class_name": self.class_name,
        }


def letterbox(
    image: np.ndarray,
    target_shape: tuple[int, int] = (640, 640),
    color: tuple[int, int, int] = (114, 114, 114),
    auto: bool = False,
    scaleup: bool = True,
    stride: int = 32,
) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Resize and pad image while meeting target stride constraints and preserving aspect ratio.

    Args:
        image: Source image in HWC BGR format.
        target_shape: Destination (height, width) tuple.
        color: Padding fill color (default: 114 gray).
        auto: Minimum rectangle padding.
        scaleup: If False, only downscale (never upscale small images).
        stride: Stride constraint multiplier.

    Returns:
        (letterboxed_image, scale_ratio, (pad_w, pad_h))
    """
    shape = image.shape[:2]  # [height, width]
    if isinstance(target_shape, int):
        target_shape = (target_shape, target_shape)

    # Scale ratio (new / old)
    r = min(target_shape[0] / shape[0], target_shape[1] / shape[1])
    if not scaleup:
        r = min(r, 1.0)

    # Compute unpadded destination dimensions
    new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
    dw, dh = target_shape[1] - new_unpad[0], target_shape[0] - new_unpad[1]

    if auto:
        dw, dh = np.mod(dw, stride), np.mod(dh, stride)

    dw /= 2.0  # Divide padding into 2 sides
    dh /= 2.0

    if shape[::-1] != new_unpad:
        image = cv2.resize(image, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))

    padded_image = cv2.copyMakeBorder(
        image,
        top,
        bottom,
        left,
        right,
        cv2.BORDER_CONSTANT,
        value=color,
    )
    return padded_image, r, (dw, dh)


class YOLOInference:
    """YOLOv8 ONNX model inference runner for CPU execution.

    Loads and runs the YOLOv8 ONNX model using ONNX Runtime's CPUExecutionProvider.
    Includes automated preprocessing (letterbox, RGB, normalize, CHW), output decoding,
    and NMS postprocessing with fallback safety if weights or dependencies are unavailable.
    """

    def __init__(
        self,
        weights_path: Optional[Union[str, Path]] = None,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        iou_threshold: float = DEFAULT_IOU_THRESHOLD,
        input_size: int = DEFAULT_INPUT_SIZE,
    ) -> None:
        """Initialize the YOLO ONNX inference engine.

        Args:
            weights_path: Path to best.onnx model weights.
            conf_threshold: Minimum detection confidence threshold (default: 0.35).
            iou_threshold: Intersection over Union threshold for NMS (default: 0.50).
            input_size: Model input dimension in pixels (default: 640).
        """
        self.weights_path = Path(weights_path) if weights_path else None
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.input_size = input_size

        self.session = None
        self.input_name: Optional[str] = None
        self.output_names: list[str] = []
        self.is_loaded: bool = False
        self.class_names: dict[int, str] = {0: "debris"}

        if self.weights_path:
            self.load_model(self.weights_path)

    def load_model(self, weights_path: Union[str, Path]) -> bool:
        """Load ONNX model weights into an ONNX Runtime InferenceSession.

        Args:
            weights_path: Path to the .onnx model weights file.

        Returns:
            True if model loaded successfully, False otherwise.
        """
        self.weights_path = Path(weights_path)
        if not self.weights_path.is_file():
            logger.warning(
                "ONNX weights file not found at '%s'. Running in fallback stub mode.",
                self.weights_path,
            )
            self.is_loaded = False
            return False

        try:
            import onnxruntime as ort

            # Force CPU Execution Provider for resilient, predictable local operation
            providers = ["CPUExecutionProvider"]
            session_options = ort.SessionOptions()
            session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            session_options.intra_op_num_threads = 4

            self.session = ort.InferenceSession(
                str(self.weights_path),
                sess_options=session_options,
                providers=providers,
            )

            # Retrieve model input and output metadata
            inputs = self.session.get_inputs()
            self.input_name = inputs[0].name
            self.output_names = [o.name for o in self.session.get_outputs()]

            # Attempt to parse class names from ONNX custom metadata
            meta = self.session.get_modelmeta()
            if meta and meta.custom_metadata_map and "names" in meta.custom_metadata_map:
                try:
                    import ast
                    raw_names = ast.literal_eval(meta.custom_metadata_map["names"])
                    self.class_names = {int(k): str(v) for k, v in raw_names.items()}
                except Exception:
                    pass

            self.is_loaded = True
            logger.info(
                "Successfully loaded ONNX model from '%s' (input='%s', classes=%s)",
                self.weights_path.name,
                self.input_name,
                self.class_names,
            )
            return True

        except Exception as e:
            logger.error("Failed to load ONNX model from '%s': %s", self.weights_path, e)
            self.is_loaded = False
            self.session = None
            return False

    def preprocess(self, frame: np.ndarray) -> tuple[np.ndarray, float, tuple[float, float]]:
        """Preprocess frame for YOLOv8 model input.

        Steps:
        1. Letterbox resize maintaining aspect ratio to (input_size, input_size).
        2. Convert BGR to RGB color channel ordering.
        3. Normalize pixel values to [0.0, 1.0].
        4. Transpose from HWC to CHW format.
        5. Expand dims to batch shape (1, 3, input_size, input_size).

        Args:
            frame: Raw BGR video frame from OpenCV.

        Returns:
            (input_tensor, scale_ratio, (pad_w, pad_h))
        """
        # Step 1: Letterbox resize to 640x640
        padded_img, ratio, (dw, dh) = letterbox(frame, (self.input_size, self.input_size))

        # Step 2: BGR to RGB conversion
        rgb_img = cv2.cvtColor(padded_img, cv2.COLOR_BGR2RGB)

        # Step 3: Normalize to [0.0, 1.0]
        normalized = rgb_img.astype(np.float32) / 255.0

        # Step 4: HWC to CHW format
        chw = np.transpose(normalized, (2, 0, 1))

        # Step 5: Add batch dimension (1, 3, 640, 640)
        tensor = np.expand_dims(chw, axis=0)
        return tensor, ratio, (dw, dh)

    def postprocess(
        self,
        raw_output: np.ndarray,
        orig_shape: tuple[int, int],
        ratio: float,
        pad: tuple[float, float],
    ) -> list[Detection]:
        """Decode raw YOLOv8 output tensor and apply NMS.

        YOLOv8 output shape is [1, 4 + num_classes, num_anchors] (e.g. [1, 5, 8400]).

        Args:
            raw_output: Raw numpy output from ONNX session.
            orig_shape: Original frame shape (height, width).
            ratio: Scale ratio applied during letterbox preprocessing.
            pad: Padding (pad_w, pad_h) applied during letterbox preprocessing.

        Returns:
            List of filtered Detection objects in original frame pixel coordinates.
        """
        orig_h, orig_w = orig_shape[:2]
        pad_w, pad_h = pad

        # Squeeze batch dimension: [5, 8400] -> transpose to [8400, 5]
        predictions = np.squeeze(raw_output)
        if predictions.ndim != 2:
            return []

        # Ensure shape is [num_anchors, channels]
        if predictions.shape[0] < predictions.shape[1]:
            predictions = predictions.T

        num_anchors, channels = predictions.shape
        if channels < 5:
            return []

        # Coordinates: cx, cy, w, h
        boxes_cxcywh = predictions[:, :4]
        # Class confidences: shape [8400, num_classes]
        scores_matrix = predictions[:, 4:]

        # For single class (debris), class_id = 0
        if scores_matrix.shape[1] == 1:
            confidences = scores_matrix[:, 0]
            class_ids = np.zeros(num_anchors, dtype=np.int32)
        else:
            class_ids = np.argmax(scores_matrix, axis=1)
            confidences = np.max(scores_matrix, axis=1)

        # Filter by confidence threshold
        conf_mask = confidences >= self.conf_threshold
        if not np.any(conf_mask):
            return []

        boxes_cxcywh = boxes_cxcywh[conf_mask]
        confidences = confidences[conf_mask]
        class_ids = class_ids[conf_mask]

        # Convert [cx, cy, w, h] to [x1, y1, x2, y2] in 640x640 space
        cx = boxes_cxcywh[:, 0]
        cy = boxes_cxcywh[:, 1]
        w = boxes_cxcywh[:, 2]
        h = boxes_cxcywh[:, 3]

        x1 = cx - w / 2.0
        y1 = cy - h / 2.0
        x2 = cx + w / 2.0
        y2 = cy + h / 2.0

        # Rescale boxes back to original image coordinates by inverting letterbox
        x1_orig = (x1 - pad_w) / ratio
        y1_orig = (y1 - pad_h) / ratio
        x2_orig = (x2 - pad_w) / ratio
        y2_orig = (y2 - pad_h) / ratio

        # Clip coordinates to original frame boundaries
        x1_orig = np.clip(x1_orig, 0, orig_w)
        y1_orig = np.clip(y1_orig, 0, orig_h)
        x2_orig = np.clip(x2_orig, 0, orig_w)
        y2_orig = np.clip(y2_orig, 0, orig_h)

        # Prepare bounding boxes for cv2.dnn.NMSBoxes ([x, y, width, height])
        nms_boxes = []
        nms_scores = []
        for i in range(len(confidences)):
            bw = x2_orig[i] - x1_orig[i]
            bh = y2_orig[i] - y1_orig[i]
            if bw > 2 and bh > 2:
                nms_boxes.append([int(x1_orig[i]), int(y1_orig[i]), int(bw), int(bh)])
                nms_scores.append(float(confidences[i]))

        if not nms_boxes:
            return []

        # Run Non-Maximum Suppression (NMS)
        indices = cv2.dnn.NMSBoxes(
            bboxes=nms_boxes,
            scores=nms_scores,
            score_threshold=self.conf_threshold,
            nms_threshold=self.iou_threshold,
        )

        detections: list[Detection] = []
        if len(indices) > 0:
            flat_indices = np.array(indices).flatten().tolist()
            for idx in flat_indices:
                box_xywh = nms_boxes[idx]
                bx1 = float(box_xywh[0])
                by1 = float(box_xywh[1])
                bx2 = float(box_xywh[0] + box_xywh[2])
                by2 = float(box_xywh[1] + box_xywh[3])
                cid = int(class_ids[idx])
                cname = self.class_names.get(cid, "debris")

                detections.append(
                    Detection(
                        box=[bx1, by1, bx2, by2],
                        confidence=nms_scores[idx],
                        class_id=cid,
                        class_name=cname,
                    )
                )

        return detections

    def infer(self, frame: np.ndarray) -> list[Detection]:
        """Perform end-to-end detection on a single video frame.

        Args:
            frame: Source video frame (numpy BGR uint8 image).

        Returns:
            List of detected debris bounding boxes. Returns empty list if model
            is not loaded or execution fails gracefully.
        """
        if not self.is_loaded or self.session is None or frame is None or frame.size == 0:
            return []

        try:
            # 1. Preprocess
            input_tensor, ratio, pad = self.preprocess(frame)

            # 2. Run ONNX Inference Session
            raw_outputs = self.session.run(self.output_names, {self.input_name: input_tensor})

            # 3. Postprocess & NMS
            detections = self.postprocess(
                raw_outputs[0],
                orig_shape=frame.shape[:2],
                ratio=ratio,
                pad=pad,
            )
            return detections

        except Exception as e:
            logger.error("Inference execution error: %s", e)
            return []

    __call__ = infer


def get_status_color(status: str) -> tuple[int, int, int]:
    """Return BGR color corresponding to occlusion status tier."""
    status_upper = str(status).upper()
    if status_upper == "CLEAR":
        return COLOR_GREEN
    if status_upper == "WARNING":
        return COLOR_YELLOW
    if status_upper == "CRITICAL":
        return COLOR_RED
    return COLOR_CYAN


def draw_annotations(
    frame: np.ndarray,
    detections: Sequence[Union[Detection, dict[str, Any]]],
    roi: Optional[Union[Sequence[float], np.ndarray, Sequence[Sequence[float]]]] = None,
    status: str = "CLEAR",
    occlusion_ratio: float = 0.0,
    show_labels: bool = True,
    draw_roi: bool = True,
    copy: bool = True,
) -> np.ndarray:
    """Draw Grate ROI boundary, status indicators, and detected debris bounding boxes.

    Args:
        frame: Base BGR video frame.
        detections: List of Detection instances or dicts with a 'box' key.
        roi: Calibrated Grate ROI as normalized [x1, y1, x2, y2], pixel box, or polygon.
        status: Current confirmed alert status ('CLEAR', 'WARNING', 'CRITICAL').
        occlusion_ratio: Grate occlusion percentage (0.0 to 100.0).
        show_labels: Whether to render confidence labels over detection boxes.
        draw_roi: Whether to render the calibrated Grate ROI.
        copy: If True, returns a new annotated copy; otherwise modifies in-place.

    Returns:
        Annotated BGR frame image.
    """
    output = frame.copy() if copy else frame
    h, w = output.shape[:2]

    # 1. Draw Calibrated Grate ROI
    if draw_roi and roi is not None:
        roi_color = get_status_color(status)
        pts = np.asarray(roi, dtype=np.float32)

        if pts.ndim == 1 and len(pts) == 4:
            rx1, ry1, rx2, ry2 = pts
            if max(rx1, ry1, rx2, ry2) <= 1.05:
                rx1 *= w
                ry1 *= h
                rx2 *= w
                ry2 *= h
            roi_box = (int(round(rx1)), int(round(ry1)), int(round(rx2)), int(round(ry2)))

            # Semi-transparent tinted fill overlay
            overlay = output.copy()
            cv2.rectangle(overlay, (roi_box[0], roi_box[1]), (roi_box[2], roi_box[3]), roi_color, thickness=-1)
            cv2.addWeighted(overlay, 0.15, output, 0.85, 0, output)

            # Solid ROI boundary outline
            cv2.rectangle(output, (roi_box[0], roi_box[1]), (roi_box[2], roi_box[3]), roi_color, thickness=2)

            # ROI Header Badge
            badge_text = f"Grate ROI: {occlusion_ratio:.1f}% [{status}]"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.55
            thickness = 1
            (tw, th), baseline = cv2.getTextSize(badge_text, font, font_scale, thickness)

            badge_y = max(roi_box[1] - 8, th + 8)
            cv2.rectangle(
                output,
                (roi_box[0], badge_y - th - 6),
                (roi_box[0] + tw + 10, badge_y + baseline),
                COLOR_BLACK,
                thickness=-1,
            )
            cv2.putText(
                output,
                badge_text,
                (roi_box[0] + 5, badge_y - 2),
                font,
                font_scale,
                roi_color,
                thickness,
                lineType=cv2.LINE_AA,
            )

        elif pts.ndim == 2 and pts.shape[1] == 2:
            poly_pts = pts.copy()
            if np.max(poly_pts) <= 1.05:
                poly_pts[:, 0] *= w
                poly_pts[:, 1] *= h
            poly_int = poly_pts.astype(np.int32)

            overlay = output.copy()
            cv2.fillPoly(overlay, [poly_int], roi_color)
            cv2.addWeighted(overlay, 0.15, output, 0.85, 0, output)
            cv2.polylines(output, [poly_int], isClosed=True, color=roi_color, thickness=2)

    # 2. Draw Debris Detection Boxes (Solid Red)
    for det in detections:
        if isinstance(det, Detection):
            bx1, by1, bx2, by2 = [int(round(c)) for c in det.box]
            confidence = det.confidence
            class_name = det.class_name
        elif isinstance(det, dict) and "box" in det:
            bx1, by1, bx2, by2 = [int(round(c)) for c in det["box"]]
            confidence = det.get("confidence", 1.0)
            class_name = det.get("class_name", "debris")
        else:
            bx1, by1, bx2, by2 = [int(round(c)) for c in det[:4]]
            confidence = float(det[4]) if len(det) > 4 else 1.0
            class_name = "debris"

        # Bounding box in Red
        cv2.rectangle(output, (bx1, by1), (bx2, by2), COLOR_RED, thickness=2)

        if show_labels:
            label_text = f"{class_name} {confidence:.0%}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.45
            thickness = 1
            (tw, th), baseline = cv2.getTextSize(label_text, font, font_scale, thickness)

            label_y = max(by1 - 4, th + 4)
            cv2.rectangle(
                output,
                (bx1, label_y - th - 4),
                (bx1 + tw + 6, label_y + baseline),
                COLOR_RED,
                thickness=-1,
            )
            cv2.putText(
                output,
                label_text,
                (bx1 + 3, label_y - 2),
                font,
                font_scale,
                COLOR_WHITE,
                thickness,
                lineType=cv2.LINE_AA,
            )

    return output
