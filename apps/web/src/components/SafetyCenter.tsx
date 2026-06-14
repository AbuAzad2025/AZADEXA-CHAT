"use client";

import {
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Eye,
  Flag,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ReportStatus } from "@/components/ModerationWorkspace";

export interface UserReport {
  id: string;
  type: string;
  reason: string;
  evidence: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reported: {
    id: string;
    username: string;
    avatar: string | null;
  };
}

interface SafetyCenterRailProps {
  reports: UserReport[];
  selectedId: string | null;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (report: UserReport) => void;
}

const formatStatus = (status: ReportStatus) =>
  status.toLowerCase().replaceAll("_", " ");

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function SafetyCenterRail({
  reports,
  selectedId,
  loading,
  onRefresh,
  onSelect,
}: SafetyCenterRailProps) {
  const openCount = reports.filter(
    ({ status }) => status === "PENDING" || status === "UNDER_REVIEW",
  ).length;

  return (
    <>
      <div className="rail-heading safety-rail-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h2>Safety center</h2>
        </div>
        <button
          className="icon-button soft"
          onClick={onRefresh}
          aria-label="Refresh your reports"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="safety-summary-card personal-safety-summary">
        <span>
          <ShieldCheck size={18} />
        </span>
        <div>
          <strong>{openCount} active reports</strong>
          <small>{reports.length} reports submitted from this account</small>
        </div>
      </div>

      <div className="direct-list-label">Your reports</div>
      <div className="safety-report-list" aria-busy={loading}>
        {loading && reports.length === 0 ? (
          <div className="rail-state compact">
            <Loader2 className="animate-spin" />
            <span>Loading your reports...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="rail-state compact">
            <ShieldCheck />
            <strong>No reports submitted</strong>
            <span>Reports you send from a message will appear here.</span>
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
              <span
                className={`report-status-dot is-${report.status.toLowerCase()}`}
              />
              <span>
                <strong>@{report.reported.username}</strong>
                <small>{formatStatus(report.status)}</small>
              </span>
              <time>{formatDate(report.createdAt)}</time>
            </button>
          ))
        )}
      </div>
    </>
  );
}

interface SafetyCenterPanelProps {
  report: UserReport | null;
}

export function SafetyCenterPanel({ report }: SafetyCenterPanelProps) {
  if (!report) {
    return (
      <div className="safety-empty-panel personal-safety-empty">
        <span>
          <ShieldCheck />
        </span>
        <p className="eyebrow">Your safety center</p>
        <h2>Reports stay visible here</h2>
        <p>
          When you report a message, you can return here to follow its review
          status and read the final response from the safety team.
        </p>
      </div>
    );
  }

  const closed = report.status === "RESOLVED" || report.status === "DISMISSED";

  return (
    <div className="safety-panel personal-safety-panel">
      <header className="conversation-header safety-header">
        <div>
          <p className="eyebrow">
            <Flag size={14} /> Your report {report.id.slice(-6)}
          </p>
          <h2>@{report.reported.username}</h2>
          <p>Submitted {formatDate(report.createdAt)}</p>
        </div>
        <span className={`status-chip is-${report.status.toLowerCase()}`}>
          {formatStatus(report.status)}
        </span>
      </header>

      <div className="safety-review-stage">
        <section className="safety-review-card primary">
          <div className="safety-card-title">
            <span>
              <Flag size={17} />
            </span>
            <div>
              <p className="eyebrow">What you reported</p>
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
                <p className="eyebrow">Context you shared</p>
                <h3>Attached message</h3>
              </div>
            </div>
            <pre>{report.evidence}</pre>
          </section>
        )}

        <section className="safety-decision-card personal-safety-decision">
          <div>
            <p className="eyebrow">Safety team status</p>
            <h3>
              {report.status === "PENDING"
                ? "Waiting for review"
                : report.status === "UNDER_REVIEW"
                  ? "A moderator is reviewing this"
                  : "Review completed"}
            </h3>
          </div>

          {report.resolution ? (
            <p className="personal-safety-resolution">{report.resolution}</p>
          ) : (
            <p className="personal-safety-resolution is-muted">
              {closed
                ? "This report was closed without an additional note."
                : "A final note will appear here when the review is complete."}
            </p>
          )}

          <div className={`safety-closed-note ${closed ? "" : "is-open"}`}>
            {report.status === "RESOLVED" ? (
              <CheckCircle2 size={17} />
            ) : report.status === "DISMISSED" ? (
              <CircleSlash2 size={17} />
            ) : (
              <Clock3 size={17} />
            )}
            {closed && report.resolvedAt
              ? `Closed ${formatDate(report.resolvedAt)}`
              : formatStatus(report.status)}
          </div>
        </section>
      </div>
    </div>
  );
}
