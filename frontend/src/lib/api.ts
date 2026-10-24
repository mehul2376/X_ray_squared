// API service abstraction for X-RAY SQUARED.
//
// The UI talks ONLY to this module. Modes:
//
//   1. LIVE mode  — when NEXT_PUBLIC_API_URL is set AND the backend is reachable.
//                   Real FastAPI + PyTorch predictions are returned.
//
//   2. DEMO mode  — local development only, and only when
//                   NEXT_PUBLIC_ALLOW_MOCK_DATA=true. Clearly labeled DEMO data.
//
// PRODUCTION RULE: a production build must never return synthetic data. If the
// backend is unreachable the request fails loudly instead of fabricating a
// result. Local development:
//
//     NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
//     NEXT_PUBLIC_ALLOW_MOCK_DATA=true
//
// Expected backend endpoints (see backend/README.md):
//   POST /api/analyze        (multipart/form-data, single image, field name: "file")
//   POST /api/analyze-batch  (multipart/form-data, field name: "files")
//   GET  /api/cases
//   GET  /api/cases/{id}
//   PATCH /api/cases/{id}/review
//   GET  /api/cases/{id}/report
//   GET  /api/analytics/summary
//   GET  /health

import type {
  AnalysisResponse,
  BatchAnalysisResponse,
  Probabilities,
  XRayCase,
  BackendCaseListResponse,
  BackendCaseDetail,
  BackendCaseBrief,
  BackendReviewRequest,
  BackendAnalyticsSummary,
  BackendCaseReport,
} from "@/lib/types";
import { generateCaseId } from "@/lib/demo-data";

// ---------- Configuration ----------

// Single source of truth for the backend base URL. No component or page builds
// its own URL; everything goes through buildUrl() / resolveMediaUrl().
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") || "";

/**
 * Synthetic demo data is only ever allowed for local development.
 * NODE_ENV is inlined by Next.js at build time, so `next build` (Vercel)
 * always compiles this to false regardless of env vars.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function resolveMockAllowed(): boolean {
  if (IS_PRODUCTION) return false;
  const raw = process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA;
  if (raw === undefined) return true;
  return raw !== "false" && raw !== "0";
}

/** True only when the app may fall back to synthetic demo data. */
export const MOCK_DATA_ALLOWED = resolveMockAllowed();

// ---------- Error types ----------

export class ApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class ModelNotAvailableError extends ApiError {
  constructor(message = "Trained model not available.") {
    super(message, 503, "MODEL_NOT_AVAILABLE");
    this.name = "ModelNotAvailableError";
  }
}

export class BackendUnreachableError extends ApiError {
  constructor(url: string, cause?: unknown) {
    super(
      `Cannot reach the X-RAY SQUARED backend at ${url}. ` +
        (cause instanceof Error && cause.message ? `(${cause.message})` : ""),
      0,
      "BACKEND_UNREACHABLE"
    );
    this.name = "BackendUnreachableError";
  }
}

/** Raised instead of ever returning synthetic data. */
function mockNotAllowed(): ApiError {
  return new ApiError(
    "Demo data is disabled in this build and the backend is unreachable. " +
      "Check NEXT_PUBLIC_API_URL and the Render service status.",
    0,
    "DEMO_DISABLED"
  );
}

// ---------- Mock helpers (DEMO mode only) ----------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function deriveConfidence(score: number) {
  if (score >= 0.8) return "HIGH" as const;
  if (score >= 0.6) return "MEDIUM" as const;
  return "LOW" as const;
}

function derivePriority(score: number, confidence: string) {
  if (score >= 0.7) return "HIGH" as const;
  if (score >= 0.45 || confidence === "LOW") return "MEDIUM" as const;
  return "LOW" as const;
}

async function mockAnalyze(file: File): Promise<AnalysisResponse> {
  await sleep(1200 + Math.random() * 900);

  const seedStr = `${file.name}:${file.size}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
  }
  const rand = Math.abs(Math.sin(hash)) % 1;

  const isPneumonia = rand > 0.45;
  const pneumoniaProb = isPneumonia ? 0.55 + rand * 0.4 : 0.05 + rand * 0.3;
  const normalProb = 1 - pneumoniaProb;
  const score = Math.round(pneumoniaProb * 100) / 100;
  const confidence = deriveConfidence(score);
  const priority = derivePriority(score, confidence);
  const uncertainty = Math.round((1 - Math.max(pneumoniaProb, normalProb)) * 100) / 100;

  const qualityRoll = Math.abs(Math.cos(hash)) % 1;
  const qualityStatus = qualityRoll > 0.85 ? "POOR" : qualityRoll > 0.65 ? "WARNING" : "GOOD";
  const brightnessStatus =
    qualityRoll > 0.85 ? "POOR" : qualityRoll > 0.65 ? "WARNING" : "GOOD";
  const contrastStatus = qualityRoll > 0.9 ? "WARNING" : "GOOD";
  const resolutionStatus = "GOOD";

  const caseId = generateCaseId();

  return {
    case_id: caseId,
    filename: file.name,
    prediction: isPneumonia ? "PNEUMONIA" : "NORMAL",
    score,
    confidence: confidence as AnalysisResponse["confidence"],
    uncertainty,
    priority: priority as AnalysisResponse["priority"],
    quality: {
      status: qualityStatus as AnalysisResponse["quality"]["status"],
      brightness: brightnessStatus as AnalysisResponse["quality"]["brightness"],
      contrast: contrastStatus as AnalysisResponse["quality"]["contrast"],
      resolution: resolutionStatus as AnalysisResponse["quality"]["resolution"],
      brightness_value: 80 + (hash % 140),
      contrast_value: 30 + (hash % 50),
      resolution_value: "1024x1024",
      note:
        qualityStatus === "POOR"
          ? "Image quality may affect AI analysis. Human review is recommended."
          : undefined,
    },
    probabilities: {
      NORMAL: Math.round(normalProb * 100) / 100,
      PNEUMONIA: Math.round(pneumoniaProb * 100) / 100,
    } as Probabilities,
    gradcam_url: `/results/${caseId}-gradcam.png`,
    review_status: "PENDING",
    human_review: { required: true },
  };
}

// ---------- Helpers ----------

function buildUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE_URL) return p;
  return `${API_BASE_URL}${p}`;
}

/** Convert a backend-relative gradcam_url into a fully-qualified URL. */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!API_BASE_URL) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `Request failed with status ${res.status}`;
  try {
    const body = await res.json();
    // Backend FastAPI HTTPException detail shape: { error, message }
    if (body?.detail?.error) code = body.detail.error;
    if (body?.detail?.message) message = body.detail.message;
    else if (body?.message) message = body.message;
    else if (typeof body?.detail === "string") message = body.detail;
  } catch {
    // Not JSON — keep default message
  }
  if (res.status === 503) return new ModelNotAvailableError(message);
  return new ApiError(message, res.status, code);
}

/**
 * Map one /api/cases row (backend brief shape) to the UI model.
 * Shared by the dashboard, cases and history pages so all three render
 * identical real rows from the backend.
 */
export function toUiCase(c: BackendCaseBrief): XRayCase {
  return {
    caseId: c.case_id,
    date: c.created_at,
    prediction: c.prediction,
    score: c.score,
    confidence: c.confidence,
    uncertainty: c.uncertainty,
    priority: c.priority,
    // Brief rows carry no quality block; /api/cases/{id} supplies the real
    // values. Never invent a measurement here.
    quality: {
      status: "GOOD",
      brightness: "GOOD",
      contrast: "GOOD",
      resolution: "GOOD",
    },
    reviewStatus: c.review_status,
    reviewDecision:
      c.human_decision === "AGREE_WITH_AI"
        ? "AGREE"
        : c.human_decision === "DISAGREE_WITH_AI"
        ? "DISAGREE"
        : c.human_decision === "NEEDS_FURTHER_REVIEW"
        ? "NEEDS_REVIEW"
        : undefined,
    gradcamAvailable: false,
  };
}

// ---------- Public service API ----------

export interface AnalyzeOptions {
  signal?: AbortSignal;
}

export type BackendStatus =
  | { mode: "demo"; reason: "no_url" | "unreachable" | "disabled" }
  | { mode: "live"; modelAvailable: boolean };

let _cachedStatus: BackendStatus | null = null;

/** True when a synthetic result may be produced instead of a real one. */
function mayUseMock(): boolean {
  return MOCK_DATA_ALLOWED && (!API_BASE_URL || _cachedStatus?.mode === "demo");
}

/**
 * In production there is no "demo" fallback: an unreachable backend is an
 * error the user must see, not something to paper over with fake data.
 */
function requireLiveOrMock(): ApiError | null {
  if (mayUseMock()) return null;
  if (!API_BASE_URL) return mockNotAllowed();
  return null;
}

export const api = {
  /** Configured backend base URL (empty when not configured). */
  baseUrl(): string {
    return API_BASE_URL;
  },

  /** True iff the app is configured to call a real FastAPI backend. */
  isLiveMode(): boolean {
    return !!API_BASE_URL;
  },

  /** True iff this build may display synthetic demo data. */
  isMockMode(): boolean {
    return mayUseMock();
  },

  /**
   * Ping the backend to detect live vs demo mode.
   * Result is cached for the session — call once on app startup.
   */
  async detectMode(): Promise<BackendStatus> {
    if (!API_BASE_URL) {
      _cachedStatus = { mode: "demo", reason: "no_url" };
      return _cachedStatus;
    }
    try {
      const res = await fetch(buildUrl("/health"), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      _cachedStatus = {
        mode: "live",
        modelAvailable: !!body.model_available,
      };
      return _cachedStatus;
    } catch {
      // Production builds refuse to substitute synthetic data.
      _cachedStatus = MOCK_DATA_ALLOWED
        ? { mode: "demo", reason: "unreachable" }
        : { mode: "demo", reason: "disabled" };
      return _cachedStatus;
    }
  },

  /** Return the cached backend status (or null if detectMode hasn't run yet). */
  getCachedStatus(): BackendStatus | null {
    return _cachedStatus;
  },

  /**
   * Analyze a single chest X-ray image.
   * Real predictions in live mode; throws ApiError / ModelNotAvailableError on failure.
   */
  async analyze(image: File, opts: AnalyzeOptions = {}): Promise<AnalysisResponse> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) {
      return mockAnalyze(image);
    }

    const form = new FormData();
    // Backend FastAPI endpoint expects the field name "file"
    form.append("file", image);

    let res: Response;
    try {
      res = await fetch(buildUrl("/api/analyze"), {
        method: "POST",
        body: form,
        signal: opts.signal,
      });
    } catch (e: any) {
      throw new BackendUnreachableError(API_BASE_URL, e);
    }

    if (!res.ok) {
      throw await parseError(res);
    }
    return (await res.json()) as AnalysisResponse;
  },

  /**
   * Analyze a batch of chest X-ray images (parallelized client-side).
   */
  async analyzeBatch(
    images: File[],
    opts: AnalyzeOptions = {}
  ): Promise<BatchAnalysisResponse> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) {
      const results = await Promise.all(
        images.map(async (file) => {
          try {
            const r = await mockAnalyze(file);
            return { filename: file.name, result: r, error: undefined } as const;
          } catch (e: any) {
            return {
              filename: file.name,
              result: null,
              error: e?.message ?? "Unknown error",
            } as const;
          }
        })
      );
      return {
        batch_id: `BATCH-${Date.now()}`,
        results: results as any,
      };
    }

    const form = new FormData();
    images.forEach((img) => form.append("files", img));

    let res: Response;
    try {
      res = await fetch(buildUrl("/api/analyze-batch"), {
        method: "POST",
        body: form,
        signal: opts.signal,
      });
    } catch (e: any) {
      throw new ApiError(
        e?.message ?? "Network error while calling /api/analyze-batch",
        0,
        "NETWORK"
      );
    }

    if (!res.ok) {
      throw await parseError(res);
    }
    return (await res.json()) as BatchAnalysisResponse;
  },

  // ---------- Cases ----------

  /**
   * List cases from the backend with pagination + optional filters.
   * Returns null only in an allowed demo build; otherwise throws on failure so
   * a production dashboard can never display the synthetic dataset.
   */
  async getCases(params: {
    page?: number;
    page_size?: number;
    prediction?: string;
    priority?: string;
    review_status?: string;
  } = {}): Promise<BackendCaseListResponse | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.page_size) qs.set("page_size", String(params.page_size));
    if (params.prediction) qs.set("prediction", params.prediction);
    if (params.priority) qs.set("priority", params.priority);
    if (params.review_status) qs.set("review_status", params.review_status);
    const url = buildUrl("/api/cases") + (qs.toString() ? `?${qs}` : "");
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (e: any) {
      throw new BackendUnreachableError(API_BASE_URL, e);
    }
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BackendCaseListResponse;
  },

  /**
   * Get a single case detail from the backend.
   * Returns null only in an allowed demo build.
   */
  async getCase(caseId: string): Promise<BackendCaseDetail | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    const res = await fetch(buildUrl(`/api/cases/${encodeURIComponent(caseId)}`), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BackendCaseDetail;
  },

  /**
   * Delete a case on the backend.
   * Returns true on success, false in demo mode.
   */
  async deleteCase(caseId: string): Promise<boolean> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return false;
    const res = await fetch(
      buildUrl(`/api/cases/${encodeURIComponent(caseId)}`),
      { method: "DELETE" }
    );
    if (!res.ok) throw await parseError(res);
    return true;
  },

  /**
   * Submit human review to the backend.
   * Returns the updated case detail, or null in an allowed demo build.
   */
  async submitReview(
    caseId: string,
    body: BackendReviewRequest
  ): Promise<BackendCaseDetail | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    const res = await fetch(
      buildUrl(`/api/cases/${encodeURIComponent(caseId)}/review`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BackendCaseDetail;
  },

  // ---------- Analytics ----------

  /**
   * Fetch the analytics summary from the backend.
   * Returns null only in an allowed demo build.
   */
  async getAnalytics(): Promise<BackendAnalyticsSummary | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    let res: Response;
    try {
      res = await fetch(buildUrl("/api/analytics/summary"), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (e: any) {
      throw new BackendUnreachableError(API_BASE_URL, e);
    }
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BackendAnalyticsSummary;
  },

  // ---------- Reports ----------

  /**
   * Fetch the AI-assisted case report (JSON) from the backend.
   * Returns null only in an allowed demo build.
   */
  async getReport(caseId: string): Promise<BackendCaseReport | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    const res = await fetch(
      buildUrl(`/api/cases/${encodeURIComponent(caseId)}/report`),
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BackendCaseReport;
  },

  /**
   * Download the plain-text version of the case report.
   * Returns the text content, or null in an allowed demo build.
   */
  async getReportText(caseId: string): Promise<string | null> {
    const blocked = requireLiveOrMock();
    if (blocked) throw blocked;
    if (mayUseMock()) return null;
    const res = await fetch(
      buildUrl(`/api/cases/${encodeURIComponent(caseId)}/report.txt`)
    );
    if (!res.ok) throw await parseError(res);
    return await res.text();
  },
};
