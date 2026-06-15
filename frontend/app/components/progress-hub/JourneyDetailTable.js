"use client";

import { ensureNodeIds, getEffectiveCounters } from "../journey/journeyTreeOps";
import { buildDoneSet, leafProgress } from "../journey/journeyProgress";

// Walk a normalized journey tree and collect every leaf node (a task) along with
// its ancestors in root->parent order.
function collectLeafTasks(nodes, ancestors = [], out = []) {
  (nodes || []).forEach((node) => {
    const children = node?.children || [];
    if (children.length === 0) {
      out.push({ leaf: node, ancestors });
    } else {
      collectLeafTasks(children, [...ancestors, node], out);
    }
  });
  return out;
}

// Earliest / latest updated_at across a leaf node's completion records.
function completionDates(nodeId, completions) {
  const dates = (completions || [])
    .filter((c) => c && c.node_id === nodeId && c.updated_at)
    .map((c) => String(c.updated_at).slice(0, 10))
    .sort();
  if (dates.length === 0) return { first: "-", last: "-" };
  return { first: dates[0], last: dates[dates.length - 1] };
}

function JourneySection({ journey, completions }) {
  const structure = ensureNodeIds(journey?.plan?.structure || []);
  const tasks = collectLeafTasks(structure);
  const doneSet = buildDoneSet(completions);

  return (
    <details className="syllabus-exam" open>
      <summary>{journey?.title || "Untitled Journey"}</summary>
      <div className="syllabus-table-wrap">
        <table className="syllabus-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Directory</th>
              <th>First Completion Date</th>
              <th>Last Completion Date</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={4}>No tasks yet.</td>
              </tr>
            ) : (
              tasks.map(({ leaf, ancestors }) => {
                const effectiveCounters = getEffectiveCounters(leaf, ancestors);
                const { completed, total } = leafProgress(leaf.id, effectiveCounters, doneSet);
                const path = ancestors.map((a) => a.label).filter(Boolean).join(" ▸ ") || "—";
                const { first, last } = completionDates(leaf.id, completions);
                return (
                  <tr key={leaf.id}>
                    <td>{leaf.label || "—"}</td>
                    <td>
                      {path} <span className="journey-task-progress">{completed}/{total}</span>
                    </td>
                    <td>{first}</td>
                    <td>{last}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function JourneyDetailTable({ journeys, progressByJourney }) {
  const list = Array.isArray(journeys) ? journeys : [];

  if (list.length === 0) {
    return <p className="day-state">No journeys yet.</p>;
  }

  return (
    <div className="syllabus-tree">
      {list.map((journey) => (
        <JourneySection
          key={journey.id}
          journey={journey}
          completions={(progressByJourney || {})[journey.id] || []}
        />
      ))}
    </div>
  );
}
