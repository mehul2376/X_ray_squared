# Internal config module — reads from environment / .env
from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend/ directory (one level up from this file).
# override=True so backend's .env takes precedence over any inherited env
# (e.g., the Next.js project's DATABASE_URL must not leak in here).
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


# Set Keras backend to PyTorch before any keras import
os.environ.setdefault("KERAS_BACKEND", "torch")


def _resolve_db_url(url: str) -> str:
    prefix = "sqlite:///./"
    if url.startswith(prefix):
        db_file = Path(__file__).resolve().parent / url[len(prefix):]
        return "sqlite:///" + db_file.as_posix()
    return url


class Settings:
    """Application settings (read from environment variables)."""

    # Model paths
    MODEL_PATH: str = os.getenv(
        "MODEL_PATH",
        "models/S_RAY_Pneumonia_Model.keras"
        if (Path(__file__).resolve().parent / "models" / "S_RAY_Pneumonia_Model.keras").exists()
        else "trained_models/pneumonia_resnet18_best.pth",
    )
    GATE_MODEL_PATH: str = os.getenv(
        "GATE_MODEL_PATH",
        "models/S_RAY_Xray_Gate.keras",
    )
    # CONFIG_PATH is resolved against several candidate locations because the
    # deploy root directory differs between local runs (backend/) and Render
    # (rootDir=backend, repo checkout, etc.). First match wins.
    CONFIG_PATH: str = os.getenv("CONFIG_PATH", "s_ray_config.json")

    # Database
    # Relative sqlite paths (sqlite:///./x.db) are anchored to backend/ so the DB
    # is the same no matter which directory uvicorn is started from.
    DATABASE_URL: str = _resolve_db_url(os.getenv("DATABASE_URL", "sqlite:///./xray_squared.db"))

    # Directories
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "uploads")
    RESULT_DIR: str = os.getenv("RESULT_DIR", "results")

    # CORS
    # Comma-separated list of allowed origins. In production set this to the
    # exact deployed Vercel origin(s). "*" is only honoured when the service is
    # explicitly running in demo/public mode (see CORS_ALLOW_ALL below).
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]

    # Regex of additional allowed origins (Vercel preview deployments use random
    # subdomains, so an explicit list alone is not enough during review).
    # Set CORS_ALLOW_ORIGIN_REGEX to an empty value to disable.
    CORS_ALLOW_ORIGIN_REGEX: str = os.getenv(
        "CORS_ALLOW_ORIGIN_REGEX", r"https://.*\.vercel\.app"
    )

    # Escape hatch for local UI work only. Never enable in production.
    CORS_ALLOW_ALL: bool = os.getenv("CORS_ALLOW_ALL", "false").strip().lower() in {
        "1",
        "true",
        "yes",
    }

    # Confidence thresholds
    HIGH_CONFIDENCE_THRESHOLD: float = float(os.getenv("HIGH_CONFIDENCE_THRESHOLD", "0.80"))
    MEDIUM_CONFIDENCE_THRESHOLD: float = float(os.getenv("MEDIUM_CONFIDENCE_THRESHOLD", "0.60"))

    # S_RAY model thresholds
    PNEUMONIA_THRESHOLD: float = float(os.getenv("PNEUMONIA_THRESHOLD", "0.50"))
    XRAY_THRESHOLD: float = float(os.getenv("XRAY_THRESHOLD", "0.70"))

    # Upload limit
    MAX_UPLOAD_MB: int = int(os.getenv("MAX_UPLOAD_MB", "10"))

    # Blur / sharpness thresholds (Laplacian variance heuristic)
    # Prototype heuristic — requires clinical validation on real chest X-rays.
    BLUR_THRESHOLD_POOR: float = float(os.getenv("BLUR_THRESHOLD_POOR", "30.0"))
    BLUR_THRESHOLD_WARNING: float = float(os.getenv("BLUR_THRESHOLD_WARNING", "100.0"))

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    @property
    def BACKEND_ROOT(self) -> Path:
        # config.py lives at backend/config.py, so backend/ is its parent.
        return Path(__file__).resolve().parent

    @property
    def MODEL_ABS_PATH(self) -> Path:
        p = Path(self.MODEL_PATH)
        if not p.is_absolute():
            p = self.BACKEND_ROOT / p
        return p

    @property
    def GATE_MODEL_ABS_PATH(self) -> Path:
        p = Path(self.GATE_MODEL_PATH)
        if not p.is_absolute():
            p = self.BACKEND_ROOT / p
        return p

    @property
    def CONFIG_ABS_PATH(self) -> Path:
        """Resolve the S_RAY config file across the layouts we actually deploy.

        Candidates are checked in order so the value works whether the process
        starts from backend/ (local), a Render rootDir=backend checkout, or a
        repository-root checkout. Returns the first existing candidate, or the
        backend-relative default when none exist (callers degrade gracefully).
        """
        configured = Path(self.CONFIG_PATH)
        if configured.is_absolute():
            return configured

        candidates = [
            self.BACKEND_ROOT / configured,          # backend/s_ray_config.json
            self.BACKEND_ROOT.parent / configured,   # <repo>/s_ray_config.json
            self.BACKEND_ROOT / "models" / configured,
            Path.cwd() / configured,
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return self.BACKEND_ROOT / configured

    def ensure_directories(self) -> None:
        """Create upload / result / model directories if missing."""
        for d in (self.UPLOAD_DIR, self.RESULT_DIR, "trained_models", "models"):
            p = Path(d)
            if not p.is_absolute():
                p = self.BACKEND_ROOT / p
            p.mkdir(parents=True, exist_ok=True)


settings = Settings()
