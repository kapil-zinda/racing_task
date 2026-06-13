"use client";

import { useEffect, useState } from "react";

export default function JourneyActionsMenu({ status, onTogglePause, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const isPaused = (status || "").toLowerCase() === "paused";

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onDocClick = () => setOpen(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <div className="journey-hero-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="ellipsis-btn"
        aria-label="Journey actions"
        onClick={() => setOpen((prev) => !prev)}
        disabled={busy}
      >
        ⋮
      </button>
      {open ? (
        <div className="menu-dropdown">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onTogglePause?.();
            }}
            disabled={busy}
          >
            {isPaused ? "Activate journey" : "Pause journey"}
          </button>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              onDelete?.();
            }}
            disabled={busy}
          >
            Delete journey
          </button>
        </div>
      ) : null}
    </div>
  );
}
