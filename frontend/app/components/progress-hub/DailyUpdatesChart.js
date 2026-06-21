"use client";

import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function DailyUpdatesChart({ series }) {
  const dates = Array.isArray(series?.dates) ? series.dates : [];
  const counts = Array.isArray(series?.counts) ? series.counts : [];
  const hasData = counts.some((c) => c > 0);

  return (
    <article className="hub-card hub-daily-updates">
      <div className="hub-card-head">
        <h3>Daily Updates</h3>
        <span className="day-state">Leaf nodes updated each day</span>
      </div>
      {hasData ? (
        <Plot
          data={[
            {
              x: dates,
              y: counts,
              type: "scatter",
              mode: "lines",
              line: { color: "#5fdc8c", width: 2, shape: "spline" },
              fill: "tozeroy",
              fillcolor: "rgba(95, 220, 140, 0.12)",
              hovertemplate: "%{x|%d %b %Y}<br>%{y} node(s)<extra></extra>",
            },
          ]}
          layout={{
            autosize: true,
            height: 240,
            margin: { l: 32, r: 12, t: 10, b: 36 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: { color: "rgba(255,255,255,0.7)", size: 11 },
            xaxis: {
              type: "date",
              gridcolor: "rgba(255,255,255,0.06)",
              zeroline: false,
              tickformat: "%d %b",
            },
            yaxis: {
              rangemode: "tozero",
              gridcolor: "rgba(255,255,255,0.06)",
              zeroline: false,
              dtick: 1,
              tickformat: "d",
            },
            showlegend: false,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
          useResizeHandler
        />
      ) : (
        <p className="day-state">No updates recorded yet — your activity will chart here.</p>
      )}
    </article>
  );
}
