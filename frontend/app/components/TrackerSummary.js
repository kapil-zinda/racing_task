"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "../lib/auth";
import Icon from "./Icon";
import { friendlyApiError } from "../lib/errors";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const VIEW_MODES = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "range", label: "Custom" },
];

const HOUR_PRESETS = [
  { key: "total", label: "Total", start: 0, end: 24 },
  { key: "morning", label: "Morning (2–10am)", start: 2, end: 10 },
  { key: "day", label: "Day (10am–6pm)", start: 10, end: 18 },
  { key: "night", label: "Night (6pm–2am)", start: 18, end: 2 },
  { key: "custom", label: "Custom", start: 0, end: 24 },
];

const WASTE_CATEGORY = "Time Wasted";

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
function fmtMins(m) {
  const mins = Math.max(0, Math.round(Number(m) || 0));
  if (!mins) return "0m";
  const h = Math.floor(mins / 60), rem = mins % 60;
  return h === 0 ? `${rem}m` : rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
function fmtHour(h) {
  const hr = ((h % 24) + 24) % 24;
  if (hr === 0) return "12am";
  if (hr < 12) return `${hr}am`;
  if (hr === 12) return "12pm";
  return `${hr - 12}pm`;
}
function toMins(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
// Split one activity into per-hour buckets: [{hour, minutes}]
function bucketByHour(act) {
  const s = toMins(act.start_time);
  if (s === null) return [];
  let e = act.end_time ? toMins(act.end_time) : null;
  if (e === null) e = s + (Number(act.duration_minutes) || 0);
  if (e < s) e += 1440;
  if (e <= s) return [];
  const out = [];
  let cur = s;
  while (cur < e) {
    const next = Math.min(Math.floor(cur / 60) * 60 + 60, e);
    out.push({ hour: Math.floor(cur / 60) % 24, minutes: next - cur });
    cur = next;
  }
  return out;
}
function hourInRange(h, start, end) {
  if (start < end) return h >= start && h < end;
  if (start === end) return false;
  return h >= start || h < end; // wrap-around (e.g. night 18–2)
}
function hoursInRange(start, end) {
  if (start < end) return end - start;
  if (start === end) return 0;
  return 24 - start + end;
}
function hourList(start, end) {
  const hours = [];
  if (start < end) {
    for (let h = start; h < end; h++) hours.push(h);
  } else {
    for (let h = start; h < 24; h++) hours.push(h);
    for (let h = 0; h < end; h++) hours.push(h);
  }
  return hours;
}
const FALLBACK_COLORS = ["#6366f1", "#10b981", "#ef4444", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ec4899", "#94a3b8"];

// ── component ──────────────────────────────────────────────────────────────
export default function TrackerSummary({ categories = [] }) {
  const today = todayStr();
  const [viewMode, setViewMode] = useState("daily");
  const [date, setDate] = useState(today);
  const [startDate, setStartDate] = useState(addDays(today, -6));
  const [endDate, setEndDate] = useState(today);
  const [catFilter, setCatFilter] = useState("all");
  const [hourPreset, setHourPreset] = useState("total");
  const [customStart, setCustomStart] = useState(0);
  const [customEnd, setCustomEnd] = useState(24);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const graphDivRef = useRef(null);

  const downloadChart = async () => {
    if (!graphDivRef.current) return;
    try {
      const Plotly = (await import("plotly.js-dist-min")).default;
      const label = viewMode === "daily" ? date : `${range.start}_${range.end}`;
      await Plotly.downloadImage(graphDivRef.current, {
        format: "png", scale: 2, filename: `time-summary-${label}`,
      });
    } catch (err) {
      setError(friendlyApiError(err));
    }
  };

  const range = useMemo(() => {
    if (viewMode === "daily") return { start: date, end: date };
    if (viewMode === "weekly") return { start: addDays(today, -6), end: today };
    if (viewMode === "monthly") return { start: addDays(today, -29), end: today };
    return { start: startDate, end: endDate };
  }, [viewMode, date, startDate, endDate, today]);

  useEffect(() => {
    if (!API_BASE_URL) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const res = await apiFetch(
          `${API_BASE_URL}/tracker/summary?start_date=${encodeURIComponent(range.start)}&end_date=${encodeURIComponent(range.end)}`
        );
        if (!res.ok) throw new Error(`Summary API failed: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) { setError(friendlyApiError(err)); setSummary(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [range.start, range.end]);

  const preset = HOUR_PRESETS.find((p) => p.key === hourPreset) || HOUR_PRESETS[0];
  const hStart = hourPreset === "custom" ? Math.min(23, Math.max(0, customStart)) : preset.start;
  const hEnd = hourPreset === "custom" ? Math.min(24, Math.max(1, customEnd)) : preset.end;

  const catColor = (name) => {
    const found = categories.find((c) => c.name === name);
    if (found?.color) return found.color;
    const idx = Math.abs([...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % FALLBACK_COLORS.length;
    return FALLBACK_COLORS[idx];
  };

  const computed = useMemo(() => {
    const days = summary?.daily_breakdown || [];
    const isDaily = viewMode === "daily";
    // Bucket every activity into hour slots, filtered by hour range + category.
    const catSet = new Set();
    const perDayCat = new Map(); // date -> Map(cat -> mins in range)
    const perHourCat = new Map(); // hour -> Map(cat -> mins) (daily view)
    let wasted = 0;
    let trackedInRange = 0;
    days.forEach((day) => {
      (day.activities || []).forEach((act) => {
        const cat = act.category || "Other";
        bucketByHour(act).forEach(({ hour, minutes }) => {
          if (!hourInRange(hour, hStart, hEnd)) return;
          if (cat === WASTE_CATEGORY) wasted += minutes;
          if (catFilter !== "all" && cat !== catFilter) return;
          catSet.add(cat);
          trackedInRange += minutes;
          const dm = perDayCat.get(day.date) || new Map();
          dm.set(cat, (dm.get(cat) || 0) + minutes);
          perDayCat.set(day.date, dm);
          if (isDaily) {
            const hm = perHourCat.get(hour) || new Map();
            hm.set(cat, (hm.get(cat) || 0) + minutes);
            perHourCat.set(hour, hm);
          }
        });
      });
    });
    const cats = Array.from(catSet).sort();
    let traces = [];
    if (isDaily) {
      const hours = hourList(hStart, hEnd);
      const labels = hours.map((h) => `${fmtHour(h)}-${fmtHour(h + 1)}`);
      traces = cats.map((cat) => ({
        type: "bar",
        name: cat,
        x: labels,
        y: hours.map((h) => perHourCat.get(h)?.get(cat) || 0),
        marker: { color: catColor(cat) },
        hovertemplate: `<b>${cat}</b><br>%{x}: %{y}m<extra></extra>`,
      }));
    } else {
      const dates = Array.from(perDayCat.keys()).sort();
      traces = cats.map((cat) => ({
        type: "bar",
        name: cat,
        x: dates,
        y: dates.map((d) => Math.round(((perDayCat.get(d)?.get(cat) || 0) / 60) * 100) / 100),
        marker: { color: catColor(cat) },
        hovertemplate: `<b>${cat}</b><br>%{x}: %{y}h<extra></extra>`,
      }));
    }
    const numDays = isDaily ? 1 : Math.max(1, days.length);
    const possibleMins = hoursInRange(hStart, hEnd) * 60 * numDays;
    const productivity = possibleMins > 0 ? (((possibleMins - wasted) / possibleMins) * 100).toFixed(1) : "0.0";
    return { traces, isDaily, wasted, trackedInRange, possibleMins, productivity, hasData: traces.some((t) => t.y.some((v) => v > 0)) };
  }, [summary, viewMode, catFilter, hStart, hEnd, categories]);

  const filterCats = useMemo(() => {
    const names = new Set(categories.map((c) => c.name));
    Object.keys(summary?.by_category || {}).forEach((n) => names.add(n));
    return Array.from(names).sort();
  }, [categories, summary]);

  if (!API_BASE_URL) {
    return <p className="dt-empty">Summary needs a backend URL configured.</p>;
  }

  return (
    <div className="ts-wrap">
      {/* View mode + date pickers */}
      <div className="ts-controls">
        <div className="ts-seg-group">
          {VIEW_MODES.map((m) => (
            <button key={m.key} className={`ts-seg${viewMode === m.key ? " active" : ""}`} onClick={() => setViewMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        {viewMode === "daily" && (
          <div className="dt-date-nav">
            <button className="dt-nav-btn" onClick={() => setDate((d) => addDays(d, -1))}>‹</button>
            <input type="date" className="ts-date-input" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            <button className="dt-nav-btn" onClick={() => setDate((d) => addDays(d, 1))} disabled={date >= today}>›</button>
            {date !== today && <button className="dt-today-btn" onClick={() => setDate(today)}>Today</button>}
          </div>
        )}
        {viewMode === "range" && (
          <div className="ts-range-row">
            <input type="date" className="ts-date-input" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value || startDate)} />
            <span className="ts-range-sep">to</span>
            <input type="date" className="ts-date-input" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value || endDate)} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="ts-filter-block">
        <span className="dt-chart-label">Filter by category</span>
        <div className="ts-chip-row">
          <button className={`ts-chip${catFilter === "all" ? " active" : ""}`} onClick={() => setCatFilter("all")}>All</button>
          {filterCats.map((name) => (
            <button
              key={name}
              className={`ts-chip${catFilter === name ? " active" : ""}`}
              style={catFilter === name ? { background: catColor(name), borderColor: catColor(name), color: "#fff" } : { color: catColor(name) }}
              onClick={() => setCatFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="ts-filter-block">
        <span className="dt-chart-label">Filter by time of day</span>
        <div className="ts-chip-row">
          {HOUR_PRESETS.map((p) => (
            <button key={p.key} className={`ts-chip${hourPreset === p.key ? " active" : ""}`} onClick={() => setHourPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {hourPreset === "custom" && (
          <div className="ts-custom-hours">
            <label>Start hour
              <input type="number" min="0" max="23" className="ts-hour-input" value={customStart}
                onChange={(e) => setCustomStart(parseInt(e.target.value, 10) || 0)} />
            </label>
            <span className="ts-range-sep">to</span>
            <label>End hour
              <input type="number" min="1" max="24" className="ts-hour-input" value={customEnd}
                onChange={(e) => setCustomEnd(parseInt(e.target.value, 10) || 24)} />
            </label>
          </div>
        )}
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      {loading ? (
        <p className="dt-empty">Loading summary…</p>
      ) : !summary || summary.days_tracked === 0 ? (
        <p className="dt-empty">No activities logged in this period yet.</p>
      ) : (
        <>
          {/* Stat cards */}
          <div className="ts-stats-grid">
            <div className="ts-stat-card">
              <span className="ts-stat-label">Tracked</span>
              <span className="ts-stat-val">{fmtMins(computed.trackedInRange)}</span>
            </div>
            <div className="ts-stat-card">
              <span className="ts-stat-label">Window</span>
              <span className="ts-stat-val">{Math.round(computed.possibleMins / 60)}h</span>
            </div>
            <div className="ts-stat-card danger">
              <span className="ts-stat-label">Time wasted</span>
              <span className="ts-stat-val">{fmtMins(computed.wasted)}</span>
            </div>
            <div className="ts-stat-card success">
              <span className="ts-stat-label">Productivity</span>
              <span className="ts-stat-val">{computed.productivity}%</span>
            </div>
            {viewMode !== "daily" && (
              <>
                <div className="ts-stat-card">
                  <span className="ts-stat-label">Days tracked</span>
                  <span className="ts-stat-val">{summary.days_tracked}</span>
                </div>
                <div className="ts-stat-card">
                  <span className="ts-stat-label">Avg / day</span>
                  <span className="ts-stat-val">{fmtMins(summary.average_per_day)}</span>
                </div>
              </>
            )}
          </div>

          {/* Stacked bar chart */}
          {computed.hasData ? (
            <div className="dt-chart-wrap">
              <div className="dt-chart-head">
                <span className="dt-chart-label">{computed.isDaily ? "Minutes per hour slot" : "Hours per day"}</span>
                <button className="dt-chart-dl" onClick={downloadChart} title="Download this graph as PNG">
                  <Icon name="download" size={14} /> Download
                </button>
              </div>
              <Plot
                onInitialized={(fig, gd) => { graphDivRef.current = gd; }}
                onUpdate={(fig, gd) => { graphDivRef.current = gd; }}
                data={computed.traces}
                layout={{
                  barmode: "stack",
                  plot_bgcolor: "rgba(0,0,0,0)", paper_bgcolor: "rgba(0,0,0,0)",
                  font: { color: "#c7d2fe", size: 11 },
                  margin: { l: 45, r: 10, t: 10, b: 70 },
                  xaxis: {
                    type: "category",
                    tickfont: { color: "#818cf8", size: 10 },
                    tickangle: -40,
                    gridcolor: "rgba(99,102,241,0.12)", showline: false, zeroline: false,
                  },
                  yaxis: {
                    title: { text: computed.isDaily ? "minutes" : "hours", font: { color: "#6b7280", size: 10 } },
                    tickfont: { color: "#a5b4fc", size: 10 },
                    gridcolor: "rgba(99,102,241,0.12)", zeroline: false,
                    ...(computed.isDaily ? { range: [0, 60] } : {}),
                  },
                  showlegend: true,
                  legend: { orientation: "h", y: -0.35, font: { color: "#a5b4fc", size: 10 } },
                  autosize: true, bargap: 0.25,
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%", height: "320px" }}
                useResizeHandler
              />
            </div>
          ) : (
            <p className="dt-empty">Nothing in this time window — try a wider filter.</p>
          )}

          {/* Per-category totals */}
          <div className="ts-cat-totals">
            {Object.entries(summary.by_category)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, mins]) => (
                <div className="dt-stat" key={cat}>
                  <span className="dt-stat-val" style={{ color: catColor(cat) }}>{fmtMins(mins)}</span>
                  <span className="dt-stat-label">{cat}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
