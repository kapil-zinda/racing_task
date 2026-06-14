"use client";

import { useEffect, useState } from "react";
import { findNode } from "./journeyTreeOps";

export default function JourneyNodeDialog({ dialog, tree, onClose, onRename, onAddChild, onSaveCounters, saving }) {
  const [labelInput, setLabelInput] = useState("");
  const [counters, setCounters] = useState([]);
  const [newCounterKey, setNewCounterKey] = useState("");
  const [newCounterValue, setNewCounterValue] = useState("");

  useEffect(() => {
    if (!dialog) return;
    if (dialog.mode === "rename") setLabelInput(dialog.initialValue || "");
    if (dialog.mode === "addChild") setLabelInput("");
    if (dialog.mode === "counters") {
      const node = findNode(tree, dialog.nodeId);
      setCounters(node?.counters ? node.counters.map((c) => ({ ...c })) : []);
      setNewCounterKey("");
      setNewCounterValue("");
    }
  }, [dialog, tree]);

  if (!dialog) return null;

  if (dialog.mode === "rename" || dialog.mode === "addChild") {
    const title = dialog.mode === "rename" ? "Rename node" : "Add child node";
    const handleSave = () => {
      const trimmed = labelInput.trim();
      if (!trimmed) return;
      if (dialog.mode === "rename") onRename(dialog.nodeId, trimmed);
      else onAddChild(dialog.nodeId, trimmed);
    };
    return (
      <div className="task-modal-overlay" onClick={onClose}>
        <div className="task-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <h3>{title}</h3>
          <label>
            <strong>Label</strong>
            <input
              className="task-select"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </label>
          <div className="task-modal-actions">
            <button className="btn-day secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn-day" onClick={handleSave} disabled={saving || !labelInput.trim()}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // counters mode
  const addCounter = () => {
    const key = newCounterKey.trim();
    const value = Math.max(0, parseInt(newCounterValue, 10) || 0);
    if (!key || counters.some((c) => c.key === key)) return;
    setCounters([...counters, { key, count: value }]);
    setNewCounterKey("");
    setNewCounterValue("");
  };
  const updateCounterValue = (key, count) =>
    setCounters((cs) => cs.map((c) => (c.key === key ? { ...c, count: Math.max(0, count) } : c)));
  const removeCounter = (key) => setCounters((cs) => cs.filter((c) => c.key !== key));

  return (
    <div className="task-modal-overlay" onClick={onClose}>
      <div className="task-modal" role="dialog" aria-modal="true" aria-label="Manage counters" onClick={(e) => e.stopPropagation()}>
        <h3>Manage counters</h3>
        <p>Add custom key/value badges for this node. Sub-nodes inherit them unless they set their own.</p>

        {counters.length === 0 ? <div className="area-empty">No counters yet.</div> : (
          <div className="counter-manage-list">
            {counters.map((c) => (
              <div className="counter-manage-row" key={c.key}>
                <span className="counter-manage-key">{c.key}</span>
                <input
                  className="task-select"
                  type="number"
                  min="0"
                  value={c.count}
                  onChange={(e) => updateCounterValue(c.key, parseInt(e.target.value, 10) || 0)}
                />
                <button type="button" className="btn-day danger" onClick={() => removeCounter(c.key)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="counter-add-row">
          <input
            className="task-select"
            placeholder="Key (e.g. Reps)"
            value={newCounterKey}
            onChange={(e) => setNewCounterKey(e.target.value)}
          />
          <input
            className="task-select"
            type="number"
            min="0"
            placeholder="Value"
            value={newCounterValue}
            onChange={(e) => setNewCounterValue(e.target.value)}
          />
          <button className="btn-day secondary" onClick={addCounter} disabled={!newCounterKey.trim()}>
            + Add counter
          </button>
        </div>

        <div className="task-modal-actions">
          <button className="btn-day secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-day" onClick={() => onSaveCounters(dialog.nodeId, counters)} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
