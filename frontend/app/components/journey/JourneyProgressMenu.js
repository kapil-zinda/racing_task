"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { counterSummaries } from "./journeyProgress";

const DROPDOWN_WIDTH = 248;
const DROPDOWN_HEIGHT_ESTIMATE = 280;

// Three-dot action menu for a leaf node in the Progress Hub "Updates" tab.
// Lists every occurrence of the node's custom entries with a Done/Undo toggle.
export default function JourneyProgressMenu({ nodeId, nodeLabel, effectiveCounters, doneSet, onToggleOccurrence, disabled }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const right = Math.min(
        Math.max(8, window.innerWidth - rect.right),
        Math.max(8, window.innerWidth - DROPDOWN_WIDTH - 8)
      );
      const top =
        rect.bottom + DROPDOWN_HEIGHT_ESTIMATE + 6 > window.innerHeight
          ? Math.max(8, rect.top - DROPDOWN_HEIGHT_ESTIMATE - 6)
          : rect.bottom + 6;
      setCoords({ top, right });
    }
    setOpen((prev) => !prev);
  };

  const summaries = counterSummaries(nodeId, effectiveCounters, doneSet);

  const items = (
    <div
      className="menu-dropdown org-node-dropdown progress-occurrence-menu"
      style={{ position: "fixed", top: coords?.top, right: coords?.right, left: "auto", zIndex: 2000, width: DROPDOWN_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="progress-occurrence-menu-title">{nodeLabel}</div>
      {summaries.length === 0 ? (
        <div className="progress-occurrence-empty">No custom entries on this node.</div>
      ) : (
        summaries.map((s) => {
          const allDone = s.completed >= s.count;
          return (
            <div key={s.key} className={`progress-entry-row ${allDone ? "is-done" : ""}`}>
              <span className="progress-entry-label">
                {s.key} <span className="progress-entry-count">{s.completed}/{s.count}</span>
              </span>
              <span className="progress-entry-actions">
                <button
                  type="button"
                  className="progress-entry-btn undo"
                  disabled={s.completed <= 0}
                  onClick={() => onToggleOccurrence?.(nodeId, nodeLabel, s.key, s.lastToUndo, "undo")}
                  aria-label={`Undo one ${s.key}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className="progress-entry-btn done"
                  disabled={allDone}
                  onClick={() => onToggleOccurrence?.(nodeId, nodeLabel, s.key, s.nextToComplete, "done")}
                  aria-label={`Mark one ${s.key} done`}
                >
                  {allDone ? "✓" : "Done"}
                </button>
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="org-node-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="ellipsis-btn"
        aria-label="Update progress"
        onClick={handleToggle}
        disabled={disabled}
      >
        ⋮
      </button>
      {open && coords && typeof document !== "undefined" ? createPortal(items, document.body) : null}
    </div>
  );
}
