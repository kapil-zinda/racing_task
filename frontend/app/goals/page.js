"use client";
import "./goals.css";
import "../components/goal.css";

// Goals dashboard + list. Replaces the old /mission journey list.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MainMenu from "../components/MainMenu";
import GoalCard from "../components/goal/GoalCard";
import CreateGoalWizard from "../components/goal/CreateGoalWizard";
import GoalHeaderTools from "../components/goal/GoalHeaderTools";
import MindfulHero from "../components/goal/MindfulHero";
import ContributionHeatmap from "../components/goal/ContributionHeatmap";
import ComparisonCharts from "../components/goal/ComparisonCharts";
import Icon from "../components/Icon";
import styles from "../components/goal/MindfulHero.module.css"; // hero + goals-list skeleton styles
import { listGoals, createGoal, getDashboard } from "../lib/goalApi";
import { friendlyApiError } from "../lib/errors";

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
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = goals.filter((g) => g.status === "active").length;
    return { total: goals.length, active };
  }, [goals]);

  const handleCreate = async (form) => {
    const created = await createGoal(form);
    setGoals((gs) => [created, ...gs]);
  };

  return (
    <div className="goal-page">
      <MainMenu active="goals" />
      <div className="goal-container">
        <header className="goal-header">
          <div>
            <h1>Goals</h1>
            <p className="goal-sub">Your goals — break each into tasks and metrics.</p>
          </div>
          <div className="goal-header-actions">
            <GoalHeaderTools />
            <button className="goal-btn ghost" onClick={load} title="Refresh"><Icon name="refresh" size={15} /> Refresh</button>
            <button className="goal-btn primary" onClick={() => setWizardOpen(true)}>+ New goal</button>
          </div>
        </header>

        {dash && (
          <MindfulHero tasks={dash.today_tasks || []} streak={dash.streak_current || 0}
                       avgProgress={dash.avg_progress || 0} onChanged={load} />
        )}

        {/* Streak + avg progress live in the hero above (one source of truth). */}
        <section className="goal-stat-row">
          <div className="goal-stat"><span className="goal-stat-num">{stats.total}</span><span className="goal-stat-lbl">Total goals</span></div>
          <div className="goal-stat"><span className="goal-stat-num">{stats.active}</span><span className="goal-stat-lbl">Active</span></div>
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
          <div className={styles.skeletonGrid} role="status" aria-label="Loading goals">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeletonCard} aria-hidden="true">
                <div className={styles.skeletonShimmer} />
              </div>
            ))}
            <span className="sr-only">Loading goals…</span>
          </div>
        ) : goals.length === 0 ? (
          <div className="goal-empty">
            <p>No goals yet.</p>
            <button className="goal-btn primary" onClick={() => setWizardOpen(true)}>Create your first goal</button>
          </div>
        ) : (
          <div className="goal-grid" id="goal-list">
            {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
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
