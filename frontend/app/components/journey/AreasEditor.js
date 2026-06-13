"use client";

import { useRef, useState } from "react";

const ACTION_MENU_STYLE = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 40,
  minWidth: 170,
  padding: 6,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(15, 22, 40, 0.98)",
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
};

const ACTION_BTN_STYLE = {
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  fontWeight: 700,
  padding: "8px 10px",
  borderRadius: 8,
  cursor: "pointer",
};

export default function AreasEditor({ plan, onChange }) {
  const courseGroupIdRef = useRef(0);
  const nextCourseGroupId = () => {
    courseGroupIdRef.current += 1;
    return `course_group_${Date.now()}_${courseGroupIdRef.current}`;
  };
  const [courseActionOpen, setCourseActionOpen] = useState("");
  const [editableRows, setEditableRows] = useState({
    course: {},
    book: {},
    random: {},
    test: {},
  });

  const setRowEditable = (kind, idx, editable) => {
    setEditableRows((prev) => ({
      ...prev,
      [kind]: {
        ...(prev[kind] || {}),
        [idx]: Boolean(editable),
      },
    }));
  };

  const isRowEditable = (kind, idx) => Boolean(editableRows?.[kind]?.[idx]);

  const courseRows = Array.isArray(plan?.courses) ? plan.courses : [];
  const courseGroups = (() => {
    const groups = [];
    const map = new Map();
    courseRows.forEach((row, idx) => {
      const courseName = String(row?.course_name || "");
      const trimmed = courseName.trim();
      const rowGroupId = String(row?.__group_id || "").trim();
      const key = rowGroupId || (trimmed ? `name:${trimmed.toLowerCase()}` : `empty:${idx}`);
      if (!map.has(key)) {
        map.set(key, { key, course_name: courseName, rowIndexes: [] });
        groups.push(map.get(key));
      }
      map.get(key).rowIndexes.push(idx);
    });
    return groups;
  })();

  return (
    <div onClick={() => setCourseActionOpen("")}>
      <h4 style={{ marginBottom: 8 }}>Course Plan</h4>
      <p className="day-state" style={{ marginTop: 0 }}>
        Add one course, then add multiple subjects under it. Backend will store each subject as a separate row.
      </p>
      <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
        {courseGroups.map((group) => (
          <div key={group.key} className="content-modal-card" style={{ borderRadius: 12, padding: 12 }}>
            <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
              <small>Course</small>
              <small>Subject</small>
              <small>Classes</small>
              <small>Revisions</small>
              <small>Action</small>
            </div>
            {group.rowIndexes.map((rowIdx, idxInGroup) => {
              const row = courseRows[rowIdx] || {};
              const isFirstRow = idxInGroup === 0;
              return (
                <div
                  key={`course-${rowIdx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("course", rowIdx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
                >
                  {isFirstRow ? (
                    <input
                      className="task-select"
                      placeholder="Course"
                      value={group.course_name || ""}
                      disabled={!isRowEditable("course", rowIdx)}
                      onChange={(e) =>
                        onChange((prev) => {
                          const list = [...(prev.courses || [])];
                          group.rowIndexes.forEach((i) => {
                            list[i] = { ...list[i], course_name: e.target.value };
                          });
                          return { ...prev, courses: list };
                        })
                      }
                    />
                  ) : (
                    <div />
                  )}
                  <input
                    className="task-select"
                    placeholder="Subject"
                    value={row.subject_name || ""}
                    disabled={!isRowEditable("course", rowIdx)}
                    onChange={(e) =>
                      onChange((prev) => {
                        const list = [...(prev.courses || [])];
                        list[rowIdx] = { ...list[rowIdx], subject_name: e.target.value };
                        return { ...prev, courses: list };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={1}
                    placeholder="Classes"
                    value={row.class_count ?? 1}
                    disabled={!isRowEditable("course", rowIdx)}
                    onChange={(e) =>
                      onChange((prev) => {
                        const list = [...(prev.courses || [])];
                        list[rowIdx] = { ...list[rowIdx], class_count: Number(e.target.value || 1) };
                        return { ...prev, courses: list };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={0}
                    max={5}
                    placeholder="Revisions"
                    value={row.revision_count ?? 1}
                    disabled={!isRowEditable("course", rowIdx)}
                    onChange={(e) =>
                      onChange((prev) => {
                        const list = [...(prev.courses || [])];
                        list[rowIdx] = { ...list[rowIdx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                        return { ...prev, courses: list };
                      })
                    }
                  />
                  <div style={{ position: "relative" }}>
                    <span className={`mission-row-state ${isRowEditable("course", rowIdx) ? "editing" : "locked"}`}>
                      {isRowEditable("course", rowIdx) ? "Editing" : "Locked"}
                    </span>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `${group.key}:${rowIdx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `${group.key}:${rowIdx}` ? (
                      <div className="content-row-actions-menu" style={ACTION_MENU_STYLE} onClick={(e) => e.stopPropagation()}>
                        {!isRowEditable("course", rowIdx) ? (
                          <button
                            className="content-row-action"
                            style={{ ...ACTION_BTN_STYLE, color: "#c7d2fe" }}
                            onClick={() => {
                              setRowEditable("course", rowIdx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{ ...ACTION_BTN_STYLE, color: "#86efac" }}
                            onClick={() => {
                              setRowEditable("course", rowIdx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
                        <button
                          className="content-row-action danger"
                          style={{ ...ACTION_BTN_STYLE, color: "#fda4af" }}
                          onClick={() => {
                            onChange((prev) => {
                              const list = [...(prev.courses || [])];
                              list.splice(rowIdx, 1);
                              return { ...prev, courses: list };
                            });
                            setEditableRows((prev) => ({ ...prev, course: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove Subject
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <button
              className="btn-day secondary"
              style={{ width: "100%" }}
              onClick={() =>
                onChange((prev) => {
                  const list = [...(prev.courses || [])];
                  const sample = list[group.rowIndexes[0]] || {};
                  const newIndex = list.length;
                  list.push({
                    course_name: sample.course_name || "",
                    subject_name: "",
                    class_count: Number(sample.class_count || 1),
                    revision_count: Math.min(5, Number(sample.revision_count || 1)),
                    __group_id: sample.__group_id || nextCourseGroupId(),
                  });
                  setTimeout(() => setRowEditable("course", newIndex, true), 0);
                  return { ...prev, courses: list };
                })
              }
            >
              + Add Subject
            </button>
          </div>
        ))}
        <button
          className="btn-day secondary"
          style={{ width: "100%" }}
          onClick={() => {
            const nextIndex = (plan.courses || []).length;
            onChange((prev) => ({
              ...prev,
              courses: [
                ...(prev.courses || []),
                { course_name: "", subject_name: "", class_count: 1, revision_count: 1, __group_id: nextCourseGroupId() },
              ],
            }));
            setTimeout(() => setRowEditable("course", nextIndex, true), 0);
          }}
        >
          + Add Course
        </button>
      </div>

      <h4 style={{ marginBottom: 8, marginTop: 12 }}>Book Plan</h4>
      <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", opacity: 0.8 }}>
          <small>Book Name</small>
          <small>Chapters</small>
          <small>Revisions</small>
          <small>Action</small>
        </div>
        {(plan.books || []).map((row, idx) => (
          <div
            key={`book-${idx}`}
            className={`session-form-grid mission-plan-row ${isRowEditable("book", idx) ? "is-editing" : "is-locked"}`}
            style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}
          >
            <input
              className="task-select"
              placeholder="Book name"
              value={row.book_name || ""}
              disabled={!isRowEditable("book", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.books || [])];
                  list[idx] = { ...list[idx], book_name: e.target.value };
                  return { ...prev, books: list };
                })
              }
            />
            <input
              className="task-select"
              type="number"
              min={1}
              placeholder="Chapters"
              value={row.chapter_count ?? 1}
              disabled={!isRowEditable("book", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.books || [])];
                  list[idx] = { ...list[idx], chapter_count: Number(e.target.value || 1) };
                  return { ...prev, books: list };
                })
              }
            />
            <input
              className="task-select"
              type="number"
              min={0}
              max={5}
              placeholder="Revisions"
              value={row.revision_count ?? 1}
              disabled={!isRowEditable("book", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.books || [])];
                  list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                  return { ...prev, books: list };
                })
              }
            />
            <div style={{ position: "relative" }}>
              <button
                className="btn-day secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  const key = `book:${idx}`;
                  setCourseActionOpen((prev) => (prev === key ? "" : key));
                }}
              >
                ...
              </button>
              {courseActionOpen === `book:${idx}` ? (
                <div className="content-row-actions-menu" style={ACTION_MENU_STYLE} onClick={(e) => e.stopPropagation()}>
                  {!isRowEditable("book", idx) ? (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#c7d2fe" }}
                      onClick={() => {
                        setRowEditable("book", idx, true);
                        setCourseActionOpen("");
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#86efac" }}
                      onClick={() => {
                        setRowEditable("book", idx, false);
                        setCourseActionOpen("");
                      }}
                    >
                      Done
                    </button>
                  )}
                  <button
                    className="content-row-action danger"
                    style={{ ...ACTION_BTN_STYLE, color: "#fda4af" }}
                    onClick={() => {
                      onChange((prev) => {
                        const list = [...(prev.books || [])];
                        list.splice(idx, 1);
                        return { ...prev, books: list };
                      });
                      setEditableRows((prev) => ({ ...prev, book: {} }));
                      setCourseActionOpen("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <button
          className="btn-day secondary"
          onClick={() => {
            const nextIndex = (plan.books || []).length;
            onChange((prev) => ({
              ...prev,
              books: [...(prev.books || []), { book_name: "", chapter_count: 1, revision_count: 1 }],
            }));
            setTimeout(() => setRowEditable("book", nextIndex, true), 0);
          }}
        >
          + Add Book
        </button>
      </div>

      <h4 style={{ marginBottom: 8, marginTop: 12 }}>Random Plan</h4>
      <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr auto", opacity: 0.8 }}>
          <small>Source</small>
          <small>Topic</small>
          <small>Revisions</small>
          <small>Action</small>
        </div>
        {(plan.random || []).map((row, idx) => (
          <div
            key={`random-${idx}`}
            className={`session-form-grid mission-plan-row ${isRowEditable("random", idx) ? "is-editing" : "is-locked"}`}
            style={{ gridTemplateColumns: "2fr 2fr 1fr auto" }}
          >
            <input
              className="task-select"
              placeholder="Source"
              value={row.source || ""}
              disabled={!isRowEditable("random", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.random || [])];
                  list[idx] = { ...list[idx], source: e.target.value };
                  return { ...prev, random: list };
                })
              }
            />
            <input
              className="task-select"
              placeholder="Topic name"
              value={row.topic_name || ""}
              disabled={!isRowEditable("random", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.random || [])];
                  list[idx] = { ...list[idx], topic_name: e.target.value };
                  return { ...prev, random: list };
                })
              }
            />
            <input
              className="task-select"
              type="number"
              min={0}
              max={5}
              placeholder="Revisions"
              value={row.revision_count ?? 1}
              disabled={!isRowEditable("random", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.random || [])];
                  list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                  return { ...prev, random: list };
                })
              }
            />
            <div style={{ position: "relative" }}>
              <button
                className="btn-day secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  const key = `random:${idx}`;
                  setCourseActionOpen((prev) => (prev === key ? "" : key));
                }}
              >
                ...
              </button>
              {courseActionOpen === `random:${idx}` ? (
                <div className="content-row-actions-menu" style={ACTION_MENU_STYLE} onClick={(e) => e.stopPropagation()}>
                  {!isRowEditable("random", idx) ? (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#c7d2fe" }}
                      onClick={() => {
                        setRowEditable("random", idx, true);
                        setCourseActionOpen("");
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#86efac" }}
                      onClick={() => {
                        setRowEditable("random", idx, false);
                        setCourseActionOpen("");
                      }}
                    >
                      Done
                    </button>
                  )}
                  <button
                    className="content-row-action danger"
                    style={{ ...ACTION_BTN_STYLE, color: "#fda4af" }}
                    onClick={() => {
                      onChange((prev) => {
                        const list = [...(prev.random || [])];
                        list.splice(idx, 1);
                        return { ...prev, random: list };
                      });
                      setEditableRows((prev) => ({ ...prev, random: {} }));
                      setCourseActionOpen("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <button
          className="btn-day secondary"
          onClick={() => {
            const nextIndex = (plan.random || []).length;
            onChange((prev) => ({
              ...prev,
              random: [...(prev.random || []), { source: "", topic_name: "", revision_count: 1 }],
            }));
            setTimeout(() => setRowEditable("random", nextIndex, true), 0);
          }}
        >
          + Add Random Topic
        </button>
      </div>

      <h4 style={{ marginBottom: 8, marginTop: 12 }}>Test Plan</h4>
      <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <p className="day-state" style={{ marginTop: 0 }}>
          `Given` and `Analysis` are automatic defaults from `No. Tests`.
        </p>
        <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
          <small>Test</small>
          <small>Source</small>
          <small>No. Tests</small>
          <small>Revisions</small>
          <small>Action</small>
        </div>
        {(plan.tests || []).map((row, idx) => (
          <div
            key={`test-${idx}`}
            className={`session-form-grid mission-plan-row ${isRowEditable("test", idx) ? "is-editing" : "is-locked"}`}
            style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
          >
            <input
              className="task-select"
              placeholder="Test"
              value={row.test_name || ""}
              disabled={!isRowEditable("test", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.tests || [])];
                  list[idx] = { ...list[idx], test_name: e.target.value };
                  return { ...prev, tests: list };
                })
              }
            />
            <input
              className="task-select"
              placeholder="Source"
              value={row.source || ""}
              disabled={!isRowEditable("test", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.tests || [])];
                  list[idx] = { ...list[idx], source: e.target.value };
                  return { ...prev, tests: list };
                })
              }
            />
            <input
              className="task-select"
              type="number"
              min={1}
              placeholder="No. Tests"
              value={row.number_of_tests ?? 1}
              disabled={!isRowEditable("test", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.tests || [])];
                  list[idx] = { ...list[idx], number_of_tests: Number(e.target.value || 1) };
                  return { ...prev, tests: list };
                })
              }
            />
            <input
              className="task-select"
              type="number"
              min={0}
              max={5}
              placeholder="Revisions"
              value={row.revisions ?? 0}
              disabled={!isRowEditable("test", idx)}
              onChange={(e) =>
                onChange((prev) => {
                  const list = [...(prev.tests || [])];
                  list[idx] = { ...list[idx], revisions: Math.min(5, Number(e.target.value || 0)) };
                  return { ...prev, tests: list };
                })
              }
            />
            <div style={{ position: "relative" }}>
              <button
                className="btn-day secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  const key = `test:${idx}`;
                  setCourseActionOpen((prev) => (prev === key ? "" : key));
                }}
              >
                ...
              </button>
              {courseActionOpen === `test:${idx}` ? (
                <div className="content-row-actions-menu" style={ACTION_MENU_STYLE} onClick={(e) => e.stopPropagation()}>
                  {!isRowEditable("test", idx) ? (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#c7d2fe" }}
                      onClick={() => {
                        setRowEditable("test", idx, true);
                        setCourseActionOpen("");
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      className="content-row-action"
                      style={{ ...ACTION_BTN_STYLE, color: "#86efac" }}
                      onClick={() => {
                        setRowEditable("test", idx, false);
                        setCourseActionOpen("");
                      }}
                    >
                      Done
                    </button>
                  )}
                  <button
                    className="content-row-action danger"
                    style={{ ...ACTION_BTN_STYLE, color: "#fda4af" }}
                    onClick={() => {
                      onChange((prev) => {
                        const list = [...(prev.tests || [])];
                        list.splice(idx, 1);
                        return { ...prev, tests: list };
                      });
                      setEditableRows((prev) => ({ ...prev, test: {} }));
                      setCourseActionOpen("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <button
          className="btn-day secondary"
          onClick={() => {
            const nextIndex = (plan.tests || []).length;
            onChange((prev) => ({
              ...prev,
              tests: [
                ...(prev.tests || []),
                { test_name: "", source: "", number_of_tests: 1, revisions: 0 },
              ],
            }));
            setTimeout(() => setRowEditable("test", nextIndex, true), 0);
          }}
        >
          + Add Test Plan
        </button>
      </div>
    </div>
  );
}
