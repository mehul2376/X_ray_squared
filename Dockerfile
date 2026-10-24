# Root Dockerfile for X-RAY SQUARED Backend (Render / Cloud deployment)
FROM python:3.11-slim

# Prevent Python from writing .pyc and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KERAS_BACKEND=torch

# Install system dependencies for OpenCV and image operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend requirements
COPY backend/requirements.txt .

# Install CPU-only PyTorch first (keeps image small and builds fast)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend files (includes models/*.keras and s_ray_config.json)
COPY backend/ /app/
# Also place the S_RAY config next to the app dir so CONFIG_ABS_PATH resolves
# regardless of which candidate directory the process starts from.
COPY s_ray_config.json /app/s_ray_config.json

# Ensure upload/result directories exist
RUN mkdir -p uploads results trained_models models

EXPOSE 10000

# Start Uvicorn bound to dynamic PORT assigned by host (Render defaults to 10000)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
