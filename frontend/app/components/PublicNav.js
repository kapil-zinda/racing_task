"use client";
// Shared top nav for the public marketing pages (landing, about, how-to-use, contact).
// Auth-aware: signed-in users get a single "Go to app" button.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/how-to-use", label: "How to use" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function PublicNav() {
  const { auth } = useAuth();
  const pathname = usePathname();
  const signedIn = !!auth;
  return (
    <header className="lp-nav">
      <Link href="/" className="lp-brand">
        <img className="lp-logo" src="/dias-icon.png" alt="Dias" />
        <span className="lp-brand-text">Dias</span>
      </Link>
      <nav className="lp-nav-links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`lp-nav-link ${pathname === l.href ? "active" : ""}`}
            aria-current={pathname === l.href ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
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
  );
}
