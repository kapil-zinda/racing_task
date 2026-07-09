"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSignup } from "../../lib/auth";
import PhoneInput from "../../components/PhoneInput";
import Icon from "../../components/Icon";
import { DEFAULT_COUNTRY } from "../../lib/countries";
import { friendlyAuthError } from "../../lib/errors";
import styles from "../auth.module.css";

// Map errors to friendly copy — never surface raw backend/fetch strings.
const friendlyError = (err) => {
  const msg = (err && err.message) || "";
  if (/already|exists|registered|taken/i.test(msg)) {
    return "An account with this email already exists — try signing in instead.";
  }
  return friendlyAuthError(err, "We couldn't create your account — please check your details and try again.");
};

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", phone: "", password: "", confirm: "" });
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const mismatch = form.password && form.confirm && form.password !== form.confirm;

  // Combine the selected country code with the local number → E.164
  // (e.g. +919876543210). Returns "" when the result isn't a plausible number.
  const buildPhone = (dial, number) => {
    const full = (dial || "") + (number || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(full)) return "";
    return "+" + full;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    const phone = buildPhone(country.dial, form.phone);
    if (!phone) {
      setError("Enter a valid phone number for the selected country code.");
      return;
    }
    setLoading(true);
    try {
      await apiSignup({ email: form.email, name: form.name, phone, password: form.password });
      router.push(`/auth/verify-otp?email=${encodeURIComponent(form.email)}`);
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
          <h1 className="auth-title">Create account</h1>
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-label" htmlFor="signup-name">Full name</label>
            <input
              id="signup-name"
              className="auth-input"
              type="text"
              autoComplete="name"
              placeholder="Aarav Sharma"
              value={form.name}
              onChange={field("name")}
              required
              autoFocus
            />
            <label className="auth-label" htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={field("email")}
              required
            />
            <label className="auth-label" id="signup-phone-label">Phone</label>
            <PhoneInput
              country={country}
              number={form.phone}
              onCountryChange={setCountry}
              onNumberChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
            <label className="auth-label" htmlFor="signup-password">Password</label>
            <div className="auth-pass-wrap">
              <input
                id="signup-password"
                className="auth-input"
                type={showPass ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.password}
                onChange={field("password")}
                minLength={8}
                required
                aria-describedby="signup-password-hint"
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
            <p id="signup-password-hint" className={styles.hint}>
              Minimum 8 characters
            </p>
            <label className="auth-label" htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              className="auth-input"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat password"
              value={form.confirm}
              onChange={field("confirm")}
              required
              aria-invalid={mismatch ? "true" : undefined}
              aria-describedby={mismatch ? "signup-confirm-error" : undefined}
            />
            {mismatch && (
              <p id="signup-confirm-error" className={styles.fieldError} role="alert">
                Passwords do not match.
              </p>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
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
