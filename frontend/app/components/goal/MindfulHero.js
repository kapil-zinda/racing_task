"use client";
// "Free your mind" hero: a figure seated in dhyan mudra. Today's outstanding tasks float
// above as thought-clouds; as you clear them the mind empties toward calm. Clicking a
// cloud jumps to its goal. Zero pending tasks → a serene, cloud-free "at peace" state.

import { useRouter } from "next/navigation";

export default function MindfulHero({ tasks = [], streak = 0, avgProgress = 0 }) {
  const router = useRouter();
  const clear = tasks.length === 0;
  // Spread clouds across arc positions above the head.
  const positions = [
    { top: "6%", left: "12%" }, { top: "0%", left: "40%" }, { top: "5%", left: "68%" },
    { top: "26%", left: "4%" }, { top: "22%", left: "80%" }, { top: "42%", left: "10%" },
    { top: "40%", left: "76%" }, { top: "16%", left: "56%" }, { top: "30%", left: "30%" },
    { top: "12%", left: "26%" }, { top: "34%", left: "60%" }, { top: "48%", left: "44%" },
  ];

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
          <span>🔥 {streak}-day streak</span>
          <span>◍ {Math.round(avgProgress)}% avg progress</span>
        </div>
      </div>

      <div className="mindful-stage">
        {/* Thought clouds */}
        {tasks.map((t, i) => {
          const pos = positions[i % positions.length];
          return (
            <button key={t.id} className="thought-cloud" style={{ ...pos, animationDelay: `${(i % 6) * 0.6}s` }}
                    title={`${t.goal_name}${t.parent_title ? ` › ${t.parent_title}` : ""} › ${t.title} — ${t.progress}%`}
                    onClick={() => router.push(`/goals/${t.goal_id}`)}>
              <span className="thought-cloud-icon">{t.goal_icon}</span>
              <span className="thought-cloud-text">
                {t.parent_title && <span className="thought-cloud-parent">{t.parent_title} › </span>}
                {t.title}
              </span>
            </button>
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
    </section>
  );
}
