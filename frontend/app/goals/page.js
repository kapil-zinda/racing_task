"use client";
// Goal OS — goals dashboard + list. Replaces the old /mission journey list.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MainMenu from "../components/MainMenu";
import GoalCard from "../components/goal/GoalCard";
import CreateGoalWizard from "../components/goal/CreateGoalWizard";
import GoalHeaderTools from "../components/goal/GoalHeaderTools";
import MindfulHero from "../components/goal/MindfulHero";
import ContributionHeatmap from "../components/goal/ContributionHeatmap";
import ComparisonCharts from "../components/goal/ComparisonCharts";
import { listGoals, createGoal, deleteGoal, getDashboard } from "../lib/goalApi";

export default function GoalsPage() {
  const router = useRouter();
  const [goals, setGoals] = useState([]);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [data, dashboard] = await Promise.all([listGoals(), getDashboard().catch(() => null)]);
      setGoals(data.goals || []);
      setDash(dashboard);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = goals.filter((g) => g.status === "active");
    const avg = active.length
      ? Math.round(active.reduce((s, g) => s + (g.progress || 0), 0) / active.length)
      : 0;
    const done = goals.filter((g) => g.status === "completed" || (g.progress || 0) >= 100).length;
    return { total: goals.length, active: active.length, avg, done };
  }, [goals]);

  const handleCreate = async (form) => {
    const created = await createGoal(form);
    setGoals((gs) => [created, ...gs]);
  };

  const handleDelete = async (goal) => {
    if (!window.confirm(`Delete "${goal.name}" and its entire tree? This cannot be undone.`)) return;
    const prev = goals;
    setGoals((gs) => gs.filter((g) => g.id !== goal.id));
    try {
      await deleteGoal(goal.id);
    } catch (err) {
      setError(String(err.message || err));
      setGoals(prev);
    }
  };

  return (
    <div className="goal-page">
      <MainMenu active="goals" />
      <div className="goal-container">
        <header className="goal-header">
          <div>
            <h1>Goals</h1>
            <p className="goal-sub">Your Goal OS — every goal is a tree of nodes with metrics and progress.</p>
          </div>
          <div className="goal-header-actions">
            <GoalHeaderTools />
            <button className="goal-btn ghost" onClick={load} title="Refresh">↻ Refresh</button>
            <button className="goal-btn primary" onClick={() => setWizardOpen(true)}>+ New goal</button>
          </div>
        </header>

        {dash && (
          <MindfulHero tasks={dash.today_tasks || []} streak={dash.streak_current || 0}
                       avgProgress={dash.avg_progress || 0} />
        )}

        <section className="goal-stat-row">
          <div className="goal-stat"><span className="goal-stat-num">{stats.total}</span><span className="goal-stat-lbl">Total goals</span></div>
          <div className="goal-stat"><span className="goal-stat-num">{stats.active}</span><span className="goal-stat-lbl">Active</span></div>
          <div className="goal-stat"><span className="goal-stat-num">{stats.avg}%</span><span className="goal-stat-lbl">Avg progress</span></div>
          <div className="goal-stat">
            <span className="goal-stat-num">🔥 {dash?.streak_current ?? 0}</span>
            <span className="goal-stat-lbl">Current streak (best {dash?.streak_longest ?? 0})</span>
          </div>
        </section>

        {dash && (
          <section className="dash-block">
            <h3 className="dash-heading">Activity</h3>
            <ContributionHeatmap activity={dash.activity_by_date || {}} />
            <ComparisonCharts today={dash.today_count} yesterday={dash.yesterday_count}
                              thisWeek={dash.this_week || []} lastWeek={dash.last_week || []} />
          </section>
        )}

        {error && <div className="goal-error">{error}</div>}

        {loading ? (
          <div className="goal-empty">Loading…</div>
        ) : goals.length === 0 ? (
          <div className="goal-empty">
            <p>No goals yet.</p>
            <button className="goal-btn primary" onClick={() => setWizardOpen(true)}>Create your first goal</button>
          </div>
        ) : (
          <div className="goal-grid">
            {goals.map((g) => <GoalCard key={g.id} goal={g} onDelete={handleDelete} />)}
          </div>
        )}
      </div>

      {wizardOpen && (
        <CreateGoalWizard
          onClose={() => setWizardOpen(false)}
          onCreate={handleCreate}
          onCreated={(goalId) => { if (goalId) router.push(`/goals/${goalId}`); else load(); }}
        />
      )}
    </div>
  );
}
