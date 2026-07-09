"use client";
// "Today's focus" — calm, data-first hero for the goals dashboard. Shows up to six open
// tasks (name + parent goal) with an explicit check button; marking done keeps the row
// for a 5-second "Done · Undo" window before it leaves. Metric-based tasks open a picker
// so you record WHICH thing was done. Right column: streak + average progress.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../Icon";
import { listNodeMetrics, incrementMetric, updateNode } from "../../lib/goalApi";
import styles from "./MindfulHero.module.css";

const MAX_ROWS = 6;
const UNDO_MS = 5000;

export default function MindfulHero({ tasks = [], streak = 0, avgProgress = 0, onChanged }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [picker, setPicker] = useState(null); // { task, metrics }
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pendingDone, setPendingDone] = useState({}); // taskId -> { prevStatus }
  const timers = useRef({});

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const visible = tasks.slice(0, MAX_ROWS);
  const overflow = tasks.length - visible.length;

  const metricComplete = (m) =>
    Number(m.target_value || 0) > 0 && Number(m.current_value || 0) >= Number(m.target_value || 0);

  // After a task is marked done, hold it in a "Done · Undo" state for 5s. Only then do
  // we tell the parent to reload (onChanged), which is what removes the row.
  const startUndoWindow = (task) => {
    setPendingDone((p) => ({ ...p, [task.id]: { prevStatus: task.status || "todo" } }));
    timers.current[task.id] = setTimeout(() => {
      delete timers.current[task.id];
      setPendingDone((p) => {
        const next = { ...p };
        delete next[task.id];
        return next;
      });
      onChanged?.();
    }, UNDO_MS);
  };

  const undo = async (task) => {
    const entry = pendingDone[task.id];
    if (!entry) return;
    clearTimeout(timers.current[task.id]);
    delete timers.current[task.id];
    setPendingDone((p) => {
      const next = { ...p };
      delete next[task.id];
      return next;
    });
    try {
      await updateNode(task.id, { status: entry.prevStatus });
    } finally {
      onChanged?.();
    }
  };

  // A metric-based task opens a picker so you record WHICH thing was done; a plain
  // done/undone task is marked done directly (with the undo window).
  const markDone = async (task) => {
    if (busyId || pendingDone[task.id]) return;
    setBusyId(task.id);
    try {
      let metrics = [];
      try { metrics = (await listNodeMetrics(task.id)).metrics || []; } catch (_) { metrics = []; }
      if (metrics.length) {
        setPicker({ task, metrics });
      } else {
        await updateNode(task.id, { status: "done" });
        startUndoWindow(task);
      }
    } finally {
      setBusyId("");
    }
  };

  const incMetric = async (m) => {
    if (pickerBusy || !picker || metricComplete(m)) return;
    setPickerBusy(true);
    try {
      await incrementMetric(m.id, 1);
      const metrics = (await listNodeMetrics(picker.task.id)).metrics || [];
      onChanged?.();
      const allDone = metrics.length > 0 && metrics.every(metricComplete);
      if (allDone) setPicker(null);
      else setPicker((p) => (p ? { ...p, metrics } : p));
    } finally {
      setPickerBusy(false);
    }
  };

  const markAllDone = async () => {
    if (!picker || pickerBusy) return;
    setPickerBusy(true);
    try {
      await updateNode(picker.task.id, { status: "done" });
      startUndoWindow(picker.task);
      setPicker(null);
    } finally {
      setPickerBusy(false);
    }
  };

  return (
    <section className={styles.hero} aria-label="Today's focus">
      <div>
        <h2 className={styles.heading}>Today&rsquo;s focus</h2>
        <p className={styles.sub}>
          {tasks.length === 0
            ? "Nothing left open today."
            : `${tasks.length} open task${tasks.length > 1 ? "s" : ""}`}
        </p>

        {tasks.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Icon name="check-circle" size={20} /></span>
            <span>
              <span className={styles.emptyTitle}>All clear.</span>
              Tasks you add to your goals show up here each day.
            </span>
          </div>
        ) : (
          <ul className={styles.list} aria-live="polite">
            {visible.map((t) => {
              const pending = pendingDone[t.id];
              return (
                <li key={t.id} className={styles.row}>
                  {pending ? (
                    <>
                      <span className={styles.doneMark}><Icon name="check-circle" size={18} /></span>
                      <span className={styles.doneTitle}>{t.title}</span>
                      <span className={styles.doneActions}>
                        Done <span aria-hidden="true">·</span>
                        <button className={styles.undoBtn} onClick={() => undo(t)}>Undo</button>
                      </span>
                    </>
                  ) : (
                    <>
                      {onChanged && (
                        <button
                          className={styles.check}
                          aria-label={`Mark "${t.title}" done`}
                          title="Mark done"
                          disabled={busyId === t.id}
                          onClick={() => markDone(t)}
                        >
                          <Icon name="check" size={14} />
                        </button>
                      )}
                      <button className={styles.rowBody} onClick={() => router.push(`/goals/${t.goal_id}`)}>
                        <span className={styles.rowTitle}>{t.title}</span>
                        <span className={styles.rowMeta}>
                          <Icon name={t.goal_icon || "target"} size={12} />
                          {t.goal_name}{t.parent_title ? ` › ${t.parent_title}` : ""}
                        </span>
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {overflow > 0 && (
          <a className={styles.more} href="#goal-list">+{overflow} more in your goals</a>
        )}
      </div>

      <aside className={styles.stats}>
        <div className={styles.stat}>
          <span className={`display-num ${styles.statNumGold}`}>{streak}</span>
          <span className={styles.statLbl}>day streak</span>
        </div>
        <div className={styles.stat}>
          <span className={`display-num ${styles.statNum}`}>{Math.round(avgProgress)}%</span>
          <span className={styles.statLbl}>avg progress</span>
        </div>
      </aside>

      {picker && (
        <div className="task-modal-overlay" onClick={() => !pickerBusy && setPicker(null)}>
          <div className="task-modal mh-metric-modal" onClick={(e) => e.stopPropagation()}>
            <h3>What did you complete?</h3>
            <p className="mh-metric-sub">{picker.task.title}</p>
            <div className="mh-metric-list">
              {picker.metrics.map((m) => {
                const done = metricComplete(m);
                return (
                  <button key={m.id} className={`mh-metric-item${done ? " done" : ""}`}
                          disabled={done || pickerBusy} onClick={() => incMetric(m)}>
                    <span className="mh-metric-name">
                      <Icon name={done ? "check-circle" : "circle"} size={16} /> {m.name}
                    </span>
                    <span className="mh-metric-count">
                      {Number(m.current_value || 0)}/{Number(m.target_value || 0)}{m.unit ? ` ${m.unit}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setPicker(null)} disabled={pickerBusy}>Close</button>
              <button className="btn-new" onClick={markAllDone} disabled={pickerBusy}>Mark all done</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
