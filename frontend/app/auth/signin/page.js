"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, apiSignin } from "../../lib/auth";
import Icon from "../../components/Icon";
import styles from "../auth.module.css";

// Map errors to friendly copy — never surface raw backend/fetch strings.
const friendlyError = (err) => {
  const msg = (err && err.message) || "";
  if (err instanceof TypeError || /fetch|network|load failed/i.test(msg)) {
    return "Something went wrong on our side — please try again.";
  }
  return "We couldn't sign you in — check your email and password and try again.";
};

export default function SigninPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiSignin(form);
      signIn(data);
      router.replace("/home");
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
          <h1 className="auth-title">Sign in</h1>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label" htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoFocus
            />
            <label className="auth-label" htmlFor="signin-password">Password</label>
            <div className="auth-pass-wrap">
              <input
                id="signin-password"
                className="auth-input"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
              <button
                type="button"
                className="auth-pass-toggle"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Hide password" : "Show password"}
                aria-pressed={showPass}
                tabIndex={-1}
              >
                <Icon name={showPass ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className={styles.helpLine}>
            Trouble signing in? Email{" "}
            <a href="mailto:support@dias.uchhal.in">support@dias.uchhal.in</a>
          </p>
          <p className="auth-foot">
            No account?{" "}
            <Link href="/auth/signup" className="auth-link">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
