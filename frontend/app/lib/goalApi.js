"use client";
// Universal Goal OS — API client. Thin wrappers over apiFetch for the /goals, /nodes,
// and /metrics endpoints. Every call throws on non-2xx with the server's detail message.

import { apiFetch } from "./auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function req(path, opts = {}) {
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured");
  const res = await apiFetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || (typeof data === "string" ? data : "") || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

// --- Goals ---
export const listGoals = () => req("/goals");
export const getGoal = (id) => req(`/goals/${id}`);
export const createGoal = (body) => req("/goals", { method: "POST", body });
export const updateGoal = (id, body) => req(`/goals/${id}`, { method: "PATCH", body });
export const deleteGoal = (id) => req(`/goals/${id}`, { method: "DELETE" });
export const getTree = (id, { parent, depth } = {}) => {
  const qs = new URLSearchParams();
  if (parent) qs.set("parent", parent);
  if (depth) qs.set("depth", String(depth));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return req(`/goals/${id}/tree${suffix}`);
};
export const getActivity = (id, limit = 100) => req(`/goals/${id}/activity?limit=${limit}`);

// --- Nodes ---
export const createNode = (body) => req("/nodes", { method: "POST", body });
export const bulkCreateNodes = (body) => req("/nodes/bulk", { method: "POST", body });
export const updateNode = (id, body) => req(`/nodes/${id}`, { method: "PATCH", body });
export const deleteNode = (id) => req(`/nodes/${id}`, { method: "DELETE" });
export const moveNode = (id, body) => req(`/nodes/${id}/move`, { method: "POST", body });
export const listNodeMetrics = (id) => req(`/nodes/${id}/metrics`);

// --- Metrics ---
export const createMetric = (body) => req("/metrics", { method: "POST", body });
export const updateMetric = (id, body) => req(`/metrics/${id}`, { method: "PATCH", body });
export const incrementMetric = (id, delta = 1) => req(`/metrics/${id}/increment`, { method: "POST", body: { delta } });
export const deleteMetric = (id) => req(`/metrics/${id}`, { method: "DELETE" });

// --- AI / forecast / review / plan ---
export const aiGenerate = (prompt) => req("/ai/generate", { method: "POST", body: { prompt } });
export const forecast = (goalId) => req("/forecast", { method: "POST", body: { goal_id: goalId } });
export const weeklyReview = (goalId) => req("/review", { method: "POST", body: { goal_id: goalId } });
export const dailyPlan = (goalId, limit = 5) => req("/ai/daily-plan", { method: "POST", body: { goal_id: goalId, limit } });

// --- Templates ---
export const listTemplates = () => req("/templates");
export const useTemplate = (templateId, name = "") => req("/templates/use", { method: "POST", body: { template_id: templateId, name } });
export const saveTemplate = (goalId, name = "") => req("/templates", { method: "POST", body: { goal_id: goalId, name } });
export const deleteTemplate = (id) => req(`/templates/${id}`, { method: "DELETE" });

// --- Dashboard / analytics / calendar / search ---
// Send the browser's timezone offset so day-bucketing (heatmap, streaks, today/yesterday,
// this/last week) follows the user's LOCAL calendar day instead of UTC.
const tzOffset = () => (typeof Date !== "undefined" ? new Date().getTimezoneOffset() : 0);
export const getDashboard = () => req(`/dashboard?tz_offset=${tzOffset()}`);
export const getAnalytics = (goalId) => req(`/goals/${goalId}/analytics?tz_offset=${tzOffset()}`);
export const getCalendar = (goalId = "") => {
  const qs = new URLSearchParams({ tz_offset: String(tzOffset()) });
  if (goalId) qs.set("goal_id", goalId);
  return req(`/calendar?${qs.toString()}`);
};
export const search = (q, limit = 30) => req(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);

// --- Dependencies ---
export const listDependencies = (goalId) => req(`/goals/${goalId}/dependencies`);
export const createDependency = (body) => req("/dependencies", { method: "POST", body });
export const deleteDependency = (id) => req(`/dependencies/${id}`, { method: "DELETE" });

// --- Reminders / recurring / notifications ---
export const listReminders = (goalId = "") => req(`/reminders${goalId ? `?goal_id=${goalId}` : ""}`);
export const createReminder = (body) => req("/reminders", { method: "POST", body });
export const deleteReminder = (id) => req(`/reminders/${id}`, { method: "DELETE" });
export const listNotifications = () => req("/notifications");

// --- Attachments ---
export const listAttachments = (nodeId) => req(`/nodes/${nodeId}/attachments`);
export const presignAttachment = (body) => req("/attachments/presign", { method: "POST", body });
export const createAttachment = (body) => req("/attachments", { method: "POST", body });
export const deleteAttachment = (id) => req(`/attachments/${id}`, { method: "DELETE" });

// Upload a file to a node: presign → PUT to storage → record metadata.
export async function uploadAttachment(nodeId, file) {
  const kind = file.type.startsWith("image/") ? "image"
    : file.type.startsWith("video/") ? "video"
    : file.type.startsWith("audio/") ? "audio"
    : file.type === "application/pdf" ? "pdf" : "file";
  const { upload_url, key } = await presignAttachment({ node_id: nodeId, name: file.name, content_type: file.type });
  const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  return createAttachment({ node_id: nodeId, type: kind, name: file.name, key, size: file.size });
}

export const PROGRESS_MODES = [
  { value: "children_weighted", label: "Auto (weighted children)" },
  { value: "boolean", label: "Done / not done" },
  { value: "metric", label: "From metrics" },
  { value: "formula", label: "Formula" },
  { value: "manual", label: "Manual %" },
];
export const NODE_STATUSES = ["todo", "in_progress", "done", "blocked", "skipped"];

// Build a nested tree ({...node, children:[]}) from the flat node list the API returns.
export function buildTree(nodes) {
  const byId = new Map();
  nodes.forEach((n) => byId.set(n.id, { ...n, children: [] }));
  const roots = [];
  byId.forEach((n) => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(n);
    else roots.push(n);
  });
  const sortRec = (list) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
