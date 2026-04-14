"use client";

import { useEffect, useState } from "react";
import MainMenu from "../components/MainMenu";
import ActivityInternalMenu from "../components/ActivityInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";
const REVISION_HEADERS = [
  "First Revision Date",
  "Second Revision Date",
  "Third Revision Date",
  "Fourth Revision Date",
  "Fifth Revision Date",
];

function labelDate(value) {
  if (!value) return "-";
  return value;
}

function subjectRecordings(subject) {
  return (subject.topics || []).flatMap((topic) =>
    (topic.recordings || []).map((rec, idx) => ({
      key: `${subject.subject}-${topic.topic}-rec-${idx}`,
      note: rec.note || topic.topic,
      date: rec.date || "",
      session_id: rec.session_id || "",
      default_media_type: rec.default_media_type || "",
    }))
  );
}

export default function SyllabusPage() {
  const [userId, setUserId] = useState("kapil");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ exams: [] });
  const [missionPlanTests, setMissionPlanTests] = useState([]);
  const [playbackByKey, setPlaybackByKey] = useState({});
  const [playbackLoadingKey, setPlaybackLoadingKey] = useState("");

  const loadSyllabus = async (nextUser = userId) => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/syllabus?user_id=${encodeURIComponent(nextUser)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Syllabus API failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      setData(json || { exams: [] });
      try {
        const optRes = await fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(nextUser)}`);
        if (optRes.ok) {
          const optJson = await optRes.json();
          const planTests = Array.isArray(optJson?.plan?.tests) ? optJson.plan.tests : [];
          setMissionPlanTests(planTests);
        } else {
          setMissionPlanTests([]);
        }
      } catch (_) {
        setMissionPlanTests([]);
      }
      setPlaybackByKey({});
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      loadSyllabus("kapil");
      return;
    }
    const initialUser = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").toLowerCase() === "divya" ? "divya" : "kapil";
    setUserId(initialUser);
    loadSyllabus(initialUser);
    const onGlobalUser = (e) => {
      const nextUser = e?.detail?.userId === "divya" ? "divya" : "kapil";
      setUserId(nextUser);
      loadSyllabus(nextUser);
    };
    window.addEventListener("global-user-change", onGlobalUser);
    return () => window.removeEventListener("global-user-change", onGlobalUser);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const playRecording = async (rec) => {
    if (!API_BASE_URL || !rec.session_id || !rec.default_media_type) return;
    setPlaybackLoadingKey(rec.key);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(rec.session_id)}/playback-url?media_type=${encodeURIComponent(rec.default_media_type)}`
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Playback API failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      setPlaybackByKey((prev) => ({
        ...prev,
        [rec.key]: {
          url: json.playback_url || "",
          mediaType: rec.default_media_type,
        }
      }));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setPlaybackLoadingKey("");
    }
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="syllabus" />
        <ActivityInternalMenu active="syllabus" />
        <h1>Syllabus Tracker</h1>
        <p className="subtext">Expandable progress map for classes, revisions, recordings, and tests.</p>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for syllabus API.</p>
        ) : (
          <>
            <div className="session-form-grid">
              <button className="btn-day" onClick={() => loadSyllabus(userId)}>Refresh</button>
            </div>
            {error ? <p className="api-state error">{error}</p> : null}
            {loading ? <p className="day-state">Loading syllabus...</p> : null}

            <div className="syllabus-tree">
              {(data.exams || []).length === 0 ? (
                <p className="day-state">No syllabus progress found yet.</p>
              ) : (
                (data.exams || []).map((exam) => (
                  <details key={exam.exam} className="syllabus-exam" open>
                    <summary>{exam.exam}</summary>

                    <div className="syllabus-subjects">
                      {(exam.subjects || []).map((subject) => {
                        const recordings = subjectRecordings(subject);
                        const topicRows = subject.topics || [];
                        const maxRevisionCols = Math.max(
                          1,
                          ...topicRows.map((topic) => {
                            const n = Number(topic?.revision_limit || 0);
                            if (!Number.isFinite(n)) return 1;
                            return Math.max(1, Math.min(5, n));
                          }),
                        );
                        return (
                          <details key={`${exam.exam}-${subject.subject}`} className="syllabus-subject">
                            <summary>{subject.subject}</summary>

                            <div className="syllabus-table-wrap">
                              <table className="syllabus-table">
                                <thead>
                                  <tr>
                                    <th>Topic</th>
                                    <th>Class/Study First Date</th>
                                    {REVISION_HEADERS.slice(0, maxRevisionCols).map((header) => (
                                      <th key={`${subject.subject}-${header}`}>{header}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {topicRows.map((topic) => (
                                    <tr key={`${subject.subject}-${topic.topic}`}>
                                      <td>{topic.topic}</td>
                                      <td>{labelDate(topic.class_study_first_date)}</td>
                                      {Array.from({ length: maxRevisionCols }, (_, idx) => (
                                        <td key={`${topic.topic}-rev-${idx}`}>
                                          {labelDate((topic.revision_dates || [])[idx] || "")}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="syllabus-table-wrap">
                              <table className="syllabus-table">
                                <thead>
                                  <tr>
                                    <th>Recording Note</th>
                                    <th>Date</th>
                                    <th>Play</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recordings.length === 0 ? (
                                    <tr>
                                      <td colSpan={3}>No recording</td>
                                    </tr>
                                  ) : (
                                    recordings.map((rec) => (
                                      <tr key={rec.key}>
                                        <td>{rec.note}</td>
                                        <td>{labelDate(rec.date)}</td>
                                        <td>
                                          <button
                                            className="btn-day secondary"
                                            disabled={!rec.session_id || !rec.default_media_type || playbackLoadingKey === rec.key}
                                            onClick={() => playRecording(rec)}
                                          >
                                            {playbackLoadingKey === rec.key ? "Loading..." : "Play"}
                                          </button>
                                          {playbackByKey[rec.key]?.url ? (
                                            playbackByKey[rec.key].mediaType === "audio" ? (
                                              <audio className="session-player" controls preload="metadata" src={playbackByKey[rec.key].url} />
                                            ) : (
                                              <video className="session-player" controls preload="metadata" playsInline src={playbackByKey[rec.key].url} />
                                            )
                                          ) : null}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        );
                      })}
                    </div>

                    {userId === "divya" ? (
                      <details className="syllabus-tests">
                        <summary>Tests</summary>
                        {missionPlanTests.length > 0 ? (
                          <div className="syllabus-table-wrap">
                            <table className="syllabus-table">
                              <thead>
                                <tr>
                                  <th>Test</th>
                                  <th>Source</th>
                                  <th>Number of Tests</th>
                                  <th>Given</th>
                                  <th>Analysis</th>
                                  <th>Revisions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {missionPlanTests.map((row, idx) => (
                                  <tr key={`mission-test-${idx}`}>
                                    <td>{row.test_name || "-"}</td>
                                    <td>{row.source || "-"}</td>
                                    <td>{row.number_of_tests ?? 0}</td>
                                    <td>{row.test_given ?? 0}</td>
                                    <td>{row.analysis_done ?? 0}</td>
                                    <td>{row.revisions ?? 0}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        {(exam.tests || []).length === 0 ? (
                          <p className="day-state">No tests logged for this exam yet.</p>
                        ) : (
                          (exam.tests || []).map((source) => (
                            <details key={`${exam.exam}-src-${source.source}`} className="syllabus-source">
                              <summary>Source: {source.source}</summary>
                              <div className="syllabus-table-wrap">
                                <table className="syllabus-table">
                                  <thead>
                                    <tr>
                                      <th>Test</th>
                                      <th>Test Number</th>
                                      <th>Note</th>
                                      <th>Test Given Date</th>
                                      <th>Analysis</th>
                                      <th>Revision</th>
                                      <th>Second Revision</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(source.tests || []).length === 0 ? (
                                      <tr>
                                        <td colSpan={7}>No tests</td>
                                      </tr>
                                    ) : (
                                      (source.tests || []).map((test) => (
                                        <tr key={`${source.source}-${test.test_number}`}>
                                          <td>{test.test_name || "-"}</td>
                                          <td>{test.test_number || "-"}</td>
                                          <td>{test.note || "-"}</td>
                                          <td>{labelDate(test.test_given_date)}</td>
                                          <td>{labelDate(test.analysis_done_date)}</td>
                                          <td>{labelDate(test.revision_date)}</td>
                                          <td>{labelDate(test.second_revision_date)}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          ))
                        )}
                      </details>
                    ) : null}

                    {userId === "kapil" ? (
                      <details className="syllabus-tests">
                        <summary>Tickets</summary>
                        {(exam.tickets || []).length === 0 ? (
                          <p className="day-state">No tickets logged for this exam yet.</p>
                        ) : (
                          (exam.tickets || []).map((org) => (
                            <details key={`${exam.exam}-org-${org.org}`} className="syllabus-source">
                              <summary>Org: {org.org}</summary>
                              <div className="syllabus-table-wrap">
                                <table className="syllabus-table">
                                  <thead>
                                    <tr>
                                      <th>Ticket Note</th>
                                      <th>Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(org.tickets || []).length === 0 ? (
                                      <tr>
                                        <td colSpan={2}>No tickets</td>
                                      </tr>
                                    ) : (
                                      (org.tickets || []).map((row, idx) => (
                                        <tr key={`${org.org}-${idx}`}>
                                          <td>{row.note || "-"}</td>
                                          <td>{labelDate(row.date)}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          ))
                        )}
                      </details>
                    ) : null}
                  </details>
                ))
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
