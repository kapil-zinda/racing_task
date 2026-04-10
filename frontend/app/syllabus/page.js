"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

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
      setPlaybackByKey({});
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSyllabus("kapil");
  }, []);

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
        <div className="top-nav-links">
          <Link href="/" className="top-nav-link">Home</Link>
          <Link href="/recorder" className="top-nav-link">Recorder</Link>
          <Link href="/syllabus" className="top-nav-link active">Syllabus</Link>
          <Link href="/mission" className="top-nav-link">Mission</Link>
        </div>
        <p className="badge">Study Map</p>
        <h1>Syllabus Tracker</h1>
        <p className="subtext">Expandable progress map for classes, revisions, recordings, and tests.</p>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for syllabus API.</p>
        ) : (
          <>
            <div className="session-form-grid">
              <select
                className="task-select"
                value={userId}
                onChange={async (e) => {
                  const next = e.target.value;
                  setUserId(next);
                  await loadSyllabus(next);
                }}
              >
                <option value="kapil">Kapil</option>
                <option value="divya">Divya</option>
              </select>
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
                        return (
                          <details key={`${exam.exam}-${subject.subject}`} className="syllabus-subject">
                            <summary>{subject.subject}</summary>

                            <div className="syllabus-table-wrap">
                              <table className="syllabus-table">
                                <thead>
                                  <tr>
                                    <th>Topic</th>
                                    <th>Class/Study First Date</th>
                                    <th>First Revision Date</th>
                                    <th>Second Revision Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(subject.topics || []).map((topic) => (
                                    <tr key={`${subject.subject}-${topic.topic}`}>
                                      <td>{topic.topic}</td>
                                      <td>{labelDate(topic.class_study_first_date)}</td>
                                      <td>{labelDate(topic.first_revision_date)}</td>
                                      <td>{labelDate(topic.second_revision_date)}</td>
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
                                      <th>Test Number</th>
                                      <th>Note</th>
                                      <th>Test Given Date</th>
                                      <th>Revision</th>
                                      <th>Second Revision</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(source.tests || []).length === 0 ? (
                                      <tr>
                                        <td colSpan={5}>No tests</td>
                                      </tr>
                                    ) : (
                                      (source.tests || []).map((test) => (
                                        <tr key={`${source.source}-${test.test_number}`}>
                                          <td>{test.test_number || "-"}</td>
                                          <td>{test.note || "-"}</td>
                                          <td>{labelDate(test.test_given_date)}</td>
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
