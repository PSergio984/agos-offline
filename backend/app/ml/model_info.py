"""Model sidecar reader: provenance JSON next to the ONNX weights plus the real file hash."""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

logger = logging.getLogger("agos.model_info")

_cache: Dict[str, Tuple[Tuple[int, int], Dict[str, Any]]] = {}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sidecar_path(weights_path: Union[str, Path]) -> Path:
    weights = Path(weights_path)
    return weights.with_name(weights.name + ".json")


def load_model_info(weights_path: Union[str, Path]) -> Dict[str, Any]:
    """
    Return provenance for the weights file. The SHA-256 and size are computed once and
    cached by (mtime, size). `sidecar_hash_match` is True only when a sidecar exists and
    its recorded sha256 equals the real file hash.
    """
    weights = Path(weights_path)
    try:
        stat = weights.stat()
    except OSError:
        return {
            "weights_file": weights.name,
            "weights_sha256": None,
            "weights_size_bytes": None,
            "model_version": "unknown",
            "training_source": "unknown",
            "license": None,
            "sidecar_hash_match": False,
        }

    key = str(weights)
    fingerprint = (stat.st_mtime_ns, stat.st_size)
    cached = _cache.get(key)
    if cached and cached[0] == fingerprint:
        return dict(cached[1])

    sha = _sha256(weights)
    sidecar: Dict[str, Any] = {}
    sc_path = sidecar_path(weights)
    if sc_path.is_file():
        try:
            sidecar = json.loads(sc_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            logger.warning("Could not read model sidecar %s: %s", sc_path.name, err)

    recorded: Optional[str] = sidecar.get("sha256")
    info = {
        "weights_file": weights.name,
        "weights_sha256": sha,
        "weights_size_bytes": stat.st_size,
        "model_version": sidecar.get("model_version", "unknown"),
        "training_source": sidecar.get("training_source", "unknown"),
        "license": sidecar.get("license"),
        "sidecar_hash_match": bool(recorded) and recorded.lower() == sha,
    }
    if sidecar and not info["sidecar_hash_match"]:
        logger.warning("Model sidecar hash does not match %s", weights.name)
    _cache[key] = (fingerprint, info)
    return dict(info)
