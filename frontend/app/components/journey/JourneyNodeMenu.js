"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DROPDOWN_WIDTH = 208;
const DROPDOWN_HEIGHT_ESTIMATE = 200;

export default function JourneyNodeMenu({ onEdit, onDelete, onAddChild, onManageCounters, disabled }) {
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

  const items = (
    <div
      className="menu-dropdown org-node-dropdown"
      style={{ position: "fixed", top: coords?.top, right: coords?.right, left: "auto", zIndex: 2000 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          setOpen(false);
          onEdit?.();
        }}
      >
        Edit node
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          setOpen(false);
          onAddChild?.();
        }}
      >
        Add child node
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          setOpen(false);
          onManageCounters?.();
        }}
      >
        Add custom counter
      </button>
      <button
        type="button"
        className="menu-item danger"
        onClick={() => {
          setOpen(false);
          onDelete?.();
        }}
      >
        Delete node
      </button>
    </div>
  );

  return (
    <div className="org-node-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="ellipsis-btn"
        aria-label="Node actions"
        onClick={handleToggle}
        disabled={disabled}
      >
        ⋮
      </button>
      {open && coords && typeof document !== "undefined" ? createPortal(items, document.body) : null}
    </div>
  );
}
