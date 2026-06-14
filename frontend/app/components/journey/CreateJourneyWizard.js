"use client";

import { useEffect, useState } from "react";
import JourneyTreeBuilder, { rowsToTree, treeToRows } from "./JourneyTreeBuilder";

const STEP_TITLES = ["Name & target date", "What will you study?"];

export default function CreateJourneyWizard({ open, initialDraft, onSave, onClose, saving }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setRows(treeToRows(initialDraft?.plan?.structure));
      setStep(0);
    }
  }, [open, initialDraft]);

  if (!open) return null;

  const titleValid = Boolean(draft?.title?.trim());
  const structureValid = rows.some((row) => row.label.trim());

  const handleSave = () => {
    onSave({
      title: draft.title.trim(),
      target_date: draft.target_date,
      plan: {
        structure: rowsToTree(rows),
      },
    });
  };

  const canContinue = step === 0 ? titleValid : structureValid;

  return (
    <div className="task-modal-overlay" onClick={onClose}>
      <div className="task-modal" role="dialog" aria-modal="true" aria-label="Create Journey" onClick={(e) => e.stopPropagation()}>
        <div className="step-dots">
          {STEP_TITLES.map((_, idx) => (
            <span key={idx} className={`step-dot ${idx === step ? "active" : idx < step ? "done" : ""}`} />
          ))}
        </div>
        <h3>{STEP_TITLES[step]}</h3>

        {step === 0 ? (
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
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <JourneyTreeBuilder rows={rows} onChange={setRows} />
            {!structureValid ? <p className="day-state" style={{ marginTop: 8 }}>Add at least one topic to create your journey.</p> : null}
          </>
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
            <button className="btn-day" onClick={() => setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1))} disabled={saving || !canContinue}>
              Continue
            </button>
          ) : (
            <button className="btn-day" onClick={handleSave} disabled={saving || !canContinue}>
              {saving ? "Saving..." : "Create Journey"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
