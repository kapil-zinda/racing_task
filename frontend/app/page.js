"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "./components/MainMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const QUOTE_API_URL = "https://motivational-spark-api.vercel.app/api/quotes/random";
const FALLBACK_HERO_QUOTE = {
  quote: "Keep racing and unlock rewards at each milestone.",
  author: "",
};
const NOTICE_TTL_MS = 15000;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";
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

const MILESTONES = [
  { points: 20, reward: "Coffee Treat" },
  { points: 40, reward: "Movie Night" },
  { points: 70, reward: "Dinner Out" },
  { points: 100, reward: "Weekend Mini Trip" }
];

const POINTS_MAP = {
  new_class: 3,
  revision: 2,
  ticket_resolved: 4,
  test_completed: 4
};

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
const EXAM_CATALOG = {
  prelims: [
    "Latest Current Affairs",
    "Static GK",
    "History of India and Indian National Movement",
    "Indian and World Geography",
    "Physical Geography",
    "Social Geography",
    "Economic Geography",
    "Indian Polity and Governance",
    "Constitution",
    "Public Policy Rights",
    "Political System",
    "Rights Issues",
    "Panchayati Raj",
    "Economic and Social Development",
    "Sustainable Development",
    "Poverty",
    "Inclusion",
    "Demographics",
    "Social Sector Initiatives",
    "Environment and Ecology",
    "Biodiversity",
    "Climate Change",
    "Science and Technology"
  ].map((subject) => ({ subject, topics: ["General"] })),
  mains: [
    "History",
    "Modern",
    "World History",
    "Art & Culture",
    "Indian Heritage and Culture",
    "Geography",
    "Human Geography",
    "World Physical Geography",
    "Society",
    "Salient Features of Indian Society",
    "Polity",
    "Indian Constitution & its features, amendments, provisions and bodies",
    "Governance",
    "Social Justice",
    "International Relations",
    "Technology",
    "Economic Development",
    "Biodiversity",
    "Environment",
    "Security",
    "Disaster Management",
    "Ethics",
    "Integrity",
    "Aptitude"
  ].map((subject) => ({ subject, topics: ["General"] })),
  csat: [
    "Comprehension",
    "Interpersonal Skills Including Communication Skills",
    "Logical Reasoning and Analytical Ability",
    "Decision Making and Problem Solving",
    "General Mental Ability",
    "Basic Numeracy",
    "Data Interpretation",
    "English Language Comprehension Skills"
  ].map((subject) => ({ subject, topics: ["General"] })),
  sociology_1: [
    { subject: "Sociology - The Discipline", topics: ["Modernity and emergence of Sociology", "Scope and comparison with other social sciences", "Sociology and common sense"] },
    { subject: "Sociology as Science", topics: ["Scientific method and critique", "Positivism and critique", "Fact value and objectivity", "Non-positivist methodologies"] },
    { subject: "Research Methods and Analysis", topics: ["Qualitative and quantitative methods", "Data collection techniques", "Sampling, hypothesis, reliability, validity"] },
    { subject: "Sociological Thinkers", topics: ["Karl Marx", "Emile Durkheim", "Max Weber", "Talcott Parsons", "Robert K. Merton", "Mead"] },
    { subject: "Stratification and Mobility", topics: ["Inequality and deprivation", "Theories of stratification", "Class/status/gender/ethnicity/race", "Mobility types and causes"] },
    { subject: "Works and Economic Life", topics: ["Work across slave/feudal/capitalist societies", "Formal and informal work", "Labour and society"] },
    { subject: "Politics and Society", topics: ["Theories of power", "Power elite and bureaucracy", "Nation/state/citizenship/democracy", "Movements and revolution"] },
    { subject: "Religion and Society", topics: ["Theories of religion", "Animism/monism/pluralism/sects/cults", "Secularisation/revivalism/fundamentalism"] },
    { subject: "Systems of Kinship", topics: ["Family/household/marriage", "Lineage and descent", "Patriarchy and sexual division of labour", "Contemporary trends"] },
    { subject: "Social Change in Modern Society", topics: ["Theories of social change", "Development and dependency", "Agents of social change", "Education/science/technology"] }
  ],
  sociology_2: [
    { subject: "Perspectives on the Study of Indian Society", topics: ["Indology (G.S. Ghure)", "Structural functionalism (M. N. Srinivas)", "Marxist sociology (A. R. Desai)"] },
    { subject: "Impact of Colonial Rule on Indian Society", topics: ["Indian nationalism background", "Modernization of tradition", "Protests and movements", "Social reforms"] },
    { subject: "Rural and Agrarian Social Structure", topics: ["Indian village studies", "Land tenure and land reforms"] },
    { subject: "Caste System", topics: ["Caste perspectives", "Features of caste", "Untouchability"] },
    { subject: "Tribal Communities in India", topics: ["Definitional problems", "Geographical spread", "Colonial policies", "Integration and autonomy"] },
    { subject: "Social Classes in India", topics: ["Agrarian class structure", "Industrial class structure", "Middle classes"] },
    { subject: "Systems of Kinship in India", topics: ["Lineage and descent", "Family and marriage", "Patriarchy and labour division"] },
    { subject: "Religion and Society", topics: ["Religious communities", "Religious minorities"] },
    { subject: "Visions of Social Change in India", topics: ["Development planning and mixed economy", "Law and social change", "Education and social change"] },
    { subject: "Rural and Agrarian Transformation in India", topics: ["Rural development programmes", "Green revolution", "Agriculture production changes", "Rural labour and migration"] },
    { subject: "Industrialization and Urbanisation in India", topics: ["Modern industry evolution", "Urban settlements growth", "Working class and mobilisation", "Informal sector and slums"] },
    { subject: "Politics and Society", topics: ["Nation/democracy/citizenship", "Parties and pressure groups", "Regionalism/decentralisation", "Secularization"] },
    { subject: "Social Movements in Modern India", topics: ["Peasants/farmers", "Womens movement", "Backward classes and Dalit", "Environmental", "Ethnicity and identity"] },
    { subject: "Population Dynamics", topics: ["Population structure and distribution", "Birth/death/migration", "Population policy", "Ageing/sex ratio/infant mortality/reproductive health"] },
    { subject: "Challenges of Social Transformation", topics: ["Crisis of development", "Poverty and inequality", "Violence against women", "Caste and ethnic conflicts", "Illiteracy and education disparities"] }
  ]
};

const getSubjectsForExam = (examType, catalog = {}) => (catalog[examType] || []).map((entry) => entry.subject);
const getTopicsForSelection = (examType, subject, catalog = {}) => {
  const found = (catalog[examType] || []).find((entry) => entry.subject === subject);
  return found?.topics || [];
};
const getExamOptionsFromCatalog = (catalog = {}) =>
  Object.keys(catalog || {}).map((key) => ({ value: key, label: key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
const SESSION_MEDIA_TYPES = ["audio", "video", "screen"];

const INITIAL_PLAYERS = [
  { key: "kapil", name: "Kapil", points: 0, reached: [], history: [] },
  { key: "divya", name: "Divya", points: 0, reached: [], history: [] }
];

function nextMilestone(points) {
  return MILESTONES.find((m) => m.points > points) || MILESTONES[MILESTONES.length - 1];
}

function rewardsFromReached(reached) {
  return reached
    .map((mark) => MILESTONES.find((m) => m.points === mark))
    .filter(Boolean);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function racePercent(points) {
  return Math.min(Math.max((points / 100) * 100, 0), 100);
}

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function readGlobalUser() {
  if (typeof window === "undefined") return "kapil";
  const raw = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").toLowerCase().trim();
  return raw === "divya" ? "divya" : "kapil";
}

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
  const [players, setPlayers] = useState(INITIAL_PLAYERS);
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
  const [historyOpen, setHistoryOpen] = useState({ kapil: false, divya: false });
  const [deletingHistoryEventId, setDeletingHistoryEventId] = useState("");
  const [todayDate, setTodayDate] = useState("");
  const [availableDates, setAvailableDates] = useState([]);
  const [winnerCounts, setWinnerCounts] = useState({ kapil: 0, divya: 0, tie: 0 });
  const [isEditable, setIsEditable] = useState(true);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [sessionForm, setSessionForm] = useState({
    user_id: "kapil",
    subject: "",
    topic: "",
    session_type: "study",
    notes: "",
    modes: ["audio", "video", "screen"]
  });
  const [sessionList, setSessionList] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const [timerState, setTimerState] = useState({ running: false, startedAt: 0, baseElapsed: 0 });
  const [nowTick, setNowTick] = useState(Date.now());
  const [uploadStatus, setUploadStatus] = useState({ audio: "", video: "", screen: "" });
  const [selectedUserId, setSelectedUserId] = useState("kapil");
  const [extrasByUser, setExtrasByUser] = useState({ kapil: [], divya: [] });
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
  const recorderRefs = useRef({});
  const streamRefs = useRef({});
  const chunkRefs = useRef({ audio: [], video: [], screen: [] });
  const extrasSaveTimerRef = useRef(null);
  const extrasHydratingRef = useRef({ kapil: false, divya: false });

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
    const init = async () => {
      if (API_BASE_URL) {
        try {
          const daysRes = await fetch(`${API_BASE_URL}/days`);
          if (!daysRes.ok) {
            const txt = await daysRes.text();
            throw new Error(`Days API failed: ${daysRes.status} ${txt}`);
          }
          const daysData = await daysRes.json();
          const initialToday = daysData.today || "";
          const dates = daysData.dates || [];
          const preferredHistoryDate = dates.find((d) => d !== initialToday) || dates[0] || initialToday;

          setTodayDate(initialToday);
          setHistoryDate(preferredHistoryDate);
          setAvailableDates(dates);
          setWinnerCounts(daysData.winner_counts || { kapil: 0, divya: 0, tie: 0 });

          const res = await fetch(`${API_BASE_URL}/state?date=${encodeURIComponent(initialToday)}`);
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`State API failed: ${res.status} ${txt}`);
          }
          const data = await res.json();
          setPlayers((prev) =>
            prev.map((p) => ({
              ...p,
              points: data.points?.[p.key] || 0,
              reached: data.reached?.[p.key] || [],
              history: data.history?.[p.key] || []
            }))
          );
          setTodayDate(data.today || initialToday);
          setIsEditable(Boolean(data.editable));
          setWinnerCounts(data.winner_counts || daysData.winner_counts || { kapil: 0, divya: 0, tie: 0 });
          setApiError("");
          return;
        } catch (err) {
          setApiError(String(err.message || err));
          return;
        }
      }

      const saved = localStorage.getItem("race-state");
      if (saved) {
        const parsed = JSON.parse(saved);
        setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            points: parsed[p.key]?.points || 0,
            reached: parsed[p.key]?.reached || [],
            history: parsed[p.key]?.history || []
          }))
        );
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const user = readGlobalUser();
    setSelectedUserId(user);
    setSessionForm((prev) => ({ ...prev, user_id: user }));
    if (!API_BASE_URL) {
      const rawExtras = window.localStorage.getItem(HOME_EXTRAS_STORAGE_KEY);
      if (rawExtras) {
        try {
          const parsed = JSON.parse(rawExtras);
          setExtrasByUser({
            kapil: Array.isArray(parsed?.kapil) ? parsed.kapil : [],
            divya: Array.isArray(parsed?.divya) ? parsed.divya : [],
          });
        } catch (_) {}
      }
    }
    const onGlobalUser = (e) => {
      const nextUser = e?.detail?.userId === "divya" ? "divya" : "kapil";
      setSelectedUserId(nextUser);
      setSessionForm((prev) => ({ ...prev, user_id: nextUser }));
      if (API_BASE_URL) {
        setMissionSelectorLoading(true);
        fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(nextUser)}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Mission options failed"))))
          .then((data) => setMissionSelector({ exam_options: data.exam_options || [], catalog: data.catalog || {}, plan: data.plan || {} }))
          .catch(() => setMissionSelector({ exam_options: [], catalog: {}, plan: {} }))
          .finally(() => setMissionSelectorLoading(false));
      }
    };
    window.addEventListener("global-user-change", onGlobalUser);
    return () => window.removeEventListener("global-user-change", onGlobalUser);
  }, [API_BASE_URL]);

  useEffect(() => {
    if (!API_BASE_URL || !selectedUserId) return;
    setMissionSelectorLoading(true);
    fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(selectedUserId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Mission options failed"))))
      .then((data) => setMissionSelector({ exam_options: data.exam_options || [], catalog: data.catalog || {}, plan: data.plan || {} }))
      .catch(() => setMissionSelector({ exam_options: [], catalog: {}, plan: {} }))
      .finally(() => setMissionSelectorLoading(false));
  }, [API_BASE_URL, selectedUserId]);

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
          const res = await fetch(
            `${API_BASE_URL}/extras?user_id=${encodeURIComponent(selectedUserId)}&date=${encodeURIComponent(effectiveExtrasDate)}`
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
          const res = await fetch(`${API_BASE_URL}/extras`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: selectedUserId, date: effectiveExtrasDate, rows: userRows }),
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
    if (API_BASE_URL) return;
    const snapshot = players.reduce((acc, p) => {
      acc[p.key] = { points: p.points, reached: p.reached, history: p.history };
      return acc;
    }, {});
    localStorage.setItem("race-state", JSON.stringify(snapshot));
  }, [players]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!timerState.running) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerState.running]);

  useEffect(() => {
    if (!apiError) return;
    const id = setTimeout(() => setApiError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [apiError]);

  useEffect(() => {
    if (!historyError) return;
    const id = setTimeout(() => setHistoryError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [historyError]);

  useEffect(() => {
    if (!sessionError) return;
    const id = setTimeout(() => setSessionError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [sessionError]);

  const addPoints = async (playerId, actionType, providedDetail = "", providedTestType = "") => {
    const add = POINTS_MAP[actionType] || 0;
    const detail = providedDetail.trim();
    const testType = providedTestType.trim();
    if (!isEditable) {
      setApiError("Only today's race can be edited.");
      return false;
    }

    if (API_BASE_URL) {
      try {
        const res = await fetch(`${API_BASE_URL}/points`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: playerId, action_type: actionType, test_type: testType, detail })
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Points API failed: ${res.status} ${txt}`);
        }

        const data = await res.json();
        const currentPlayer = players.find((p) => p.key === playerId);
        const beforeReached = currentPlayer?.reached || [];
        const afterReached = data.reached?.[playerId] || [];
        const unlocked = afterReached.find((mark) => !beforeReached.includes(mark));

        if (unlocked) {
          const reward = MILESTONES.find((m) => m.points === unlocked)?.reward || "Reward";
          setToast(`${currentPlayer?.name || playerId} unlocked ${reward} at ${unlocked} points!`);
        }

        setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            points: data.points?.[p.key] || 0,
            reached: data.reached?.[p.key] || [],
            history: data.history?.[p.key] || []
          }))
        );
        setWinnerCounts(data.winner_counts || winnerCounts);
        setIsEditable(Boolean(data.editable));
        setApiError("");
        return true;
      } catch (err) {
        setApiError(String(err.message || err));
        return false;
      }
    }

    setPlayers((prev) =>
      prev.map((p) => {
        if (p.key !== playerId) return p;

        const updatedPoints = p.points + add;
        const updatedReached = [...p.reached];
        const updatedHistory = [...p.history];

        MILESTONES.forEach((m) => {
          if (updatedPoints >= m.points && !updatedReached.includes(m.points)) {
            updatedReached.push(m.points);
            setToast(`${p.name} unlocked ${m.reward} at ${m.points} points!`);
          }
        });

        updatedHistory.unshift({
          action_type: actionType,
          action_label: actionType === "test_completed" && testType ? testType : ACTION_LABELS[actionType],
          detail: detail || (actionType === "test_completed" && testType ? testType : ACTION_LABELS[actionType]),
          points: add,
          created_at: new Date().toISOString()
        });

        return { ...p, points: updatedPoints, reached: updatedReached, history: updatedHistory };
      })
    );
    return true;
  };

  const deleteHistoryEntry = async (eventId) => {
    const id = String(eventId || "").trim();
    if (!id) return;
    if (!isEditable) {
      setApiError("Only today's race can be edited.");
      return;
    }
    if (!API_BASE_URL) {
      setApiError("Delete entry requires backend API.");
      return;
    }
    setDeletingHistoryEventId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/points/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: id }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Delete entry failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setPlayers((prev) =>
        prev.map((p) => ({
          ...p,
          points: data.points?.[p.key] || 0,
          reached: data.reached?.[p.key] || [],
          history: data.history?.[p.key] || [],
        }))
      );
      setWinnerCounts(data.winner_counts || winnerCounts);
      setApiError("");
    } catch (err) {
      setApiError(String(err.message || err));
    } finally {
      setDeletingHistoryEventId("");
    }
  };

  const openTaskModal = async (playerId, actionType) => {
    if (!isEditable) return;
    setTaskModal({ open: true, playerId, actionType });
    setTaskComment("");
    let nextExamOptions = activeExamOptions;
    let nextCatalog = activeCatalog;
    let nextPlan = missionSelector?.plan || {};

    if (API_BASE_URL && (actionType === "new_class" || actionType === "revision" || actionType === "test_completed")) {
      try {
        const res = await fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(playerId)}`);
        if (res.ok) {
          const data = await res.json();
          nextExamOptions = Array.isArray(data?.exam_options) ? data.exam_options : [];
          nextCatalog = data?.catalog && typeof data.catalog === "object" ? data.catalog : {};
          nextPlan = data?.plan && typeof data.plan === "object" ? data.plan : {};
          setMissionSelector({ exam_options: nextExamOptions, catalog: nextCatalog, plan: nextPlan });
        }
      } catch (_) {
        // Keep existing selector state if refresh fails.
      }
    }

    const firstExam = nextExamOptions[0]?.value || "";
    const firstSubject = getSubjectsForExam(firstExam, nextCatalog)[0] || "";
    const firstTopic = getTopicsForSelection(firstExam, firstSubject, nextCatalog)[0] || "";
    const nextMissionTests = Array.isArray(nextPlan?.tests) ? nextPlan.tests : missionTestPlan;
    const nextMissionSources = [...new Set(nextMissionTests.map((row) => String(row?.source || "").trim()).filter(Boolean))];
    const nextActiveSources = nextMissionSources.length ? nextMissionSources : activeTestSources;
    const defaultSource = nextActiveSources[0] || "";
    const sourceRows = nextMissionTests.filter((row) => String(row?.source || "").trim() === defaultSource);
    const maxCount = sourceRows.reduce((mx, row) => Math.max(mx, Number(row?.number_of_tests || 1)), 1);
    const defaultTestNumber = String(maxCount > 0 ? 1 : 1);

    setTaskMeta({
      exam_type: firstExam,
      subject: firstSubject,
      topic: firstTopic,
      exam_type_other: "",
      subject_other: "",
      topic_other: "",
      work_type: "study",
      note: ""
    });
    setTaskTestMeta({
      exam_type: TEST_EXAM_OPTIONS[0].value,
      exam_type_other: "",
      source: defaultSource,
      source_other: "",
      test_number: defaultTestNumber,
      stage: "test_given",
      note: "",
    });
    setTaskTicketMeta({
      org: TICKET_ORG_OPTIONS[0],
      org_other: "",
      note: "",
    });
  };

  const closeTaskModal = () => {
    setTaskModal({ open: false, playerId: "", actionType: "" });
    setTaskComment("");
  };

  const submitTaskModal = async () => {
    const isTestAction = taskModal.actionType === "test_completed";
    const isClassOrRevision = taskModal.actionType === "new_class" || taskModal.actionType === "revision";
    const isNewClassAction = taskModal.actionType === "new_class";
    const isTicketAction = taskModal.actionType === "ticket_resolved";
    const effectiveExamType = taskMeta.exam_type === OTHER_VALUE ? taskMeta.exam_type_other.trim().toLowerCase() : taskMeta.exam_type;
    const examLabelMap = Object.fromEntries(activeExamOptions.map((o) => [o.value, o.label]));
    const effectiveExamLabel = examLabelMap[effectiveExamType] || effectiveExamType;
    const effectiveSubject = taskMeta.subject === OTHER_VALUE ? taskMeta.subject_other.trim() : taskMeta.subject;
    const effectiveTopic = taskMeta.topic === OTHER_VALUE ? taskMeta.topic_other.trim() : taskMeta.topic;
    const testType = isTestAction ? "Test Completed" : "";
    let detail = taskComment.trim();
    if (isClassOrRevision) {
      if (!effectiveExamType || !effectiveSubject || !effectiveTopic) return;
      const note = taskMeta.note.trim();
      if (isNewClassAction) {
        detail = `Exam: ${effectiveExamLabel} | Subject: ${effectiveSubject} | Topic: ${effectiveTopic} | Work: ${taskMeta.work_type || "study"}${note ? ` | Note: ${note}` : ""}`;
      } else {
        detail = `Exam: ${effectiveExamLabel} | Subject: ${effectiveSubject} | Topic: ${effectiveTopic}${note ? ` | Note: ${note}` : ""}`;
      }
    }
    if (isTestAction) {
      const exam = taskTestMeta.exam_type === OTHER_VALUE ? taskTestMeta.exam_type_other.trim().toLowerCase() : taskTestMeta.exam_type;
      const examLabel = examLabelMap[exam] || exam;
      const source = taskTestMeta.source === OTHER_VALUE ? taskTestMeta.source_other.trim().toLowerCase() : taskTestMeta.source;
      const testNumber = taskTestMeta.test_number.trim();
      const stage = taskTestMeta.stage;
      const note = taskTestMeta.note.trim();
      if (!exam || !source || !testNumber || !stage) return;
      detail = `Exam: ${examLabel} | Source: ${source} | Test Number: ${testNumber} | Stage: ${stage}${note ? ` | Note: ${note}` : ""}`;
    }
    if (isTicketAction) {
      const org = taskTicketMeta.org === OTHER_VALUE ? taskTicketMeta.org_other.trim().toLowerCase() : taskTicketMeta.org;
      const note = taskTicketMeta.note.trim();
      if (!org || !note) return;
      detail = `Org: ${org} | Note: ${note}`;
    }
    if (isTestAction && (!testType || !detail)) return;
    if (!isTestAction && !detail) return;
    const ok = await addPoints(taskModal.playerId, taskModal.actionType, detail, testType);
    if (ok) closeTaskModal();
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
    setHistoryData(null);
    setHistoryError("");
    if (!historyDate) {
      const fallback = availableDates.find((d) => d !== todayDate) || availableDates[0] || todayDate;
      setHistoryDate(fallback);
    }
  };

  const closeHistoryModal = () => {
    setHistoryModalOpen(false);
    setHistoryError("");
  };

  const fetchDayHistory = async () => {
    if (!API_BASE_URL || !historyDate) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch(`${API_BASE_URL}/state?date=${encodeURIComponent(historyDate)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`State API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setHistoryData({
        date: data.date || historyDate,
        points: data.points || {},
        reached: data.reached || {},
        history: data.history || {}
      });
    } catch (err) {
      setHistoryError(String(err.message || err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchSessions = async (userValue = sessionForm.user_id) => {
    if (!API_BASE_URL || !userValue) return;
    setSessionLoading(true);
    setSessionError("");
    try {
      const res = await fetch(`${API_BASE_URL}/sessions?user_id=${encodeURIComponent(userValue)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sessions API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSessionList(data.sessions || []);
      if (selectedSession) {
        const refreshed = (data.sessions || []).find((s) => s._id === selectedSession._id);
        if (refreshed) setSelectedSession(refreshed);
      }
    } catch (err) {
      setSessionError(String(err.message || err));
    } finally {
      setSessionLoading(false);
    }
  };

  const createSession = async () => {
    if (!API_BASE_URL) return;
    setSessionError("");
    try {
      const payload = {
        user_id: sessionForm.user_id,
        subject: sessionForm.subject.trim(),
        topic: sessionForm.topic.trim(),
        session_type: sessionForm.session_type,
        notes: sessionForm.notes.trim(),
        modes: sessionForm.modes
      };
      const res = await fetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create session failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSelectedSession(data.session);
      setTimerState({ running: false, startedAt: 0, baseElapsed: data.session?.elapsed_seconds || 0 });
      await fetchSessions(sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const selectSession = (session) => {
    setSelectedSession(session);
    setTimerState({ running: false, startedAt: 0, baseElapsed: session?.elapsed_seconds || 0 });
    setUploadStatus({ audio: "", video: "", screen: "" });
  };

  const stopAndReleaseStreams = () => {
    Object.values(streamRefs.current).forEach((stream) => {
      (stream?.getTracks?.() || []).forEach((t) => t.stop());
    });
    streamRefs.current = {};
  };

  const stopRecordersOnly = async () => {
    const entries = Object.entries(recorderRefs.current);
    if (entries.length === 0) return;
    await Promise.all(entries.map(([mode, rec]) => new Promise((resolve) => {
      if (!rec || rec.state === "inactive") return resolve();
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch (_) {
        resolve();
      }
    })));
  };

  const getMimeForMode = (mode) => {
    if (mode === "audio") return "audio/webm";
    return "video/webm";
  };

  const initRecorders = async (modes) => {
    recorderRefs.current = {};
    chunkRefs.current = { audio: [], video: [], screen: [] };
    const unique = Array.from(new Set(modes || []));
    for (const mode of unique) {
      let stream;
      if (mode === "audio") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else if (mode === "video") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } else if (mode === "screen") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } else {
        continue;
      }
      streamRefs.current[mode] = stream;
      const mimeType = getMimeForMode(mode);
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunkRefs.current[mode].push(e.data);
        }
      };
      recorderRefs.current[mode] = rec;
      rec.start(1000);
    }
  };

  const uploadRecordedBlob = async (mediaType, blob) => {
    if (!API_BASE_URL || !selectedSession?._id || !blob || blob.size === 0) return;
    setUploadStatus((prev) => ({ ...prev, [mediaType]: "Uploading..." }));
    try {
      const contentType = blob.type || (mediaType === "audio" ? "audio/webm" : "video/webm");
      const ext = contentType.includes("mp4") ? "mp4" : "webm";
      const presignRes = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: mediaType,
          content_type: contentType,
          extension: ext
        })
      });
      if (!presignRes.ok) {
        const txt = await presignRes.text();
        throw new Error(`Presign failed: ${presignRes.status} ${txt}`);
      }
      const presignData = await presignRes.json();
      const putRes = await fetch(presignData.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      setUploadStatus((prev) => ({ ...prev, [mediaType]: "Uploaded" }));
    } catch (err) {
      setUploadStatus((prev) => ({ ...prev, [mediaType]: `Error: ${String(err.message || err)}` }));
    }
  };

  const pushSessionStatus = async (status) => {
    if (!API_BASE_URL || !selectedSession?._id) return;
    const elapsed = timerState.running
      ? timerState.baseElapsed + Math.floor((Date.now() - timerState.startedAt) / 1000)
      : timerState.baseElapsed;
    try {
      const res = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, elapsed_seconds: elapsed })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Status update failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSelectedSession(data.session);
      setTimerState({ running: false, startedAt: 0, baseElapsed: data.session?.elapsed_seconds || elapsed });
      await fetchSessions(selectedSession?.user_id || sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const startSession = async () => {
    if (!selectedSession) return;
    setSessionError("");
    try {
      await initRecorders(selectedSession.modes || []);
    } catch (err) {
      stopAndReleaseStreams();
      setSessionError(`Recorder permission/device error: ${String(err.message || err)}`);
      return;
    }
    await pushSessionStatus("started");
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: selectedSession.elapsed_seconds || 0 });
  };

  const pauseSession = async () => {
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "recording") rec.pause();
    });
    await pushSessionStatus("paused");
  };

  const resumeSession = async () => {
    if (!selectedSession) return;
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "paused") rec.resume();
    });
    await pushSessionStatus("resumed");
    const base = selectedSession.elapsed_seconds || timerState.baseElapsed || 0;
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: base });
  };

  const stopSession = async () => {
    await stopRecordersOnly();
    stopAndReleaseStreams();
    await Promise.all(SESSION_MEDIA_TYPES.map(async (m) => {
      const parts = chunkRefs.current[m] || [];
      if (!parts.length) return;
      const blob = new Blob(parts, { type: getMimeForMode(m) });
      await uploadRecordedBlob(m, blob);
    }));
    recorderRefs.current = {};
    chunkRefs.current = { audio: [], video: [], screen: [] };
    await pushSessionStatus("stopped");
  };

  const elapsedDisplay = timerState.running
    ? timerState.baseElapsed + Math.floor((nowTick - timerState.startedAt) / 1000)
    : timerState.baseElapsed;

  const selectedPlayer = players.find((p) => p.key === selectedUserId) || players[0];
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
        {API_BASE_URL ? (
          <div className="top-right-tools">
            <div className="winner-counter compact">
              <span>Kapil Wins: {winnerCounts.kapil || 0}</span>
              <span>Divya Wins: {winnerCounts.divya || 0}</span>
              <span>Ties: {winnerCounts.tie || 0}</span>
            </div>
            <button className="btn-day" onClick={openHistoryModal} disabled={availableDates.length === 0}>
              View Previous Day
            </button>
          </div>
        ) : null}
        <p className="badge">Milestone Reward Challenge</p>
        <div className="race-board">
          {players.map((player) => {
            const percent = racePercent(player.points);
            return (
              <div key={`race-${player.key}`} className="race-lane">
                <div className="race-lane-top">
                  <strong>{player.name}</strong>
                  <span>{Math.min(player.points, 100)} / 100</span>
                </div>
                <div className="race-track">
                  <div className="track-line" />
                  <div className="track-fill" style={{ width: `${percent}%` }} />
                  <div className="race-horse" style={{ left: `calc(${percent}% - 16px)` }}>
                    <span className="horse-emoji" aria-hidden="true">
                      {player.key === "divya" ? "🏃‍♀️" : "🏃‍♂️"}
                    </span>
                  </div>
                  <div className="finish-flag">🏁</div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="subtext">"{heroQuote.quote}"</p>
        {heroQuote.author ? <p className="subtext subtext-author">- {heroQuote.author}</p> : null}
        <div className="legend">
          <span><i className="dot dot-gold" />New Class: +3</span>
          <span><i className="dot dot-blue" />Revision: +2</span>
          <span><i className="dot dot-red" />Ticket Resolved: +4</span>
        </div>
        {API_BASE_URL ? (
          <p className={`api-state ${apiError ? "error" : "ok"}`}>
            {apiError ? `API issue: ${apiError}` : "Connected to backend API"}
          </p>
        ) : (
          <p className="api-state warn">Running in local mode (no backend URL configured).</p>
        )}
      </header>

      <section className="scoreboard">
        {selectedPlayer ? (
          <article className="player-card" key={selectedPlayer.key}>
            <div className="player-row">
              <h2 className="player-name">{selectedPlayer.name}</h2>
              <div className="player-points">{selectedPlayer.points}</div>
            </div>

            <div className="progress-wrap">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.min((selectedPlayer.points / nextMilestone(selectedPlayer.points).points) * 100, 100)}%` }} />
              </div>
              <div className="progress-label">Next reward at {nextMilestone(selectedPlayer.points).points} points</div>
            </div>

            <div className="action-grid">
              <button className="btn-new" disabled={!isEditable} onClick={() => openTaskModal(selectedPlayer.key, "new_class")}>+ New Class</button>
              <button className="btn-revise" disabled={!isEditable} onClick={() => openTaskModal(selectedPlayer.key, "revision")}>+ Revision</button>
              {selectedPlayer.key === "divya" ? (
                <button className="btn-ticket" disabled={!isEditable} onClick={() => openTaskModal(selectedPlayer.key, "test_completed")}>+ Tests</button>
              ) : (
                <button className="btn-ticket" disabled={!isEditable} onClick={() => openTaskModal(selectedPlayer.key, "ticket_resolved")}>+ Ticket</button>
              )}
            </div>

            <div className="earned-wrap">
              <h3>{selectedPlayer.name} Rewards</h3>
              <div className="earned-list">
                {rewardsFromReached(selectedPlayer.reached).length === 0 ? (
                  <span className="earned-empty">No rewards yet</span>
                ) : (
                  rewardsFromReached(selectedPlayer.reached).map((r) => (
                    <span key={`${selectedPlayer.key}-${r.points}`} className="earned-chip">
                      {r.reward} ({r.points})
                    </span>
                  ))
                )}
              </div>
            </div>

            <button
              className="history-toggle"
              onClick={() => setHistoryOpen((prev) => ({ ...prev, [selectedPlayer.key]: !prev[selectedPlayer.key] }))}
            >
              {historyOpen[selectedPlayer.key] ? "Hide History" : "View History"}
            </button>

            {historyOpen[selectedPlayer.key] ? (
              <div className="history-wrap">
                <h3>{selectedPlayer.name} Activity History</h3>
                <div className="history-list">
                  {selectedPlayer.history.length === 0 ? (
                    <span className="history-empty">No activity logged yet</span>
                  ) : (
                    selectedPlayer.history.slice(0, 8).map((item, idx) => (
                      <div key={`${selectedPlayer.key}-${item.created_at}-${idx}`} className="history-item">
                        <div className="history-top">
                          <span className="history-action">{item.action_label || ACTION_LABELS[item.action_type] || "Task"}</span>
                          <div className="history-actions">
                            <span className="history-points">+{item.points}</span>
                            {API_BASE_URL && isEditable && item.event_id ? (
                              <button
                                className="history-delete-btn"
                                onClick={() => deleteHistoryEntry(item.event_id)}
                                disabled={deletingHistoryEventId === item.event_id}
                                title="Delete this entry"
                              >
                                {deletingHistoryEventId === item.event_id ? "Deleting..." : "Delete"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="history-detail">{item.detail}</div>
                        <div className="history-time">{formatTime(item.created_at)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </article>
        ) : null}

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

      <section className="milestone-panel">
        <h2>Milestones & Rewards</h2>
        <div className="milestone-list">
          {MILESTONES.map((m) => (
            <article key={m.points} className="milestone-item">
              <h3>{m.points} pts</h3>
              <p>Reward: {m.reward}</p>
              <div className="milestone-owners">
                {players.map((p) => (
                  <span key={`${m.points}-${p.key}`} className={p.reached.includes(m.points) ? "owner won" : "owner"}>
                    {p.name}: {p.reached.includes(m.points) ? "Unlocked" : "Pending"}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {toast ? <div className="reward-toast">{toast}</div> : null}
      {extraModalOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>{extraModalMode === "edit" ? "Edit Extra" : "Add Extra"}</h3>
            <p>{players.find((p) => p.key === selectedUserId)?.name || "User"}</p>
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
              {players.find((p) => p.key === taskModal.playerId)?.name} -{" "}
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
      {historyModalOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal">
            <h3>Previous Day Result</h3>
            <p>Select a date and load race summary in this popup.</p>
            <div className="day-picker-row">
              <select
                className="day-picker"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
              >
                {availableDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <button className="btn-day" onClick={fetchDayHistory} disabled={!historyDate || historyLoading}>
                Load Result
              </button>
            </div>
            {historyError ? <p className="api-state error">{historyError}</p> : null}
            {historyLoading ? <p className="day-state">Loading...</p> : null}
            {historyData ? (
              <div className="popup-result">
                <p className="day-state">Date: {historyData.date}</p>
                <div className="popup-score-row">
                  <div className="popup-score-card">Kapil: {historyData.points?.kapil || 0}</div>
                  <div className="popup-score-card">Divya: {historyData.points?.divya || 0}</div>
                </div>
                <div className="popup-history-grid">
                  {["kapil", "divya"].map((key) => (
                    <div key={key} className="popup-history-card">
                      <h4>{key === "kapil" ? "Kapil" : "Divya"} History</h4>
                      <div className="history-list">
                        {(historyData.history?.[key] || []).length === 0 ? (
                          <span className="history-empty">No activity logged</span>
                        ) : (
                          (historyData.history?.[key] || []).slice(0, 8).map((item, idx) => (
                            <div key={`${key}-${item.created_at}-${idx}`} className="history-item">
                              <div className="history-top">
                                <span className="history-action">{item.action_label || "Task"}</span>
                                <span className="history-points">+{item.points}</span>
                              </div>
                              <div className="history-detail">{item.detail}</div>
                              <div className="history-time">{formatTime(item.created_at)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={closeHistoryModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
