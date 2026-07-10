"use client";

import "./time-tracker.css";
import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "../lib/auth";
import { friendlyApiError } from "../lib/errors";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtMins(mins) {
  const m = Math.max(0, Number(mins) || 0);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const VIEW_PRESETS = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "30", label: "Last 30 Days" },
];

export default function TimeTracker({ onLogActivity }) {
  const [view, setView] = useState("week");
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const getDateRange = useCallback(() => {
    const today = todayStr();
    if (view === "week") return { from: weekStart(), to: today };
    if (view === "month") return { from: monthStart(), to: today };
    return { from: addDays(today, -29), to: today };
  }, [view]);

  const load = useCallback(async () => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const { from, to } = getDateRange();
      const res = await apiFetch(`${API_BASE_URL}/agent-v2/state/range?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, [getDateRange]);

  useEffect(() => { load(); }, [load]);

  const activeDays = days.filter((d) => d.active).length;
  const totalPoints = days.reduce((s, d) => s + (d.points_total || 0), 0);
  const totalSessionMins = days.reduce((s, d) => s + (d.session_minutes || 0), 0);
  const totalEvents = days.reduce((s, d) => s + (d.event_count || 0), 0);

  const dates = days.map((d) => fmtDate(d.date));
  const newClassCounts = days.map((d) => d.new_class_count || 0);
  const revisionCounts = days.map((d) => d.revision_count || 0);
  const practiceCounts = days.map((d) => d.practice_count || 0);
  const sessionMins = days.map((d) => d.session_minutes || 0);

  const activityTraces = [
    {
      type: "bar",
      name: "New Class",
      x: dates,
      y: newClassCounts,
      marker: { color: "#6366f1" },
      hovertemplate: "New Class: %{y}<extra></extra>",
    },
    {
      type: "bar",
      name: "Revision",
      x: dates,
      y: revisionCounts,
      marker: { color: "#10b981" },
      hovertemplate: "Revision: %{y}<extra></extra>",
    },
    {
      type: "bar",
      name: "Practice",
      x: dates,
      y: practiceCounts,
      marker: { color: "#f59e0b" },
      hovertemplate: "Practice: %{y}<extra></extra>",
    },
  ];

  const sessionTrace = [
    {
      type: "bar",
      name: "Session Time",
      x: dates,
      y: sessionMins,
      marker: { color: "#0ea5e9" },
      hovertemplate: "%{y}m<extra></extra>",
    },
  ];

  const layoutBase = {
    plot_bgcolor: "rgba(0,0,0,0)",
    paper_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#c7d2fe", size: 11 },
    margin: { l: 40, r: 20, t: 10, b: 60 },
    xaxis: {
      tickfont: { color: "#818cf8", size: 10 },
      gridcolor: "rgba(99,102,241,0.1)",
      showgrid: false,
      showline: false,
      automargin: true,
    },
    yaxis: {
      tickfont: { color: "#818cf8", size: 10 },
      gridcolor: "rgba(99,102,241,0.15)",
      gridwidth: 1,
      showline: false,
      automargin: true,
      rangemode: "tozero",
    },
    showlegend: true,
    legend: {
      font: { color: "#c7d2fe", size: 10 },
      bgcolor: "rgba(0,0,0,0)",
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: -0.25,
    },
    autosize: true,
    bargap: 0.25,
  };

  return (
    <div className="tracker-wrap">
      <div className="tracker-header">
        <h2 className="tracker-title">Activity Tracker</h2>
        <div className="tracker-tabs">
          {VIEW_PRESETS.map((p) => (
            <button
              key={p.key}
              className={`tracker-tab${view === p.key ? " active" : ""}`}
              onClick={() => setView(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button className="tracker-tab tracker-refresh" onClick={load} disabled={loading} title="Refresh">
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      <div className="tracker-summary">
        <div className="tracker-stat">
          <span className="tracker-stat-val">{activeDays}</span>
          <span className="tracker-stat-label">Active Days</span>
        </div>
        <div className="tracker-stat">
          <span className="tracker-stat-val">{fmtMins(totalSessionMins)}</span>
          <span className="tracker-stat-label">Study Time</span>
        </div>
        <div className="tracker-stat">
          <span className="tracker-stat-val">{totalEvents}</span>
          <span className="tracker-stat-label">Events</span>
        </div>
        <div className="tracker-stat">
          <span className="tracker-stat-val">{totalPoints}</span>
          <span className="tracker-stat-label">Points</span>
        </div>
      </div>

      {onLogActivity ? (
        <div className="tracker-actions">
          <button className="btn-new" onClick={() => onLogActivity("new_class")}>+ New Class</button>
          <button className="btn-revise" onClick={() => onLogActivity("revision")}>+ Revision</button>
          <button className="btn-ticket" onClick={() => onLogActivity("ticket_resolved")}>+ Ticket</button>
          <button className="btn-ticket" style={{ background: "var(--accent-teal, #0ea5e9)" }} onClick={() => onLogActivity("test_completed")}>+ Test</button>
        </div>
      ) : null}

      {days.length > 0 ? (
        <>
          <div className="tracker-chart-label">Events by Type</div>
          <div className="tracker-chart">
            <Plot
              data={activityTraces}
              layout={{ ...layoutBase, barmode: "stack" }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "220px" }}
              useResizeHandler
            />
          </div>
          <div className="tracker-chart-label">Session Time (minutes)</div>
          <div className="tracker-chart">
            <Plot
              data={sessionTrace}
              layout={{ ...layoutBase, barmode: "group" }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: "180px" }}
              useResizeHandler
            />
          </div>
        </>
      ) : !loading ? (
        <p className="day-state" style={{ padding: "1.5rem 0", textAlign: "center" }}>
          No activity data yet for this period.
        </p>
      ) : null}
    </div>
  );
}
