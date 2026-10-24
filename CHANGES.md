# Audit fixes

| File | Change |
|---|---|
| `frontend/.env.local` (new) | `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` - without it the UI runs on fake demo data. Git ignores this file, so recreate it after every fresh clone. |
| `backend/.env.example`, `render.yaml`, `render-backend.env` | `MODEL_PATH` now points to the Keras model (+ `GATE_MODEL_PATH`); old setting forced ResNet18 and disabled the X-ray gate. CORS now also allows 127.0.0.1:3000/3001. |
| `backend/api/analyze.py` | Batch endpoint no longer returns HTTP 500 when one file is rejected. Confidence/priority use the predicted-class probability (NORMAL results were always LOW confidence). Grad-CAM path anchored to `backend/`. |
| `backend/utils/file_utils.py` | Upload path anchored to `backend/` (no longer depends on the working directory). |
| `backend/config.py` | SQLite path anchored to `backend/`; default PORT 10000 -> 8000. |
| `backend/requirements.txt` | `keras>=3.13.2` (models were saved with 3.13.2), added `h5py`, removed unused `pydantic-settings`. |
| `frontend/Dockerfile`, `docker-compose.yml` | `NEXT_PUBLIC_API_URL` passed as a build arg (it is baked in at build time). |
| `frontend/package.json` | `start` no longer needs bun/tee (works on Windows). |
| `backend/tests/*` | Tests run the app lifespan so DB tables exist. |
