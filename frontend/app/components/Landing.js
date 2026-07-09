"use client";
// Public marketing / explainer page shown to signed-out and first-time visitors.
// Signed-in users are bounced to the app. CTAs route to signup / signin.

import Link from "next/link";
import Icon from "./Icon";
import { useAuth } from "../lib/auth";
import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";
import styles from "./Landing.module.css";

const BOARD_SEATS = [
  { role: "Chairman", chair: true },
  { role: "Member 1" },
  { role: "Member 2" },
  { role: "Member 3" },
  { role: "Member 4" },
];

const ALSO_INSIDE = ["study recorder", "goal tracker", "day tracker", "mind maps", "analytics"];

const STEPS = [
  { n: "1", title: "Create your account", desc: "Sign up with your email and verify with a one-time code. You're in within a minute." },
  { n: "2", title: "Bring in your material", desc: "Upload your notes as PDFs and fill in your DAF — the board interviews you on your own background, and answers come from your own material." },
  { n: "3", title: "Study smarter", desc: "Search, ask, self-evaluate, and track — with an AI study buddy alongside you." },
];

export default function LandingPage() {
  const { auth } = useAuth();
  const signedIn = !!auth;

  return (
    <main className="lp">
      <div className="lp-bg" aria-hidden="true" />

      <PublicNav />

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-pill"><Icon name="sparkles" size={14} /> Your all-in-one UPSC prep workspace</span>
          <h1 className="lp-title">Prepare for UPSC with everything in one place.</h1>
          <p className="lp-sub">
            Record and review study sessions, sit a voice mock interview, get your Mains
            answers evaluated, search your own notes, plan goals, and study alongside an
            AI buddy — all in a single focused workspace.
          </p>
          <div className="lp-cta-row">
            {signedIn ? (
              <Link href="/home" className="lp-btn primary lg">Go to app <Icon name="arrow-right" size={16} /></Link>
            ) : (
              <>
                <Link href="/auth/signup" className="lp-btn primary lg">Get started free <Icon name="arrow-right" size={16} /></Link>
                <Link href="/auth/signin" className="lp-btn ghost lg">I already have an account</Link>
              </>
            )}
          </div>
          {!signedIn && <p className="lp-note">Free to start · No card required</p>}
        </div>

        {/* Interview-board vignette — product-true UI, not a fake screenshot */}
        <div className={styles.heroArt}>
          <div className={styles.board}>
            <p className={styles.boardHead}>
              <span className={styles.boardHeadIcon}><Icon name="gavel" size={16} /></span>
              UPSC Personality Test — Mock Board
            </p>
            <ul className={styles.seats} aria-label="Board members">
              {BOARD_SEATS.map((s) => (
                <li key={s.role} className={`${styles.seat} ${s.chair ? styles.seatChair : ""}`}>
                  <span className={styles.seatAvatar}><Icon name="user" size={18} /></span>
                  <span className={styles.seatRole}>{s.role}</span>
                </li>
              ))}
            </ul>
            <div className={styles.question}>
              <p className={styles.questionWho}>Chairman</p>
              <p className={styles.questionText}>
                &ldquo;Your DAF says you worked in fintech. Why should the state employ you?&rdquo;
              </p>
            </div>
          </div>
          <p className={styles.boardCaption}>A five-voice board interviews you on your own DAF.</p>
        </div>
      </section>

      {/* Feature story */}
      <section className="lp-section">
        <h2 className="lp-h2">Built around the hardest parts of the exam</h2>
        <p className="lp-section-sub">Three tools carry most of the weight. The rest keep your routine honest.</p>
        <div className={styles.storyGrid}>
          <article className={styles.spotlight}>
            <div className={styles.cardTitleRow}>
              <span className={styles.spotlightIcon}><Icon name="gavel" size={20} /></span>
              <h3>Mock Interview</h3>
            </div>
            <p>
              Face a five-member board that has read your DAF — your education, your work,
              your hobbies — and questions you on it by voice, the way the real panel does.
              Members roam across topics, probe once, and move on: no scripts, no turn-taking
              theatre, and no answers fed back to you.
            </p>
            <p className={styles.spotlightNote}>
              Every session ends with a written report scored on the seven official qualities the board assesses.
            </p>
          </article>

          <article className={styles.storyCard}>
            <div className={styles.cardTitleRow}>
              <span className={styles.inlineIcon}><Icon name="file" size={18} /></span>
              <h3>Answer Evaluation</h3>
            </div>
            <p>
              Upload a Mains answer PDF, typed or handwritten. Your PDF comes back with
              red-ink marks and margin comments written on the page itself, plus a score
              for every question it finds.
            </p>
          </article>

          <article className={styles.storyCard}>
            <div className={styles.cardTitleRow}>
              <span className={styles.inlineIcon}><Icon name="chat" size={18} /></span>
              <h3>Ask your own notes</h3>
            </div>
            <p>
              Index your PDFs, then ask questions in plain language. Answers are grounded
              in — and cited from — your own material, not the open internet.
            </p>
          </article>
        </div>

        <p className={styles.alsoRow}>
          <strong>Also inside:</strong>{" "}
          {ALSO_INSIDE.map((item, i) => (
            <span key={item}>
              {i > 0 && <span className={styles.alsoSep} aria-hidden="true">·</span>}
              {item}
            </span>
          ))}
        </p>
      </section>

      {/* Start free */}
      <section className="lp-section">
        <h2 className="lp-h2">Start free</h2>
        <p className="lp-section-sub">Try the tools that matter before you spend anything.</p>
        <div className={styles.pricingPanel}>
          <ul className={styles.pricingList}>
            <li className={styles.pricingItem}>
              <span className={styles.pricingCheck}><Icon name="check" size={16} /></span>
              Your first mock interviews and answer evaluations are free.
            </li>
            <li className={styles.pricingItem}>
              <span className={styles.pricingCheck}><Icon name="check" size={16} /></span>
              After that, get a Pro or Max plan for more — or just top up credits and pay per use.
            </li>
            <li className={styles.pricingItem}>
              <span className={styles.pricingCheck}><Icon name="check" size={16} /></span>
              No card required to get started.
            </li>
          </ul>
          <a href="/pricing" className="lp-btn ghost" style={{ marginTop: 18, display: "inline-flex" }}>
            See full pricing →
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section alt">
        <h2 className="lp-h2">Get going in three steps</h2>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="lp-step">
              <span className="lp-step-num">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <p className={styles.quiet}>Built with working aspirants preparing for the 2026 cycle.</p>

      {/* Closing CTA */}
      <section className="lp-closing">
        <h2>Ready to make every study day count?</h2>
        <p>Join and turn scattered prep into one focused routine.</p>
        {signedIn ? (
          <Link href="/home" className="lp-btn primary lg">Go to app <Icon name="arrow-right" size={16} /></Link>
        ) : (
          <Link href="/auth/signup" className="lp-btn primary lg">Create your free account <Icon name="arrow-right" size={16} /></Link>
        )}
      </section>

      <PublicFooter />
    </main>
  );
}
