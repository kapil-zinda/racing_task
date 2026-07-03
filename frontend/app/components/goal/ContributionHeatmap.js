"use client";
// Month-wise activity heatmap. Shows one month at a time (navigable like the day
// tracker), sized to its content so it never stretches across the row — the leftover
// space holds a study-motivation animation.

import { useMemo, useState } from "react";
import Icon from "../Icon";
import { toIsoDate } from "../../lib/dateUtils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function level(count, max) {
  if (!count) return 0;
  const r = count / (max || 1);
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

function StudyClimb() {
  // Pure-CSS scene: a book hopping up steps toward a star — "keep climbing".
  return (
    <div className="climb-scene" aria-hidden="true">
      <div className="climb-stairs">
        <span className="climb-step s1" />
        <span className="climb-step s2" />
        <span className="climb-step s3" />
        <span className="climb-step s4" />
      </div>
      <div className="climb-star"><Icon name="sparkles" size={22} /></div>
      <div className="climb-book">
        <div className="climb-book-body">
          <span className="climb-book-page" />
          <span className="climb-book-page" />
        </div>
        <span className="climb-book-leg l" />
        <span className="climb-book-leg r" />
      </div>
    </div>
  );
}

const QUOTES = [
  "Small steps, every day.",
  "One page more than yesterday.",
  "Consistency beats intensity.",
  "Keep climbing — the summit is closer.",
];

export default function ContributionHeatmap({ activity = {} }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const max = useMemo(() => Math.max(1, ...Object.values(activity)), [activity]);
  const today = new Date();
  const todayIso = toIsoDate(today);

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const lead = first.getDay();
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) {
      const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const count = activity[iso] || 0;
      out.push({ d, iso, count, lvl: level(count, max) });
    }
    return out;
  }, [cursor, activity, max]);

  const shift = (delta) => setCursor((c) => {
    const m = c.m + delta;
    return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });

  const monthTotal = cells.reduce((s, c) => s + (c ? c.count : 0), 0);
  const quote = QUOTES[cursor.m % QUOTES.length];

  return (
    <div className="activity-panel">
      <div className="heatmap-card">
        <div className="heatmap-head">
          <button className="dt-nav-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevron-left" size={16} /></button>
          <span className="heatmap-month-label">{MONTHS[cursor.m]} {cursor.y}</span>
          <button className="dt-nav-btn" onClick={() => shift(1)} aria-label="Next month"><Icon name="chevron-right" size={16} /></button>
        </div>
        <div className="heatmap-month-grid heatmap-month-head">
          {DOW.map((d, i) => <span key={i} className="heatmap-dow">{d}</span>)}
        </div>
        <div className="heatmap-month-grid">
          {cells.map((c, i) => c === null
            ? <span key={i} className="heatmap-mcell empty" />
            : <span key={c.iso} className={`heatmap-mcell lvl-${c.lvl}${c.iso === todayIso ? " today" : ""}`}
                    title={`${c.iso}: ${c.count} action${c.count === 1 ? "" : "s"}`}>{c.d}</span>)}
        </div>
        <div className="heatmap-foot">
          <span>{monthTotal} action{monthTotal === 1 ? "" : "s"} this month</span>
          <span className="heatmap-legend-inline">
            <span>Less</span>
            <span className="heatmap-cell lvl-0" /><span className="heatmap-cell lvl-1" />
            <span className="heatmap-cell lvl-2" /><span className="heatmap-cell lvl-3" /><span className="heatmap-cell lvl-4" />
            <span>More</span>
          </span>
        </div>
      </div>

      <div className="motivation-card">
        <StudyClimb />
        <p className="motivation-text">{quote}</p>
      </div>
    </div>
  );
}
