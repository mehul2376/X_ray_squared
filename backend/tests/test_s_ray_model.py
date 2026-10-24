"""Test live S_RAY Keras model inference and X-Ray Gate check."""
from __future__ import annotations

import io
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from main import app
from services import prediction

client = TestClient(app)

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def _find_real_xray() -> Path | None:
    """Locate a genuine chest X-ray fixture.

    Never scan uploads/: that directory holds user uploads plus synthetic
    images produced by other tests, so globbing it made this test
    non-deterministic. Provide a fixture explicitly instead.
    """
    env_path = os.getenv("XRAY_FIXTURE")
    if env_path:
        candidate = Path(env_path)
        return candidate if candidate.is_file() else None
    if FIXTURE_DIR.is_dir():
        for pattern in ("*.jpg", "*.jpeg", "*.png"):
            for candidate in sorted(FIXTURE_DIR.glob(pattern)):
                if candidate.name.startswith("."):
                    continue
                return candidate
    return None


def test_s_ray_model_status():
    """Verify S_RAY model is loaded."""
    status = prediction.model_status()
    assert status["available"] is True
    assert status["model_type"] == "keras"
    assert status["gate_available"] is True


def test_s_ray_rejects_non_xray():
    """Verify non-X-rays (e.g. flat image or color photo) are rejected with 400 NOT_AN_XRAY."""
    buf = io.BytesIO()
    Image.new("RGB", (224, 224), (255, 100, 50)).save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/api/analyze",
        files={"file": ("color_photo.jpg", buf.getvalue(), "image/jpeg")},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["detail"]["error"] == "NOT_AN_XRAY"


def test_s_ray_analyze_real_xray():
    """Test full /api/analyze flow with an actual chest X-ray image.

    Skipped unless a genuine chest X-ray fixture is supplied, because the
    X-Ray Gate is expected to reject synthetic images.
    """
    xray_path = _find_real_xray()
    if xray_path is None:
        pytest.skip(
            "No chest X-ray fixture available. Place one in backend/tests/fixtures/ "
            "or set XRAY_FIXTURE=/path/to/chest_xray.jpg"
        )

    img_bytes = xray_path.read_bytes()

    response = client.post(
        "/api/analyze",
        files={"file": ("chest_xray.jpg", img_bytes, "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "case_id" in data
    assert data["prediction"] in ("NORMAL", "PNEUMONIA")
    assert 0.0 <= data["score"] <= 1.0
    assert 0.0 <= data["probabilities"]["NORMAL"] <= 1.0
    assert 0.0 <= data["probabilities"]["PNEUMONIA"] <= 1.0
    assert data["gradcam_url"] is not None
