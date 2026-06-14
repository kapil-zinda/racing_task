"use client";

const KIND_LABELS = {
  course: "Course",
  book: "Book",
  random: "Random Topic",
  test: "Test Set",
};

function pct(done, total) {
  if (!total) return 0;
  return Math.round((Math.max(0, done) / total) * 100);
}

export default function DimensionProgressGrid({ dimensions }) {
  if (!dimensions.length) {
    return <p className="day-state">No plan items yet. Add courses, books, or tests in Journey to see progress here.</p>;
  }

  return (
    <div className="progress-card-grid">
      {dimensions.map((dim) => {
        const coverage = pct(dim.coverageDone, dim.coverageTotal);
        const retention = pct(dim.retentionDone, dim.retentionTotal);
        const performance = pct(dim.performanceDone, dim.performanceTotal);
        return (
          <article key={dim.key} className="progress-card">
            <div className="progress-card-head">
              <span className={`progress-card-kind kind-${dim.kind}`}>{KIND_LABELS[dim.kind] || dim.kind}</span>
              <h4>{dim.label}</h4>
            </div>
            <div className="progress-card-bars">
              <div className="progress-card-row">
                <span>Coverage</span>
                <div className="progress-track"><div className="progress-fill coverage" style={{ width: `${coverage}%` }} /></div>
                <strong>{coverage}%</strong>
              </div>
              <div className="progress-card-row">
                <span>Retention</span>
                <div className="progress-track"><div className="progress-fill retention" style={{ width: `${retention}%` }} /></div>
                <strong>{retention}%</strong>
              </div>
              <div className="progress-card-row">
                <span>Performance</span>
                <div className="progress-track"><div className="progress-fill performance" style={{ width: `${performance}%` }} /></div>
                <strong>{performance}%</strong>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
