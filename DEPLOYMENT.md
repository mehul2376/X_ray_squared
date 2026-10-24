# Live Deployment Guide — X-RAY SQUARED (Vercel + Render)

Production architecture for this repository:

```
User
  ↓
Vercel Frontend  (frontend/  — Next.js 16)
  ↓ HTTPS API  (NEXT_PUBLIC_API_URL)
Render FastAPI Backend  (backend/  — uvicorn main:app)
  ↓
Existing trained ML model  (backend/models/S_RAY_Pneumonia_Model.keras, Keras 3 on PyTorch)
  ↓
Prediction + Confidence
  ↓
Render API  →  Vercel Frontend  →  Dashboard / Analysis Result
```

GitHub is the single source of truth. Every `git push` triggers an automatic
redeploy on Render and Vercel. Nothing is ever uploaded by hand.

---

## 0. Project facts this guide relies on (verified against the repo)

| Item | Value |
|---|---|
| Backend entry point | `backend/main.py` → `main:app` |
| Render root directory | `backend` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Build command | `pip install --upgrade pip && pip install -r requirements.txt` |
| Health check | `GET /health` |
| Model file | `backend/models/S_RAY_Pneumonia_Model.keras` (19 MB, tracked in Git) |
| Gate model file | `backend/models/S_RAY_Xray_Gate.keras` (17 MB, tracked in Git) |
| Legacy fallback | `backend/trained_models/pneumonia_resnet18_best.pth` (45 MB, tracked in Git) |
| Model load | Once, in the FastAPI `lifespan` startup handler |
| Runtime device | CPU (`torch.device("cpu")`) |
| Input | 224×224 RGB, channels-last `(1, 224, 224, 3)` float32 in [0,255] |
| Classes | `NORMAL`, `PNEUMONIA` |
| Preprocess | resize to 224×224 → float32 tensor; EfficientNet layers do the scaling/normalization |
| Prediction | sigmoid output `out[0,0]` = P(pneumonia); threshold 0.50 |
| Single upload field | `file` |
| Batch upload field | `files` |
| Total model size in Git | ~77 MB — under GitHub's 100 MB per-file limit, no LFS required |

The trained model is **not** retrained, replaced or re-architecture'd by this
deployment. Only its location and the process that loads it changed.

---

## 1. Push the repository to GitHub

```bash
cd X-RAY_ANALYSIS-fixed
git init
git add .
git commit -m "Prepare X-RAY SQUARED for Render + Vercel deployment"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/<YOUR_REPO>.git
git push -u origin main
```

Before pushing, confirm the model files ARE included (they must not be ignored):

```bash
git check-ignore -v backend/models/S_RAY_Pneumonia_Model.keras   # must print nothing
git ls-files backend/models backend/trained_models
```

Expected:

```
backend/models/S_RAY_Pneumonia_Model.keras
backend/models/S_RAY_Xray_Gate.keras
backend/s_ray_config.json
backend/trained_models/pneumonia_resnet18_best.pth
```

---

## 2. Deploy the backend to Render

### 2.1 Create the account and connect the repository

1. Go to <https://render.com> → **Get Started** → sign in with GitHub.
2. Render asks for repository access → grant it for the repo you just pushed.

### 2.2 Create the Web Service

1. Dashboard → **New +** → **Web Service**.
2. **Connect repository:** select your repo.
3. Fill in exactly these values:

   | Field | Value |
   |---|---|
   | Name | `xray-squared-backend` |
   | Branch | `main` |
   | Root Directory | `backend` |
   | Runtime / Language | `Python` (native — **not** Docker) |
   | Build Command | `pip install --upgrade pip && pip install -r requirements.txt` |
   | Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Health Check Path | `/health` |
   | Instance Type | `Free` |

   > **Root Directory must be `backend`.** `config.py` resolves the model paths
   > relative to its own location, so `backend/` must be the process root for
   > `models/*.keras` and `s_ray_config.json` to resolve unchanged.

   > **Use the native Python runtime, not Docker.** `requirements.txt` pins
   > CPU-only PyTorch wheels via
   > `--extra-index-url https://download.pytorch.org/whl/cpu`. With Docker
   > the default CUDA wheels (~2.5 GB) are downloaded and the build fails on
   > Render's disk quota.

   > Blueprint alternative: Render detects `render.yaml` at the repo root and
   > creates the service for you (**New +** → **Blueprint**). It declares the
   > same values plus the env vars below.

### 2.3 Environment variables

Render → your service → **Environment** → **Add Environment Variable**.

| Key | Value |
|---|---|
| `PYTHON_VERSION` | `3.12.8` |
| `KERAS_BACKEND` | `torch` |
| `MODEL_PATH` | `models/S_RAY_Pneumonia_Model.keras` |
| `GATE_MODEL_PATH` | `models/S_RAY_Xray_Gate.keras` |
| `CONFIG_PATH` | `s_ray_config.json` |
| `DATABASE_URL` | `sqlite:///./xray_squared.db` — see §2.6 for Postgres |
| `UPLOAD_DIR` | `uploads` |
| `RESULT_DIR` | `results` |
| `CORS_ORIGINS` | `https://YOUR-VERCEL-DOMAIN.vercel.app` (§2.5) |
| `CORS_ALLOW_ORIGIN_REGEX` | `https://.*\.vercel\.app` |
| `CORS_ALLOW_ALL` | `false` |
| `HIGH_CONFIDENCE_THRESHOLD` | `0.80` |
| `MEDIUM_CONFIDENCE_THRESHOLD` | `0.60` |
| `MAX_UPLOAD_MB` | `10` |

Do **not** set `PORT` — Render injects it. Do **not** set `HOST` — the start
command already binds `0.0.0.0`.

Template file with the same keys: `render-backend.env`. It contains no secrets.

### 2.4 Deploy and verify

1. Click **Create Web Service**.
2. Watch the build log. A healthy build ends with `Successfully installed ...`
   and the service transitions to **Live**.
3. Open `https://xray-squared-backend.onrender.com/health`:

   ```json
   {"status":"ok","model_available":true}
   ```

4. Open `https://xray-squared-backend.onrender.com/docs` — Swagger UI must load.
5. Check the startup log for these three lines (proves the model loaded once):

   ```
   xray_squared.prediction: Loaded S_RAY config from .../s_ray_config.json: pneumonia_threshold=0.50, xray_threshold=0.70
   xray_squared.prediction: S_RAY Keras model loaded successfully on device=cpu
   xray_squared.main: Model loaded on device=cpu
   ```

   There must be **no** "Failed to load Keras model" line.
6. Debug endpoint `https://xray-squared-backend.onrender.com/model-status`:

   ```json
   {
     "available": true,
     "model_type": "keras",
     "gate_available": true,
     "device": "cpu",
     "error": null,
     "input_size": [224, 224],
     "classes": ["NORMAL", "PNEUMONIA"],
     "model_loaded_once": true
   }
   ```

### 2.5 Set CORS to your Vercel origin

`CORS_ORIGINS` must contain the exact deployed frontend origin, no trailing
slash, no wildcard. You can deploy the frontend first (§3) and come back, or
use a placeholder and update it once the Vercel URL exists.

Verify a preflight from the browser origin:

```bash
curl -i -X OPTIONS https://xray-squared-backend.onrender.com/api/analyze \
  -H "Origin: https://YOUR-VERCEL-DOMAIN.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expect `access-control-allow-origin: https://YOUR-VERCEL-DOMAIN.vercel.app`.
A request from an unrelated origin must **not** return that header.

### 2.6 Recommended: Render Postgres (survives redeploys)

Render's filesystem is ephemeral — with `sqlite:///./xray_squared.db` **all
cases are erased on every redeploy and restart.** For a real production
database:

1. Render → **New +** → **Postgres**.
2. Name it, pick the free plan, choose the same region as the web service.
3. **Internal Database URL** is only reachable from Render; use the
   **External Database URL** if you also connect from your machine.
4. Set on the web service:
   `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME`
5. `psycopg2-binary` is already in `requirements.txt`, and `init_db()` creates
   the schema automatically on next boot. No migration step needed.

Alternatively keep SQLite and mount a persistent disk, then set
`DATABASE_URL=sqlite:////mnt/data/xray_squared.db`.

### 2.7 Test the prediction API against Render

```bash
curl -X POST https://xray-squared-backend.onrender.com/api/analyze \
  -F "file=@./chest_xray.jpg"
```

A valid chest X-ray returns HTTP 200 with the full payload:

```json
{
  "case_id": "XR-000001",
  "filename": "chest_xray.jpg",
  "prediction": "PNEUMONIA",
  "score": 0.825,
  "confidence": "HIGH",
  "uncertainty": 0.175,
  "priority": "HIGH",
  "quality": { "status": "WARNING", "...": "..." },
  "probabilities": { "NORMAL": 0.175, "PNEUMONIA": 0.825 },
  "gradcam_url": "/results/XR-000001-gradcam.png",
  "review_status": "PENDING",
  "human_review": { "required": true, "decision": null, "notes": null }
}
```

Expected non-200 responses:

| Code | Meaning |
|---|---|
| 400 `INVALID_IMAGE` | unsupported type, >10 MB, corrupt, or dimensions outside 64–4096 px |
| 400 `NOT_AN_XRAY` | the X-Ray Gate rejected the image (it is not a chest radiograph) |
| 503 `MODEL_NOT_AVAILABLE` | the model failed to load — check the Render log |

Free-tier note: the first request after an idle period takes ~30–60 s while
Render spins the instance up.

---

## 3. Deploy the frontend to Vercel

### 3.1 Create the project

1. Go to <https://vercel.com> → sign in with GitHub.
2. **Add New...** → **Project** → import the same repository.

### 3.2 Configure the build

| Field | Value |
|---|---|
| Framework Preset | `Next.js` |
| Root Directory | `frontend` |
| Build Command | `next build` (default — leave as detected) |
| Output Directory | auto (`.next`) |
| Node.js Version | 22.x or newer |

`output: "standalone"` in `next.config.ts` is ignored by Vercel's Next.js
builder, so no extra configuration is needed.

### 3.3 Environment variables

Vercel → project → **Settings** → **Environment Variables** → add for
**Production** (and **Preview**):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://xray-squared-backend.onrender.com` |
| `NEXT_PUBLIC_ALLOW_MOCK_DATA` | `false` |

No other variables are needed. There are **no API keys, tokens or database
URLs in the frontend** — `NEXT_PUBLIC_*` values are public by definition, so
never put anything secret in them.

Template file with the same keys: `vercel-frontend.env`.

> `NEXT_PUBLIC_*` values are **baked into the client bundle at build time**.
> After changing one you must redeploy (Settings → Deployments → ⋯ → Redeploy),
> not just restart.

### 3.4 Deploy and verify

1. Click **Deploy**.
2. Open the production URL, e.g. `https://x-ray-analysis.vercel.app`.
3. Confirm the green **Live Backend** badge appears on the dashboard.
4. **Upload test:** Analyze → drop a real chest X-ray → confirm the result
   card shows prediction, confidence and a Grad-CAM overlay.
5. **Dashboard test:** the KPI row and Recent X-Ray Cases table must show the
   cases you analysed — real values from Render, not the demo dataset.
6. **Review test:** open a case → submit a human decision → reopen the
   dashboard and confirm the Review column and the AI Review Queue counts
   changed.

### 3.5 Confirm no localhost leaked into production

```bash
curl -s https://YOUR-VERCEL-DOMAIN.vercel.app/_next/static/ -o /dev/null -w "%{http_code}\n"
```

Then search your deployed JS chunks for `localhost` / `127.0.0.1`. There must
be no API URL pointing at localhost:8000. The only place the backend base URL
exists is `frontend/src/lib/api.ts` (`API_BASE_URL`); every request is built
from it, so it is impossible for two files to disagree.

---

## 4. Environment separation (no accidental localhost in production)

### Development

| | |
|---|---|
| Frontend | `http://localhost:3000` |
| Backend | `http://127.0.0.1:8000` |
| Config | `frontend/.env.local` (git-ignored) |

```bash
# terminal 1
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# terminal 2
cd frontend && npm install
# .env.local must contain:
#   NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
#   NEXT_PUBLIC_ALLOW_MOCK_DATA=true
npm run dev
```

Backend copy for local use: `cp backend/.env.example backend/.env`.

### Production

| | |
|---|---|
| Frontend | `https://YOUR-VERCEL-DOMAIN.vercel.app` |
| Backend | `https://YOUR-RENDER-DOMAIN.onrender.com` |

`NEXT_PUBLIC_ALLOW_MOCK_DATA` is hard-disabled in any production build
regardless of the variable's value:

```ts
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MOCK_DATA_ALLOWED = !IS_PRODUCTION && /* env override */;
```

If the backend is unreachable in production the UI shows **Backend Offline**
with zeroed figures and an explicit error banner. It never substitutes
synthetic data.

---

## 5. Update workflow (no manual uploads)

```
edit locally  →  npm run build / pytest  →  git add .  →  git commit  →
git push  →  GitHub  →  Render auto-redeploy  +  Vercel auto-redeploy
```

Both services must have auto-deploy enabled (Render: **Settings → Auto-Deploy**
= `Yes`, which is the default; Vercel: production deploys on every push to the
connected branch).

Notes:

- Schema changes to `models/case.py` are applied by `init_db()` on the next
  boot (`create_all` + an `ALTER TABLE` guard for `sharpness_status`).
- With SQLite on Render, a redeploy wipes the case database. Use Postgres (§2.6).
- Because `NEXT_PUBLIC_*` values are build-time, changing them requires a
  redeploy, which a `git push` or a manual Vercel redeploy provides.

---

## 6. Updating the trained model later

Nothing below is automatic. The pipeline never retrains, never re-architects
and never changes preprocessing on its own. To swap in a new model, verify each
item against the current model first, then change only what differs.

### 6.1 Verify compatibility before integrating

| Property | Current value | Must match? |
|---|---|---|
| Input spatial size | 224×224 | Yes — unless you also update preprocessing |
| Input channels | 3 (RGB) | Yes |
| Input layout | channels-last `(1, 224, 224, 3)`, float32 in [0,255] | Yes for Keras |
| Scaling / normalization | handled inside the EfficientNet layers | Yes — do not add `ToTensor()`/`Normalize()` |
| Output shape | `(1, 1)` sigmoid = P(pneumonia) | Yes — a 2-logit softmax model needs a different read in `prediction.predict()` |
| Class mapping | 0 → `NORMAL`, 1 → `PNEUMONIA` (see `CLASS_NAMES`) | Yes, or update it |
| Decision threshold | 0.50 (`pneumonia_threshold`) | Re-validate; update via `s_ray_config.json` or `PNEUMONIA_THRESHOLD` |
| Gate model | `S_RAY_Xray_Gate.keras`, `(1,1)`, reject when score > 0.42 | Keep paired, or set `GATE_MODEL_PATH` and re-validate the 0.42 cut-off |

Current values are also recorded at runtime in `s_ray_config.json`
(`image_size`, `classes`, `pneumonia_threshold`, `xray_threshold`) and are
reported by `GET /model-status` as `input_size`, `classes` and
`model_loaded_once`.

### 6.2 What to change for a new model

1. **Replace the file** — keep the same filename and drop it in
   `backend/models/`. No code change; `MODEL_PATH` already points there.
2. **Update `s_ray_config.json`** if `image_size`, `classes` or the thresholds
   changed. It is copied into `backend/` so it resolves on every deploy root.
3. **Change preprocessing** only if the input size or scaling differs:
   `backend/services/preprocessing.py` (`MODEL_INPUT_SIZE`,
   `preprocess_image_keras`). This is the single source of truth for resize and
   tensor construction.
4. **Change the output read** only if the head changed:
   `backend/services/prediction.py` → `predict()` and, if Grad-CAM needs a
   different layer, `_find_target_layer()` in `backend/services/gradcam.py`.
5. **Re-run the tests:** `cd backend && pytest -q`. The suite asserts the
   model loads, `/api/analyze` returns 200 for a real fixture, scores are in
   [0,1] and Grad-CAM is produced.
6. **Commit and push.** Render redeploys; confirm `GET /model-status` reports
   the new `input_size` / `classes`.

### 6.3 Do not

- Do not delete the current `.keras` file in the same commit as a code change.
- Do not change `CLASS_NAMES`, the thresholds and the Keras input layout in one
  step without testing each.
- Do not enable `CORS_ALLOW_ALL` or replace `CORS_ORIGINS` with `*`.

---

## 7. Post-deployment checklist

- [ ] `GET https://<render-domain>/health` → `{"status":"ok","model_available":true}`
- [ ] `GET https://<render-domain>/docs` renders Swagger UI
- [ ] `GET https://<render-domain>/model-status` → `available: true`, `model_loaded_once: true`, `device: cpu`
- [ ] Render log shows `Model loaded on device=cpu` and no load failure
- [ ] `POST https://<render-domain>/api/analyze` with a real X-ray → HTTP 200 + prediction + confidence
- [ ] `GET /api/cases` returns the created case
- [ ] `PATCH /api/cases/<id>/review` updates the case
- [ ] `GET /api/analytics/summary` reflects the case counts
- [ ] `GET /results/<case>-gradcam.png` → 200 `image/png`
- [ ] CORS preflight from the Vercel origin returns `access-control-allow-origin`
- [ ] CORS preflight from an unrelated origin does **not**
- [ ] Vercel production page loads and shows the **Live Backend** badge
- [ ] X-ray upload in the browser returns a real prediction and Grad-CAM overlay
- [ ] Dashboard KPIs and Recent X-Ray Cases reflect the real database
- [ ] Dashboard table columns align: CASE ID / PREDICTION / CONFIDENCE / PRIORITY / REVIEW / DATE / ACTIONS
- [ ] `NEXT_PUBLIC_API_URL` on Vercel points at the Render HTTPS URL
- [ ] No `localhost` / `127.0.0.1` API URL in any production bundle
- [ ] Production never renders the demo dataset when the backend is down
- [ ] No secrets, API keys or database URLs in `frontend/`
- [ ] `CORS_ALLOW_ALL=false` and `CORS_ORIGINS` lists the exact Vercel origin
- [ ] `git push` triggers automatic redeploys on both platforms

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails, disk full | CUDA PyTorch wheels downloaded | Use the native Python runtime; `requirements.txt` pins the CPU index |
| `ModuleNotFoundError: No module named 'config'` | Root Directory not set to `backend` | Set Root Directory = `backend` |
| `ModuleNotFoundError: No module named 'tensorflow'` | `KERAS_BACKEND` not `torch` at import time | Set `KERAS_BACKEND=torch`; it must be set before Keras is imported |
| `model_available: false` | Model file missing or wrong `MODEL_PATH` | Check `backend/models/*.keras` is committed; read `error` in `/model-status` |
| 400 `NOT_AN_XRAY` | The X-Ray Gate judged the upload not a chest radiograph | Expected behaviour — use a real chest X-ray |
| Vercel: CORS error in console | `CORS_ORIGINS` doesn't match the origin | Copy the exact origin from the browser console, no trailing slash |
| Frontend shows demo data in production | Backend unreachable | Check `NEXT_PUBLIC_API_URL`; demo data cannot be enabled in a production build |
| Dashboard empty after a push | SQLite wiped by the redeploy | Move to Render Postgres (§2.6) |
| Frontend still calls the old URL | `NEXT_PUBLIC_*` is build-time | Redeploy on Vercel after changing it |
| First request very slow | Free-tier cold start | Expected; ~30–60 s after idle |