"use client";
// Shared footer for the public marketing pages. Auth-aware links.

import Link from "next/link";
import { useAuth } from "../lib/auth";

export default function PublicFooter() {
  const { auth } = useAuth();
  const signedIn = !!auth;
  return (
    <footer className="lp-footer">
      <div className="lp-brand">
        <img className="lp-logo sm" src="/dias-icon.png" alt="Dias" />
        <span className="lp-brand-text">Dias</span>
      </div>
      <span className="lp-footer-note">Your all-in-one UPSC preparation workspace.</span>
      <div className="lp-footer-links">
        <Link href="/pricing">Pricing</Link>
        <Link href="/how-to-use">How to use</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        {signedIn ? (
          <Link href="/home">Go to app</Link>
        ) : (
          <Link href="/auth/signin">Sign in</Link>
        )}
      </div>
    </footer>
  );
}
