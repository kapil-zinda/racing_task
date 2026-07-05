"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, apiVerifyOtp, apiResendOtp } from "../../lib/auth";

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

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiVerifyOtp({ email, otp });
      signIn(data);
      router.replace("/home");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResending(true);
    try {
      await apiResendOtp({ email });
      setInfo("New OTP sent.");
      setCountdown(60);
    } catch (err) {
      setError(err.message);
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
            <label className="auth-label">OTP</label>
            <input
              className="auth-input auth-input-otp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
            {error && <p className="auth-error">{error}</p>}
            {info && <p className="auth-info">{info}</p>}
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
