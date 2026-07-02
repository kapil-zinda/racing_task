"use client";
// GitHub-style contribution heatmap from an { "YYYY-MM-DD": count } map. Pure CSS grid:
// 7 rows (Sun–Sat) × ~26 week columns, colour by activity intensity.

function level(count, max) {
  if (!count) return 0;
  const r = count / (max || 1);
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

export default function ContributionHeatmap({ activity = {}, weeks = 26 }) {
  const today = new Date();
  const max = Math.max(1, ...Object.values(activity));
  // Start on the Sunday `weeks` weeks ago.
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7 - today.getDay());

  const cols = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks + 1; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const iso = cursor.toISOString().slice(0, 10);
      const count = activity[iso] || 0;
      col.push({ iso, count, lvl: cursor <= today ? level(count, max) : -1 });
      cursor.setDate(cursor.getDate() + 1);
    }
    cols.push(col);
  }

  return (
    <div className="heatmap">
      <div className="heatmap-grid">
        {cols.map((col, i) => (
          <div key={i} className="heatmap-col">
            {col.map((cell) => (
              <span key={cell.iso} className={`heatmap-cell lvl-${cell.lvl}`}
                    title={cell.lvl >= 0 ? `${cell.iso}: ${cell.count} action${cell.count === 1 ? "" : "s"}` : ""} />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        <span className="heatmap-cell lvl-0" /><span className="heatmap-cell lvl-1" />
        <span className="heatmap-cell lvl-2" /><span className="heatmap-cell lvl-3" /><span className="heatmap-cell lvl-4" />
        <span>More</span>
      </div>
    </div>
  );
}
