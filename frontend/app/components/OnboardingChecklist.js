"use client";
// "Get set up" checklist for new users on /home. Three steps that link into the
// core features; each step can be marked done (persisted in localStorage), and
// the whole card disappears once every step is done or the user skips setup.

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import styles from "../home/page.module.css";

const STORAGE_KEY = "dias_onboarding_v1";

const STEPS = [
  {
    id: "interview",
    href: "/interview",
    title: "Sit your free AI mock interview",
    desc: "A board-style interview built on your own DAF.",
  },
  {
    id: "answer_eval",
    href: "/answer-eval",
    title: "Get one answer evaluated",
    desc: "Upload a written answer and get examiner-style marking.",
  },
  {
    id: "content",
    href: "/content",
    title: "Upload notes & ask a question",
    desc: "Build your library, then query it directly.",
  },
];

function readState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

export default function OnboardingChecklist() {
  // null until localStorage is read (client-only) so dismissed users never see a flash.
  const [doneMap, setDoneMap] = useState(null);

  useEffect(() => {
    setDoneMap(readState());
  }, []);

  if (!doneMap) return null;
  if (STEPS.every((s) => doneMap[s.id])) return null;

  const persist = (next) => {
    setDoneMap(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {}
  };

  const markDone = (id) => persist({ ...doneMap, [id]: true });
  const skipAll = () =>
    persist(STEPS.reduce((acc, s) => ({ ...acc, [s.id]: true }), { ...doneMap }));

  const doneCount = STEPS.filter((s) => doneMap[s.id]).length;

  return (
    <section className={styles.onboardCard} aria-label="Get set up">
      <div className={styles.onboardHead}>
        <div>
          <h2 className={styles.onboardTitle}>Get set up</h2>
          <p className={styles.onboardSub}>
            Three short steps to see how this works.
            {doneCount > 0 ? ` ${doneCount} of ${STEPS.length} done.` : ""}
          </p>
        </div>
        <button className={styles.onboardSkip} onClick={skipAll}>
          Skip setup
        </button>
      </div>
      <ol className={styles.onboardSteps}>
        {STEPS.map((step, i) => {
          const done = !!doneMap[step.id];
          return (
            <li key={step.id} className={done ? styles.stepDone : styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                {done ? <Icon name="check" size={15} /> : i + 1}
              </span>
              {done ? (
                <span className={styles.stepBody}>
                  <span className={styles.stepTitle}>{step.title}</span>
                </span>
              ) : (
                <>
                  <Link href={step.href} className={styles.stepBody}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={styles.stepDesc}>{step.desc}</span>
                  </Link>
                  <button
                    className={styles.stepDoneBtn}
                    onClick={() => markDone(step.id)}
                    aria-label={`Mark "${step.title}" as done`}
                    title="Mark done"
                  >
                    <Icon name="check" size={16} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
