import { AGENT_PENDING_RECORDER_ACTION_KEY, AGENT_RECORDER_EVENT } from "./constants";

function dispatchRecorderAction(actionName, args = {}) {
  if (typeof window === "undefined") return;
  const payload = { name: actionName, args: args || {}, at: Date.now() };
  try {
    window.sessionStorage.setItem(AGENT_PENDING_RECORDER_ACTION_KEY, JSON.stringify(payload));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(AGENT_RECORDER_EVENT, { detail: payload }));
}

function safeName(value) {
  return String(value || "").trim();
}

export async function executeAgentActions(actions, { router, pathname }) {
  if (!Array.isArray(actions) || !router) return [];
  const results = [];
  for (const row of actions) {
    const name = safeName(row?.name);
    const args = row?.args && typeof row.args === "object" ? row.args : {};
    if (!name) continue;
    try {
      const normalizedName = (() => {
        const raw = name.toLowerCase();
        if (raw === "focus_recorder") return "switch_page_recorder";
        if (raw === "start_audio_recording") return "start_recording_session";
        if (raw === "pause_audio_recording") return "pause_recording_session";
        if (raw === "resume_audio_recording") return "resume_recording_session";
        if (raw === "stop_audio_recording") return "end_recording_session";
        if (raw === "recorder_start") return "start_recording_session";
        if (raw === "recorder_pause") return "pause_recording_session";
        if (raw === "recorder_resume") return "resume_recording_session";
        if (raw === "recorder_stop") return "end_recording_session";
        return name;
      })();
      const genericPage = String(args?.page || args?.target || args?.path || "").trim().toLowerCase();
      const isSwitchPageGeneric = normalizedName === "switch_page" || normalizedName === "open_page" || normalizedName === "navigate";
      const wantsHome = normalizedName === "switch_page_home" || (isSwitchPageGeneric && (genericPage === "home" || genericPage === "/"));
      const wantsRecorder =
        normalizedName === "switch_page_recorder" ||
        (isSwitchPageGeneric && (genericPage === "recorder" || genericPage === "/recorder"));
      const wantsSyllabus =
        normalizedName === "switch_page_syllabus" ||
        (isSwitchPageGeneric && (genericPage === "syllabus" || genericPage === "/syllabus"));
      const wantsMission =
        normalizedName === "switch_page_mission" ||
        (isSwitchPageGeneric && (genericPage === "mission" || genericPage === "/mission"));
      const wantsResources =
        normalizedName === "switch_page_resources" ||
        (isSwitchPageGeneric && (genericPage === "resources" || genericPage === "/search" || genericPage === "search" || genericPage === "content" || genericPage === "qna"));

      if (wantsHome) {
        router.push("/");
      } else if (wantsRecorder) {
        router.push("/recorder");
      } else if (wantsSyllabus) {
        router.push("/syllabus");
      } else if (wantsMission) {
        router.push("/mission");
      } else if (wantsResources) {
        const subpage = String(args?.subpage || genericPage || "").trim().toLowerCase();
        if (subpage === "content" || subpage === "search" || subpage === "qna") router.push(`/${subpage}`);
        else router.push("/search");
      } else if (
        normalizedName === "start_recording_session" ||
        normalizedName === "pause_recording_session" ||
        normalizedName === "resume_recording_session" ||
        normalizedName === "end_recording_session"
      ) {
        if (pathname !== "/recorder") {
          router.push("/recorder");
        }
        dispatchRecorderAction(normalizedName, args);
      }
      results.push({ name: normalizedName, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String(err?.message || err) });
    }
  }
  return results;
}
