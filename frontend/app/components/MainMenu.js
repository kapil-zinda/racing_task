"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import { useCredits } from "../lib/credits";
import Icon from "./Icon";

// Grouped to match the hierarchy the landing page itself states: "Three tools
// carry most of the weight" (Interview, Answer Eval, QnA). Home stays
// ungrouped since it's the daily entry point, not a peer of a category.
const NAV_GROUPS = [
  {
    heading: null,
    items: [{ key: "home", label: "Home", href: "/home", icon: "home" }],
  },
  {
    heading: "Core tools",
    items: [
      { key: "interview", label: "Interview", href: "/interview", icon: "interview" },
      { key: "answer-eval", label: "Answer Eval", href: "/answer-eval", icon: "answer-eval" },
      { key: "qna", label: "QnA", href: "/qna", icon: "qna" },
    ],
  },
  {
    heading: "Plan & track",
    items: [
      { key: "goals", label: "Goals", href: "/goals", icon: "goals" },
      { key: "analytics", label: "Analytics", href: "/analytics", icon: "analytics" },
      { key: "recorder", label: "Recorder", href: "/recorder", icon: "recorder" },
    ],
  },
  {
    heading: "Library",
    items: [
      { key: "content", label: "Content", href: "/content", icon: "content" },
      { key: "search", label: "Search", href: "/search", icon: "search" },
      { key: "mindmap", label: "Mind Map", href: "/mindmap", icon: "mindmap" },
    ],
  },
  {
    heading: "Account",
    items: [{ key: "usage", label: "Usage", href: "/usage", icon: "usage" }],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const DRAWER_ID = "main-menu-drawer";

export default function MainMenu({ active = "" }) {
  const [open, setOpen] = useState(false);
  const { auth, signOut } = useAuth();
  const { credits, refreshCredits } = useCredits();
  const router = useRouter();

  // Ambient credit awareness: make sure the summary is loaded once we're signed in.
  // (CreditsProvider caches it; this is a no-op refresh if already fetched elsewhere.)
  useEffect(() => {
    if (auth) refreshCredits();
  }, [auth, refreshCredits]);

  const balance = credits != null ? Number(credits.balance_usd ?? 0) : null;
  const showChip = Boolean(auth) && balance != null;
  const chipZero = showChip && balance <= 0;
  const chipLabel = showChip ? `$${balance.toFixed(2)}` : "";

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

  // Keep drawer content out of the tab order while closed (CSS hides it, but
  // an explicit tabIndex guards against any rule re-forcing visibility).
  const drawerTab = open ? 0 : -1;

  return (
    <>
      <button
        className={`nav-hamburger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
      >
        <span className="nav-bar-line" />
        <span className="nav-bar-line" />
        <span className="nav-bar-line" />
      </button>

      {showChip && (
        <Link
          href="/usage"
          className={`nav-credit-chip ${open ? "is-hidden" : ""} ${chipZero ? "zero" : ""}`}
          aria-label={`Credit balance ${chipLabel} — open usage`}
          tabIndex={open ? -1 : 0}
        >
          <Icon name="wallet" size={13} />
          <span>{chipLabel}</span>
        </Link>
      )}

      {/* Reserves the header space the old inline menu used, so page layout is unchanged. */}
      <div className="main-menu-spacer" aria-hidden="true" />

      <div
        className={`nav-backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside
        id={DRAWER_ID}
        className={`side-drawer ${open ? "open" : ""}`}
        role={open ? "dialog" : undefined}
        aria-label="Main menu"
        aria-hidden={!open}
      >
        <div className="side-drawer-brand">
          <img className="brand-mark" src="/dias-icon.png" alt="Dias" />
          <span className="brand-text">Dias</span>
          <button className="drawer-close-btn" onClick={() => setOpen(false)} aria-label="Close menu" tabIndex={drawerTab}><Icon name="close" size={18} /></button>
        </div>
        <nav className="side-nav">
          {NAV_GROUPS.map((group, gi) => (
            <div className="side-nav-group" key={group.heading || `g${gi}`}>
              {group.heading && <p className="side-nav-heading">{group.heading}</p>}
              {group.items.map((item) => {
                const i = NAV_ITEMS.indexOf(item);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`side-nav-item ${active === item.key ? "active" : ""}`}
                    style={{ transitionDelay: open ? `${90 + i * 45}ms` : "0ms" }}
                    onClick={() => setOpen(false)}
                    tabIndex={drawerTab}
                  >
                    <span className="side-nav-icon" aria-hidden="true"><Icon name={item.icon} size={20} /></span>
                    <span className="side-nav-label">{item.label}</span>
                    <span className="side-nav-arrow" aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-drawer-foot">
          <Link
            href="/how-to-use"
            className="side-help-link"
            onClick={() => setOpen(false)}
            tabIndex={drawerTab}
          >
            <Icon name="help-circle" size={15} />
            <span>Help &amp; shortcuts</span>
          </Link>
          {showChip && (
            <Link
              href="/usage"
              className={`drawer-credit-chip ${chipZero ? "zero" : ""}`}
              onClick={() => setOpen(false)}
              tabIndex={drawerTab}
            >
              <Icon name="wallet" size={14} />
              <span>{chipLabel} credits</span>
              <span className="drawer-credit-chip-arrow" aria-hidden="true">›</span>
            </Link>
          )}
          {auth ? (
            <div className="side-auth-row">
              <span className="side-auth-email">{auth.name || auth.email}</span>
              <button className="side-signout-btn" onClick={handleSignOut} tabIndex={drawerTab}>Sign out</button>
            </div>
          ) : (
            <Link href="/auth/signin" className="side-signin-link" onClick={() => setOpen(false)} tabIndex={drawerTab}>
              Sign in
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
