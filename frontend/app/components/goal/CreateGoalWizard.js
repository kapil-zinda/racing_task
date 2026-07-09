"use client";
// Goal creation wizard. Step 1: identity. Step 2: start mode — Blank, Template, or AI.
// Blank uses onCreate(form); Template and AI create server-side and call onCreated(goalId).

import { useEffect, useState } from "react";
import { aiGenerate, listTemplates, useTemplate } from "../../lib/goalApi";
import Icon from "../Icon";
import { friendlyApiError } from "../../lib/errors";

const ICONS = ["target", "book", "trophy", "food", "idea", "file", "chart", "chat", "fire", "brain", "tree", "timer"];
const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6"];

export default function CreateGoalWizard({ onClose, onCreate, onCreated }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "", icon: "target", color: "#6366f1", end_date: "", category: "General" });
  const [aiPrompt, setAiPrompt] = useState("");
  const [templates, setTemplates] = useState([]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (step === 1 && mode === "template" && templates.length === 0) {
      listTemplates().then((d) => setTemplates(d.templates || [])).catch((e) => setError(friendlyApiError(e)));
    }
  }, [step, mode, templates.length]);

  const submitBlank = async () => {
    if (!form.name.trim()) { setError("Name is required"); setStep(0); return; }
    setSaving(true); setError("");
    try { await onCreate(form); onClose(); }
    catch (e) { setError(friendlyApiError(e)); }
    finally { setSaving(false); }
  };

  const submitAI = async () => {
    if (!aiPrompt.trim()) { setError("Describe your goal first"); return; }
    setSaving(true); setError("");
    try {
      const res = await aiGenerate(aiPrompt.trim());
      onCreated && onCreated(res.goal?.id);
      onClose();
    } catch (e) { setError(friendlyApiError(e)); }
    finally { setSaving(false); }
  };

  const pickTemplate = async (t) => {
    setSaving(true); setError("");
    try {
      const res = await useTemplate(t.id, form.name.trim() || t.name);
      onCreated && onCreated(res.goal_id);
      onClose();
    } catch (e) { setError(friendlyApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="goal-modal-backdrop" onClick={onClose}>
      <div className="goal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="goal-modal-head">
          <h3>{step === 0 ? "New goal" : mode === "ai" ? "Generate with AI" : mode === "template" ? "Pick a template" : "How do you want to start?"}</h3>
          <button className="goal-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {error && <div className="goal-error">{error}</div>}

        {step === 0 && (
          <div className="goal-modal-body">
            <label className="goal-field"><span>Name</span>
              <input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Prepare UPSC 2027" /></label>
            <label className="goal-field"><span>Description</span>
              <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" /></label>
            <div className="goal-field"><span>Icon</span>
              <div className="goal-icon-grid">{ICONS.map((ic) => (
                <button key={ic} type="button" className={`goal-icon-pick ${form.icon === ic ? "sel" : ""}`} onClick={() => set("icon", ic)}><Icon name={ic} /></button>))}</div></div>
            <div className="goal-field"><span>Color</span>
              <div className="goal-color-grid">{COLORS.map((c) => (
                <button key={c} type="button" className={`goal-color-pick ${form.color === c ? "sel" : ""}`} style={{ background: c }} onClick={() => set("color", c)} aria-label={c} />))}</div></div>
            <label className="goal-field"><span>Target date</span>
              <input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></label>
          </div>
        )}

        {step === 1 && !mode && (
          <div className="goal-modal-body">
            <div className="goal-start-grid">
              <button className="goal-start-card" onClick={submitBlank} disabled={saving}>
                <span className="goal-start-emoji"><Icon name="file" /></span><span className="goal-start-title">Blank</span>
                <span className="goal-start-sub">Build the tree yourself</span></button>
              <button className="goal-start-card" onClick={() => setMode("template")} disabled={saving}>
                <span className="goal-start-emoji"><Icon name="puzzle" /></span><span className="goal-start-title">Template</span>
                <span className="goal-start-sub">Start from a preset</span></button>
              <button className="goal-start-card" onClick={() => setMode("ai")} disabled={saving}>
                <span className="goal-start-emoji"><Icon name="sparkles" /></span><span className="goal-start-title">AI Generate</span>
                <span className="goal-start-sub">Describe it in words</span></button>
            </div>
          </div>
        )}

        {step === 1 && mode === "ai" && (
          <div className="goal-modal-body">
            <label className="goal-field"><span>Describe your goal — the AI builds the full hierarchy</span>
              <textarea rows={5} autoFocus value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Prepare for UPSC 2027. Subjects: History, Geography, Economics. Every lecture should have Video, Notes, Revision, MCQ. Add weekly tests." /></label>
            <small className="goal-hint">This may take a few seconds.</small>
          </div>
        )}

        {step === 1 && mode === "template" && (
          <div className="goal-modal-body">
            <div className="template-grid sm">
              {templates.map((t) => (
                <button key={t.id} className="template-card" onClick={() => pickTemplate(t)} disabled={saving}>
                  <span className="template-icon"><Icon name={t.icon} /></span>
                  <span className="template-name">{t.name}</span>
                  <span className="template-meta">{t.node_count} nodes{t.builtin ? " · preset" : ""}</span>
                </button>
              ))}
              {templates.length === 0 && <div className="goal-hint">Loading templates…</div>}
            </div>
          </div>
        )}

        <div className="goal-modal-foot">
          {step === 1 && <button className="goal-btn ghost" onClick={() => (mode ? setMode("") : setStep(0))}>Back</button>}
          <div style={{ flex: 1 }} />
          {step === 0 && <button className="goal-btn primary" onClick={() => { if (!form.name.trim()) { setError("Name is required"); return; } setError(""); setStep(1); }}>Next</button>}
          {step === 1 && mode === "ai" && <button className="goal-btn primary" onClick={submitAI} disabled={saving}>{saving ? "Generating…" : "Generate goal"}</button>}
        </div>
      </div>
    </div>
  );
}
