"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSignup } from "../../lib/auth";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", phone: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await apiSignup({ email: form.email, name: form.name, phone: form.phone, password: form.password });
      router.push(`/auth/verify-otp?email=${encodeURIComponent(form.email)}`);
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
            <img className="brand-mark" src="/dias-icon.png" alt="Dias" />
            <span className="brand-text">Dias</span>
          </div>
          <h1 className="auth-title">Create account</h1>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label">Full name</label>
            <input
              className="auth-input"
              placeholder="Kapil Kumar"
              value={form.name}
              onChange={field("name")}
              required
              autoFocus
            />
            <label className="auth-label">Email</label>
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={field("email")}
              required
            />
            <label className="auth-label">Phone (optional)</label>
            <input
              className="auth-input"
              type="tel"
              placeholder="+91 98765 43210"
              value={form.phone}
              onChange={field("phone")}
            />
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="Min 8 characters"
              value={form.password}
              onChange={field("password")}
              minLength={8}
              required
            />
            <label className="auth-label">Confirm password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="Repeat password"
              value={form.confirm}
              onChange={field("confirm")}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>
          <p className="auth-foot">
            Already have an account?{" "}
            <Link href="/auth/signin" className="auth-link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
