"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

const NAV_ITEMS = [
  { key: "home", label: "Home", href: "/", icon: "🏠" },
  { key: "recorder", label: "Recorder", href: "/recorder", icon: "🎙️" },
  { key: "interview", label: "Interview", href: "/interview", icon: "🧑‍⚖️" },
  { key: "answer-eval", label: "Answer Eval", href: "/answer-eval", icon: "📝" },
  { key: "goals", label: "Goals", href: "/goals", icon: "🎯" },
  { key: "analytics", label: "Analytics", href: "/analytics", icon: "📊" },
  { key: "qna", label: "QnA", href: "/qna", icon: "💬" },
  { key: "mindmap", label: "Mind Map", href: "/mindmap", icon: "🧠" },
  { key: "search", label: "Search", href: "/search", icon: "🔍" },
  { key: "content", label: "Content", href: "/content", icon: "📂" },
  { key: "usage", label: "Usage", href: "/usage", icon: "📊" },
];

export default function MainMenu({ active = "" }) {
  const [open, setOpen] = useState(false);
  const { auth, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = () => {
    signOut();
    setOpen(false);
    router.push("/auth/signin");
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        className={`nav-hamburger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <span className="nav-bar-line" />
        <span className="nav-bar-line" />
        <span className="nav-bar-line" />
      </button>

      {/* Reserves the header space the old inline menu used, so page layout is unchanged. */}
      <div className="main-menu-spacer" aria-hidden="true" />

      <div
        className={`nav-backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside className={`side-drawer ${open ? "open" : ""}`} aria-label="Main menu">
        <div className="side-drawer-brand">
          <img className="brand-mark" src="/dias-icon.png" alt="Dias" />
          <span className="brand-text">Dias</span>
          <button className="drawer-close-btn" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
        </div>
        <nav className="side-nav">
          {NAV_ITEMS.map((item, i) => (
            <Link
              key={item.key}
              href={item.href}
              className={`side-nav-item ${active === item.key ? "active" : ""}`}
              style={{ transitionDelay: open ? `${90 + i * 45}ms` : "0ms" }}
              onClick={() => setOpen(false)}
            >
              <span className="side-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="side-nav-label">{item.label}</span>
              <span className="side-nav-arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
        <div className="side-drawer-foot">
          {auth ? (
            <div className="side-auth-row">
              <span className="side-auth-email">{auth.name || auth.email}</span>
              <button className="side-signout-btn" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <Link href="/auth/signin" className="side-signin-link" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
