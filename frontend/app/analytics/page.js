"use client";
// Goal OS — analytics. Defaults to an ALL-GOALS combined view; a selector switches to
// per-goal charts. Calendar sits at the bottom (scoped to the current selection).

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import MainMenu from "../components/MainMenu";
import ComparisonCharts from "../components/goal/ComparisonCharts";
import ContributionHeatmap from "../components/goal/ContributionHeatmap";
import CalendarView from "../components/goal/CalendarView";
import Icon from "../components/Icon";
import { listGoals, getAnalytics, getDashboard } from "../lib/goalApi";
import { friendlyApiError } from "../lib/errors";
import styles from "./page.module.css";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Design tokens (mirrors globals.css) — all chart colors come from here.
const T = {
  gold: "#ffd166", cyan: "#72ddf7", indigo: "#6366f1", mint: "#80ed99", red: "#ff6b6b",
  muted: "#8b95a7", border: "#222a3d", card: "#131826", ink: "#e7ecf5",
};
// Fixed categorical order — assign by position, never invent extra hues.
const PALETTE = [T.cyan, T.indigo, T.gold, T.mint, T.muted];

// Node statuses get semantic colors (done/blocked keep success/failure hues).
const STATUS_META = {
  done: { color: T.mint, label: "Done" },
  in_progress: { color: T.cyan, label: "In progress" },
  todo: { color: T.muted, label: "To do" },
  blocked: { color: T.red, label: "Blocked" },
  skipped: { color: T.indigo, label: "Skipped" },
};
const statusLabel = (s) => STATUS_META[s]?.label || String(s).replace(/_/g, " ");
const statusColor = (s, i) => STATUS_META[s]?.color || PALETTE[i % PALETTE.length];

const DARK = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: T.muted }, margin: { t: 30, r: 10, b: 40, l: 40 },
  xaxis: { gridcolor: T.border, zerolinecolor: T.border, linecolor: T.border },
  yaxis: { gridcolor: T.border, zerolinecolor: T.border, linecolor: T.border },
};
const plotCfg = { displayModeBar: false, responsive: true };

function GaugeCard({ title, value }) {
  return (
    <div className="chart-card">
      <h4>{title}</h4>
      <Plot
        data={[{
          type: "indicator", mode: "gauge+number", value,
          number: { suffix: "%", font: { color: T.ink, size: 30 } },
          gauge: {
            axis: { range: [0, 100], tickcolor: T.muted, tickfont: { color: T.muted, size: 10 } },
            bar: { color: T.cyan }, bgcolor: T.border, borderwidth: 0,
          },
        }]}
        layout={{ ...DARK, height: 240 }} config={plotCfg} style={{ width: "100%" }}
      />
    </div>
  );
}

function StatusDonut({ counts }) {
  const keys = Object.keys(counts);
  return (
    <Plot
      data={[{
        type: "pie", hole: 0.55,
        labels: keys.map(statusLabel), values: keys.map((k) => counts[k]),
        marker: { colors: keys.map((k, i) => statusColor(k, i)), line: { color: T.card, width: 2 } },
      }]}
      layout={{ ...DARK, height: 240, showlegend: true, legend: { font: { size: 10 } } }}
      config={plotCfg} style={{ width: "100%" }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading analytics">
      <div className={styles.skelRow} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skelStat} />)}
      </div>
      <div className={styles.skelGrid} aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className={styles.skelCard} />)}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyCard}>
      <h3 className={styles.emptyTitle}>No analytics yet</h3>
      <p className={styles.emptyText}>
        Your analytics build up as you track days, complete goals and take evaluations.
        Start with today&apos;s tracker.
      </p>
      <Link href="/home" className={`goal-btn primary ${styles.emptyCta}`}>Go to today&apos;s tracker</Link>
    </div>
  );
}

export default function AnalyticsPage() {
  const [goals, setGoals] = useState([]);
  const [goalId, setGoalId] = useState(""); // "" = all goals (combined), default
  const [combined, setCombined] = useState(null);
  const [perGoal, setPerGoal] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGoals().then((d) => setGoals(d.goals || [])).catch((e) => setError(friendlyApiError(e)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (goalId) { setPerGoal(await getAnalytics(goalId)); }
      else { setCombined(await getDashboard()); }
    } catch (e) { setError(friendlyApiError(e)); }
    finally { setLoading(false); }
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  const combinedCharts = useMemo(() => {
    if (!combined) return null;
    const gp = combined.goals_progress || [];
    const sd = combined.status_distribution || {};
    const act = combined.activity_by_date || {};
    return { gp, sd, actDates: Object.keys(act).sort(), act };
  }, [combined]);

  const perCharts = useMemo(() => {
    if (!perGoal) return null;
    const act = perGoal.activity_by_date || {};
    return { status: perGoal.status_distribution || {}, types: perGoal.progress_by_type || [],
      roots: perGoal.node_progress || [], act, actDates: Object.keys(act).sort() };
  }, [perGoal]);

  // A brand-new account: no goals and no recorded activity → show the teaching card.
  const combinedEmpty = !combinedCharts ||
    ((combined?.goal_count || 0) === 0 && combinedCharts.actDates.length === 0);

  return (
    <div className="goal-page">
      <MainMenu active="analytics" />
      <div className="goal-container">
        <header className="goal-header">
          <div><h1>Analytics</h1><p className="goal-sub">Combined across all goals, or drill into one.</p></div>
          <div className="goal-header-actions">
            <select className="gsearch-input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">All goals (combined)</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button className="goal-btn ghost" onClick={load}><Icon name="refresh" size={15} /> Refresh</button>
          </div>
        </header>
        {error && <div className="goal-error">{error}</div>}

        {loading ? <LoadingSkeleton />
          : goalId === "" ? (
            combinedEmpty ? <EmptyState /> : (
              <>
                <section className="goal-stat-row">
                  <div className="goal-stat"><span className="goal-stat-num">{combined.goal_count}</span><span className="goal-stat-lbl">Goals</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{combined.avg_progress}%</span><span className="goal-stat-lbl">Avg progress</span></div>
                  <div className="goal-stat"><span className="goal-stat-num"><Icon name="fire" size={18} /> {combined.streak_current}</span><span className="goal-stat-lbl">Streak (best {combined.streak_longest})</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{combinedCharts.actDates.reduce((s, d) => s + combinedCharts.act[d], 0)}</span><span className="goal-stat-lbl">Updates (last 180 days)</span></div>
                </section>
                <div className="chart-grid">
                  <GaugeCard title="Overall progress" value={combined.avg_progress} />
                  <div className="chart-card">
                    <h4>Status across all nodes</h4>
                    <StatusDonut counts={combinedCharts.sd} />
                  </div>
                  <div className="chart-card">
                    <h4>Progress by goal</h4>
                    <Plot data={[{ type: "bar", x: combinedCharts.gp.map((g) => g.name), y: combinedCharts.gp.map((g) => g.progress),
                      marker: { color: combinedCharts.gp.map((_, i) => PALETTE[i % PALETTE.length]) } }]}
                      layout={{ ...DARK, height: 240, yaxis: { ...DARK.yaxis, range: [0, 100] } }} config={plotCfg} style={{ width: "100%" }} />
                  </div>
                </div>
                <section className="dash-block">
                  <h3 className="dash-heading">Activity</h3>
                  <ContributionHeatmap activity={combined.activity_by_date || {}} />
                  <ComparisonCharts today={combined.today_count} yesterday={combined.yesterday_count}
                                    thisWeek={combined.this_week || []} lastWeek={combined.last_week || []} />
                </section>
              </>
            )
          ) : (
            !perCharts ? <EmptyState /> : (
              <>
                <section className="goal-stat-row">
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.overall_progress}%</span><span className="goal-stat-lbl">Progress</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.total_nodes}</span><span className="goal-stat-lbl">Nodes</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.leaves_done}/{perGoal.leaves_total}</span><span className="goal-stat-lbl">Leaves done</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perCharts.actDates.reduce((s, d) => s + perCharts.act[d], 0)}</span><span className="goal-stat-lbl">Updates (last 120 days)</span></div>
                </section>
                <div className="chart-grid">
                  <GaugeCard title="Completion" value={perGoal.overall_progress} />
                  <div className="chart-card"><h4>Status distribution</h4>
                    <StatusDonut counts={perCharts.status} /></div>
                  <div className="chart-card"><h4>Progress by type</h4>
                    <Plot data={[{ type: "bar", x: perCharts.types.map((t) => t.type), y: perCharts.types.map((t) => t.avg_progress), marker: { color: T.indigo } }]}
                          layout={{ ...DARK, height: 260, yaxis: { ...DARK.yaxis, range: [0, 100] } }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card"><h4>Top-level progress</h4>
                    <Plot data={[{ type: "treemap", labels: perCharts.roots.map((r) => r.title), parents: perCharts.roots.map(() => ""),
                      values: perCharts.roots.map((r) => r.weight), text: perCharts.roots.map((r) => `${r.progress}%`), textinfo: "label+text",
                      textfont: { color: T.card },
                      marker: { colors: perCharts.roots.map((_, i) => PALETTE[i % PALETTE.length]), line: { color: T.card, width: 2 } } }]}
                      layout={{ ...DARK, height: 260 }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card wide"><h4>Activity (last 120 days)</h4>
                    <Plot data={[{ type: "bar", x: perCharts.actDates, y: perCharts.actDates.map((d) => perCharts.act[d]), marker: { color: T.cyan } }]}
                      layout={{ ...DARK, height: 220 }} config={plotCfg} style={{ width: "100%" }} /></div>
                </div>
              </>
            )
          )}

        {!loading && (
          <section className="dash-block">
            <h3 className="dash-heading">Calendar {goalId ? "· this goal" : "· all goals"}</h3>
            <CalendarView goalId={goalId} />
          </section>
        )}
      </div>
    </div>
  );
}
