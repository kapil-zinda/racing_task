# Universal Goal OS — Architecture & Build Plan

Replaces the existing **journey** + **progress hub** features. No realtime/WebSockets
(refresh button + direct API updates), no offline-first sync (direct API calls).
Old `journeys` / `journey_progress` data is discarded — no migration needed.

---

## 1. Core architectural decisions

| Decision | Choice | Why |
|---|---|---|
| Tree storage | **One document per node** (`goal_nodes`, adjacency list via `parent_id`) | Spec needs 10k+ nodes, lazy loading, virtualization. Embedded tree (current model) hits Mongo's 16MB doc cap and can't lazy-load subtrees. |
| Node ordering | `order` float + `depth` int + `path` array of ancestor ids | Cheap sibling reorder, subtree queries (`path: nodeId`), ancestor walk for propagation. |
| Progress | Cached `progress` on each node, **recomputed up the ancestor path on every write** | No realtime needed; compute-on-write keeps reads fast. `path` makes the upward walk O(depth). |
| Realtime | **Dropped.** Refresh button; all mutations are direct REST calls | Per your call; also avoids API Gateway WebSocket complexity on Lambda. |
| Background jobs | **EventBridge-scheduled Lambda** (reminders, recurring rules, analytics rollups) | Lambda has no long-running workers; cron-triggered invocations replace them. |
| AI generation | Reuse existing OpenAI + LangChain stack (as in `qna_domain` / `agent_v2`) | Already wired; NL → hierarchical JSON → bulk node insert. |
| Charts | **Plotly** (already a dependency) covers rings, sunburst, treemap, heatmap, radar, donut, stacked bars, burndown/up, timeline | No new charting dep for the analytics suite. |
| New frontend libs | `@tanstack/react-virtual` (windowing), `@dnd-kit/core` (tree drag-drop), `reactflow` (dependency graph) | None of these exist today; needed for the tree editor + dep graph at scale. |

---

## 2. Data model (MongoDB collections)

All generic — no per-goal-type tables, everything metadata-driven (spec's core principle).

### `goals`
`_id, user_id, name, description, icon, cover_image, color, status, category, priority,
start_date, end_date, visibility, progress, estimated_hours, actual_hours, settings(json),
created_at, updated_at`

### `goal_nodes`  (the recursive tree — one doc per node)
`_id, goal_id, parent_id (null=root child), path[ancestor_ids], depth, order,
title, description, type, status, weight, estimated_value, actual_value, unit,
progress, progress_mode (children_weighted|formula|metric|boolean|manual),
formula (string), metadata(json), created_at, updated_at`

### `goal_metrics`
`_id, goal_id, node_id, name, type, unit, target_value, current_value, min_value, max_value, created_at, updated_at`

### `goal_activity`  (append-only log)
`_id, goal_id, node_id, action, old_value, new_value, performed_by, created_at`

### `goal_attachments`
`_id, goal_id, node_id, type, url, name, size, created_at` — files land in B2/S3 via existing `storage_domain` presign.

### `goal_dependencies`
`_id, goal_id, source_node_id, target_node_id, dependency_type, created_at`

### `goal_recurring_rules`
`_id, goal_id, node_id, frequency, cron, start_date, end_date, created_at`

### `goal_reminders`
`_id, goal_id, node_id, time, type, status, created_at`

### `goal_templates`
`_id, owner_id, name, description, thumbnail, schema(json), visibility, created_at` — full tree stored as JSON schema; duplicated into `goals`+`goal_nodes` on use.

**Indexes:** `goal_nodes` on `(goal_id, parent_id, order)`, `(goal_id, path)`, `(goal_id, status)`; text index on `title/description` for global search; `goal_activity` on `(goal_id, created_at)`.

---

## 3. Progress engine

Each node computes progress by its `progress_mode`:
- **boolean** — done/not done (leaf).
- **metric** — `current_value / target_value` from linked metric(s).
- **formula** — e.g. `(Video×30)+(Notes×20)+(Revision×20)+(MCQ×30)`; formula references child metrics/counters.
- **children_weighted** — weighted average of children by `weight`.
- **manual** — user-set number.

Propagation: on any write (status/metric/value change) → append `goal_activity` → recompute the node → walk `path` upward recomputing each ancestor → update `goals.progress`. All in one request; no workers.

---

## 4. API surface (matches spec)

```
GET    /goals                 POST /goals            PATCH /goals/:id      DELETE /goals/:id
GET    /goals/:id/tree        (lazy: ?parent=&depth=)
POST   /nodes                 PATCH /nodes/:id       DELETE /nodes/:id     POST /nodes/:id/move
POST   /metrics               PATCH /metrics/:id
POST   /activity              GET  /goals/:id/activity
POST   /attachments           (presign via storage_domain)
POST   /dependencies          DELETE /dependencies/:id
POST   /reminders             POST /recurring
GET    /templates             POST /templates        POST /templates/:id/use
GET    /analytics             GET  /calendar         GET  /search
POST   /ai/generate           POST /forecast         POST /review           POST /ai/daily-plan
```

Backend modules: `goal_domain.py`, `goal_node_domain.py`, `goal_progress_engine.py`,
`goal_metric_domain.py`, `goal_analytics_domain.py`, `goal_ai_domain.py`,
`goal_template_domain.py` + schemas + `context.py` collection accessors + `app_factory.py` routes.

---

## 5. Frontend (replaces mission/ + progress-hub/ + syllabus/)

- **Sidebar nav:** Dashboard, Goals, Templates, Analytics, Calendar, Timeline, Settings.
- **Dashboard:** cards (overall/today progress, streak, time, deadlines, missed, reviews, weekly score) + heatmap + progress rings + today's plan + recent activity + AI suggestions.
- **Goal list:** card view (icon, name, progress, deadline, hours, status) + open/duplicate/archive/delete/share.
- **Goal detail:** split layout — left = **virtualized, drag-drop tree** (rename/collapse/expand/search/multi-select/copy-paste/duplicate); right = **node detail tabs** (Overview, Metrics, Files, Activity, Comments, Dependencies, History).
- **Creation wizard:** Step 1 name/desc/icon/color → Step 2 Blank | Template | AI Generate.
- **Node editor** popup, **Templates grid**, **Calendar** (daily/weekly/monthly), **Analytics** (Plotly chart tabs), **Dependency graph** (React Flow), **Global search**, **Notifications**.

---

## 6. Phased roadmap

| Phase | Scope | Size | Status |
|---|---|---|---|
| **P1 — Foundation** | Collections + accessors; `goal_domain` + `goal_node_domain`; node-per-doc CRUD; lazy `/goals/:id/tree`; goals CRUD APIs | M | ✅ done |
| **P2 — Progress engine + marking** | Metrics + `/metrics` APIs incl. increment; 5 progress modes + upward propagation; activity log; node-status + metric marking | M | ✅ done |
| **P3 — Tree editor UI** | Virtualized drag-drop tree; node detail tabs (Overview/Metrics/Activity); goal detail split; goal list + dashboard stats; creation wizard (blank); old journey frontend+backend deleted | L | ✅ done |
| **P4 — Templates + AI** | Templates (built-in + save-from-goal + use); `/ai/generate` NL→hierarchy; daily planner; weekly review; forecast; wizard AI/Template modes; templates page | M | ✅ done |
| **P5 — Analytics + viz** | `/goals/:id/analytics` + `/calendar`; Plotly chart suite (gauge/donut/bar/treemap/activity); dependency graph (React Flow) with click-to-link; analytics page | L | ✅ done |
| **P6 — Supporting** | Dependencies (cycle-guarded); recurring rules; reminders + scheduled Lambda (`goal_reminders` task); notifications; global search; attachments (links + presign) | M | ✅ done |
| **P7 — Perf & polish** | Indexes in place; lazy tree loading; virtualized tree; 1k-node cap enforced; optimistic list updates | S | ◑ core done |

---

## 7. Confirmed decisions

1. **Frontend libs** — adding all three: `@tanstack/react-virtual`, `@dnd-kit/core`, `reactflow`. **Target scale: 1,000 nodes per goal** (not 10k) for now — virtualization still used but tuning is relaxed.
2. **Metrics** — **separate `goal_metrics` collection** (spec-aligned, queryable).
3. **Scheduled jobs** — **EventBridge cron is available**; reminders, recurring rules, and analytics rollups run as scheduled Lambda invocations.
4. **Scope** — build everything in the spec **except** WebSockets/realtime (refresh button + direct API) and offline-first sync (direct API calls).
5. **Migration** — **replace** the old journey + progress-hub features; no data preserved.
