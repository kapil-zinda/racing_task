"use client";

import { dimensionTopics, dimensionTestSlots, dimensionCompletion } from "../../lib/missionModel";

const KIND_LABELS = {
  course: "Course",
  book: "Book",
  random: "Random Topic",
  test: "Test Set",
};

function topicStatus(t) {
  if (t.secondRev) return { icon: "✓", label: "Fully revised" };
  if (t.firstRev) return { icon: "◐", label: "1st revision done" };
  if (t.classDate) return { icon: "◐", label: "Studied · awaiting revision" };
  return { icon: "○", label: "Not started" };
}

function testStatus(slot) {
  if (slot.secondRevisionDate) return { icon: "✓", label: "Fully reviewed" };
  if (slot.revisionDate) return { icon: "◐", label: "1st revision done" };
  if (slot.analysisDoneDate) return { icon: "◐", label: "Analysis done" };
  if (slot.testGivenDate) return { icon: "◐", label: "Test given" };
  return { icon: "○", label: "Not attempted" };
}

export default function MilestoneDetailSheet({ dim, planExecution, onClose }) {
  if (!dim) return null;

  const overall = dimensionCompletion(dim);
  const topics = dim.kind === "test" ? [] : dimensionTopics(dim, planExecution?.missionTopics);
  const testSlots = dim.kind === "test" ? dimensionTestSlots(dim, planExecution?.missionTestSlots) : [];

  return (
    <div className="task-modal-overlay sheet-overlay" onClick={onClose}>
      <div
        className="task-modal bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={dim.label}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{dim.label}</h3>
        <p className="day-state" style={{ marginTop: 0 }}>
          {KIND_LABELS[dim.kind] || dim.kind} · {overall}% complete
        </p>
        <div className="progress-track" style={{ marginBottom: 12 }}>
          <div className="progress-fill coverage" style={{ width: `${overall}%` }} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {dim.kind === "test" ? (
            testSlots.length === 0 ? (
              <p className="day-state">No test slots found for this area.</p>
            ) : (
              testSlots.map((slot) => {
                const status = testStatus(slot);
                return (
                  <div key={`${slot.testName}-${slot.testNumber}`} className="milestone-item">
                    <strong>
                      {status.icon} Test {slot.testNumber}
                      {slot.testName ? `: ${slot.testName}` : ""}
                    </strong>
                    <p>{status.label}</p>
                    <p className="milestone-card-meta">
                      {slot.testGivenDate ? <span>Given: {slot.testGivenDate}</span> : null}
                      {slot.analysisDoneDate ? <span>Analysis: {slot.analysisDoneDate}</span> : null}
                      {slot.revisionDate ? <span>Revision: {slot.revisionDate}</span> : null}
                      {slot.secondRevisionDate ? <span>2nd Revision: {slot.secondRevisionDate}</span> : null}
                    </p>
                  </div>
                );
              })
            )
          ) : topics.length === 0 ? (
            <p className="day-state">No topics found for this area.</p>
          ) : (
            topics.map((t) => {
              const status = topicStatus(t);
              return (
                <div key={t.key} className="milestone-item">
                  <strong>
                    {status.icon} {t.topic}
                  </strong>
                  <p>
                    {status.label}
                    {t.subject && t.subject !== t.topic ? ` · ${t.subject}` : ""}
                  </p>
                  <p className="milestone-card-meta">
                    {t.classDate ? <span>Class: {t.classDate}</span> : null}
                    {t.firstRev ? <span>1st rev: {t.firstRev}</span> : null}
                    {t.secondRev ? <span>2nd rev: {t.secondRev}</span> : null}
                    {Array.isArray(t.revisionDates) && t.revisionDates.length > 2 ? (
                      <span>+{t.revisionDates.length - 2} more revisions</span>
                    ) : null}
                  </p>
                </div>
              );
            })
          )}
        </div>

        <div className="task-modal-actions">
          <button className="btn-day secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
