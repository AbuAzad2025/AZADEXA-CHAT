"use client";

import { FormEvent, useEffect, useState } from "react";
import { Flag, Loader2, ShieldAlert, X } from "lucide-react";

export type ReportType =
  | "SPAM"
  | "HARASSMENT"
  | "HATE_SPEECH"
  | "INAPPROPRIATE_CONTENT"
  | "IMPERSONATION"
  | "SCAM"
  | "OTHER";

export interface ReportTarget {
  reportedUserId: string;
  username: string;
  roomName: string;
  messageId: string;
  excerpt: string;
}

interface ReportDialogProps {
  target: ReportTarget | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (type: ReportType, reason: string) => Promise<void>;
}

const reportOptions: Array<{ value: ReportType; label: string }> = [
  { value: "SPAM", label: "Spam or flooding" },
  { value: "HARASSMENT", label: "Harassment or bullying" },
  { value: "HATE_SPEECH", label: "Hate speech" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "SCAM", label: "Scam or fraud" },
  { value: "OTHER", label: "Something else" },
];

export function ReportDialog({
  target,
  submitting,
  onClose,
  onSubmit,
}: ReportDialogProps) {
  const [type, setType] = useState<ReportType>("HARASSMENT");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!target) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting, target]);

  if (!target) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(type, reason.trim());
  };

  return (
    <div
      className="report-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
      >
        <div className="report-dialog-heading">
          <span>
            <ShieldAlert size={20} />
          </span>
          <div>
            <p className="eyebrow">Community safety</p>
            <h2 id="report-dialog-title">Report @{target.username}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close report form"
          >
            <X size={18} />
          </button>
        </div>

        <blockquote>
          <strong>From #{target.roomName}</strong>
          <p>{target.excerpt}</p>
        </blockquote>

        <form onSubmit={submit}>
          <label>
            What happened?
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ReportType)}
              disabled={submitting}
              autoFocus
            >
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Help the safety team understand
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={1000}
              rows={4}
              required
              disabled={submitting}
              placeholder="Describe why this message or behavior should be reviewed."
            />
            <small>{reason.length}/1000, minimum 10 characters</small>
          </label>

          <div className="report-dialog-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              className="report-submit-button"
              type="submit"
              disabled={submitting || reason.trim().length < 10}
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <Flag size={16} />
              )}
              Send report
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
