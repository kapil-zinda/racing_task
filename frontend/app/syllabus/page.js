"use client";

import { useEffect, useMemo, useState } from "react";
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

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

export default function SyllabusPage() {
  const [userId, setUserId] = useState("kapil");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({ exams: [] });
  const [playbackByKey, setPlaybackByKey] = useState({});
  const [playbackLoadingKey, setPlaybackLoadingKey] = useState("");

  const globalTestsBySource = useMemo(() => {
    const exams = Array.isArray(data?.exams) ? data.exams : [];
    const bySource = new Map();
    const recordingIndex = new Map();

    exams.forEach((exam) => {
      const examName = exam?.exam || "General";
      (exam?.subjects || []).forEach((subject) => {
        const subjectName = subject?.subject || "General";
        (subject?.topics || []).forEach((topic) => {
          const topicName = topic?.topic || "General";
          const recordings = (topic?.recordings || [])
            .filter((rec) => rec?.session_id && rec?.default_media_type)
            .map((rec, idx) => ({
              key: `test-rec-${norm(examName)}-${norm(subjectName)}-${norm(topicName)}-${idx}-${rec.session_id}`,
              note: rec.note || topicName,
              date: rec.date || "",
              session_id: rec.session_id,
              default_media_type: rec.default_media_type,
            }));
          if (recordings.length > 0) {
            recordingIndex.set(`${norm(examName)}||${norm(subjectName)}||${norm(topicName)}`, recordings);
          }
        });
      });
    });

    exams.forEach((exam) => {
      const examName = exam?.exam || "General";
      (exam?.tests || []).forEach((sourceBlock) => {
        const sourceName = sourceBlock?.source || "General";
        if (!bySource.has(sourceName)) bySource.set(sourceName, []);

        (sourceBlock?.tests || []).forEach((test) => {
          const testNumber = String(test?.test_number || "").trim();
          const testName = String(test?.test_name || "").trim();
          const dedupeKey = `${norm(examName)}||${norm(sourceName)}||${norm(testNumber)}||${norm(testName)}`;
          const list = bySource.get(sourceName);
          if (list.some((row) => row._dedupeKey === dedupeKey)) return;

          const directRecordings = Array.isArray(test?.recordings)
            ? test.recordings
                .filter((rec) => rec?.session_id && rec?.default_media_type)
                .map((rec, idx) => ({
                  key: `test-row-rec-${norm(examName)}-${norm(sourceName)}-${norm(testNumber)}-${idx}-${rec.session_id}`,
                  note: rec.note || testName || `Test ${testNumber}`,
                  date: rec.date || "",
                  session_id: rec.session_id,
                  default_media_type: rec.default_media_type,
                }))
            : [];

          let linkedRecordings = directRecordings;
          if (linkedRecordings.length === 0) {
            const candidates = [testName, `Test ${testNumber}`, testNumber].filter((v) => v && v.trim());
            for (const candidate of candidates) {
              const hit = recordingIndex.get(`${norm(examName)}||${norm(sourceName)}||${norm(candidate)}`);
              if (hit?.length) {
                linkedRecordings = hit;
                break;
              }
            }
          }

          list.push({
            _dedupeKey: dedupeKey,
            exam: examName,
            test_name: testName,
            test_number: testNumber,
            note: test?.note || "",
            test_given_date: test?.test_given_date || "",
            analysis_done_date: test?.analysis_done_date || "",
            revision_date: test?.revision_date || "",
            second_revision_date: test?.second_revision_date || "",
            recordings: linkedRecordings,
          });
        });
      });
    });

    return Array.from(bySource.entries())
      .map(([source, tests]) => ({
        source,
        tests: tests
          .slice()
          .sort((a, b) => {
            const aNum = Number(a.test_number);
            const bNum = Number(b.test_number);
            if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
            return String(a.test_number).localeCompare(String(b.test_number));
          }),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }, [data]);

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

            {userId === "divya" ? (
              <details className="syllabus-tests" open>
                <summary>Tests</summary>
                {globalTestsBySource.length === 0 ? (
                  <p className="day-state">No tests logged yet.</p>
                ) : (
                  globalTestsBySource.map((source) => (
                    <details key={`global-tests-${source.source}`} className="syllabus-source">
                      <summary>Source: {source.source}</summary>
                      <div className="syllabus-table-wrap">
                        <table className="syllabus-table">
                          <thead>
                            <tr>
                              <th>Exam</th>
                              <th>Test Number</th>
                              <th>Test Given Date</th>
                              <th>Analysis</th>
                              <th>Revision</th>
                              <th>Second Revision</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(source.tests || []).length === 0 ? (
                              <tr>
                                <td colSpan={6}>No tests</td>
                              </tr>
                            ) : (
                              (source.tests || []).map((test) => (
                                <tr key={test._dedupeKey}>
                                  <td>{test.exam || "-"}</td>
                                  <td>{test.test_number || "-"}</td>
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
                            {(() => {
                              const allRecordings = (source.tests || [])
                                .flatMap((test) => (test.recordings || []).map((rec) => ({
                                  ...rec,
                                  note: rec.note || `${test.test_name || "Test"} ${test.test_number || ""}`.trim(),
                                })))
                                .filter((rec) => rec?.session_id && rec?.default_media_type);
                              if (allRecordings.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={3}>No recording</td>
                                  </tr>
                                );
                              }
                              return allRecordings.map((rec) => (
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
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))
                )}
              </details>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
