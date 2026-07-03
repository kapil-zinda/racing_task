"use client";

import { useEffect, useState } from "react";
import { _bind, _settle } from "../lib/dialog";
import Icon from "./Icon";

export default function DialogHost() {
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    _bind((d) => setDialog(d));
    return () => _bind(null);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close(dialog.kind === "confirm" ? false : undefined);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  if (!dialog) return null;

  const isConfirm = dialog.kind === "confirm";
  const close = (val) => { _settle(dialog.id, val); setDialog(null); };
  const iconName = dialog.danger ? "warning" : dialog.tone === "error" ? "warning" : dialog.tone === "success" ? "check-circle" : "alert";

  return (
    <div className="app-dialog-overlay" onClick={() => close(isConfirm ? false : undefined)}>
      <div className={`app-dialog${dialog.danger ? " danger" : ""}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="app-dialog-icon"><Icon name={iconName} size={22} /></div>
        {dialog.title ? <h3 className="app-dialog-title">{dialog.title}</h3> : null}
        <p className="app-dialog-msg">{dialog.message}</p>
        <div className="app-dialog-actions">
          {isConfirm ? (
            <button className="app-dialog-btn ghost" onClick={() => close(false)}>{dialog.cancelLabel || "Cancel"}</button>
          ) : null}
          <button
            className={`app-dialog-btn ${dialog.danger ? "danger" : "primary"}`}
            onClick={() => close(isConfirm ? true : undefined)}
            autoFocus
          >
            {dialog.confirmLabel || (isConfirm ? "Confirm" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
