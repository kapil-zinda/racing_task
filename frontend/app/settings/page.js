"use client";
import "./settings.css";

// Account settings — profile (name editable; email/phone read-only), password
// change, current plan, and the danger zone (sign out / delete account). Sign
// out used to be a bare button in the MainMenu drawer; it now lives here
// alongside account deletion so the drawer only links in.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, apiUpdateProfile, apiChangePassword, apiDeleteAccount } from "../lib/auth";
import { useCredits } from "../lib/credits";
import { friendlyApiError } from "../lib/errors";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";

const PLAN_NAME = { free: "Free", pro: "Pro", max: "Max" };

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (_) {
    return "";
  }
}

export default function SettingsPage() {
  const { auth, signOut, updateAuth } = useAuth();
  const { credits } = useCredits();
  const router = useRouter();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(auth?.name || "");
  const [nameStatus, setNameStatus] = useState(null); // { kind: "ok"|"error", message }
  const [nameSaving, setNameSaving] = useState(false);

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwStatus, setPwStatus] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteStatus, setDeleteStatus] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const startEditingName = () => {
    setName(auth?.name || "");
    setNameStatus(null);
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setName(auth?.name || "");
    setNameStatus(null);
    setEditingName(false);
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameStatus({ kind: "error", message: "Name can't be empty." });
      return;
    }
    setNameSaving(true);
    setNameStatus(null);
    try {
      await apiUpdateProfile(trimmed);
      updateAuth({ name: trimmed });
      setEditingName(false);
    } catch (err) {
      setNameStatus({ kind: "error", message: friendlyApiError(err) });
    } finally {
      setNameSaving(false);
    }
  };

  const closePwModal = () => {
    setPwModalOpen(false);
    setPwForm({ current: "", next: "", confirm: "" });
    setPwStatus(null);
    setPwSaving(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwStatus(null);
    if (pwForm.next.length < 8) {
      setPwStatus({ kind: "error", message: "New password must be at least 8 characters." });
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwStatus({ kind: "error", message: "New passwords don't match." });
      return;
    }
    setPwSaving(true);
    try {
      await apiChangePassword({ currentPassword: pwForm.current, newPassword: pwForm.next });
      closePwModal();
    } catch (err) {
      setPwStatus({ kind: "error", message: friendlyApiError(err) });
      setPwSaving(false);
    }
  };

  const handleSignOut = () => {
    signOut();
    router.push("/auth/signin");
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePassword) return;
    setDeleting(true);
    setDeleteStatus(null);
    try {
      await apiDeleteAccount(deletePassword);
      signOut();
      router.push("/");
    } catch (err) {
      setDeleteStatus(friendlyApiError(err));
      setDeleting(false);
    }
  };

  const plan = credits?.plan;
  const planKey = plan?.plan || "free";
  const planLabel = PLAN_NAME[planKey] || planKey;

  return (
    <div className="goal-page">
      <MainMenu active="settings" />
      <div className="goal-container">
        <header className="goal-header">
          <div>
            <h1>Settings</h1>
            <p className="goal-sub">Your profile, password, plan, and account.</p>
          </div>
        </header>

        <section className="usage-card">
          <div className="usage-card-head"><h3>Profile</h3></div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Name</span>
            {editingName ? (
              <form onSubmit={handleSaveName} className="settings-profile-edit">
                <input
                  className="settings-profile-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  autoFocus
                />
                <button type="submit" className="goal-btn primary tiny" disabled={nameSaving}>
                  {nameSaving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="goal-btn ghost tiny" onClick={cancelEditingName} disabled={nameSaving}>
                  Cancel
                </button>
              </form>
            ) : (
              <span className="settings-profile-value">
                {auth?.name || "—"}
                <button
                  type="button"
                  className="settings-edit-btn"
                  onClick={startEditingName}
                  aria-label="Edit name"
                  title="Edit name"
                >
                  <Icon name="edit" size={14} />
                </button>
              </span>
            )}
          </div>
          {nameStatus && (
            <p className="auth-error" role="alert">{nameStatus.message}</p>
          )}
          <div className="settings-profile-row">
            <span className="settings-profile-label">Email</span>
            <span className="settings-profile-value">{auth?.email || "—"}</span>
          </div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Phone</span>
            <span className="settings-profile-value">{auth?.phone || "—"}</span>
          </div>
          <p className="goal-hint">Email and phone can&apos;t be changed here — contact support if this needs to change.</p>
        </section>

        <section className="usage-card">
          <div className="usage-card-head">
            <h3>Plan</h3>
            <span className="usage-of">{planLabel}</span>
          </div>
          <p className="goal-hint">
            {planKey === "free"
              ? "You're on the Free plan."
              : `Renews ${fmtDate(plan?.period_end)}.`}
          </p>
          <div className="settings-plan-actions">
            <Link href="/usage" className="goal-btn ghost">Manage plan &amp; credits</Link>
            <Link href="/pricing" className="goal-btn ghost">Compare plans</Link>
          </div>
        </section>

        <section className="usage-card">
          <div className="usage-card-head"><h3>Account</h3></div>
          <div className="settings-danger-row">
            <div>
              <strong>Change password</strong>
              <p className="goal-hint">Update the password used to sign in.</p>
            </div>
            <button className="goal-btn ghost" onClick={() => setPwModalOpen(true)}>Change password</button>
          </div>
          <div className="settings-danger-row">
            <div>
              <strong>Sign out</strong>
              <p className="goal-hint">End your session on this device.</p>
            </div>
            <button className="goal-btn ghost" onClick={handleSignOut}>Sign out</button>
          </div>
          <div className="settings-danger-row">
            <div>
              <strong>Delete account</strong>
              <p className="goal-hint">Disables your account immediately. Your data is kept, not erased.</p>
            </div>
            {!deleteOpen ? (
              <button className="goal-btn danger" onClick={() => setDeleteOpen(true)}>Delete account</button>
            ) : null}
          </div>
          {deleteOpen && (
            <form onSubmit={handleDeleteAccount} className="settings-delete-confirm">
              <p className="goal-hint">
                <Icon name="warning" size={14} /> Enter your password to confirm — this signs you out and blocks future sign-in.
              </p>
              <div className="goal-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoFocus
                />
              </div>
              {deleteStatus && <p className="auth-error" role="alert">{deleteStatus}</p>}
              <div className="settings-plan-actions">
                <button
                  type="button"
                  className="goal-btn ghost"
                  onClick={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteStatus(null); }}
                >
                  Cancel
                </button>
                <button type="submit" className="goal-btn danger" disabled={deleting || !deletePassword}>
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      {pwModalOpen && (
        <div className="settings-modal-overlay" onClick={closePwModal}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pw-modal-title">
            <div className="settings-modal-head">
              <h3 id="pw-modal-title">Change password</h3>
              <button className="settings-modal-close" onClick={closePwModal} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="settings-form">
              <div className="goal-field">
                <span>Current password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pwForm.current}
                  onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="goal-field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.next}
                  onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                />
              </div>
              <div className="goal-field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.confirm}
                  onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                />
              </div>
              {pwStatus && (
                <p className="auth-error" role="alert">{pwStatus.message}</p>
              )}
              <div className="settings-plan-actions">
                <button type="button" className="goal-btn ghost" onClick={closePwModal} disabled={pwSaving}>Cancel</button>
                <button className="goal-btn primary" type="submit" disabled={pwSaving}>
                  {pwSaving ? "Changing…" : "Change password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
