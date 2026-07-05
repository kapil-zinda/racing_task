"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSignup } from "../../lib/auth";
import PhoneInput from "../../components/PhoneInput";
import Icon from "../../components/Icon";
import { DEFAULT_COUNTRY } from "../../lib/countries";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", phone: "", password: "", confirm: "" });
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
      setError("Passwords do not match");
      return;
    }
    const phone = buildPhone(country.dial, form.phone);
    if (!phone) {
      setError("Enter a valid phone number for the selected country code");
      return;
    }
    setLoading(true);
    try {
      await apiSignup({ email: form.email, name: form.name, phone, password: form.password });
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
            <label className="auth-label">Phone</label>
            <PhoneInput
              country={country}
              number={form.phone}
              onCountryChange={setCountry}
              onNumberChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
            <label className="auth-label">Password</label>
            <div className="auth-pass-wrap">
              <input
                className="auth-input"
                type={showPass ? "text" : "password"}
                placeholder="Min 8 characters"
                value={form.password}
                onChange={field("password")}
                minLength={8}
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
            <label className="auth-label">Confirm password</label>
            <input
              className="auth-input"
              type={showPass ? "text" : "password"}
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
