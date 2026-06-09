"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "./components/MainMenu";
import TimeTracker from "./components/TimeTracker";
import { apiFetch, useAuth } from "./lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const QUOTE_API_URL = "https://motivational-spark-api.vercel.app/api/quotes/random";
const FALLBACK_HERO_QUOTE = {
  quote: "Keep racing and unlock rewards at each milestone.",
  author: "",
};
const NOTICE_TTL_MS = 15000;
const HOME_EXTRAS_STORAGE_KEY = "home_extras_by_user_v1";
const EXTRAS_KIND_META = {
  time_waste: { label: "Time waste", color: "#94A3B8" },
  danger: { label: "Danger", color: "#F43F5E" },
  necessary: { label: "Necessary", color: "#0EA5E9" },
  coursework: { label: "Coursework", color: "#10B981" },
  random: { label: "Random", color: "#8B5CF6" },
  sleep: { label: "Sleep", color: "#4338CA" },
};
const EXTRAS_TYPE_OPTIONS = Object.keys(EXTRAS_KIND_META);

const ACTION_LABELS = {
  new_class: "New Class",
  revision: "Revision",
  ticket_resolved: "Ticket Resolved",
  test_completed: "Test Completed"
};

const TEST_STAGE_OPTIONS = [
  { value: "test_given", label: "Test Given" },
  { value: "analysis_done", label: "Analysis Done" },
  { value: "revision", label: "Revision" },
];
const TEST_EXAM_OPTIONS = [{ value: "tests", label: "Tests" }];
const TICKET_ORG_OPTIONS = ["uchhal", "elucidata", "divya"];
const OTHER_VALUE = "__other__";

const getSubjectsForExam = (examType, catalog = {}) => (catalog[examType] || []).map((entry) => entry.subject);
const getTopicsForSelection = (examType, subject, catalog = {}) => {
  const found = (catalog[examType] || []).find((entry) => entry.subject === subject);
  return found?.topics || [];
};

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

function toTitle(text) {
  return String(text || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function HomePage() {
  const { auth } = useAuth();
  const [missionSelector, setMissionSelector] = useState({ exam_options: [], catalog: {} });
  const [missionSelectorLoading, setMissionSelectorLoading] = useState(Boolean(API_BASE_URL));
  const hasMissionCatalog = Object.keys(missionSelector.catalog || {}).length > 0;
  const activeCatalog = hasMissionCatalog ? missionSelector.catalog : {};
  const activeExamOptions = hasMissionCatalog ? (missionSelector.exam_options || []) : [];
  const missionTestPlan = Array.isArray(missionSelector?.plan?.tests) ? missionSelector.plan.tests : [];
  const missionTestSources = [...new Set(missionTestPlan.map((row) => String(row?.source || "").trim()).filter(Boolean))];
  const activeTestSources = missionTestSources;
  const defaultExam = activeExamOptions[0]?.value || "";
  const defaultSubject = getSubjectsForExam(defaultExam, activeCatalog)[0] || "";
  const defaultTopic = getTopicsForSelection(defaultExam, defaultSubject, activeCatalog)[0] || "";
  const defaultTestSource = activeTestSources[0] || "";
  const [toast, setToast] = useState("");
  const [apiError, setApiError] = useState("");
  const [taskModal, setTaskModal] = useState({ open: false, playerId: "", actionType: "" });
  const [taskComment, setTaskComment] = useState("");
  const [taskMeta, setTaskMeta] = useState({
    exam_type: defaultExam,
    subject: defaultSubject,
    topic: defaultTopic,
    exam_type_other: "",
    subject_other: "",
    topic_other: "",
    work_type: "study",
    note: ""
  });
  const [taskTestMeta, setTaskTestMeta] = useState({
    exam_type: TEST_EXAM_OPTIONS[0].value,
    exam_type_other: "",
    source: defaultTestSource,
    source_other: "",
    test_number: "1",
    stage: "test_given",
    note: "",
  });
  const [taskTicketMeta, setTaskTicketMeta] = useState({
    org: TICKET_ORG_OPTIONS[0],
    org_other: "",
    note: "",
  });
  const [todayDate, setTodayDate] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [extrasByUser, setExtrasByUser] = useState({});
  const [extraActionOpenId, setExtraActionOpenId] = useState("");
  const [extraModalOpen, setExtraModalOpen] = useState(false);
  const [extraModalMode, setExtraModalMode] = useState("create");
  const [editingExtraId, setEditingExtraId] = useState("");
  const [extraDraft, setExtraDraft] = useState({
    title: "",
    link: "",
    duration: "",
    kind: "time_waste",
  });
  const [heroQuote, setHeroQuote] = useState(FALLBACK_HERO_QUOTE);
  const effectiveExtrasDate = todayDate || new Date().toISOString().slice(0, 10);
  const extrasSaveTimerRef = useRef(null);
  const extrasHydratingRef = useRef({});

  const getMissionTestRowsBySource = (sourceValue) =>
    missionTestPlan.filter((row) => String(row?.source || "").trim() === String(sourceValue || "").trim());
  const getMissionTestNumberOptions = (sourceValue) => {
    const rows = getMissionTestRowsBySource(sourceValue);
    const maxCount = rows.reduce((mx, row) => Math.max(mx, Number(row?.number_of_tests || 1)), 1);
    return Array.from({ length: maxCount }, (_, idx) => String(idx + 1));
  };

  useEffect(() => {
    const controller = new AbortController();

    const loadHeroQuote = async () => {
      try {
        const res = await fetch(QUOTE_API_URL, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Quote API failed: ${res.status}`);

        const data = await res.json();
        const quote = String(data?.quote || "").trim();
        const author = String(data?.author || "").trim();
        if (!quote) throw new Error("Quote API returned an empty quote");

        setHeroQuote({
          quote,
          author: author || "Unknown",
        });
      } catch {
        if (!controller.signal.aborted) setHeroQuote(FALLBACK_HERO_QUOTE);
      }
    };

    loadHeroQuote();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!auth?.userId) return;
    setSelectedUserId(auth.userId);
  }, [auth?.userId]);

  useEffect(() => {
    if (!API_BASE_URL) return;
    setMissionSelectorLoading(true);
    apiFetch(`${API_BASE_URL}/mission/options`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Mission options failed"))))
      .then((data) => setMissionSelector({ exam_options: data.exam_options || [], catalog: data.catalog || {}, plan: data.plan || {} }))
      .catch(() => setMissionSelector({ exam_options: [], catalog: {}, plan: {} }))
      .finally(() => setMissionSelectorLoading(false));
  }, [API_BASE_URL]);

  useEffect(() => {
    if (!(taskModal.open && (taskModal.actionType === "new_class" || taskModal.actionType === "revision"))) return;
    if (taskMeta.exam_type) return;
    if (!activeExamOptions.length) return;
    const firstExam = activeExamOptions[0]?.value || "";
    const firstSubject = getSubjectsForExam(firstExam, activeCatalog)[0] || "";
    const firstTopic = getTopicsForSelection(firstExam, firstSubject, activeCatalog)[0] || "";
    setTaskMeta((prev) => ({
      ...prev,
      exam_type: firstExam,
      subject: firstSubject,
      topic: firstTopic,
    }));
  }, [taskModal.open, taskModal.actionType, taskMeta.exam_type, activeExamOptions, activeCatalog]);

  useEffect(() => {
    const loadExtrasForUser = async () => {
      if (!selectedUserId) return;
      if (API_BASE_URL) {
        try {
          const res = await apiFetch(
            `${API_BASE_URL}/extras?date=${encodeURIComponent(effectiveExtrasDate)}`
          );
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Extras API failed: ${res.status} ${txt}`);
          }
          const data = await res.json();
          extrasHydratingRef.current[selectedUserId] = true;
          setExtrasByUser((prev) => ({ ...prev, [selectedUserId]: Array.isArray(data.rows) ? data.rows : [] }));
          return;
        } catch (err) {
          setApiError(String(err.message || err));
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
    if (extrasSaveTimerRef.current) {
      clearTimeout(extrasSaveTimerRef.current);
    }
    extrasSaveTimerRef.current = setTimeout(async () => {
      if (API_BASE_URL) {
        try {
          const res = await apiFetch(`${API_BASE_URL}/extras`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: effectiveExtrasDate, rows: userRows }),
          });
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Extras save failed: ${res.status} ${txt}`);
          }
        } catch (err) {
          setApiError(String(err.message || err));
        }
        return;
      }
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(HOME_EXTRAS_STORAGE_KEY);
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          parsed = {};
        }
        const userEntry = parsed?.[selectedUserId];
        const normalizedUserEntry =
          userEntry && typeof userEntry === "object" && !Array.isArray(userEntry)
            ? userEntry
            : {};
        const nextParsed = {
          ...parsed,
          [selectedUserId]: {
            ...normalizedUserEntry,
            [effectiveExtrasDate]: userRows,
          },
        };
        window.localStorage.setItem(HOME_EXTRAS_STORAGE_KEY, JSON.stringify(nextParsed));
      }
    }, 500);
    return () => {
      if (extrasSaveTimerRef.current) clearTimeout(extrasSaveTimerRef.current);
    };
  }, [extrasByUser, selectedUserId, API_BASE_URL, effectiveExtrasDate]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!apiError) return;
    const id = setTimeout(() => setApiError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [apiError]);

  const openTaskModal = (actionType) => {
    setTaskModal({ open: true, playerId: "", actionType });
    setTaskComment("");
  };


  const closeTaskModal = () => {
    setTaskModal({ open: false, playerId: "", actionType: "" });
    setTaskComment("");
  };

  const submitTaskModal = async () => {
    const actionType = taskModal.actionType;
    let detail = "";
    let testType = "";
    if (actionType === "new_class" || actionType === "revision") {
      const exam = taskMeta.exam_type === OTHER_VALUE ? taskMeta.exam_type_other.trim() : taskMeta.exam_type;
      const subject = taskMeta.subject === OTHER_VALUE ? taskMeta.subject_other.trim() : taskMeta.subject;
      const topic = taskMeta.topic === OTHER_VALUE ? taskMeta.topic_other.trim() : taskMeta.topic;
      const workType = taskMeta.work_type || "study";
      detail = [exam, subject, topic, workType].filter(Boolean).join(" | ");
    } else if (actionType === "test_completed") {
      const src = taskTestMeta.source === OTHER_VALUE ? taskTestMeta.source_other.trim() : taskTestMeta.source;
      testType = [taskTestMeta.stage, src, `#${taskTestMeta.test_number}`].filter(Boolean).join(" | ");
      detail = taskTestMeta.note.trim();
    } else if (actionType === "ticket_resolved") {
      const org = taskTicketMeta.org === OTHER_VALUE ? taskTicketMeta.org_other.trim() : taskTicketMeta.org;
      detail = [org, taskTicketMeta.note.trim()].filter(Boolean).join(" | ");
    } else {
      detail = taskComment.trim();
    }
    if (API_BASE_URL) {
      try {
        const res = await apiFetch(`${API_BASE_URL}/points`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_type: actionType, test_type: testType, detail }),
        });
        if (res.ok) {
          setToast(`${ACTION_LABELS[actionType] || "Activity"} logged!`);
        }
      } catch (_) {}
    }
    closeTaskModal();
  };

  const selectedExtras = extrasByUser[selectedUserId] || [];

  useEffect(() => {
    setExtraActionOpenId("");
  }, [selectedUserId]);

  const openExtraModal = () => {
    setExtraModalMode("create");
    setEditingExtraId("");
    setExtraDraft({
      title: "",
      link: "",
      duration: "",
      kind: "time_waste",
    });
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
      title: row.title || "",
      link: row.link || "",
      duration: row.duration || "",
      kind: normalizeExtraKind(row.kind),
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
          : [
              ...(prev[selectedUserId] || []),
              {
                id: `extra:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ...cleanRow,
              },
            ],
    }));
    closeExtraModal();
  };

  const removeExtraRow = (rowId) => {
    setExtrasByUser((prev) => ({
      ...prev,
      [selectedUserId]: (prev[selectedUserId] || []).filter((r) => r.id !== rowId),
    }));
    setExtraActionOpenId("");
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="home" />
        <p className="subtext">"{heroQuote.quote}"</p>
        {heroQuote.author ? <p className="subtext subtext-author">- {heroQuote.author}</p> : null}
        {API_BASE_URL ? (
          <p className={`api-state ${apiError ? "error" : "ok"}`}>
            {apiError ? `API issue: ${apiError}` : "Connected to backend API"}
          </p>
        ) : (
          <p className="api-state warn">Running in local mode (no backend URL configured).</p>
        )}
      </header>

      <section className="scoreboard">
        <TimeTracker onLogActivity={(type) => openTaskModal(type)} />
        <article className="player-card extras-card">
          <div className="player-row">
            <h2 className="player-name">Extras</h2>
            <button className="btn-day secondary" onClick={openExtraModal}>+ Add Row</button>
          </div>
          <div className="extras-table-wrap">
            <table className="extras-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Link (optional)</th>
                  <th>Duration</th>
                  <th>Selector</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedExtras.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="extras-empty">No extras yet</td>
                  </tr>
                ) : (
                  selectedExtras.map((row) => (
                    <tr key={row.id}>
                      <td>{row.title || "-"}</td>
                      <td>
                        {row.link ? (
                          <a href={row.link} target="_blank" rel="noreferrer" className="extras-link">
                            {row.link}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{row.duration || "-"}</td>
                      <td>
                        <span className={`extras-kind-chip ${extraKindClass(row.kind)}`}>
                          {extraKindLabel(row.kind)}
                        </span>
                      </td>
                      <td>
                        <div className="extras-action-wrap">
                          <button
                            className="icon-action-btn"
                            onClick={() => setExtraActionOpenId((prev) => (prev === row.id ? "" : row.id))}
                            aria-label="Open extra actions"
                          >
                            ⋯
                          </button>
                          {extraActionOpenId === row.id ? (
                            <div className="extras-action-menu">
                              <button className="context-item" onClick={() => openEditExtraModal(row)}>Edit</button>
                              <button className="context-item danger" onClick={() => removeExtraRow(row.id)}>Delete</button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {toast ? <div className="reward-toast">{toast}</div> : null}
      {extraModalOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>{extraModalMode === "edit" ? "Edit Extra" : "Add Extra"}</h3>
            <p>{auth?.name || "User"}</p>
            <div className="session-form-grid">
              <input
                className="task-select"
                placeholder="Title"
                value={extraDraft.title}
                onChange={(e) => setExtraDraft((prev) => ({ ...prev, title: e.target.value }))}
              />
              <input
                className="task-select"
                placeholder="Link (optional)"
                value={extraDraft.link}
                onChange={(e) => setExtraDraft((prev) => ({ ...prev, link: e.target.value }))}
              />
              <input
                className="task-select"
                placeholder="Duration (e.g. 30m)"
                value={extraDraft.duration}
                onChange={(e) => setExtraDraft((prev) => ({ ...prev, duration: e.target.value }))}
              />
              <select
                className="task-select"
                value={extraDraft.kind}
                onChange={(e) => setExtraDraft((prev) => ({ ...prev, kind: e.target.value }))}
              >
                {EXTRAS_TYPE_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EXTRAS_KIND_META[kind]?.label || kind}
                  </option>
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
      {taskModal.open ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>Add Activity</h3>
            <p>
              {ACTION_LABELS[taskModal.actionType] || "Task"}
            </p>
            {taskModal.actionType === "test_completed" ? (
              <>
                <div className="session-form-grid">
                  <select
                    className="task-select"
                    value={taskTestMeta.exam_type}
                    onChange={(e) => {
                      const nextExam = e.target.value;
                      setTaskTestMeta((p) => ({
                        ...p,
                        exam_type: nextExam,
                        exam_type_other: nextExam === OTHER_VALUE ? p.exam_type_other : "",
                      }));
                    }}
                  >
                    {TEST_EXAM_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskTestMeta.exam_type === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom exam"
                      value={taskTestMeta.exam_type_other}
                      onChange={(e) => setTaskTestMeta((p) => ({ ...p, exam_type_other: e.target.value }))}
                    />
                  ) : null}
                  <select
                    className="task-select"
                    value={taskTestMeta.source}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextNumbers = getMissionTestNumberOptions(next);
                      setTaskTestMeta((p) => ({
                        ...p,
                        source: next,
                        source_other: next === OTHER_VALUE ? p.source_other : "",
                        test_number: nextNumbers[0] || "1",
                      }));
                    }}
                  >
                    {activeTestSources.map((src) => (
                      <option key={src} value={src}>{toTitle(src)}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskTestMeta.source === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom source"
                      value={taskTestMeta.source_other}
                      onChange={(e) => setTaskTestMeta((p) => ({ ...p, source_other: e.target.value }))}
                    />
                  ) : null}
                  <select
                    className="task-select"
                    value={taskTestMeta.test_number}
                    onChange={(e) => setTaskTestMeta((p) => ({ ...p, test_number: e.target.value }))}
                  >
                    {getMissionTestNumberOptions(taskTestMeta.source).map((num) => (
                      <option key={num} value={num}>{num}</option>
                    ))}
                  </select>
                  <select
                    className="task-select"
                    value={taskTestMeta.stage}
                    onChange={(e) => setTaskTestMeta((p) => ({ ...p, stage: e.target.value }))}
                  >
                    {TEST_STAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="task-textarea"
                  placeholder="Test note..."
                  value={taskTestMeta.note}
                  onChange={(e) => setTaskTestMeta((p) => ({ ...p, note: e.target.value }))}
                />
              </>
            ) : taskModal.actionType === "new_class" || taskModal.actionType === "revision" ? (
              <>
                {missionSelectorLoading ? (
                  <p className="day-state" style={{ marginTop: 0 }}>
                    Loading mission options...
                  </p>
                ) : !hasMissionCatalog ? (
                  <p className="api-state warn" style={{ marginTop: 0 }}>
                    No mission course data found for this user. Please set mission first.
                  </p>
                ) : null}
                <div className="session-form-grid">
                  <select
                    className="task-select"
                    value={taskMeta.exam_type}
                    onChange={(e) => {
                      const nextExam = e.target.value;
                      const nextExamForCatalog = nextExam === OTHER_VALUE ? "" : nextExam;
                      const nextSubjects = nextExamForCatalog ? getSubjectsForExam(nextExamForCatalog, activeCatalog) : [];
                      const nextSubject = nextExam === OTHER_VALUE ? OTHER_VALUE : (nextSubjects[0] || OTHER_VALUE);
                      const nextTopics = nextExamForCatalog && nextSubject !== OTHER_VALUE
                        ? getTopicsForSelection(nextExamForCatalog, nextSubject, activeCatalog)
                        : [];
                      setTaskMeta((p) => ({
                        ...p,
                        exam_type: nextExam,
                        subject: nextSubject,
                        topic: nextTopics[0] || OTHER_VALUE,
                        exam_type_other: nextExam === OTHER_VALUE ? p.exam_type_other : "",
                        subject_other: nextSubject === OTHER_VALUE ? p.subject_other : "",
                        topic_other: (nextTopics[0] || OTHER_VALUE) === OTHER_VALUE ? p.topic_other : ""
                      }));
                    }}
                  >
                    {activeExamOptions.length === 0 ? (
                      <option value="">No mission course</option>
                    ) : activeExamOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskMeta.exam_type === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom exam"
                      value={taskMeta.exam_type_other}
                      onChange={(e) => setTaskMeta((p) => ({ ...p, exam_type_other: e.target.value, subject: OTHER_VALUE, topic: OTHER_VALUE }))}
                    />
                  ) : null}
                  <select
                    className="task-select"
                    value={taskMeta.subject}
                    onChange={(e) => {
                      const nextSubject = e.target.value;
                      const effectiveExamType = taskMeta.exam_type === OTHER_VALUE ? taskMeta.exam_type_other.trim().toLowerCase() : taskMeta.exam_type;
                      const nextTopics = nextSubject === OTHER_VALUE ? [] : getTopicsForSelection(effectiveExamType, nextSubject, activeCatalog);
                      setTaskMeta((p) => ({
                        ...p,
                        subject: nextSubject,
                        topic: nextTopics[0] || OTHER_VALUE,
                        subject_other: nextSubject === OTHER_VALUE ? p.subject_other : "",
                        topic_other: (nextTopics[0] || OTHER_VALUE) === OTHER_VALUE ? p.topic_other : ""
                      }));
                    }}
                  >
                    {(taskMeta.exam_type === OTHER_VALUE ? [] : getSubjectsForExam(taskMeta.exam_type, activeCatalog)).map((subj) => (
                      <option key={subj} value={subj}>{subj}</option>
                    ))}
                    {taskMeta.exam_type !== OTHER_VALUE && getSubjectsForExam(taskMeta.exam_type, activeCatalog).length === 0 ? (
                      <option value="">No subject</option>
                    ) : null}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskMeta.subject === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom subject"
                      value={taskMeta.subject_other}
                      onChange={(e) => setTaskMeta((p) => ({ ...p, subject_other: e.target.value, topic: OTHER_VALUE }))}
                    />
                  ) : null}
                  <select
                    className="task-select"
                    value={taskMeta.topic}
                    onChange={(e) => setTaskMeta((p) => ({ ...p, topic: e.target.value }))}
                  >
                    {(taskMeta.exam_type === OTHER_VALUE || taskMeta.subject === OTHER_VALUE
                      ? []
                      : getTopicsForSelection(taskMeta.exam_type, taskMeta.subject, activeCatalog)).map((topic) => (
                      <option key={topic} value={topic}>{topic}</option>
                    ))}
                    {taskMeta.exam_type !== OTHER_VALUE && taskMeta.subject !== OTHER_VALUE && getTopicsForSelection(taskMeta.exam_type, taskMeta.subject, activeCatalog).length === 0 ? (
                      <option value="">No topic</option>
                    ) : null}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskMeta.topic === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom topic"
                      value={taskMeta.topic_other}
                      onChange={(e) => setTaskMeta((p) => ({ ...p, topic_other: e.target.value }))}
                    />
                  ) : null}
                  {taskModal.actionType === "new_class" ? (
                    <select
                      className="task-select"
                      value={taskMeta.work_type}
                      onChange={(e) => setTaskMeta((p) => ({ ...p, work_type: e.target.value }))}
                    >
                      <option value="study">Class Video Watched</option>
                      <option value="notes">Notes Completed</option>
                    </select>
                  ) : null}
                </div>
                <textarea
                  className="task-textarea"
                  placeholder="Add comment (optional)"
                  value={taskMeta.note}
                  onChange={(e) => setTaskMeta((p) => ({ ...p, note: e.target.value }))}
                />
              </>
            ) : taskModal.actionType === "ticket_resolved" ? (
              <>
                <div className="session-form-grid">
                  <select
                    className="task-select"
                    value={taskTicketMeta.org}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTaskTicketMeta((p) => ({ ...p, org: next, org_other: next === OTHER_VALUE ? p.org_other : "" }));
                    }}
                  >
                    {TICKET_ORG_OPTIONS.map((org) => (
                      <option key={org} value={org}>{org}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other</option>
                  </select>
                  {taskTicketMeta.org === OTHER_VALUE ? (
                    <input
                      className="task-select"
                      placeholder="Type custom org"
                      value={taskTicketMeta.org_other}
                      onChange={(e) => setTaskTicketMeta((p) => ({ ...p, org_other: e.target.value }))}
                    />
                  ) : null}
                </div>
                <textarea
                  className="task-textarea"
                  placeholder="Ticket note..."
                  value={taskTicketMeta.note}
                  onChange={(e) => setTaskTicketMeta((p) => ({ ...p, note: e.target.value }))}
                />
              </>
            ) : (
              <textarea
                className="task-textarea"
                placeholder="Write what was completed..."
                value={taskComment}
                onChange={(e) => setTaskComment(e.target.value)}
              />
            )}
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={closeTaskModal}>Cancel</button>
              <button
                className="btn-save"
                onClick={submitTaskModal}
                disabled={
                  taskModal.actionType === "test_completed"
                    ? !(
                      (taskTestMeta.exam_type === OTHER_VALUE ? taskTestMeta.exam_type_other.trim() : taskTestMeta.exam_type) &&
                      (taskTestMeta.source === OTHER_VALUE ? taskTestMeta.source_other.trim() : taskTestMeta.source) &&
                      taskTestMeta.test_number.trim() &&
                      taskTestMeta.stage
                    )
                    : (taskModal.actionType === "new_class" || taskModal.actionType === "revision")
                      ? !(
                        (taskMeta.exam_type === OTHER_VALUE ? taskMeta.exam_type_other.trim() : taskMeta.exam_type) &&
                        (taskMeta.subject === OTHER_VALUE ? taskMeta.subject_other.trim() : taskMeta.subject) &&
                        (taskMeta.topic === OTHER_VALUE ? taskMeta.topic_other.trim() : taskMeta.topic)
                      )
                      : taskModal.actionType === "ticket_resolved"
                        ? !(
                          (taskTicketMeta.org === OTHER_VALUE ? taskTicketMeta.org_other.trim() : taskTicketMeta.org) &&
                          taskTicketMeta.note.trim()
                        )
                      : !taskComment.trim()
                }
              >
                Save Task
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
