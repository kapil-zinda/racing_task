"use client";
// "Free your mind" hero: a figure seated in dhyan mudra. Today's outstanding tasks float
// above as thought-clouds; as you clear them the mind empties toward calm. Clicking a
// cloud jumps to its goal. Zero pending tasks → a serene, cloud-free "at peace" state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../Icon";
import { listNodeMetrics, incrementMetric, updateNode } from "../../lib/goalApi";

export default function MindfulHero({ tasks = [], streak = 0, avgProgress = 0, onChanged }) {
  const router = useRouter();
  const clear = tasks.length === 0;
  const [busyId, setBusyId] = useState("");
  const [picker, setPicker] = useState(null); // { task, metrics }
  const [pickerBusy, setPickerBusy] = useState(false);

  // Spread clouds across arc positions above the head.
  const positions = [
    { top: "6%", left: "12%" }, { top: "0%", left: "40%" }, { top: "5%", left: "68%" },
    { top: "26%", left: "4%" }, { top: "22%", left: "80%" }, { top: "42%", left: "10%" },
    { top: "40%", left: "76%" }, { top: "16%", left: "56%" }, { top: "30%", left: "30%" },
    { top: "12%", left: "26%" }, { top: "34%", left: "60%" }, { top: "48%", left: "44%" },
  ];

  const metricComplete = (m) => Number(m.target_value || 0) > 0 && Number(m.current_value || 0) >= Number(m.target_value || 0);

  // Tick behaviour depends on how the node measures progress: a metric-based node opens a
  // picker so you record WHICH thing was done (class / notes / a revision); a plain
  // done/undone node just gets marked done.
  const onTick = async (task, e) => {
    e.stopPropagation();
    if (busyId) return;
    setBusyId(task.id);
    try {
      let metrics = [];
      try { metrics = (await listNodeMetrics(task.id)).metrics || []; } catch (_) { metrics = []; }
      if (metrics.length) {
        setPicker({ task, metrics });
      } else {
        await updateNode(task.id, { status: "done" });
        onChanged?.();
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
      onChanged?.();
      setPicker(null);
    } finally {
      setPickerBusy(false);
    }
  };

  return (
    <section className={`mindful ${clear ? "is-clear" : ""}`}>
      <div className="mindful-copy">
        <h2>{clear ? "Mind clear" : "Free your mind"}</h2>
        <p>
          {clear
            ? "No tasks weighing on you. Breathe, and rest in the calm you've earned."
            : `${tasks.length} thought${tasks.length > 1 ? "s" : ""} to release today. Complete them and return to peace.`}
        </p>
        <div className="mindful-meta">
          <span><Icon name="fire" size={15} /> {streak}-day streak</span>
          <span><Icon name="target" size={15} /> {Math.round(avgProgress)}% avg progress</span>
        </div>
      </div>

      <div className="mindful-stage">
        {/* Thought clouds */}
        {tasks.map((t, i) => {
          const pos = positions[i % positions.length];
          return (
            <div key={t.id} className="thought-cloud" style={{ ...pos, animationDelay: `${(i % 6) * 0.6}s` }}
                 title={`${t.goal_name}${t.parent_title ? ` › ${t.parent_title}` : ""} › ${t.title} — ${t.progress}%`}>
              {onChanged && (
                <button className="thought-cloud-done" title="Mark done"
                        disabled={busyId === t.id}
                        onClick={(e) => onTick(t, e)}>
                  <Icon name="check" size={13} />
                </button>
              )}
              <button className="thought-cloud-open" onClick={() => router.push(`/goals/${t.goal_id}`)}>
                <span className="thought-cloud-icon"><Icon name={t.goal_icon} size={13} /></span>
                <span className="thought-cloud-text">
                  {t.parent_title && <span className="thought-cloud-parent">{t.parent_title} › </span>}
                  {t.title}
                </span>
              </button>
            </div>
          );
        })}

        {/* Meditating figure in dhyan mudra */}
        <svg className="meditator" viewBox="0 0 200 180" width="180" height="162" aria-hidden="true">
          <ellipse cx="100" cy="168" rx="72" ry="10" className="med-shadow" />
          {/* aura */}
          <circle cx="100" cy="70" r="52" className="med-aura" />
          {/* crossed legs base */}
          <path d="M40 150 Q100 118 160 150 Q140 164 100 164 Q60 164 40 150 Z" className="med-body" />
          {/* torso */}
          <path d="M76 150 Q72 96 100 90 Q128 96 124 150 Z" className="med-body" />
          {/* arms resting to lap (mudra) */}
          <path d="M78 120 Q64 138 88 146 Q100 150 112 146 Q136 138 122 120 Q100 132 78 120 Z" className="med-body-2" />
          {/* neck + head */}
          <rect x="94" y="72" width="12" height="16" rx="5" className="med-body" />
          <circle cx="100" cy="60" r="18" className="med-head" />
          {/* serene face */}
          <path d="M92 60 Q94 63 96 60" className="med-face" fill="none" />
          <path d="M104 60 Q106 63 108 60" className="med-face" fill="none" />
          <path d="M94 68 Q100 71 106 68" className="med-face" fill="none" />
          {/* dot / third eye */}
          <circle cx="100" cy="52" r="1.8" className="med-bindi" />
        </svg>
        {clear && <div className="mindful-glow" aria-hidden="true" />}
      </div>

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
