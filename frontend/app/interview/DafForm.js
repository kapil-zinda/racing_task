"use client";

import { useMemo, useState } from "react";
import Icon from "../components/Icon";

// The canonical empty DAF (mirrors DAF_TEMPLATE on the backend).
export const EMPTY_DAF = {
  personal_details: {
    name: "", date_of_birth: "", gender: "", father_name: "", mother_name: "",
    home_district: "", home_state: "", mother_tongue: "",
    languages_known: [], medium_of_interview: "English", category: "",
  },
  educational_details: {
    matriculation: { board: "", year: "", school: "" },
    intermediate: { board: "", year: "", school: "", stream: "" },
    graduation: { degree: "", discipline: "", college_university: "", year: "" },
    post_graduation: { degree: "", discipline: "", college_university: "", year: "" },
  },
  optional_subject: "",
  employment_details: { currently_employed: false, work_experience: [] },
  hobbies_and_interests: [],
  achievements: { prizes_and_awards: [], positions_of_responsibility: [], extracurricular: [] },
  service_preferences: [],
  cadre_preferences: [],
  career_details: { why_civil_services: "", unique_points_in_daf: [] },
};

// Deep-merge a stored DAF onto the empty template so every field is controlled.
function hydrate(daf) {
  const base = structuredClone(EMPTY_DAF);
  if (!daf || typeof daf !== "object") return base;
  const merge = (target, src) => {
    Object.keys(src).forEach((k) => {
      const sv = src[k];
      if (Array.isArray(sv)) target[k] = sv;
      else if (sv && typeof sv === "object" && target[k] && typeof target[k] === "object") merge(target[k], sv);
      else if (sv !== undefined && sv !== null) target[k] = sv;
    });
    return target;
  };
  return merge(base, daf);
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="daf-field">
      <span className="daf-field-label">{label}</span>
      <input className="task-input" type={type} value={value || ""} placeholder={placeholder || ""}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Chip list: type + Enter (or comma) to add, click × to remove.
function TagList({ label, values, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const items = values || [];
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...items, ...parts]);
    setDraft("");
  };
  return (
    <div className="daf-field daf-taglist">
      <span className="daf-field-label">{label}</span>
      {items.length ? (
        <div className="daf-chips">
          {items.map((it, i) => (
            <span key={`${it}-${i}`} className="daf-chip">
              {it}
              <button type="button" aria-label={`Remove ${it}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Icon name="x" size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="daf-tag-add">
        <input className="task-input" value={draft} placeholder={placeholder || "Type and press Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-day secondary" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
    </div>
  );
}

export default function DafForm({ initial, onSave, onCancel, saving, error }) {
  const [daf, setDaf] = useState(() => hydrate(initial));

  // set a value at a dotted path, immutably.
  const setPath = (path, value) => {
    setDaf((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i += 1) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  };
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), daf);

  const work = daf.employment_details.work_experience;
  const setWork = (rows) => setPath("employment_details.work_experience", rows);
  const addWork = () => setWork([...work, { designation: "", organization: "", duration: "" }]);
  const updWork = (i, k, v) => setWork(work.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const delWork = (i) => setWork(work.filter((_, j) => j !== i));

  const valid = useMemo(() => {
    const p = daf.personal_details;
    const g = daf.educational_details.graduation;
    return Boolean(p.name.trim() && p.home_state.trim() && (g.degree.trim() || g.discipline.trim()));
  }, [daf]);

  return (
    <div className="daf-form">
      <div className="daf-form-head">
        <button className="iv-back" onClick={onCancel}><Icon name="arrow-left" size={16} /> Back</button>
        <h2>Your DAF</h2>
        <p className="iv-intro">
          The board interviews you on <strong>your own DAF</strong> — home state, education, optional subject,
          hobbies and work. Fill it once; every question is grounded in what you enter here.
        </p>
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      {/* Personal */}
      <section className="daf-section">
        <h3><Icon name="user" size={16} /> Personal details</h3>
        <div className="daf-grid">
          <Field label="Full name *" value={get("personal_details.name")} onChange={(v) => setPath("personal_details.name", v)} />
          <Field label="Date of birth" type="date" value={get("personal_details.date_of_birth")} onChange={(v) => setPath("personal_details.date_of_birth", v)} />
          <Field label="Gender" value={get("personal_details.gender")} onChange={(v) => setPath("personal_details.gender", v)} placeholder="e.g. Male / Female" />
          <Field label="Category" value={get("personal_details.category")} onChange={(v) => setPath("personal_details.category", v)} placeholder="General / OBC / SC / ST / EWS" />
          <Field label="Father's name" value={get("personal_details.father_name")} onChange={(v) => setPath("personal_details.father_name", v)} />
          <Field label="Mother's name" value={get("personal_details.mother_name")} onChange={(v) => setPath("personal_details.mother_name", v)} />
          <Field label="Home district" value={get("personal_details.home_district")} onChange={(v) => setPath("personal_details.home_district", v)} />
          <Field label="Home state *" value={get("personal_details.home_state")} onChange={(v) => setPath("personal_details.home_state", v)} />
          <Field label="Mother tongue" value={get("personal_details.mother_tongue")} onChange={(v) => setPath("personal_details.mother_tongue", v)} />
          <Field label="Medium of interview" value={get("personal_details.medium_of_interview")} onChange={(v) => setPath("personal_details.medium_of_interview", v)} placeholder="English / Hindi" />
        </div>
        <TagList label="Languages known" values={get("personal_details.languages_known")} onChange={(v) => setPath("personal_details.languages_known", v)} placeholder="e.g. Hindi, English" />
      </section>

      {/* Education */}
      <section className="daf-section">
        <h3><Icon name="book" size={16} /> Educational details</h3>
        <div className="daf-subsection">
          <span className="daf-sub-label">Graduation *</span>
          <div className="daf-grid">
            <Field label="Degree" value={get("educational_details.graduation.degree")} onChange={(v) => setPath("educational_details.graduation.degree", v)} placeholder="e.g. B.Tech, B.A." />
            <Field label="Discipline / subject" value={get("educational_details.graduation.discipline")} onChange={(v) => setPath("educational_details.graduation.discipline", v)} placeholder="e.g. Mechanical Engineering" />
            <Field label="College / University" value={get("educational_details.graduation.college_university")} onChange={(v) => setPath("educational_details.graduation.college_university", v)} />
            <Field label="Year" value={get("educational_details.graduation.year")} onChange={(v) => setPath("educational_details.graduation.year", v)} />
          </div>
        </div>
        <div className="daf-subsection">
          <span className="daf-sub-label">Post-graduation (if any)</span>
          <div className="daf-grid">
            <Field label="Degree" value={get("educational_details.post_graduation.degree")} onChange={(v) => setPath("educational_details.post_graduation.degree", v)} />
            <Field label="Discipline / subject" value={get("educational_details.post_graduation.discipline")} onChange={(v) => setPath("educational_details.post_graduation.discipline", v)} />
            <Field label="College / University" value={get("educational_details.post_graduation.college_university")} onChange={(v) => setPath("educational_details.post_graduation.college_university", v)} />
            <Field label="Year" value={get("educational_details.post_graduation.year")} onChange={(v) => setPath("educational_details.post_graduation.year", v)} />
          </div>
        </div>
        <div className="daf-subsection">
          <span className="daf-sub-label">Schooling</span>
          <div className="daf-grid">
            <Field label="Class 12 board" value={get("educational_details.intermediate.board")} onChange={(v) => setPath("educational_details.intermediate.board", v)} />
            <Field label="Class 12 stream" value={get("educational_details.intermediate.stream")} onChange={(v) => setPath("educational_details.intermediate.stream", v)} placeholder="Science / Commerce / Arts" />
            <Field label="Class 10 board" value={get("educational_details.matriculation.board")} onChange={(v) => setPath("educational_details.matriculation.board", v)} />
            <Field label="School" value={get("educational_details.intermediate.school")} onChange={(v) => setPath("educational_details.intermediate.school", v)} />
          </div>
        </div>
      </section>

      {/* Optional + work */}
      <section className="daf-section">
        <h3><Icon name="target" size={16} /> Optional subject &amp; work</h3>
        <div className="daf-grid">
          <Field label="Optional subject" value={get("optional_subject")} onChange={(v) => setPath("optional_subject", v)} placeholder="e.g. Public Administration, Geography" />
        </div>
        <label className="daf-check">
          <input type="checkbox" checked={!!get("employment_details.currently_employed")}
            onChange={(e) => setPath("employment_details.currently_employed", e.target.checked)} />
          <span>Currently employed</span>
        </label>
        <div className="daf-worklist">
          <span className="daf-sub-label">Work experience</span>
          {work.map((row, i) => (
            <div key={i} className="daf-work-row">
              <input className="task-input" placeholder="Designation" value={row.designation}
                onChange={(e) => updWork(i, "designation", e.target.value)} />
              <input className="task-input" placeholder="Organization" value={row.organization}
                onChange={(e) => updWork(i, "organization", e.target.value)} />
              <input className="task-input" placeholder="Duration" value={row.duration}
                onChange={(e) => updWork(i, "duration", e.target.value)} />
              <button type="button" className="daf-row-del" aria-label="Remove" onClick={() => delWork(i)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="btn-day secondary daf-add-row" onClick={addWork}>
            <Icon name="plus" size={14} /> Add work experience
          </button>
        </div>
      </section>

      {/* Hobbies + achievements */}
      <section className="daf-section">
        <h3><Icon name="sparkles" size={16} /> Hobbies &amp; achievements</h3>
        <TagList label="Hobbies & interests" values={get("hobbies_and_interests")} onChange={(v) => setPath("hobbies_and_interests", v)} placeholder="e.g. Badminton, Reading non-fiction" />
        <TagList label="Prizes & awards" values={get("achievements.prizes_and_awards")} onChange={(v) => setPath("achievements.prizes_and_awards", v)} />
        <TagList label="Positions of responsibility" values={get("achievements.positions_of_responsibility")} onChange={(v) => setPath("achievements.positions_of_responsibility", v)} placeholder="e.g. Class representative, NCC" />
        <TagList label="Extracurricular activities" values={get("achievements.extracurricular")} onChange={(v) => setPath("achievements.extracurricular", v)} />
      </section>

      {/* Preferences + motivation */}
      <section className="daf-section">
        <h3><Icon name="clipboard" size={16} /> Preferences &amp; motivation</h3>
        <TagList label="Service preferences (in order)" values={get("service_preferences")} onChange={(v) => setPath("service_preferences", v)} placeholder="e.g. IAS, IPS, IFS" />
        <TagList label="Cadre preferences" values={get("cadre_preferences")} onChange={(v) => setPath("cadre_preferences", v)} />
        <label className="daf-field">
          <span className="daf-field-label">Why civil services? (your honest reason)</span>
          <textarea className="task-input daf-textarea" rows={3} value={get("career_details.why_civil_services")}
            onChange={(e) => setPath("career_details.why_civil_services", e.target.value)}
            placeholder="The board will press you on this — write the real reason, not a coaching-class line." />
        </label>
        <TagList label="Unique / notable points about you" values={get("career_details.unique_points_in_daf")} onChange={(v) => setPath("career_details.unique_points_in_daf", v)} placeholder="Anything the board might latch on to" />
      </section>

      <div className="daf-actions">
        <button className="btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn-day" onClick={() => onSave(daf)} disabled={saving || !valid}>
          {saving ? "Saving…" : "Save DAF"}
        </button>
      </div>
      {!valid ? <p className="daf-hint">Name, home state and graduation are required to save.</p> : null}
    </div>
  );
}
