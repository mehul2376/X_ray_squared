"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Brain,
  AlertTriangle,
  ClipboardCheck,
  ArrowRight,
  FileText,
  Eye,
  FolderOpen,
  Plus,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
  ServerCrash,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { api, toUiCase, type BackendStatus } from "@/lib/api";
import type { BackendAnalyticsSummary, XRayCase } from "@/lib/types";
import {
  PredictionBadge,
  ConfidenceBadge,
  PriorityBadge,
  ReviewStatusBadge,
} from "@/components/xray/badges";
import { DemoBadge } from "@/components/xray/demo-disclaimer";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardPage() {
  const storeCases = useAppStore((s) => s.cases);
  const setPage = useAppStore((s) => s.setPage);
  const selectCase = useAppStore((s) => s.selectCase);

  // Backend mode detection
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [summary, setSummary] = useState<BackendAnalyticsSummary | null>(null);
  const [backendCases, setBackendCases] = useState<XRayCase[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api.detectMode().then((s) => {
      if (mounted) setBackendStatus(s);
    });
    return () => { mounted = false; };
  }, []);

  const isLive = backendStatus?.mode === "live";
  // Synthetic data is only ever rendered when this build explicitly allows it
  // (local development). Production never falls back to the demo dataset.
  const useDemoData = !isLive && api.isMockMode();

  const refresh = useCallback(async () => {
    if (!isLive) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [summ, resp] = await Promise.all([
        api.getAnalytics(),
        api.getCases({ page: 1, page_size: 10 }),
      ]);
      if (summ) setSummary(summ);
      if (resp) setBackendCases(resp.cases.map(toUiCase));
    } catch (e: any) {
      setLoadError(e?.message ?? "Failed to load dashboard data.");
      setSummary(null);
      setBackendCases(null);
    } finally {
      setLoading(false);
    }
  }, [isLive]);

  useEffect(() => {
    if (isLive) {
      queueMicrotask(() => {
        void refresh();
      });
    }
  }, [isLive, refresh]);

  // Data source: real backend rows in production, local store only in a demo build.
  const rawCases = useDemoData ? storeCases : (backendCases ?? []);
  const cases = useMemo(() => {
    const seen = new Set<string>();
    return rawCases.filter((c) => {
      if (!c?.caseId || seen.has(c.caseId)) return false;
      seen.add(c.caseId);
      return true;
    });
  }, [rawCases]);

  // KPIs — every number comes from /api/analytics/summary when live.
  const totalCases = isLive
    ? (summary?.total_cases ?? 0)
    : useDemoData
    ? storeCases.length
    : 0;
  const aiAnalyzed = totalCases; // every persisted case has been analyzed
  const pneumoniaSuspected = isLive
    ? (summary?.pneumonia_cases ?? 0)
    : useDemoData
    ? storeCases.filter((c) => c.prediction === "PNEUMONIA").length
    : 0;
  const needsReview = isLive
    ? (summary?.pending_reviews ?? 0)
    : useDemoData
    ? storeCases.filter((c) => c.reviewStatus === "PENDING").length
    : 0;

  const recent = [...cases]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  // Review queue categories
  const highPriority = isLive
    ? (summary?.high_priority_cases ?? 0)
    : useDemoData
    ? storeCases.filter((c) => c.priority === "HIGH").length
    : 0;
  const needsFurtherReview = isLive
    ? (summary?.needs_further_review ?? 0)
    : useDemoData
    ? storeCases.filter(
        (c) => c.reviewStatus === "REVIEWED" && c.reviewDecision === "NEEDS_REVIEW"
      ).length
    : 0;
  const lowConfidence = isLive
    ? (summary?.confidence_distribution?.LOW ?? 0)
    : useDemoData
    ? storeCases.filter((c) => c.confidence === "LOW").length
    : 0;
  const pendingReview = needsReview;

  function openCase(caseId: string) {
    selectCase(caseId);
    setPage("cases");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page hero */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
            Today at a glance
          </h2>
          {isLive ? (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-800">
              <Wifi className="mr-1 h-3 w-3" />
              Live Backend
            </Badge>
          ) : useDemoData ? (
            <DemoBadge />
          ) : (
            <Badge className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-50 hover:text-rose-800">
              <WifiOff className="mr-1 h-3 w-3" />
              Backend Offline
            </Badge>
          )}
          {isLive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </Button>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {isLive
            ? "Live metrics from the FastAPI backend — real cases from the database."
            : useDemoData
            ? "A workflow-first overview of AI-assisted screenings awaiting human review."
            : "No data available: the X-RAY SQUARED backend could not be reached."}
        </p>
      </div>

      {/* Backend error banner — never silently substitute fake numbers */}
      {!isLive && !useDemoData && (
        <div
          className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-[12.5px] text-rose-900"
          role="alert"
        >
          <ServerCrash className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div className="flex flex-col gap-1">
            <span className="font-medium">Backend unavailable</span>
            <span>
              {loadError ??
                `Could not reach ${api.baseUrl() || "the configured backend"}. Check NEXT_PUBLIC_API_URL and the Render service.`}
            </span>
            <span className="text-[12px] text-rose-800">
              Demo data is disabled in this build, so no figures are shown.
            </span>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Cases"
          value={totalCases}
          description="All cases in the platform"
          icon={FolderOpen}
        />
        <KpiCard
          label="AI Analyzed"
          value={aiAnalyzed}
          description="Cases processed by AI"
          icon={Brain}
          accent="primary"
        />
        <KpiCard
          label="Pneumonia Suspected"
          value={pneumoniaSuspected}
          description="Flagged by AI for review"
          icon={AlertTriangle}
          accent="warning"
        />
        <KpiCard
          label="Needs Human Review"
          value={needsReview}
          description="Pending reviewer decision"
          icon={ClipboardCheck}
          accent="info"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* Recent cases */}
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[15px]">
                  Recent X-Ray Cases
                </CardTitle>
                <CardDescription className="mt-1 text-[12.5px]">
                  Latest AI-assisted analyses awaiting or recently reviewed.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 text-[12.5px]"
                onClick={() => setPage("cases")}
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto scrollbar-thin">
              {recent.length === 0 ? (
                <div className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
                  No cases yet. Analyze a chest X-ray to populate this table.
                </div>
              ) : (
                <table className="w-full min-w-[820px] table-fixed text-left text-[13px]">
                  <colgroup>
                    <col className="w-[124px]" />
                    <col className="w-[164px]" />
                    <col className="w-[124px]" />
                    <col className="w-[132px]" />
                    <col className="w-[124px]" />
                    <col className="w-[132px]" />
                    <col className="w-[112px]" />
                  </colgroup>
                  <thead className="bg-muted/50 text-[11.5px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">Case ID</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Prediction</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Confidence</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Priority</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Review</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recent.map((c) => (
                      <tr key={c.caseId} className="hover:bg-accent/40">
                        <td className="whitespace-nowrap px-4 py-3 align-middle font-mono text-[12px] text-foreground">
                          {c.caseId}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <PredictionBadge prediction={c.prediction} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <ConfidenceBadge confidence={c.confidence} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <PriorityBadge priority={c.priority} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle">
                          <ReviewStatusBadge status={c.reviewStatus} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-middle text-[12px] tabular-nums text-muted-foreground">
                          <span className="block leading-tight">{formatDate(c.date)}</span>
                          <span className="block text-[11px] leading-tight text-muted-foreground/80">
                            {formatTime(c.date)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right align-middle">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 px-2 text-[12px]"
                            onClick={() => openCase(c.caseId)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        {/* AI review queue */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-[15px]">AI Review Queue</CardTitle>
                  <CardDescription className="mt-1 text-[12.5px]">
                    Workflow-driven prioritization — not clinical severity.
                  </CardDescription>
                </div>
                {isLive ? (
                  <Badge
                    variant="secondary"
                    className="border-emerald-200 bg-emerald-50 text-[10.5px] text-emerald-800 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    Live Data
                  </Badge>
                ) : useDemoData ? (
                  <Badge variant="secondary" className="text-[10.5px]">
                    Demo Data
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              <QueueItem
                label="High Priority"
                count={highPriority}
                tone="danger"
                hint="High model score, flagged pneumonia"
                icon={AlertTriangle}
                onClick={() => setPage("cases")}
              />
              <QueueItem
                label="Needs Further Review"
                count={needsFurtherReview}
                tone="warning"
                hint="Reviewer requested more info"
                icon={ClipboardCheck}
                onClick={() => setPage("cases")}
              />
              <QueueItem
                label="Low Confidence"
                count={lowConfidence}
                tone="info"
                hint="Model uncertain about these cases"
                icon={Activity}
                onClick={() => setPage("cases")}
              />
              <QueueItem
                label="Pending Human Review"
                count={pendingReview}
                tone="neutral"
                hint="Awaiting reviewer decision"
                icon={Eye}
                onClick={() => setPage("cases")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-[15px]">Quick Actions</CardTitle>
              <CardDescription className="mt-1 text-[12.5px]">
                Jump into the core workflows.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 p-3">
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 px-3 py-2.5 text-left"
                onClick={() => setPage("analyze")}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Plus className="h-4 w-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">Analyze new X-Ray</span>
                  <span className="text-[11px] text-muted-foreground">
                    Upload and run AI screening
                  </span>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 px-3 py-2.5 text-left"
                onClick={() => setPage("cases")}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">Open case list</span>
                  <span className="text-[11px] text-muted-foreground">
                    Search and review existing cases
                  </span>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 px-3 py-2.5 text-left"
                onClick={() => setPage("analytics")}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">View analytics</span>
                  <span className="text-[11px] text-muted-foreground">
                    AI–human agreement metrics
                  </span>
                </div>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  description,
  icon: Icon,
  accent = "default",
}: {
  label: string;
  value: number | string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "default" | "primary" | "warning" | "info";
}) {
  const accentClasses = {
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary",
    warning: "bg-amber-50 text-amber-700",
    info: "bg-sky-50 text-sky-700",
  } as const;

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="text-[28px] font-semibold leading-none tracking-tight text-foreground">
            {value}
          </span>
          <span className="text-[12px] text-muted-foreground">{description}</span>
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            accentClasses[accent]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function QueueItem({
  label,
  count,
  tone,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  count: number;
  tone: "danger" | "warning" | "info" | "neutral";
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  const tones = {
    danger: "bg-rose-50 text-rose-700",
    warning: "bg-amber-50 text-amber-700",
    info: "bg-sky-50 text-sky-700",
    neutral: "bg-muted text-foreground",
  } as const;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", tones[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-[18px] font-semibold leading-none tracking-tight">
          {count}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[12.5px] font-medium text-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
    </button>
  );
}