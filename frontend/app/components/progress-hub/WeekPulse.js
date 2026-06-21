"use client";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function WeekPulse({ weekPulse }) {
  const days = Array.isArray(weekPulse?.days) ? weekPulse.days : [];
  const max = Math.max(1, ...days.map((d) => d.total));
  const delta = weekPulse?.deltaPct ?? 0;
  const trendArrow = delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const trendCls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <article className="hub-card hub-week-pulse">
      <div className="hub-card-head">
        <h3>This Week</h3>
        <span className={`hub-trend hub-trend-${trendCls}`}>
          {trendArrow} {Math.abs(delta)}% vs last week
        </span>
      </div>
      <div className="week-pulse-bars">
        {days.map((d) => {
          const h = d.total > 0 ? Math.max(10, Math.round((d.total / max) * 100)) : 4;
          return (
            <div key={d.date} className="week-pulse-col">
              <div className="week-pulse-track">
                <div className="week-pulse-bar" style={{ height: `${h}%` }} title={`${d.date}: ${d.total}`} />
              </div>
              <span className="week-pulse-day">{DAY_LABELS[d.dow]}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
