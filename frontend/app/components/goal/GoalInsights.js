"use client";
// Goal insights panel: forecast, weekly review, and today's plan — computed on demand.

import { useCallback, useEffect, useState } from "react";
import { forecast, weeklyReview, dailyPlan } from "../../lib/goalApi";
import Icon from "../Icon";

export default function GoalInsights({ goalId, onJump }) {
  const [fc, setFc] = useState(null);
  const [rv, setRv] = useState(null);
  const [plan, setPlan] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [f, r, p] = await Promise.all([forecast(goalId), weeklyReview(goalId), dailyPlan(goalId, 5)]);
      setFc(f); setRv(r); setPlan(p.plan || []);
    } catch (e) { setErr(String(e.message || e)); }
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="insights">
      <div className="insights-head"><h3>Insights</h3><button className="goal-btn ghost tiny" onClick={load}><Icon name="refresh" /></button></div>
      {err && <div className="goal-error">{err}</div>}

      <div className="insight-card">
        <span className="insight-label">Forecast</span>
        <span className="insight-main">{fc ? (fc.projected_days_remaining != null ? `~${fc.projected_days_remaining} days left` : "—") : "…"}</span>
        <span className="insight-sub">{fc?.message}</span>
      </div>

      <div className="insight-card">
        <span className="insight-label">This week</span>
        <span className="insight-main">{rv ? `${rv.actions_this_week} actions` : "…"}</span>
        <span className="insight-sub">
          {rv ? `${rv.completed_count} done · ${rv.in_progress_count} in progress · ${rv.stale_count} stale` : ""}
        </span>
        {rv?.suggestions?.[0] && <span className="insight-sub tip"><Icon name="idea" /> {rv.suggestions[0]}</span>}
      </div>

      <div className="insight-card">
        <span className="insight-label">Today's plan</span>
        {plan.length === 0 ? <span className="insight-sub">All caught up <Icon name="party" /></span> : (
          <ul className="insight-plan">
            {plan.map((p) => (
              <li key={p.id}>
                <button className="insight-plan-item" onClick={() => onJump && onJump(p.id)}>
                  <span className={`tree-status-dot s-${p.status}`} /> {p.title}
                  <span className="insight-plan-pct">{p.progress}%</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
