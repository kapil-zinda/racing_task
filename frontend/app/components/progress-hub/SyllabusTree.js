"use client";

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

function RecordingTable({ recordings, playbackByKey, playbackLoadingKey, onPlay }) {
  return (
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
                    onClick={() => onPlay(rec)}
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
  );
}

export default function SyllabusTree({ data, globalTestsBySource, playbackByKey, playbackLoadingKey, onPlay }) {
  const exams = data?.exams || [];

  return (
    <>
      <div className="syllabus-tree">
        {exams.length === 0 ? (
          <p className="day-state">No syllabus progress found yet.</p>
        ) : (
          exams.map((exam) => (
            <details key={exam.exam} className="syllabus-exam">
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

                      <RecordingTable
                        recordings={recordings}
                        playbackByKey={playbackByKey}
                        playbackLoadingKey={playbackLoadingKey}
                        onPlay={onPlay}
                      />
                    </details>
                  );
                })}
              </div>

              {(exam.tickets || []).length > 0 ? (
                <details className="syllabus-tests">
                  <summary>Tickets</summary>
                  {(exam.tickets || []).map((org) => (
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
                  ))}
                </details>
              ) : null}
            </details>
          ))
        )}
      </div>

      {globalTestsBySource.length > 0 ? (
        <details className="syllabus-tests">
          <summary>Tests</summary>
          {globalTestsBySource.map((source) => (
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

              <RecordingTable
                recordings={(source.tests || [])
                  .flatMap((test) => (test.recordings || []).map((rec) => ({
                    ...rec,
                    note: rec.note || `${test.test_name || "Test"} ${test.test_number || ""}`.trim(),
                  })))
                  .filter((rec) => rec?.session_id && rec?.default_media_type)}
                playbackByKey={playbackByKey}
                playbackLoadingKey={playbackLoadingKey}
                onPlay={onPlay}
              />
            </details>
          ))}
        </details>
      ) : null}
    </>
  );
}
