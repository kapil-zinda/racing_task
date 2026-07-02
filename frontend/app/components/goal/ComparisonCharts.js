"use client";
// Comparison charts: today vs yesterday (bar) and this-week vs last-week (line).

import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const DARK = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#c7cede" }, margin: { t: 20, r: 10, b: 30, l: 30 },
};

export default function ComparisonCharts({ today = 0, yesterday = 0, thisWeek = [], lastWeek = [] }) {
  const labels = thisWeek.map((d) => d.label);
  return (
    <div className="chart-grid">
      <div className="chart-card">
        <h4>Yesterday vs Today</h4>
        <Plot
          data={[{ type: "bar", x: ["Yesterday", "Today"], y: [yesterday, today],
            marker: { color: ["#8b95a7", "#6366f1"] }, text: [yesterday, today], textposition: "auto" }]}
          layout={{ ...DARK, height: 220 }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
      </div>
      <div className="chart-card">
        <h4>This week vs Last week</h4>
        <Plot
          data={[
            { type: "scatter", mode: "lines+markers", name: "Last week", x: labels, y: lastWeek.map((d) => d.count),
              line: { color: "#8b95a7", dash: "dot" } },
            { type: "scatter", mode: "lines+markers", name: "This week", x: labels, y: thisWeek.map((d) => d.count),
              line: { color: "#10b981" } },
          ]}
          layout={{ ...DARK, height: 220, showlegend: true, legend: { orientation: "h", y: 1.15, font: { size: 10 } } }}
          config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
      </div>
    </div>
  );
}
