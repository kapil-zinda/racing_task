"use client";
// Public marketing / explainer page shown to signed-out and first-time visitors.
// Signed-in users are bounced to the app. CTAs route to signup / signin.

import Link from "next/link";
import Icon from "./Icon";
import { useAuth } from "../lib/auth";

const FEATURES = [
  { icon: "mic", title: "Study Recorder", desc: "Record audio, video, or screen sessions that upload as you go — a dropped connection or closed tab never loses your work." },
  { icon: "gavel", title: "Mock Interview", desc: "Face a virtual 5-member UPSC board by voice and get a report scored on all seven official qualities." },
  { icon: "file", title: "Answer Evaluation", desc: "Upload a Mains answer PDF — typed or handwritten — and get red-ink marks and margin comments back on it." },
  { icon: "target", title: "Goals & Missions", desc: "Break big goals into tasks and metrics, set an overarching mission, and watch progress roll up automatically." },
  { icon: "search", title: "Smart Search", desc: "Semantic search across your own PDFs — find the right passage by meaning, not exact keywords." },
  { icon: "chat", title: "Grounded QnA", desc: "Ask questions in plain language and get answers cited straight from your indexed material." },
  { icon: "brain", title: "Mind Maps", desc: "Lay topics out visually and save your maps to revisit and revise from later." },
  { icon: "sparkles", title: "Voice Assistant", desc: "A hands-free study companion that talks with you and can navigate the app and log your work." },
  { icon: "chart", title: "Progress Analytics", desc: "Dashboards for study time, streaks, and where your day really goes — so you can adjust fast." },
];

const STEPS = [
  { n: "1", title: "Create your account", desc: "Sign up with your email and verify with a one-time code. You're in within a minute." },
  { n: "2", title: "Bring in your material", desc: "Upload PDFs, record study sessions, and set the goals you're working toward." },
  { n: "3", title: "Study smarter", desc: "Search, ask, self-evaluate, and track — with an AI study buddy alongside you." },
];

export default function LandingPage() {
  const { auth } = useAuth();
  const signedIn = !!auth;

  return (
    <main className="lp">
      <div className="lp-bg" aria-hidden="true" />

      <header className="lp-nav">
        <Link href="/" className="lp-brand">
          <img className="lp-logo" src="/dias-icon.png" alt="Dias" />
          <span className="lp-brand-text">Dias</span>
        </Link>
        <nav className="lp-nav-actions">
          {signedIn ? (
            <Link href="/home" className="lp-btn primary">Go to app</Link>
          ) : (
            <>
              <Link href="/auth/signin" className="lp-btn ghost">Sign in</Link>
              <Link href="/auth/signup" className="lp-btn primary">Get started</Link>
            </>
          )}
        </nav>
      </header>

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

        {/* CSS product preview */}
        <div className="lp-hero-art" aria-hidden="true">
          <div className="lp-window">
            <div className="lp-window-bar">
              <span className="lp-dot r" /><span className="lp-dot y" /><span className="lp-dot g" />
              <span className="lp-window-title">Dias · Dashboard</span>
            </div>
            <div className="lp-window-body">
              <div className="lp-tile gold"><Icon name="trophy" size={20} /><b>Race</b><small>+42 today</small></div>
              <div className="lp-tile blue"><Icon name="mic" size={20} /><b>Recorder</b><small>3 sessions</small></div>
              <div className="lp-tile mint"><Icon name="file" size={20} /><b>Answer Eval</b><small>Scored 7/10</small></div>
              <div className="lp-tile"><Icon name="target" size={20} /><b>Goals</b><small>64% done</small></div>
              <div className="lp-tile"><Icon name="search" size={20} /><b>Search</b><small>PDF index</small></div>
              <div className="lp-tile"><Icon name="chat" size={20} /><b>QnA</b><small>Cited answers</small></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="lp-section">
        <h2 className="lp-h2">Everything you need to prepare</h2>
        <p className="lp-section-sub">One workspace that replaces a dozen scattered tools.</p>
        <div className="lp-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-feature">
              <span className="lp-feature-icon"><Icon name={f.icon} size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
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

      <footer className="lp-footer">
        <div className="lp-brand">
          <img className="lp-logo sm" src="/dias-icon.png" alt="Dias" />
          <span className="lp-brand-text">Dias</span>
        </div>
        <span className="lp-footer-note">Your all-in-one UPSC preparation workspace.</span>
        <div className="lp-footer-links">
          {signedIn ? (
            <Link href="/home">Go to app</Link>
          ) : (
            <>
              <Link href="/auth/signin">Sign in</Link>
              <Link href="/auth/signup">Get started</Link>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
