"use client";

export default function GrowthStoryPanel({ mission }) {
  const identityCurrent = [
    mission.momentum.cls === "falling" ? "Irregular momentum" : "Momentum improving",
    mission.reviewRate < 50 ? "Weak test review loop" : "Tests are being reviewed",
    mission.revisionDebt > 20 ? "Revision debt growing" : "Revision debt controlled",
    mission.csatSafety === "Unsafe" ? "Test execution risk is high" : "Test execution trend is manageable",
  ];
  const identityTarget = [
    "Revises cyclically",
    "Attempts tests regularly",
    "Tracks and closes mistakes",
    "Protects completion safety buffer",
  ];

  return (
    <>
      <article className="milestone-panel">
        <h2>Identity Reflection</h2>
        <p className="day-state">How different are you from the version of you that hits this goal?</p>
        <div className="identity-grid">
          <div>
            <h4>Current You</h4>
            <ul>
              {identityCurrent.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <h4>Target You</h4>
            <ul>
              {identityTarget.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
        <p className="identity-delta">{mission.identityDelta}</p>
      </article>

      <article className="milestone-panel">
        <h2>Weekly Trajectory</h2>
        <div className="trajectory-status">{mission.trajectory}</div>
        <div className="trajectory-cols">
          <div>
            <h4>What Improved</h4>
            <ul>
              {(mission.improved.length ? mission.improved : ["No clear improvement this week"]).map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
          <div>
            <h4>What Worsened</h4>
            <ul>
              {(mission.worsened.length ? mission.worsened : ["No major decline this week"]).map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
          <div>
            <h4>One Correction</h4>
            <p>
              {mission.worsened.includes("Revision discipline")
                ? "Lock 2 fixed revision blocks daily before new study."
                : mission.worsened.includes("Practice pressure")
                  ? "Add one timed recall/test block every day for 14 days."
                  : "Keep the current tempo and protect review backlog at zero."}
            </p>
          </div>
        </div>
      </article>

      <article className="milestone-panel projection-panel">
        <h2>14-Day Projection</h2>
        <p className="day-state">What happens if you continue like this?</p>
        <ul>
          <li>Likely readiness after 14 days: <strong>{Math.min(100, mission.readiness + (mission.momentum.cls === "rising" ? 8 : mission.momentum.cls === "stable" ? 3 : -5))}</strong></li>
          <li>Topics entering forgetting zone: <strong>{mission.timeline.filter((t) => t.zone === "red").length}</strong></li>
          <li>Expected revision debt drift: <strong>{mission.momentum.cls === "falling" ? "+6 topics" : mission.momentum.cls === "stable" ? "+2 topics" : "-3 topics"}</strong></li>
          <li>Mock readiness outlook: <strong>{mission.testsAttempted >= 8 ? "Recoverable" : "At risk"}</strong></li>
        </ul>
      </article>
    </>
  );
}
