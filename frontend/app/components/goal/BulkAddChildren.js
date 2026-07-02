"use client";
// Bulk-create identical children under a node, with a shared metric template.
// e.g. under "History": "Class 1..14", each getting metrics Video(1), Notes(1), Revision(4).

import { useMemo, useState } from "react";
import { bulkCreateNodes } from "../../lib/goalApi";

export default function BulkAddChildren({ goalId, parent, onClose, onDone }) {
  const [pattern, setPattern] = useState("Class {n}");
  const [count, setCount] = useState(14);
  const [start, setStart] = useState(1);
  const [type, setType] = useState("");
  const [metrics, setMetrics] = useState([
    { name: "Video", target_value: 1, unit: "" },
    { name: "Notes", target_value: 1, unit: "" },
    { name: "Revision", target_value: 4, unit: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const preview = useMemo(() => {
    const p = pattern.includes("{n}") ? pattern : `${pattern} {n}`;
    const n = Math.max(0, Math.min(Number(count) || 0, 6));
    const s = Number(start) || 1;
    return Array.from({ length: n }, (_, i) => p.replace("{n}", String(s + i)));
  }, [pattern, count, start]);

  const setMetric = (i, k, v) => setMetrics((ms) => ms.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)));
  const addMetricRow = () => setMetrics((ms) => [...ms, { name: "", target_value: 1, unit: "" }]);
  const removeMetric = (i) => setMetrics((ms) => ms.filter((_, idx) => idx !== i));

  const submit = async () => {
    setSaving(true); setErr("");
    try {
      const cleanMetrics = metrics
        .filter((m) => m.name.trim())
        .map((m) => ({ name: m.name.trim(), target_value: Number(m.target_value) || 0, unit: m.unit.trim() }));
      const res = await bulkCreateNodes({
        goal_id: goalId,
        parent_id: parent ? parent.id : null,
        name_pattern: pattern,
        count: Number(count) || 0,
        start: Number(start) || 1,
        type: type.trim(),
        metrics: cleanMetrics,
      });
      onDone(res);
      onClose();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="goal-modal-backdrop" onClick={onClose}>
      <div className="goal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="goal-modal-head">
          <h3>Add multiple children{parent ? ` under “${parent.title}”` : ""}</h3>
          <button className="goal-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="goal-error">{err}</div>}
        <div className="goal-modal-body">
          <div className="goal-field-row">
            <label className="goal-field" style={{ flex: 2 }}>
              <span>Name pattern (use {"{n}"} for the number)</span>
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Class {n}" />
            </label>
            <label className="goal-field">
              <span>Count</span>
              <input type="number" min="1" max="500" value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <label className="goal-field">
              <span>Start</span>
              <input type="number" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
          </div>
          <label className="goal-field">
            <span>Node type (optional)</span>
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Lecture, Class" />
          </label>

          <div className="goal-field">
            <span>Metric template — applied to every child</span>
            <div className="bulk-metric-list">
              {metrics.map((m, i) => (
                <div key={i} className="bulk-metric-row">
                  <input placeholder="Metric (e.g. Revision)" value={m.name}
                         onChange={(e) => setMetric(i, "name", e.target.value)} />
                  <input type="number" placeholder="Target" value={m.target_value}
                         onChange={(e) => setMetric(i, "target_value", e.target.value)} />
                  <input placeholder="Unit" value={m.unit}
                         onChange={(e) => setMetric(i, "unit", e.target.value)} />
                  <button className="goal-icon-btn danger sm" onClick={() => removeMetric(i)} title="Remove">✕</button>
                </div>
              ))}
            </div>
            <button className="goal-btn ghost tiny" onClick={addMetricRow}>+ Add metric to template</button>
          </div>

          <div className="goal-field">
            <span>Preview</span>
            <div className="bulk-preview">
              {preview.map((t) => <span key={t} className="bulk-preview-chip">{t}</span>)}
              {Number(count) > 6 && <span className="bulk-preview-chip more">+{Number(count) - 6} more…</span>}
            </div>
          </div>
        </div>
        <div className="goal-modal-foot">
          <div style={{ flex: 1 }} />
          <button className="goal-btn ghost" onClick={onClose}>Cancel</button>
          <button className="goal-btn primary" onClick={submit} disabled={saving}>
            {saving ? "Creating…" : `Create ${Number(count) || 0} children`}
          </button>
        </div>
      </div>
    </div>
  );
}
