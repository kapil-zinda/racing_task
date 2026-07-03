"use client";
// Right-hand node detail panel with tabs: Overview, Metrics, Activity.
// Overview edits node properties; Metrics is where per-node "marking" happens
// (increment current_value); status marking lives in Overview.

import { useCallback, useEffect, useState } from "react";
import {
  PROGRESS_MODES, NODE_STATUSES,
  listNodeMetrics, createMetric, incrementMetric, deleteMetric,
  listAttachments, createAttachment, deleteAttachment, uploadAttachment,
} from "../../lib/goalApi";
import Icon from "../Icon";

const TABS = ["Overview", "Metrics", "Files", "Activity"];

export default function NodeDetail({ node, onUpdate, onDelete, onChanged, activity }) {
  const [tab, setTab] = useState("Overview");
  const [draft, setDraft] = useState(node);
  const [metrics, setMetrics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setDraft(node); setTab((t) => t); }, [node]);

  const loadMetrics = useCallback(async () => {
    try { const d = await listNodeMetrics(node.id); setMetrics(d.metrics || []); }
    catch (e) { setErr(String(e.message || e)); }
  }, [node.id]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const saveField = async (patch) => {
    setBusy(true); setErr("");
    try { await onUpdate(node.id, patch); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const commit = (k) => { if (draft[k] !== node[k]) saveField({ [k]: draft[k] }); };

  return (
    <div className="node-detail">
      <div className="node-detail-head">
        <input className="node-title-input" value={draft.title || ""}
               onChange={(e) => set("title", e.target.value)} onBlur={() => commit("title")} />
        <button className="goal-icon-btn danger" title="Delete node" onClick={() => onDelete(node)}><Icon name="trash" /></button>
      </div>
      <div className="node-detail-substats">
        <span className={`goal-status-chip s-${draft.status}`}>{draft.status}</span>
        <span className="node-progress-badge">{Math.round(node.progress || 0)}%</span>
        {node.type && <span className="node-type-chip">{node.type}</span>}
      </div>

      <div className="node-tabs">
        {TABS.map((t) => (
          <button key={t} className={`node-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {err && <div className="goal-error">{err}</div>}

      {tab === "Overview" && (
        <div className="node-tab-body">
          <label className="goal-field">
            <span>Status</span>
            <select value={draft.status || "todo"} onChange={(e) => { set("status", e.target.value); saveField({ status: e.target.value }); }}>
              {NODE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="goal-field">
            <span>Description</span>
            <textarea rows={3} value={draft.description || ""}
                      onChange={(e) => set("description", e.target.value)} onBlur={() => commit("description")} />
          </label>
          <div className="goal-field-row">
            <label className="goal-field">
              <span>Type</span>
              <input value={draft.type || ""} placeholder="e.g. Lecture, Chapter"
                     onChange={(e) => set("type", e.target.value)} onBlur={() => commit("type")} />
            </label>
            <label className="goal-field">
              <span>Weight</span>
              <input type="number" min="0" step="0.5" value={draft.weight ?? 1}
                     onChange={(e) => set("weight", e.target.value)} onBlur={() => commit("weight")} />
            </label>
          </div>
          <label className="goal-field">
            <span>Progress mode</span>
            <select value={draft.progress_mode || "children_weighted"}
                    onChange={(e) => { set("progress_mode", e.target.value); saveField({ progress_mode: e.target.value }); }}>
              {PROGRESS_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          {draft.progress_mode === "manual" && (
            <label className="goal-field">
              <span>Manual progress %</span>
              <input type="number" min="0" max="100" value={draft.progress ?? 0}
                     onChange={(e) => set("progress", e.target.value)} onBlur={() => commit("progress")} />
            </label>
          )}
          {draft.progress_mode === "formula" && (
            <label className="goal-field">
              <span>Formula</span>
              <input value={draft.formula || ""} placeholder="(video*30)+(notes*20)+(revision*20)+(mcq*30)"
                     onChange={(e) => set("formula", e.target.value)} onBlur={() => commit("formula")} />
              <small className="goal-hint">Reference metric or child names (lowercased, no spaces). Result 0–100.</small>
            </label>
          )}
          {busy && <div className="goal-hint">Saving…</div>}
        </div>
      )}

      {tab === "Metrics" && (
        <MetricsTab node={node} metrics={metrics} setErr={setErr}
                    reload={() => { loadMetrics(); onChanged && onChanged(); }} />
      )}

      {tab === "Files" && <FilesTab node={node} setErr={setErr} />}

      {tab === "Activity" && (
        <div className="node-tab-body">
          {(activity || []).filter((a) => a.node_id === node.id).slice(0, 50).map((a) => (
            <div key={a.id} className="node-activity-row">
              <span className="node-activity-action">{a.action.replace(/_/g, " ")}</span>
              <span className="node-activity-time">{(a.created_at || "").slice(0, 16).replace("T", " ")}</span>
            </div>
          ))}
          {(activity || []).filter((a) => a.node_id === node.id).length === 0 && (
            <div className="goal-hint">No activity yet for this node.</div>
          )}
        </div>
      )}
    </div>
  );
}

function FilesTab({ node, setErr }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { const d = await listAttachments(node.id); setItems(d.attachments || []); }
    catch (e) { setErr(String(e.message || e)); }
  }, [node.id]);
  useEffect(() => { load(); }, [load]);

  const addLink = async () => {
    if (!url.trim()) return;
    try {
      await createAttachment({ node_id: node.id, type: "link", name: name.trim() || url.trim(), url: url.trim() });
      setName(""); setUrl(""); load();
    } catch (e) { setErr(String(e.message || e)); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true); setErr("");
    try { await uploadAttachment(node.id, file); load(); }
    catch (err) { setErr(String(err.message || err)); }
    finally { setUploading(false); }
  };

  const iconName = (t) => (t === "link" ? "link" : t === "image" ? "image" : t === "video" ? "play" : t === "audio" ? "music" : t === "pdf" ? "file" : "attachment");

  return (
    <div className="node-tab-body">
      {items.length === 0 && <div className="goal-hint">No files or links yet.</div>}
      {items.map((a) => (
        <div key={a.id} className="metric-row">
          <div className="metric-row-top">
            <a className="metric-name" href={a.url || "#"} target="_blank" rel="noreferrer"><Icon name={iconName(a.type)} /> {a.name}</a>
            <button className="goal-icon-btn danger sm" onClick={async () => { try { await deleteAttachment(a.id); load(); } catch (e) { setErr(String(e.message || e)); } }}><Icon name="trash" /></button>
          </div>
        </div>
      ))}
      <label className="goal-btn ghost" style={{ textAlign: "center", cursor: "pointer" }}>
        {uploading ? "Uploading…" : <><Icon name="upload" /> Upload file</>}
        <input type="file" hidden onChange={onFile} disabled={uploading} />
      </label>
      <div className="metric-add">
        <input placeholder="Label (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="https://link-to-resource" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="metric-add-actions">
          <button className="goal-btn primary tiny" onClick={addLink}>Add link</button>
        </div>
      </div>
    </div>
  );
}

function MetricsTab({ node, metrics, reload, setErr }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", target_value: 1, unit: "" });

  const add = async () => {
    if (!form.name.trim()) return;
    try {
      await createMetric({ node_id: node.id, name: form.name.trim(),
        target_value: Number(form.target_value) || 0, unit: form.unit.trim() });
      setForm({ name: "", target_value: 1, unit: "" }); setAdding(false); reload();
    } catch (e) { setErr(String(e.message || e)); }
  };

  const bump = async (m, delta) => {
    try { await incrementMetric(m.id, delta); reload(); }
    catch (e) { setErr(String(e.message || e)); }
  };

  return (
    <div className="node-tab-body">
      {metrics.length === 0 && !adding && <div className="goal-hint">No metrics. Add one to track measurable progress (e.g. Videos 0/30).</div>}
      {metrics.map((m) => {
        const cur = Number(m.current_value || 0);
        const tgt = Number(m.target_value || 0);
        const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : (cur > 0 ? 100 : 0);
        return (
          <div key={m.id} className="metric-row">
            <div className="metric-row-top">
              <span className="metric-name">{m.name}</span>
              <span className="metric-count">{cur}{tgt ? ` / ${tgt}` : ""}{m.unit ? ` ${m.unit}` : ""}</span>
            </div>
            <div className="goal-progress-bar sm"><span style={{ width: `${pct}%` }} /></div>
            <div className="metric-row-actions">
              <button className="goal-btn tiny" onClick={() => bump(m, -1)} disabled={cur <= 0}>−</button>
              <button className="goal-btn tiny primary" onClick={() => bump(m, 1)}>+1 done</button>
              <button className="goal-icon-btn danger sm" title="Delete metric"
                      onClick={async () => { try { await deleteMetric(m.id); reload(); } catch (e) { setErr(String(e.message || e)); } }}><Icon name="trash" /></button>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="metric-add">
          <input placeholder="Metric name (e.g. Videos)" value={form.name}
                 onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          <input type="number" placeholder="Target" value={form.target_value}
                 onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))} />
          <input placeholder="Unit" value={form.unit}
                 onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
          <div className="metric-add-actions">
            <button className="goal-btn ghost tiny" onClick={() => setAdding(false)}>Cancel</button>
            <button className="goal-btn primary tiny" onClick={add}>Add</button>
          </div>
        </div>
      ) : (
        <button className="goal-btn ghost" onClick={() => setAdding(true)}>+ Add metric</button>
      )}
    </div>
  );
}
