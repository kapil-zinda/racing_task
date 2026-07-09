"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiForgotPassword } from "../../lib/auth";
import { friendlyAuthError } from "../../lib/errors";

const friendlyError = (err) =>
  friendlyAuthError(err, "We couldn't send that reset code — please try again.");

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiForgotPassword(email.trim());
      router.push(`/auth/reset-password?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="auth-center">
        <div className="auth-card">
          <div className="auth-brand">
            <img className="brand-mark" src="/dias-icon.png" alt="Dias" />
            <span className="brand-text">Dias</span>
          </div>
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">
            Enter your account email and we&apos;ll send you a code to reset your password.
          </p>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label" htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset code"}
            </button>
          </form>
          <p className="auth-foot">
            <Link href="/auth/signin" className="auth-link">
              ← Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
