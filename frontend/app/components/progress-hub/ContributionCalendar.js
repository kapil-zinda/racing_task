"use client";

import { buildContributionCalendar, heatLevelFor } from "../../lib/journeyInsights";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export default function ContributionCalendar({ activityByDate, weeks = 14, streaks }) {
  const columns = buildContributionCalendar(activityByDate, weeks);

  let lastMonth = -1;
  const monthMarks = columns.map((col) => {
    const month = col[0]?.month;
    const isNew = month !== lastMonth;
    if (isNew) lastMonth = month;
    return isNew ? MONTH_LABELS[month] : "";
  });

  return (
    <article className="hub-card hub-calendar">
      <div className="hub-card-head">
        <h3>Consistency</h3>
        <span className="hub-streak-inline">
          🔥 {streaks?.current || 0}-day streak · best {streaks?.longest || 0}
        </span>
      </div>
      <div className="cal-scroll">
        <div className="cal-grid-wrap">
          <div className="cal-months">
            {monthMarks.map((m, i) => (
              <span key={i} className="cal-month">{m}</span>
            ))}
          </div>
          <div className="cal-body">
            <div className="cal-dow-labels">
              {DOW_LABELS.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
            <div className="cal-grid">
              {columns.map((col, ci) => (
                <div key={ci} className="cal-col">
                  {col.map((cell) => (
                    <span
                      key={cell.date}
                      className={`cal-cell level-${heatLevelFor(cell.total)}`}
                      title={cell.total === null ? "" : `${cell.date}: ${cell.total} activities`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="cal-legend">
        <span>Less</span>
        <span className="cal-cell level-0" />
        <span className="cal-cell level-1" />
        <span className="cal-cell level-2" />
        <span className="cal-cell level-3" />
        <span className="cal-cell level-4" />
        <span>More</span>
      </div>
    </article>
  );
}
