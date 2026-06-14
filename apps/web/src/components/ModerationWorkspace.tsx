"use client";

import {
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Eye,
  Flag,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

export type ReportStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "DISMISSED";

export interface AdminReport {
  id: string;
  type: string;
  reason: string;
  evidence: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: {
    id: string;
    username: string;
    avatar: string | null;
  };
  reported: {
    id: string;
    username: string;
    avatar: string | null;
    role: string;
    createdAt: string;
  };
}

export interface ModerationSummary {
  counts: Record<ReportStatus, number>;
  open: number;
}

export type ModerationFilter = "ALL" | ReportStatus;

interface ModerationRailProps {
  summary: ModerationSummary;
  reports: AdminReport[];
  selectedId: string | null;
  filter: ModerationFilter;
  loading: boolean;
  onFilterChange: (filter: ModerationFilter) => void;
  onRefresh: () => void;
  onSelect: (report: AdminReport) => void;
}

const filters: Array<{ value: ModerationFilter; label: string }> = [
  { value: "ALL", label: "All reports" },
  { value: "PENDING", label: "Pending" },
  { value: "UNDER_REVIEW", label: "In review" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "DISMISSED", label: "Dismissed" },
];

const formatStatus = (status: ReportStatus) =>
  status.toLowerCase().replaceAll("_", " ");

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function ModerationRail({
  summary,
  reports,
  selectedId,
  filter,
  loading,
  onFilterChange,
  onRefresh,
  onSelect,
}: ModerationRailProps) {
  return (
    <>
      <div className="rail-heading safety-rail-heading">
        <div>
          <p className="eyebrow">Moderator access</p>
          <h2>Safety desk</h2>
        </div>
        <button
          className="icon-button soft"
          onClick={onRefresh}
          aria-label="Refresh reports"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="safety-summary-card">
        <span>
          <ShieldAlert size={18} />
        </span>
        <div>
          <strong>{summary.open} open reports</strong>
          <small>
            {summary.counts.PENDING} waiting, {summary.counts.UNDER_REVIEW} in
            review
          </small>
        </div>
      </div>

      <div className="safety-filters" aria-label="Filter reports">
        {filters.map((item) => (
          <button
            key={item.value}
            className={filter === item.value ? "is-active" : ""}
            onClick={() => onFilterChange(item.value)}
          >
            {item.label}
            {item.value !== "ALL" && (
              <span>{summary.counts[item.value]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="safety-report-list">
        {loading && reports.length === 0 ? (
          <div className="rail-state compact">
            <Loader2 className="animate-spin" />
            <span>Loading reports...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="rail-state compact">
            <CheckCircle2 />
            <strong>No reports here</strong>
            <span>This queue is clear.</span>
          </div>
        ) : (
          reports.map((report) => (
            <button
              key={report.id}
              className={`safety-report-card ${
                selectedId === report.id ? "is-active" : ""
              }`}
              onClick={() => onSelect(report)}
            >
              <span className={`report-status-dot is-${report.status.toLowerCase()}`} />
              <span>
                <strong>@{report.reported.username}</strong>
                <small>
                  {report.type.toLowerCase().replaceAll("_", " ")}
                </small>
              </span>
              <time>{formatDate(report.createdAt)}</time>
            </button>
          ))
        )}
      </div>
    </>
  );
}

interface ModerationPanelProps {
  report: AdminReport | null;
  resolution: string;
  updating: boolean;
  onResolutionChange: (value: string) => void;
  onUpdate: (status: Exclude<ReportStatus, "PENDING">) => void;
}

export function ModerationPanel({
  report,
  resolution,
  updating,
  onResolutionChange,
  onUpdate,
}: ModerationPanelProps) {
  if (!report) {
    return (
      <div className="safety-empty-panel">
        <span>
          <ShieldAlert />
        </span>
        <p className="eyebrow">Safety desk</p>
        <h2>Select a report to review</h2>
        <p>
          Read the context carefully, document the decision, and use the least
          disruptive action that keeps the community safe.
        </p>
      </div>
    );
  }

  const closed = report.status === "RESOLVED" || report.status === "DISMISSED";

  return (
    <div className="safety-panel">
      <header className="conversation-header safety-header">
        <div>
          <p className="eyebrow">
            <Flag size={14} /> Report {report.id.slice(-6)}
          </p>
          <h2>@{report.reported.username}</h2>
          <p>
            Reported by @{report.reporter.username} on {formatDate(report.createdAt)}
          </p>
        </div>
        <span className={`status-chip is-${report.status.toLowerCase()}`}>
          {formatStatus(report.status)}
        </span>
      </header>

      <div className="safety-review-stage">
        <section className="safety-review-card primary">
          <div className="safety-card-title">
            <span>
              <ShieldAlert size={17} />
            </span>
            <div>
              <p className="eyebrow">Reported behavior</p>
              <h3>{report.type.toLowerCase().replaceAll("_", " ")}</h3>
            </div>
          </div>
          <p>{report.reason}</p>
        </section>

        {report.evidence && (
          <section className="safety-review-card">
            <div className="safety-card-title">
              <span>
                <Eye size={17} />
              </span>
              <div>
                <p className="eyebrow">Attached context</p>
                <h3>Message evidence</h3>
              </div>
            </div>
            <pre>{report.evidence}</pre>
          </section>
        )}

        <section className="safety-people-grid">
          <article>
            <small>Reporter</small>
            <strong>@{report.reporter.username}</strong>
            <span>User ID {report.reporter.id.slice(-8)}</span>
          </article>
          <article>
            <small>Reported account</small>
            <strong>@{report.reported.username}</strong>
            <span>
              {report.reported.role.toLowerCase()} since{" "}
              {new Intl.DateTimeFormat(undefined, {
                month: "short",
                year: "numeric",
              }).format(new Date(report.reported.createdAt))}
            </span>
          </article>
        </section>

        <section className="safety-decision-card">
          <div>
            <p className="eyebrow">Decision record</p>
            <h3>{closed ? "Review completed" : "Document your decision"}</h3>
          </div>
          <textarea
            value={resolution}
            onChange={(event) => onResolutionChange(event.target.value)}
            rows={4}
            maxLength={2000}
            disabled={closed || updating}
            placeholder="Summarize what you reviewed and why this decision is appropriate."
          />
          {!closed && (
            <small>
              A final resolution needs at least 5 characters. Marking in review
              does not require one.
            </small>
          )}

          {closed ? (
            <div className="safety-closed-note">
              {report.status === "RESOLVED" ? (
                <CheckCircle2 size={17} />
              ) : (
                <CircleSlash2 size={17} />
              )}
              Closed {report.resolvedAt ? formatDate(report.resolvedAt) : ""}
            </div>
          ) : (
            <div className="safety-actions">
              {report.status === "PENDING" && (
                <button
                  onClick={() => onUpdate("UNDER_REVIEW")}
                  disabled={updating}
                >
                  <Clock3 size={16} />
                  Mark in review
                </button>
              )}
              <button
                className="resolve"
                onClick={() => onUpdate("RESOLVED")}
                disabled={updating || resolution.trim().length < 5}
              >
                <CheckCircle2 size={16} />
                Resolve
              </button>
              <button
                className="dismiss"
                onClick={() => onUpdate("DISMISSED")}
                disabled={updating || resolution.trim().length < 5}
              >
                {updating ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <CircleSlash2 size={16} />
                )}
                Dismiss
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
