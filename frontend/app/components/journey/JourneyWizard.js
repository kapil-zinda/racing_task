"use client";

import { useEffect, useState } from "react";
import AreasEditor from "./AreasEditor";

const ICON_OPTIONS = ["🎯", "🏛️", "💪", "💼", "🚀", "📚", "🎨", "🧘", "💰", "🌍", "🏆", "🧩"];
const CATEGORY_OPTIONS = ["Education", "Fitness", "Career", "Business", "Skill", "General"];

const STEP_TITLES = ["What's the goal?", "Name & target date", "Areas", "Review"];

function countAreas(plan) {
  return (
    (plan?.courses?.length || 0) +
    (plan?.books?.length || 0) +
    (plan?.random?.length || 0) +
    (plan?.tests?.length || 0)
  );
}

export default function JourneyWizard({ open, initialDraft, onSave, onClose, saving }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setStep(0);
    }
  }, [open, initialDraft]);

  if (!open) return null;

  const updatePlan = (updater) =>
    setDraft((prev) => ({
      ...prev,
      plan: typeof updater === "function" ? updater(prev.plan) : updater,
    }));

  return (
    <div className="task-modal-overlay sheet-overlay" onClick={onClose}>
      <div className="task-modal bottom-sheet" role="dialog" aria-modal="true" aria-label="Edit Journey" onClick={(e) => e.stopPropagation()}>
        <div className="step-dots">
          {STEP_TITLES.map((_, idx) => (
            <span key={idx} className={`step-dot ${idx === step ? "active" : idx < step ? "done" : ""}`} />
          ))}
        </div>
        <h3>{STEP_TITLES[step]}</h3>

        {step === 0 ? (
          <>
            <p className="day-state" style={{ marginTop: 0 }}>
              Pick a category and icon — these personalize labels across Journey and Progress Hub.
            </p>
            <div className="category-picker">
              {CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`category-chip ${draft.category === cat ? "active" : ""}`}
                  onClick={() => setDraft((prev) => ({ ...prev, category: cat }))}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="icon-picker">
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`icon-picker-option ${draft.icon === icon ? "active" : ""}`}
                  onClick={() => setDraft((prev) => ({ ...prev, icon }))}
                >
                  {icon}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label>
              <strong>Journey Title</strong>
              <input
                className="task-select"
                placeholder="e.g. UPSC 2027"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>
            <label>
              <strong>Target Date</strong>
              <input
                className="task-select"
                type="date"
                value={draft.target_date}
                onChange={(e) => setDraft((prev) => ({ ...prev, target_date: e.target.value }))}
              />
            </label>
            <label>
              <strong>Status</strong>
              <select
                className="task-select"
                value={draft.status}
                onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <>
            <p className="day-state" style={{ marginTop: 0 }}>
              Saved values are loaded as read-only. Use item Action -&gt; Edit to modify.
            </p>
            <AreasEditor plan={draft.plan} onChange={updatePlan} />
          </>
        ) : null}

        {step === 3 ? (
          <div>
            <p style={{ fontSize: 28, margin: "4px 0" }}>
              {draft.icon} {draft.title || "Untitled Journey"}
            </p>
            <p className="day-state">
              Category: {draft.category || "General"} · Target: {draft.target_date || "Not set"} · Status: {draft.status}
            </p>
            <p className="day-state">{countAreas(draft.plan)} area(s) in this journey.</p>
          </div>
        ) : null}

        <div className="task-modal-actions">
          <button className="btn-day secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {step > 0 ? (
            <button className="btn-day secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={saving}>
              Back
            </button>
          ) : null}
          {step < STEP_TITLES.length - 1 ? (
            <button className="btn-day" onClick={() => setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1))} disabled={saving}>
              Continue
            </button>
          ) : (
            <button className="btn-day" onClick={() => onSave(draft)} disabled={saving}>
              {saving ? "Saving..." : "Save Journey"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
