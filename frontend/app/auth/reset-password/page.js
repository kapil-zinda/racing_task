"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, apiResetPassword, apiResendOtp } from "../../lib/auth";
import { friendlyAuthError } from "../../lib/errors";
import styles from "../auth.module.css";

const friendlyError = (err, fallback) => {
  const msg = (err && err.message) || "";
  if (/expired/i.test(msg)) {
    return "That code has expired — request a new one below.";
  }
  return friendlyAuthError(err, fallback);
};

function ResetPasswordInner() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") || "";

  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiResetPassword({ email, otp, newPassword });
      signIn(data);
      router.replace("/home");
    } catch (err) {
      setError(friendlyError(err, "That code didn't work — double-check the 6 digits and try again."));
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    setResending(true);
    try {
      await apiResendOtp({ email, purpose: "reset" });
      setInfo("A new code is on its way — check your inbox.");
      setCountdown(60);
    } catch (err) {
      setError(friendlyError(err, "We couldn't resend the code — please try again in a moment."));
    } finally {
      setResending(false);
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
          <h1 className="auth-title">Enter your reset code</h1>
          <p className="auth-sub">
            Enter the 6-digit code sent to<br /><strong>{email}</strong>, then choose a new password.
          </p>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label" htmlFor="reset-otp">Reset code</label>
            <input
              id="reset-otp"
              className="auth-input auth-input-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
            <label className="auth-label" htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <label className="auth-label" htmlFor="reset-confirm-password">Confirm new password</label>
            <input
              id="reset-confirm-password"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <p className={styles.hint}>Use at least 8 characters.</p>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            {info && (
              <p className="auth-info" role="status">
                {info}
              </p>
            )}
            <button className="auth-btn" type="submit" disabled={loading || otp.length !== 6}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
          <p className="auth-foot">
            {countdown > 0 ? (
              `Resend in ${countdown}s`
            ) : (
              <button className="auth-link auth-link-btn" onClick={handleResend} disabled={resending}>
                {resending ? "Sending…" : "Resend code"}
              </button>
            )}
          </p>
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

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}
