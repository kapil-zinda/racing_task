"use client";
// Goal OS — analytics. Defaults to an ALL-GOALS combined view; a selector switches to
// per-goal charts. Calendar sits at the bottom (scoped to the current selection).

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import MainMenu from "../components/MainMenu";
import ComparisonCharts from "../components/goal/ComparisonCharts";
import ContributionHeatmap from "../components/goal/ContributionHeatmap";
import CalendarView from "../components/goal/CalendarView";
import Icon from "../components/Icon";
import { listGoals, getAnalytics, getDashboard } from "../lib/goalApi";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const DARK = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#c7cede" }, margin: { t: 30, r: 10, b: 40, l: 40 },
};
const PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f87171", "#3b82f6"];
const gauge = (value, title) => ({
  data: [{ type: "indicator", mode: "gauge+number", value, gauge: { axis: { range: [0, 100] }, bar: { color: "#6366f1" } } }],
  title,
});

export default function AnalyticsPage() {
  const [goals, setGoals] = useState([]);
  const [goalId, setGoalId] = useState(""); // "" = all goals (combined), default
  const [combined, setCombined] = useState(null);
  const [perGoal, setPerGoal] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGoals().then((d) => setGoals(d.goals || [])).catch((e) => setError(String(e.message || e)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (goalId) { setPerGoal(await getAnalytics(goalId)); }
      else { setCombined(await getDashboard()); }
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  const plotCfg = { displayModeBar: false, responsive: true };

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

  return (
    <div className="goal-page">
      <MainMenu active="analytics" />
      <div className="goal-container">
        <header className="goal-header">
          <div><h1>Analytics</h1><p className="goal-sub">Combined across all goals, or drill into one.</p></div>
          <div className="goal-header-actions">
            <select className="gsearch-input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">◍ All goals (combined)</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button className="goal-btn ghost" onClick={load}><Icon name="refresh" size={15} /> Refresh</button>
          </div>
        </header>
        {error && <div className="goal-error">{error}</div>}

        {loading ? <div className="goal-empty">Loading…</div>
          : goalId === "" ? (
            !combinedCharts ? <div className="goal-empty">No data.</div> : (
              <>
                <section className="goal-stat-row">
                  <div className="goal-stat"><span className="goal-stat-num">{combined.goal_count}</span><span className="goal-stat-lbl">Goals</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{combined.avg_progress}%</span><span className="goal-stat-lbl">Avg progress</span></div>
                  <div className="goal-stat"><span className="goal-stat-num"><Icon name="fire" size={18} /> {combined.streak_current}</span><span className="goal-stat-lbl">Streak (best {combined.streak_longest})</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{combinedCharts.actDates.reduce((s, d) => s + combinedCharts.act[d], 0)}</span><span className="goal-stat-lbl">Actions (120d+)</span></div>
                </section>
                <div className="chart-grid">
                  <div className="chart-card">
                    <h4>Overall progress</h4>
                    <Plot {...gauge(combined.avg_progress)} layout={{ ...DARK, height: 240 }} config={plotCfg} style={{ width: "100%" }} />
                  </div>
                  <div className="chart-card">
                    <h4>Status across all nodes</h4>
                    <Plot data={[{ type: "pie", hole: 0.55, labels: Object.keys(combinedCharts.sd), values: Object.values(combinedCharts.sd), marker: { colors: PALETTE } }]}
                          layout={{ ...DARK, height: 240, showlegend: true, legend: { font: { size: 10 } } }} config={plotCfg} style={{ width: "100%" }} />
                  </div>
                  <div className="chart-card">
                    <h4>Progress by goal</h4>
                    <Plot data={[{ type: "bar", x: combinedCharts.gp.map((g) => g.name), y: combinedCharts.gp.map((g) => g.progress),
                      marker: { color: combinedCharts.gp.map((_, i) => PALETTE[i % PALETTE.length]) } }]}
                      layout={{ ...DARK, height: 240, yaxis: { range: [0, 100] } }} config={plotCfg} style={{ width: "100%" }} />
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
            !perCharts ? <div className="goal-empty">No data.</div> : (
              <>
                <section className="goal-stat-row">
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.overall_progress}%</span><span className="goal-stat-lbl">Progress</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.total_nodes}</span><span className="goal-stat-lbl">Nodes</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perGoal.leaves_done}/{perGoal.leaves_total}</span><span className="goal-stat-lbl">Leaves done</span></div>
                  <div className="goal-stat"><span className="goal-stat-num">{perCharts.actDates.reduce((s, d) => s + perCharts.act[d], 0)}</span><span className="goal-stat-lbl">Actions (120d)</span></div>
                </section>
                <div className="chart-grid">
                  <div className="chart-card"><h4>Completion</h4>
                    <Plot {...gauge(perGoal.overall_progress)} layout={{ ...DARK, height: 240 }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card"><h4>Status distribution</h4>
                    <Plot data={[{ type: "pie", hole: 0.55, labels: Object.keys(perCharts.status), values: Object.values(perCharts.status), marker: { colors: PALETTE } }]}
                          layout={{ ...DARK, height: 240, showlegend: true, legend: { font: { size: 10 } } }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card"><h4>Progress by type</h4>
                    <Plot data={[{ type: "bar", x: perCharts.types.map((t) => t.type), y: perCharts.types.map((t) => t.avg_progress), marker: { color: "#8b5cf6" } }]}
                          layout={{ ...DARK, height: 260, yaxis: { range: [0, 100] } }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card"><h4>Top-level progress</h4>
                    <Plot data={[{ type: "treemap", labels: perCharts.roots.map((r) => r.title), parents: perCharts.roots.map(() => ""),
                      values: perCharts.roots.map((r) => r.weight), text: perCharts.roots.map((r) => `${r.progress}%`), textinfo: "label+text",
                      marker: { colors: perCharts.roots.map((_, i) => PALETTE[i % PALETTE.length]) } }]}
                      layout={{ ...DARK, height: 260 }} config={plotCfg} style={{ width: "100%" }} /></div>
                  <div className="chart-card wide"><h4>Activity (last 120 days)</h4>
                    <Plot data={[{ type: "bar", x: perCharts.actDates, y: perCharts.actDates.map((d) => perCharts.act[d]), marker: { color: "#10b981" } }]}
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
