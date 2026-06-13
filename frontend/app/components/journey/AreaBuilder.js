"use client";

import { useMemo, useRef, useState } from "react";

function clampNumber(value, min, max) {
  let val = value;
  if (typeof min === "number") val = Math.max(min, val);
  if (typeof max === "number") val = Math.min(max, val);
  return val;
}

export function groupCourses(courseRows) {
  const rows = Array.isArray(courseRows) ? courseRows : [];
  const groups = [];
  const map = new Map();
  rows.forEach((row, idx) => {
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
}

function AreaForm({ fields, values, onChange, onSave, onCancel, saveLabel = "Add" }) {
  return (
    <div className="area-form">
      <div className="area-form-grid">
        {fields.map((f) => (
          <div className="area-form-field" key={f.key}>
            <label>{f.label}</label>
            <input
              className="task-select"
              type={f.type || "text"}
              min={f.min}
              max={f.max}
              placeholder={f.placeholder || ""}
              value={values[f.key] ?? (f.type === "number" ? f.min ?? 0 : "")}
              onChange={(e) => {
                const raw = e.target.value;
                let val = raw;
                if (f.type === "number") {
                  val = clampNumber(Number(raw || f.min || 0), f.min, f.max);
                }
                onChange({ ...values, [f.key]: val });
              }}
            />
          </div>
        ))}
      </div>
      <div className="area-form-actions">
        <button type="button" className="btn-day secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-day" onClick={onSave}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function AreaCardSection({ icon, title, description, items, fields, renderSummary, addLabel, emptyText, onAdd, onUpdate, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [editingIdx, setEditingIdx] = useState(-1);
  const [formValues, setFormValues] = useState({});

  const defaultsFor = () => {
    const d = {};
    fields.forEach((f) => {
      d[f.key] = f.default ?? (f.type === "number" ? f.min ?? 0 : "");
    });
    return d;
  };

  const openAdd = () => {
    setFormValues(defaultsFor());
    setEditingIdx(-1);
    setAdding(true);
  };

  const openEdit = (idx) => {
    setFormValues({ ...items[idx] });
    setAdding(false);
    setEditingIdx(idx);
  };

  const cancel = () => {
    setAdding(false);
    setEditingIdx(-1);
  };

  const save = () => {
    if (adding) onAdd(formValues);
    else onUpdate(editingIdx, formValues);
    cancel();
  };

  return (
    <section>
      <div className="area-step-head">
        <span className="area-step-icon" aria-hidden="true">{icon}</span>
        <div>
          <h4>{title}</h4>
          <p className="day-state">{description}</p>
        </div>
      </div>

      {items.length === 0 && !adding ? <div className="area-empty">{emptyText}</div> : null}

      <div className="area-list">
        {items.map((item, idx) =>
          editingIdx === idx ? (
            <AreaForm key={idx} fields={fields} values={formValues} onChange={setFormValues} onSave={save} onCancel={cancel} saveLabel="Update" />
          ) : (
            <div key={idx} className="area-card">
              <div className="area-card-main">{renderSummary(item)}</div>
              <div className="area-card-actions">
                <button type="button" className="area-icon-btn" aria-label="Edit" onClick={() => openEdit(idx)}>
                  ✏️
                </button>
                <button type="button" className="area-icon-btn danger" aria-label="Remove" onClick={() => onRemove(idx)}>
                  🗑️
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {adding ? (
        <AreaForm fields={fields} values={formValues} onChange={setFormValues} onSave={save} onCancel={cancel} saveLabel="Add" />
      ) : (
        <button type="button" className="area-add-btn" onClick={openAdd}>
          {addLabel}
        </button>
      )}
    </section>
  );
}

const SUBJECT_FIELDS = [
  { key: "subject_name", label: "Subject", placeholder: "e.g. Polity" },
  { key: "class_count", label: "Classes", type: "number", min: 1, default: 1 },
  { key: "revision_count", label: "Revisions", type: "number", min: 0, max: 5, default: 1 },
];

const COURSE_FIELDS = [{ key: "course_name", label: "Course name", placeholder: "e.g. Foundation Batch" }, ...SUBJECT_FIELDS];

export function CourseAreaStep({ plan, onChange }) {
  const courseRows = plan?.courses || [];
  const courseGroups = useMemo(() => groupCourses(courseRows), [courseRows]);
  const groupIdRef = useRef(0);
  const nextGroupId = () => {
    groupIdRef.current += 1;
    return `course_group_${Date.now()}_${groupIdRef.current}`;
  };

  const [activeForm, setActiveForm] = useState(null);
  const [formValues, setFormValues] = useState({});

  const cancel = () => {
    setActiveForm(null);
    setFormValues({});
  };

  const openAddCourse = () => {
    setFormValues({ course_name: "", subject_name: "", class_count: 1, revision_count: 1 });
    setActiveForm({ type: "add-course" });
  };

  const openAddSubject = (groupKey, sample) => {
    setFormValues({
      subject_name: "",
      class_count: Number(sample?.class_count || 1),
      revision_count: clampNumber(Number(sample?.revision_count ?? 1), 0, 5),
    });
    setActiveForm({ type: "add-subject", groupKey });
  };

  const openEditSubject = (rowIdx) => {
    setFormValues({ ...courseRows[rowIdx] });
    setActiveForm({ type: "edit-subject", rowIdx });
  };

  const openEditCourseName = (groupKey, currentName) => {
    setFormValues({ course_name: currentName });
    setActiveForm({ type: "edit-course-name", groupKey });
  };

  const save = () => {
    if (activeForm.type === "add-course") {
      onChange((prev) => ({
        ...prev,
        courses: [
          ...(prev.courses || []),
          {
            course_name: formValues.course_name || "",
            subject_name: formValues.subject_name || "",
            class_count: Number(formValues.class_count || 1),
            revision_count: clampNumber(Number(formValues.revision_count ?? 1), 0, 5),
            __group_id: nextGroupId(),
          },
        ],
      }));
    } else if (activeForm.type === "add-subject") {
      const group = courseGroups.find((g) => g.key === activeForm.groupKey);
      const sample = group ? courseRows[group.rowIndexes[0]] : {};
      onChange((prev) => ({
        ...prev,
        courses: [
          ...(prev.courses || []),
          {
            course_name: sample?.course_name || "",
            subject_name: formValues.subject_name || "",
            class_count: Number(formValues.class_count || 1),
            revision_count: clampNumber(Number(formValues.revision_count ?? 1), 0, 5),
            __group_id: sample?.__group_id || activeForm.groupKey,
          },
        ],
      }));
    } else if (activeForm.type === "edit-subject") {
      onChange((prev) => {
        const list = [...(prev.courses || [])];
        list[activeForm.rowIdx] = { ...list[activeForm.rowIdx], ...formValues };
        return { ...prev, courses: list };
      });
    } else if (activeForm.type === "edit-course-name") {
      const group = courseGroups.find((g) => g.key === activeForm.groupKey);
      onChange((prev) => {
        const list = [...(prev.courses || [])];
        (group?.rowIndexes || []).forEach((i) => {
          list[i] = { ...list[i], course_name: formValues.course_name || "" };
        });
        return { ...prev, courses: list };
      });
    }
    cancel();
  };

  const removeSubject = (rowIdx) => {
    onChange((prev) => {
      const list = [...(prev.courses || [])];
      list.splice(rowIdx, 1);
      return { ...prev, courses: list };
    });
    cancel();
  };

  const removeCourse = (group) => {
    onChange((prev) => {
      const list = (prev.courses || []).filter((_, i) => !group.rowIndexes.includes(i));
      return { ...prev, courses: list };
    });
    cancel();
  };

  return (
    <section>
      <div className="area-step-head">
        <span className="area-step-icon" aria-hidden="true">🎓</span>
        <div>
          <h4>Courses</h4>
          <p className="day-state">Add a course, then list the subjects you&apos;ll cover under it.</p>
        </div>
      </div>

      {courseGroups.length === 0 && activeForm?.type !== "add-course" ? (
        <div className="area-empty">No courses yet — add one to start tracking subjects, classes, and revisions.</div>
      ) : null}

      <div className="area-list">
        {courseGroups.map((group) => (
          <div key={group.key} className="course-card">
            <div className="course-card-head">
              <span className="area-card-title">🎓 {group.course_name || "Untitled course"}</span>
              <div className="area-card-actions">
                <button type="button" className="area-icon-btn" aria-label="Rename course" onClick={() => openEditCourseName(group.key, group.course_name)}>
                  ✏️
                </button>
                <button type="button" className="area-icon-btn danger" aria-label="Remove course" onClick={() => removeCourse(group)}>
                  🗑️
                </button>
              </div>
            </div>

            {activeForm?.type === "edit-course-name" && activeForm.groupKey === group.key ? (
              <AreaForm
                fields={[{ key: "course_name", label: "Course name", placeholder: "e.g. Foundation Batch" }]}
                values={formValues}
                onChange={setFormValues}
                onSave={save}
                onCancel={cancel}
                saveLabel="Update"
              />
            ) : null}

            <div className="subject-list">
              {group.rowIndexes.map((rowIdx) => {
                const row = courseRows[rowIdx] || {};
                if (activeForm?.type === "edit-subject" && activeForm.rowIdx === rowIdx) {
                  return (
                    <AreaForm
                      key={rowIdx}
                      fields={SUBJECT_FIELDS}
                      values={formValues}
                      onChange={setFormValues}
                      onSave={save}
                      onCancel={cancel}
                      saveLabel="Update"
                    />
                  );
                }
                return (
                  <div key={rowIdx} className="subject-row">
                    <div className="subject-row-main">
                      <span className="subject-row-name">{row.subject_name || "Untitled subject"}</span>
                      <span className="area-stat-chip">{row.class_count ?? 1} classes</span>
                      <span className="area-stat-chip">{row.revision_count ?? 1} revisions</span>
                    </div>
                    <div className="area-card-actions">
                      <button type="button" className="area-icon-btn" aria-label="Edit subject" onClick={() => openEditSubject(rowIdx)}>
                        ✏️
                      </button>
                      <button type="button" className="area-icon-btn danger" aria-label="Remove subject" onClick={() => removeSubject(rowIdx)}>
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeForm?.type === "add-subject" && activeForm.groupKey === group.key ? (
              <AreaForm fields={SUBJECT_FIELDS} values={formValues} onChange={setFormValues} onSave={save} onCancel={cancel} saveLabel="Add" />
            ) : (
              <button type="button" className="area-add-btn" onClick={() => openAddSubject(group.key, courseRows[group.rowIndexes[0]])}>
                + Add subject
              </button>
            )}
          </div>
        ))}
      </div>

      {activeForm?.type === "add-course" ? (
        <AreaForm fields={COURSE_FIELDS} values={formValues} onChange={setFormValues} onSave={save} onCancel={cancel} saveLabel="Add course" />
      ) : (
        <button type="button" className="area-add-btn" onClick={openAddCourse}>
          + Add a course
        </button>
      )}
    </section>
  );
}

export function BookAreaStep({ plan, onChange }) {
  return (
    <AreaCardSection
      icon="📘"
      title="Books"
      description="Add the books you'll work through, chapter by chapter."
      items={plan?.books || []}
      fields={[
        { key: "book_name", label: "Book name", placeholder: "e.g. NCERT Polity" },
        { key: "chapter_count", label: "Chapters", type: "number", min: 1, default: 1 },
        { key: "revision_count", label: "Revisions", type: "number", min: 0, max: 5, default: 1 },
      ]}
      renderSummary={(row) => (
        <>
          <span className="area-card-title">{row.book_name || "Untitled book"}</span>
          <div className="area-card-stats">
            <span className="area-stat-chip">{row.chapter_count ?? 1} chapters</span>
            <span className="area-stat-chip">{row.revision_count ?? 1} revisions</span>
          </div>
        </>
      )}
      addLabel="+ Add a book"
      emptyText="No books yet — add one to start tracking chapters and revisions."
      onAdd={(values) => onChange((prev) => ({ ...prev, books: [...(prev.books || []), values] }))}
      onUpdate={(idx, values) =>
        onChange((prev) => {
          const list = [...(prev.books || [])];
          list[idx] = values;
          return { ...prev, books: list };
        })
      }
      onRemove={(idx) =>
        onChange((prev) => {
          const list = [...(prev.books || [])];
          list.splice(idx, 1);
          return { ...prev, books: list };
        })
      }
    />
  );
}

export function RandomAreaStep({ plan, onChange }) {
  return (
    <AreaCardSection
      icon="🎲"
      title="Practice Topics"
      description="One-off topics, mocks, or revisions that don't belong to a course or book."
      items={plan?.random || []}
      fields={[
        { key: "source", label: "Source", placeholder: "e.g. Telegram channel" },
        { key: "topic_name", label: "Topic", placeholder: "e.g. Static GK" },
        { key: "revision_count", label: "Revisions", type: "number", min: 0, max: 5, default: 1 },
      ]}
      renderSummary={(row) => (
        <>
          <span className="area-card-title">{row.topic_name || "Untitled topic"}</span>
          <div className="area-card-stats">
            <span className="area-stat-chip">{row.source || "No source"}</span>
            <span className="area-stat-chip">{row.revision_count ?? 1} revisions</span>
          </div>
        </>
      )}
      addLabel="+ Add a topic"
      emptyText="No practice topics yet — add one for anything outside your courses and books."
      onAdd={(values) => onChange((prev) => ({ ...prev, random: [...(prev.random || []), values] }))}
      onUpdate={(idx, values) =>
        onChange((prev) => {
          const list = [...(prev.random || [])];
          list[idx] = values;
          return { ...prev, random: list };
        })
      }
      onRemove={(idx) =>
        onChange((prev) => {
          const list = [...(prev.random || [])];
          list.splice(idx, 1);
          return { ...prev, random: list };
        })
      }
    />
  );
}

export function TestAreaStep({ plan, onChange }) {
  return (
    <AreaCardSection
      icon="📝"
      title="Tests"
      description="Mock tests and series you'll take and review. Given &amp; Analysis dates are tracked automatically."
      items={plan?.tests || []}
      fields={[
        { key: "test_name", label: "Test name", placeholder: "e.g. Prelims Mock" },
        { key: "source", label: "Source", placeholder: "e.g. Vision IAS" },
        { key: "number_of_tests", label: "No. of tests", type: "number", min: 1, default: 1 },
        { key: "revisions", label: "Revisions", type: "number", min: 0, max: 5, default: 0 },
      ]}
      renderSummary={(row) => (
        <>
          <span className="area-card-title">{row.test_name || "Untitled test"}</span>
          <div className="area-card-stats">
            <span className="area-stat-chip">{row.source || "No source"}</span>
            <span className="area-stat-chip">{row.number_of_tests ?? 1} tests</span>
            <span className="area-stat-chip">{row.revisions ?? 0} revisions</span>
          </div>
        </>
      )}
      addLabel="+ Add a test plan"
      emptyText="No tests yet — add a test series to track attempts and reviews."
      onAdd={(values) => onChange((prev) => ({ ...prev, tests: [...(prev.tests || []), values] }))}
      onUpdate={(idx, values) =>
        onChange((prev) => {
          const list = [...(prev.tests || [])];
          list[idx] = values;
          return { ...prev, tests: list };
        })
      }
      onRemove={(idx) =>
        onChange((prev) => {
          const list = [...(prev.tests || [])];
          list.splice(idx, 1);
          return { ...prev, tests: list };
        })
      }
    />
  );
}
