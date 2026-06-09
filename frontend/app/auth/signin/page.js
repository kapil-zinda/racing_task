"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, apiSignin } from "../../lib/auth";

export default function SigninPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiSignin(form);
      signIn(data);
      router.replace("/");
    } catch (err) {
      setError(err.message);
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
            <span className="brand-mark">KD</span>
            <span className="brand-text">Race Hub</span>
          </div>
          <h1 className="auth-title">Sign in</h1>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label">Email</label>
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoFocus
            />
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
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
