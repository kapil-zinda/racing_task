"use client";
// Monthly calendar with per-day activity counts + reminder markers. Self-fetches from
// /calendar, optionally scoped to one goal. Namespaced .goalcal-* classes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCalendar } from "../../lib/goalApi";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function CalendarView({ goalId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const load = useCallback(async () => {
    setError("");
    try { setData(await getCalendar(goalId)); } catch (e) { setError(String(e.message || e)); }
  }, [goalId]);
  useEffect(() => { load(); }, [load]);

  const remindersByDate = useMemo(() => {
    const map = {};
    (data?.reminders || []).forEach((r) => {
      const d = (r.time || "").slice(0, 10);
      if (d) (map[d] = map[d] || []).push(r);
    });
    return map;
  }, [data]);

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const lead = first.getDay();
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) {
      const iso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ d, iso, count: (data?.activity_by_date || {})[iso] || 0, reminders: remindersByDate[iso] || [] });
    }
    return out;
  }, [cursor, data, remindersByDate]);

  const shift = (delta) => setCursor((c) => {
    const m = c.m + delta;
    return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="goalcal-bar">
        <button className="goal-btn ghost tiny" onClick={() => shift(-1)}>‹</button>
        <span className="goalcal-month">{MONTHS[cursor.m]} {cursor.y}</span>
        <button className="goal-btn ghost tiny" onClick={() => shift(1)}>›</button>
      </div>
      {error && <div className="goal-error">{error}</div>}
      <div className="goalcal-grid goalcal-head">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="goalcal-dow">{d}</div>)}
      </div>
      <div className="goalcal-grid">
        {cells.map((c, i) => c === null ? <div key={i} className="goalcal-cell empty" />
          : (
            <div key={c.iso} className={`goalcal-cell ${c.iso === todayIso ? "today" : ""} ${c.count ? "active" : ""}`}>
              <span className="goalcal-date">{c.d}</span>
              {c.count > 0 && <span className="goalcal-count">{c.count}</span>}
              {c.reminders.length > 0 && <span className="goalcal-rem" title={`${c.reminders.length} reminder(s)`}>🔔{c.reminders.length}</span>}
            </div>
          ))}
      </div>
    </div>
  );
}
