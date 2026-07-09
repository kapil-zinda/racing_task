"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, apiVerifyOtp, apiResendOtp } from "../../lib/auth";
import styles from "../auth.module.css";

// Map errors to friendly copy — never surface raw backend/fetch strings.
const friendlyError = (err, fallback) => {
  const msg = (err && err.message) || "";
  if (err instanceof TypeError || /fetch|network|load failed/i.test(msg)) {
    return "Something went wrong on our side — please try again.";
  }
  if (/expired/i.test(msg)) {
    return "That code has expired — request a new one below.";
  }
  return fallback;
};

function VerifyOtpInner() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") || "";

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const submittingRef = useRef(false); // guards against double-submit (auto + manual)

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const submitCode = async (code) => {
    if (submittingRef.current || code.length !== 6) return;
    submittingRef.current = true;
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const data = await apiVerifyOtp({ email, otp: code });
      signIn(data);
      router.replace("/home");
    } catch (err) {
      setError(
        friendlyError(err, "That code didn't work — double-check the 6 digits and try again.")
      );
      submittingRef.current = false;
      setLoading(false);
    }
    // On success we stay "loading" while the redirect happens.
  };

  const handleVerify = (e) => {
    e.preventDefault();
    submitCode(otp);
  };

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setOtp(digits);
    // Auto-submit as soon as all 6 digits are in.
    if (digits.length === 6) submitCode(digits);
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    setResending(true);
    try {
      await apiResendOtp({ email });
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
          <h1 className="auth-title">Verify email</h1>
          <p className="auth-sub">Enter the 6-digit code sent to<br /><strong>{email}</strong></p>
          <form onSubmit={handleVerify} className="auth-form">
            <label className="auth-label" htmlFor="otp-code">Verification code</label>
            <input
              id="otp-code"
              className="auth-input auth-input-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={handleChange}
              required
              autoFocus
              aria-describedby="otp-hint"
            />
            <p id="otp-hint" className={styles.hint}>
              Verifies automatically once all 6 digits are in.
            </p>
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
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>
          <p className="auth-foot">
            {countdown > 0 ? (
              `Resend in ${countdown}s`
            ) : (
              <button
                className="auth-link auth-link-btn"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? "Sending…" : "Resend OTP"}
              </button>
            )}
          </p>
          <p className="auth-foot">
            <Link href="/auth/signup" className="auth-link">
              ← Back to sign up
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense>
      <VerifyOtpInner />
    </Suspense>
  );
}
