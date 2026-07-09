"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "../lib/auth";
import TrackerSummary from "./TrackerSummary";
import Icon from "./Icon";
import { confirmDialog } from "../lib/dialog";
import { friendlyApiError } from "../lib/errors";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

// ── helpers ────────────────────────────────────────────────────────────────
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function addDays(d, n) {
  const [y, mo, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, day + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
function fmtMins(m) {
  const mins = Math.max(0, Number(m) || 0);
  if (!mins) return "0m";
  const h = Math.floor(mins / 60), rem = mins % 60;
  return h === 0 ? `${rem}m` : rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function parseHHMM(val) {
  if (!val) return { hour: 12, minute: 0, ampm: "AM" };
  const [h, m] = val.split(":").map(Number);
  return { hour: h % 12 || 12, minute: m, ampm: h >= 12 ? "PM" : "AM" };
}
function buildHHMM(hour, minute, ampm) {
  let h = Number(hour);
  if (ampm === "AM" && h === 12) h = 0;
  if (ampm === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function toMins(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function overlaps(activities, start, end, excludeId) {
  const ns = toMins(start);
  if (ns === null) return null;
  const ne = end ? toMins(end) : null;
  for (const act of activities) {
    if (act.id === excludeId) continue;
    const as = toMins(act.start_time);
    if (as === null) continue;
    const ae = act.end_time ? toMins(act.end_time) : null;
    let clash = false;
    if (ne !== null && ae !== null) clash = ns < ae && as < ne;
    else if (ne === null && ae !== null) clash = ns >= as && ns < ae;
    else if (ne !== null && ae === null) clash = as >= ns && as < ne;
    else clash = ns === as;
    if (clash) return act.title || "another entry";
  }
  return null;
}

// ── Clock Picker ───────────────────────────────────────────────────────────
const CX = 120, CY = 120, R_NUM = 88, R_HAND = 80, CLOCK_SIZE = 240;
const HOUR_ITEMS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MIN_ITEMS  = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function clockPos(idx, total) {
  const rad = ((idx / total) * 2 * Math.PI) - Math.PI / 2;
  return { x: CX + R_NUM * Math.cos(rad), y: CY + R_NUM * Math.sin(rad) };
}
function handAngleDeg(idx, total) { return (idx / total) * 360; }

function ClockPicker({ value, onChange, onClose }) {
  const parsed = parseHHMM(value);
  const [step, setStep] = useState("hour");
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [ampm, setAmpm] = useState(parsed.ampm);
  const advanceTimer = useRef(null);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const hourIdx  = HOUR_ITEMS.indexOf(hour);
  const minIdx   = MIN_ITEMS.indexOf(Math.round(minute / 5) * 5);
  const selIdx   = step === "hour" ? (hourIdx === -1 ? 0 : hourIdx) : (minIdx === -1 ? 0 : minIdx);
  const angle    = handAngleDeg(selIdx, 12);

  // Smooth shortest-path rotation
  const [dispAngle, setDispAngle] = useState(angle);
  useEffect(() => {
    setDispAngle((prev) => {
      if (prev === null) return angle;
      let delta = angle - (prev % 360);
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      return prev + delta;
    });
  }, [angle]);

  const pickHour = (h) => {
    setHour(h);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setStep("minute"), 220);
  };

  const pickMinute = (m) => {
    setMinute(m);
    const result = buildHHMM(hour, m, ampm);
    onChange(result);
    onClose();
  };

  const confirm = () => {
    onChange(buildHHMM(hour, minute, ampm));
    onClose();
  };

  const items = step === "hour" ? HOUR_ITEMS : MIN_ITEMS;
  const selectedVal = step === "hour" ? hour : Math.round(minute / 5) * 5;

  return (
    <div className="cp-backdrop" onMouseDown={onClose}>
      <div className="cp-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header display */}
        <div className="cp-header">
          <button className={`cp-seg${step === "hour" ? " active" : ""}`} onClick={() => setStep("hour")}>
            {String(hour).padStart(2, "0")}
          </button>
          <span className="cp-colon">:</span>
          <button className={`cp-seg${step === "minute" ? " active" : ""}`} onClick={() => setStep("minute")}>
            {String(minute).padStart(2, "0")}
          </button>
          <div className="cp-ampm-wrap">
            <button className={`cp-ampm-btn${ampm === "AM" ? " active" : ""}`} onClick={() => setAmpm("AM")}>AM</button>
            <button className={`cp-ampm-btn${ampm === "PM" ? " active" : ""}`} onClick={() => setAmpm("PM")}>PM</button>
          </div>
        </div>

        <div className="cp-step-label">{step === "hour" ? "Select hour" : "Select minute"}</div>

        {/* Clock face */}
        <div className="cp-clock-outer">
          <svg width={CLOCK_SIZE} height={CLOCK_SIZE} viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`}>
            {/* Dial */}
            <circle cx={CX} cy={CY} r={CX - 6} fill="rgba(99,102,241,0.07)" stroke="rgba(129,140,248,0.18)" strokeWidth="1.5" />

            {/* Hand + highlight circle */}
            <g style={{ transform: `rotate(${dispAngle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)" }}>
              <line x1={CX} y1={CY} x2={CX} y2={CY - R_HAND} stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx={CX} cy={CY - R_HAND} r="18" fill="#6366f1" />
            </g>

            {/* Center dot */}
            <circle cx={CX} cy={CY} r="5" fill="#6366f1" />

            {/* Numbers */}
            {items.map((num, i) => {
              const pos = clockPos(i, 12);
              const isSelected = num === selectedVal;
              return (
                <g
                  key={num}
                  style={{ cursor: "pointer" }}
                  onClick={() => step === "hour" ? pickHour(num) : pickMinute(num)}
                >
                  <circle cx={pos.x} cy={pos.y} r="18" fill="transparent" />
                  <text
                    x={pos.x} y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="13"
                    fontWeight={isSelected ? "700" : "400"}
                    fill={isSelected ? "#fff" : "#a5b4fc"}
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {step === "minute" ? String(num).padStart(2, "0") : num}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="cp-footer">
          <button className="cp-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="cp-ok-btn" onClick={confirm}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── Time Field (trigger + picker) ──────────────────────────────────────────
function TimeField({ label, value, onChange, optional }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dt-tf-group">
      <label className="dt-tp-label">
        {label}{optional && <span className="dt-optional"> (optional)</span>}
      </label>
      <div className="dt-tf-row">
        <button className={`dt-tf-btn${value ? " has-val" : ""}`} onClick={() => setOpen(true)}>
          {value ? fmtTime(value) : "-- : -- --"}
        </button>
        {value && (
          <button className="dt-tp-clear" onClick={() => onChange("")} title="Clear"><Icon name="close" size={13} /></button>
        )}
      </div>
      {open && (
        <ClockPicker value={value} onChange={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
const EMPTY_FORM = { title: "", start_time: "", end_time: "", category: "", note: "", date: "" };

export default function DayTracker({ onDateChange }) {
  const [view, setView]             = useState("log");
  const [date, setDate]             = useState(todayStr);
  const [activities, setActivities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const [modal, setModal]           = useState({ open: false, mode: "add", id: null });
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [overlapWarn, setOverlapWarn] = useState("");

  const [catOpen, setCatOpen]       = useState(false);
  const [newCat, setNewCat]         = useState({ name: "", color: "#6366f1" });
  const [catSaving, setCatSaving]   = useState(false);

  const loadedCatsRef = useRef(false);

  const loadCategories = useCallback(async () => {
    if (!API_BASE_URL || loadedCatsRef.current) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/tracker/categories`);
      if (!res.ok) return;
      const data = await res.json();
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      loadedCatsRef.current = true;
    } catch (_) {}
  }, []);

  const loadActivities = useCallback(async () => {
    if (!API_BASE_URL) return;
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/tracker/activities?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadActivities(); }, [loadActivities]);
  // Let the host (home page) mirror the Day Log's selected date so Extras follow it.
  useEffect(() => { onDateChange?.(date); }, [date, onDateChange]);

  const catColor = (name) => categories.find((c) => c.name === name)?.color || "#6366f1";

  const catTotals = {};
  activities.forEach((a) => { const c = a.category || "Other"; catTotals[c] = (catTotals[c] || 0) + (a.duration_minutes || 0); });
  const totalTracked = Object.values(catTotals).reduce((s, v) => s + v, 0);
  const catEntries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  const openAdd = () => {
    setOverlapWarn("");
    setForm({ ...EMPTY_FORM, date, category: categories[0]?.name || "Study" });
    setModal({ open: true, mode: "add", id: null });
  };
  const openEdit = (act) => {
    setOverlapWarn("");
    setForm({ title: act.title || "", start_time: act.start_time || "", end_time: act.end_time || "", category: act.category || (categories[0]?.name || "Study"), note: act.note || "", date: act.date || date });
    setModal({ open: true, mode: "edit", id: act.id });
  };
  const closeModal = () => { setModal({ open: false, mode: "add", id: null }); setForm(EMPTY_FORM); setOverlapWarn(""); };

  const saveActivity = async () => {
    if (!form.title.trim() || saving) return;
    const clash = overlaps(activities, form.start_time, form.end_time, modal.id);
    if (clash) { setOverlapWarn(`Overlaps with "${clash}"`); return; }
    setOverlapWarn("");
    setSaving(true);
    try {
      const body = { ...form, title: form.title.trim(), note: form.note.trim() };
      const url = modal.mode === "edit" ? `${API_BASE_URL}/tracker/activities/${modal.id}` : `${API_BASE_URL}/tracker/activities`;
      const res = await apiFetch(url, { method: modal.mode === "edit" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${res.status}`);
      closeModal(); await loadActivities();
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setSaving(false); }
  };

  const deleteActivity = async (id) => {
    if (!(await confirmDialog({ message: "Delete this activity?", confirmLabel: "Delete", danger: true }))) return;
    try { await apiFetch(`${API_BASE_URL}/tracker/activities/${id}`, { method: "DELETE" }); setActivities((p) => p.filter((a) => a.id !== id)); }
    catch (_) {}
  };

  const addCategory = async () => {
    const name = newCat.name.trim();
    if (!name || catSaving) return;
    setCatSaving(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/tracker/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color: newCat.color }) });
      if (!res.ok) throw new Error(`${res.status}`);
      const cat = await res.json();
      setCategories((p) => [...p, cat]);
      setNewCat({ name: "", color: "#6366f1" });
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setCatSaving(false); }
  };

  const deleteCategory = async (name) => {
    if (!(await confirmDialog({ message: `Remove the "${name}" category?`, confirmLabel: "Remove", danger: true }))) return;
    try { await apiFetch(`${API_BASE_URL}/tracker/categories/${encodeURIComponent(name)}`, { method: "DELETE" }); setCategories((p) => p.filter((c) => c.name !== name)); }
    catch (_) {}
  };

  const today = todayStr();

  // Duration hint in modal
  const modalDuration = (() => {
    const s = toMins(form.start_time), e = toMins(form.end_time);
    if (s === null || e === null) return null;
    const d = e - s; return d < 0 ? d + 1440 : d;
  })();

  return (
    <div className="dt-wrap">
      {/* Header */}
      <div className="dt-header">
        <h2 className="dt-title">Day Tracker</h2>
        <div className="dt-tabs">
          <button className={`dt-tab${view === "log" ? " active" : ""}`} onClick={() => setView("log")}>Day Log</button>
          <button className={`dt-tab${view === "summary" ? " active" : ""}`} onClick={() => setView("summary")}>Summary</button>
        </div>
        {view === "log" && (
          <div className="dt-log-controls">
            <div className="dt-date-nav">
              <button className="dt-nav-btn" onClick={() => setDate((d) => addDays(d, -1))}><Icon name="chevron-left" size={16} /></button>
              <span className="dt-date-label">{fmtDate(date)}</span>
              <button className="dt-nav-btn" onClick={() => setDate((d) => addDays(d, 1))} disabled={date >= today}><Icon name="chevron-right" size={16} /></button>
              {date !== today && <button className="dt-today-btn" onClick={() => setDate(today)}>Today</button>}
            </div>
            <button className="dt-add-btn" onClick={openAdd}><Icon name="plus" size={14} /> Log Activity</button>
          </div>
        )}
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      {view === "summary" ? (
        <TrackerSummary categories={categories} />
      ) : (
        <>
      {/* Summary */}
      <div className="dt-summary">
        <div className="dt-stat">
          <span className="dt-stat-val">{activities.length}</span>
          <span className="dt-stat-label" style={{ fontSize: 12 }}>Entries</span>
        </div>
        <div className="dt-stat">
          <span className="dt-stat-val">{fmtMins(totalTracked)}</span>
          <span className="dt-stat-label" style={{ fontSize: 12 }}>Total</span>
        </div>
        {catEntries.map(([cat, mins]) => (
          <div className="dt-stat" key={cat}>
            <span className="dt-stat-val" style={{ color: catColor(cat) }}>{fmtMins(mins)}</span>
            <span className="dt-stat-label" style={{ fontSize: 12 }}>{cat}</span>
          </div>
        ))}
      </div>

      {/* Activity list */}
      <div className="dt-list">
        {loading ? <p className="dt-empty">Loading…</p>
          : activities.length === 0 ? <p className="dt-empty">No activities yet. Click <b>+ Log Activity</b> to start.</p>
          : activities.map((act) => (
            <div className="dt-item" key={act.id} style={{ borderLeftColor: catColor(act.category) }}>
              <div className="dt-item-main">
                <span className="dt-item-title">{act.title}</span>
                {act.note ? <span className="dt-item-note">{act.note}</span> : null}
              </div>
              <div className="dt-item-meta">
                <span className="dt-item-cat" style={{ background: catColor(act.category) + "22", color: catColor(act.category) }}>{act.category}</span>
                {act.start_time ? <span className="dt-item-time">{fmtTime(act.start_time)}{act.end_time ? ` → ${fmtTime(act.end_time)}` : " →"}</span> : null}
                {act.duration_minutes > 0
                  ? <span className="dt-item-dur">{fmtMins(act.duration_minutes)}</span>
                  : <span className="dt-item-dur pending">—</span>}
                <button className="dt-icon-btn" onClick={() => openEdit(act)} title="Edit"><Icon name="edit" size={14} /></button>
                <button className="dt-icon-btn danger" onClick={() => deleteActivity(act.id)} title="Delete"><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
      </div>

      {/* Bar chart */}
      {catEntries.length > 0 && (
        <div className="dt-chart-wrap">
          <div className="dt-chart-label">Time by Category</div>
          <Plot
            data={[{
              type: "bar", orientation: "h",
              x: catEntries.map(([, v]) => v),
              y: catEntries.map(([k]) => k),
              text: catEntries.map(([, v]) => fmtMins(v)),
              textposition: "outside",
              textfont: { color: "#c7d2fe", size: 11 },
              marker: { color: catEntries.map(([k]) => catColor(k)) },
              hovertemplate: "%{y}: %{text}<extra></extra>",
            }]}
            layout={{
              plot_bgcolor: "rgba(0,0,0,0)", paper_bgcolor: "rgba(0,0,0,0)",
              font: { color: "#c7d2fe", size: 11 },
              margin: { l: 90, r: 60, t: 8, b: 30 },
              xaxis: { tickfont: { color: "#818cf8", size: 10 }, gridcolor: "rgba(99,102,241,0.12)", showline: false, zeroline: false, ticksuffix: "m" },
              yaxis: { tickfont: { color: "#a5b4fc", size: 11 }, showgrid: false, automargin: true },
              showlegend: false, autosize: true, bargap: 0.35,
            }}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%", height: `${Math.max(120, catEntries.length * 44 + 50)}px` }}
            useResizeHandler
          />
        </div>
      )}

      {/* Categories */}
      <div className="dt-cat-section">
        <button className="dt-cat-toggle" onClick={() => setCatOpen((v) => !v)}>
          Categories <Icon name={catOpen ? "chevron-up" : "chevron-down"} size={14} />
        </button>
        {catOpen && (
          <div className="dt-cat-body">
            <div className="dt-cat-list">
              {categories.map((cat) => (
                <div className="dt-cat-row" key={cat.name}>
                  <span className="dt-cat-dot" style={{ background: cat.color }} />
                  <span className="dt-cat-name">{cat.name}</span>
                  <button className="dt-icon-btn danger" onClick={() => deleteCategory(cat.name)}><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
            <div className="dt-cat-add">
              <input className="dt-input" placeholder="New category name" value={newCat.name}
                onChange={(e) => setNewCat((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addCategory()} />
              <input type="color" className="dt-color-input" value={newCat.color}
                onChange={(e) => setNewCat((p) => ({ ...p, color: e.target.value }))} />
              <button className="dt-add-btn" onClick={addCategory} disabled={!newCat.name.trim() || catSaving}>Add</button>
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {/* Modal */}
      {modal.open && (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal dt-modal">
            <h3>{modal.mode === "edit" ? "Edit Activity" : "Log Activity"}</h3>
            <div className="session-form-grid">
              <input className="task-select" placeholder="Title (e.g. Morning run)" value={form.title} autoFocus
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
              <select className="task-select" value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                {categories.map((cat) => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
              </select>
              <input type="date" className="task-select" value={form.date || date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
            </div>

            <div className="dt-tp-row">
              <TimeField label="Start time" value={form.start_time}
                onChange={(v) => { setForm((p) => ({ ...p, start_time: v })); setOverlapWarn(""); }} />
              <TimeField label="End time" value={form.end_time} optional
                onChange={(v) => { setForm((p) => ({ ...p, end_time: v })); setOverlapWarn(""); }} />
            </div>

            {modalDuration !== null && (
              <p className="dt-duration-hint">Duration: {fmtMins(modalDuration)}</p>
            )}
            {overlapWarn && <p className="dt-overlap-warn"><Icon name="warning" size={14} /> {overlapWarn}</p>}

            <textarea className="task-textarea" placeholder="Note (optional)" rows={2} value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />

            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={closeModal}>Cancel</button>
              <button className="btn-save" onClick={saveActivity} disabled={!form.title.trim() || saving}>
                {saving ? "Saving…" : modal.mode === "edit" ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
