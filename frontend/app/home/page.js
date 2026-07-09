"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import DayTracker from "../components/DayTracker";
import DayReport from "../components/DayReport";
import OnboardingChecklist from "../components/OnboardingChecklist";
import Icon from "../components/Icon";
import { apiFetch, useAuth } from "../lib/auth";
import { friendlyApiError } from "../lib/errors";
import styles from "./page.module.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const HOME_EXTRAS_STORAGE_KEY = "home_extras_by_user_v1";

// Local quote rotation — one serious line a day, picked by day-of-year.
// No third-party fetch; this is secondary text under the hero, not the lead.
const DAILY_QUOTES = [
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { text: "It is not that we have a short time to live, but that we waste a lot of it.", author: "Seneca" },
  { text: "Arise, awake, and stop not till the goal is reached.", author: "Swami Vivekananda" },
  { text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Perseverance is not a long race; it is many short races one after the other.", author: "Walter Elliot" },
  { text: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "In a gentle way, you can shake the world.", author: "Mahatma Gandhi" },
  { text: "Well begun is half done.", author: "Aristotle" },
];

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

const EXTRAS_KIND_META = {
  time_waste: { label: "Time waste", color: "#94A3B8" },
  danger: { label: "Danger", color: "#F43F5E" },
  necessary: { label: "Necessary", color: "#0EA5E9" },
  coursework: { label: "Coursework", color: "#10B981" },
  random: { label: "Random", color: "#8B5CF6" },
  sleep: { label: "Sleep", color: "#4338CA" },
};
const EXTRAS_TYPE_OPTIONS = Object.keys(EXTRAS_KIND_META);

function normalizeExtraKind(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "time weste" || raw === "time waste" || raw === "time_waste") return "time_waste";
  if (raw === "denger" || raw === "danger") return "danger";
  if (raw === "necessory" || raw === "necessary") return "necessary";
  if (raw === "coursework") return "coursework";
  if (raw === "random") return "random";
  if (raw === "sleep") return "sleep";
  return "time_waste";
}

function extraKindLabel(value) {
  const key = normalizeExtraKind(value);
  return EXTRAS_KIND_META[key]?.label || "Time waste";
}

function extraKindClass(value) {
  return `extras-kind-${normalizeExtraKind(value)}`;
}

export default function HomePage() {
  const { auth } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  // Mirrors the Day Log's selected date so Extras load for the same day.
  const [todayDate, setTodayDate] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [extrasByUser, setExtrasByUser] = useState({});
  const [extrasSaved, setExtrasSaved] = useState(false);
  const [extraActionOpenId, setExtraActionOpenId] = useState("");
  const [extraModalOpen, setExtraModalOpen] = useState(false);
  const [extraModalMode, setExtraModalMode] = useState("create");
  const [editingExtraId, setEditingExtraId] = useState("");
  const [extraDraft, setExtraDraft] = useState({ title: "", link: "", duration: "", kind: "time_waste" });
  // Set on the client only, so SSR/hydration never disagree across midnight/timezones.
  const [heroDate, setHeroDate] = useState("");
  const [dailyQuote, setDailyQuote] = useState(null);
  const effectiveExtrasDate = todayDate || new Date().toISOString().slice(0, 10);
  const extrasSaveTimerRef = useRef(null);
  const extrasPendingSaveRef = useRef(null);
  const extrasHydratingRef = useRef({});

  useEffect(() => {
    const now = new Date();
    setHeroDate(now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
    setDailyQuote(DAILY_QUOTES[dayOfYear(now) % DAILY_QUOTES.length]);
  }, []);

  useEffect(() => {
    if (!auth?.userId) return;
    setSelectedUserId(auth.userId);
  }, [auth?.userId]);

  useEffect(() => {
    const loadExtrasForUser = async () => {
      if (!selectedUserId) return;
      if (API_BASE_URL) {
        try {
          const res = await apiFetch(`${API_BASE_URL}/extras?date=${encodeURIComponent(effectiveExtrasDate)}`);
          if (!res.ok) throw new Error(`Extras API failed: ${res.status}`);
          const data = await res.json();
          extrasHydratingRef.current[selectedUserId] = true;
          setExtrasByUser((prev) => ({ ...prev, [selectedUserId]: Array.isArray(data.rows) ? data.rows : [] }));
          return;
        } catch (err) {
          setApiError(friendlyApiError(err));
        }
      }
      if (typeof window !== "undefined") {
        const rawExtras = window.localStorage.getItem(HOME_EXTRAS_STORAGE_KEY);
        if (!rawExtras) return;
        try {
          const parsed = JSON.parse(rawExtras);
          const userEntry = parsed?.[selectedUserId];
          let rows = [];
          if (Array.isArray(userEntry)) {
            rows = userEntry;
          } else if (userEntry && typeof userEntry === "object") {
            rows = Array.isArray(userEntry?.[effectiveExtrasDate]) ? userEntry[effectiveExtrasDate] : [];
          }
          extrasHydratingRef.current[selectedUserId] = true;
          setExtrasByUser((prev) => ({ ...prev, [selectedUserId]: rows }));
        } catch (_) {}
      }
    };
    loadExtrasForUser();
  }, [selectedUserId, API_BASE_URL, effectiveExtrasDate]);

  useEffect(() => {
    if (!selectedUserId) return;
    const userRows = extrasByUser[selectedUserId] || [];
    if (extrasHydratingRef.current[selectedUserId]) {
      extrasHydratingRef.current[selectedUserId] = false;
      return;
    }
    const doSave = async () => {
      extrasPendingSaveRef.current = null;
      if (API_BASE_URL) {
        try {
          const res = await apiFetch(`${API_BASE_URL}/extras`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: effectiveExtrasDate, rows: userRows }),
          });
          if (!res.ok) throw new Error(`Extras save failed: ${res.status}`);
          setExtrasSaved(true);
        } catch (err) {
          setApiError(friendlyApiError(err));
        }
        return;
      }
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(HOME_EXTRAS_STORAGE_KEY);
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) {}
        const userEntry = parsed?.[selectedUserId];
        const normalized = userEntry && typeof userEntry === "object" && !Array.isArray(userEntry) ? userEntry : {};
        window.localStorage.setItem(HOME_EXTRAS_STORAGE_KEY, JSON.stringify({
          ...parsed,
          [selectedUserId]: { ...normalized, [effectiveExtrasDate]: userRows },
        }));
        setExtrasSaved(true);
      }
    };
    // Keep the pending save in a ref so an unmount can flush the last edit.
    extrasPendingSaveRef.current = doSave;
    if (extrasSaveTimerRef.current) clearTimeout(extrasSaveTimerRef.current);
    extrasSaveTimerRef.current = setTimeout(doSave, 500);
    return () => { if (extrasSaveTimerRef.current) clearTimeout(extrasSaveTimerRef.current); };
  }, [extrasByUser, selectedUserId, API_BASE_URL, effectiveExtrasDate]);

  // Flush a still-debounced extras save on unmount so the last edit isn't lost.
  useEffect(() => () => {
    if (extrasSaveTimerRef.current) clearTimeout(extrasSaveTimerRef.current);
    const flush = extrasPendingSaveRef.current;
    extrasPendingSaveRef.current = null;
    if (flush) flush();
  }, []);

  useEffect(() => {
    if (!extrasSaved) return;
    const t = setTimeout(() => setExtrasSaved(false), 2000);
    return () => clearTimeout(t);
  }, [extrasSaved]);

  useEffect(() => {
    if (!apiError) return;
    const t = setTimeout(() => setApiError(""), NOTICE_TTL_MS);
    return () => clearTimeout(t);
  }, [apiError]);

  const selectedExtras = extrasByUser[selectedUserId] || [];

  useEffect(() => { setExtraActionOpenId(""); }, [selectedUserId]);

  // Close the row action menu on Escape or on a click outside it.
  useEffect(() => {
    if (!extraActionOpenId) return;
    const onKeyDown = (e) => { if (e.key === "Escape") setExtraActionOpenId(""); };
    const onPointerDown = (e) => {
      if (!e.target?.closest?.(".extras-action-wrap")) setExtraActionOpenId("");
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [extraActionOpenId]);

  const openExtraModal = () => {
    setExtraModalMode("create");
    setEditingExtraId("");
    setExtraDraft({ title: "", link: "", duration: "", kind: "time_waste" });
    setExtraModalOpen(true);
  };

  const closeExtraModal = () => {
    setExtraModalOpen(false);
    setExtraModalMode("create");
    setEditingExtraId("");
  };

  const openEditExtraModal = (row) => {
    setExtraModalMode("edit");
    setEditingExtraId(row.id);
    setExtraDraft({
      title: row.title || "", link: row.link || "",
      duration: row.duration || "", kind: normalizeExtraKind(row.kind),
    });
    setExtraActionOpenId("");
    setExtraModalOpen(true);
  };

  const saveExtraRow = () => {
    const cleanRow = {
      title: (extraDraft.title || "").trim(),
      link: (extraDraft.link || "").trim(),
      kind: normalizeExtraKind(extraDraft.kind),
      duration: (extraDraft.duration || "").trim(),
    };
    setExtrasByUser((prev) => ({
      ...prev,
      [selectedUserId]:
        extraModalMode === "edit" && editingExtraId
          ? (prev[selectedUserId] || []).map((row) => (row.id === editingExtraId ? { ...row, ...cleanRow } : row))
          : [...(prev[selectedUserId] || []), { id: `extra:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...cleanRow }],
    }));
    closeExtraModal();
  };

  const removeExtraRow = (rowId) => {
    setExtrasByUser((prev) => ({ ...prev, [selectedUserId]: (prev[selectedUserId] || []).filter((r) => r.id !== rowId) }));
    setExtraActionOpenId("");
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="home" />
        <div className={styles.heroRow}>
          <div>
            <h1>Today</h1>
            {heroDate ? <p className={styles.heroDate}>{heroDate}</p> : null}
            <p className="subtext">Log your hours, keep the extras honest, and close the day with a report.</p>
          </div>
          <button className={styles.reportBtn} onClick={() => setReportOpen(true)}>
            <Icon name="file" size={16} /> Generate report of the day
          </button>
        </div>
        {dailyQuote ? (
          <p className={styles.heroQuote}>
            “{dailyQuote.text}” <span className={styles.heroQuoteAuthor}>— {dailyQuote.author}</span>
          </p>
        ) : null}
        {!API_BASE_URL ? (
          <p className="api-state warn">Running in local mode (no backend URL configured).</p>
        ) : apiError ? (
          <p className="api-state error">API issue: {apiError}</p>
        ) : null}
      </header>

      <section className={styles.primaryFocus}>
        <DayTracker onDateChange={setTodayDate} />
      </section>

      <OnboardingChecklist />

      <section className={`player-card extras-card ${styles.extrasCard}`}>
        <button
          className={styles.extrasToggle}
          onClick={() => setExtrasOpen((v) => !v)}
          aria-expanded={extrasOpen}
          aria-controls="home-extras-body"
        >
          <span className={styles.extrasToggleLead}>
            <Icon name={extrasOpen ? "chevron-up" : "chevron-down"} size={16} />
            <h2 className="player-name">Extras</h2>
            <span className={styles.extrasCount}>
              {selectedExtras.length > 0 ? `${selectedExtras.length} logged` : "Optional"}
            </span>
          </span>
          {extrasSaved ? (
            <span className={styles.savedNote} role="status">
              <Icon name="check" size={12} /> Saved
            </span>
          ) : null}
        </button>
        {extrasOpen && (
          <div id="home-extras-body">
          <div className={styles.extrasHeadActions}>
              <button className="btn-day secondary" onClick={openExtraModal}>+ Add Row</button>
          </div>
          <div className="extras-table-wrap">
            <table className="extras-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Link (optional)</th>
                  <th>Duration</th>
                  <th>Category</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedExtras.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="extras-empty">
                      Track anything extra — optional subjects, test series, essays. Add a row to start.
                    </td>
                  </tr>
                ) : selectedExtras.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title || "-"}</td>
                    <td>
                      {row.link ? (
                        <a href={row.link} target="_blank" rel="noreferrer" className="extras-link">{row.link}</a>
                      ) : "-"}
                    </td>
                    <td>{row.duration || "-"}</td>
                    <td>
                      <span className={`extras-kind-chip ${extraKindClass(row.kind)}`}>{extraKindLabel(row.kind)}</span>
                    </td>
                    <td>
                      <div className="extras-action-wrap">
                        <button
                          className="icon-action-btn"
                          onClick={() => setExtraActionOpenId((prev) => (prev === row.id ? "" : row.id))}
                          aria-label="Open extra actions"
                          aria-expanded={extraActionOpenId === row.id}
                        >⋯</button>
                        {extraActionOpenId === row.id ? (
                          <div className="extras-action-menu">
                            <button className="context-item" onClick={() => openEditExtraModal(row)}>Edit</button>
                            <button className="context-item danger" onClick={() => removeExtraRow(row.id)}>Delete</button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </section>

      <DayReport open={reportOpen} onClose={() => setReportOpen(false)} />

      {extraModalOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>{extraModalMode === "edit" ? "Edit Extra" : "Add Extra"}</h3>
            <p>{auth?.name || "User"}</p>
            <div className="session-form-grid">
              <input className="task-select" placeholder="Title" value={extraDraft.title}
                onChange={(e) => setExtraDraft((p) => ({ ...p, title: e.target.value }))} />
              <input className="task-select" placeholder="Link (optional)" value={extraDraft.link}
                onChange={(e) => setExtraDraft((p) => ({ ...p, link: e.target.value }))} />
              <input className="task-select" placeholder="Duration (e.g. 30m)" value={extraDraft.duration}
                onChange={(e) => setExtraDraft((p) => ({ ...p, duration: e.target.value }))} />
              <select className="task-select" value={extraDraft.kind}
                onChange={(e) => setExtraDraft((p) => ({ ...p, kind: e.target.value }))}>
                {EXTRAS_TYPE_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>{EXTRAS_KIND_META[kind]?.label || kind}</option>
                ))}
              </select>
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={closeExtraModal}>Cancel</button>
              <button className="btn-new" onClick={saveExtraRow} disabled={!extraDraft.title.trim()}>
                {extraModalMode === "edit" ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
