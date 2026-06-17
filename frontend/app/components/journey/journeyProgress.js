// Helpers for the Progress Hub "Updates" tab — turning a leaf node's effective
// counters into individual occurrences and computing completion progress.

// Stable lookup key for a single occurrence of a custom entry on a leaf node.
export function progressKey(nodeId, counterKey, occurrence) {
  return `${nodeId}::${counterKey}::${occurrence}`;
}

// Flatten effective counters (e.g. [{key:"Revision", count:4}]) into a flat list
// of occurrences: [{ key:"Revision", occurrence:1, count:4 }, ...].
export function flattenOccurrences(effectiveCounters) {
  const out = [];
  (effectiveCounters || []).forEach((c) => {
    const count = Math.max(0, Number(c?.count) || 0);
    for (let i = 1; i <= count; i += 1) {
      out.push({ key: c.key, occurrence: i, count });
    }
  });
  return out;
}

// Summarize each custom entry (counter key) for a leaf node as a single row.
// Occurrences are completed sequentially, so we only expose the next one to
// complete and the last one to undo rather than listing every occurrence.
// Returns [{ key, count, completed, nextToComplete, lastToUndo }].
export function counterSummaries(nodeId, effectiveCounters, doneSet) {
  return (effectiveCounters || []).map((c) => {
    const count = Math.max(0, Number(c?.count) || 0);
    let completed = 0;
    let nextToComplete = null;
    let lastToUndo = null;
    for (let i = 1; i <= count; i += 1) {
      const isDone = doneSet && doneSet.has(progressKey(nodeId, c.key, i));
      if (isDone) {
        completed += 1;
        lastToUndo = i;
      } else if (nextToComplete === null) {
        nextToComplete = i;
      }
    }
    return { key: c.key, count, completed, nextToComplete, lastToUndo };
  });
}

// Compute { completed, total, pct } for a leaf node given its effective counters
// and the Set of done occurrence keys.
export function leafProgress(nodeId, effectiveCounters, doneSet) {
  const occurrences = flattenOccurrences(effectiveCounters);
  const total = occurrences.length;
  let completed = 0;
  occurrences.forEach((o) => {
    if (doneSet && doneSet.has(progressKey(nodeId, o.key, o.occurrence))) completed += 1;
  });
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, pct };
}

// Build a Set of done occurrence keys from a backend completions array.
export function buildDoneSet(completions) {
  const set = new Set();
  (completions || []).forEach((c) => {
    if (!c) return;
    set.add(progressKey(c.node_id, c.counter_key, c.occurrence));
  });
  return set;
}
