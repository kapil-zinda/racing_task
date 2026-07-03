"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import { apiFetch } from "../lib/auth";
import { confirmDialog } from "../lib/dialog";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const MAP_PAGE_SIZE = 5;

const DEMO_CONTENT = `#HOME RULE MOVEMENT (1916)
##Key Repressive Acts (Background)
###Seditious Meetings Act, 1907
###Indian Newspapers (Incitement to Offences) Act, 1908
###Criminal Law Amendment Act, 1908
###Indian Press Act, 1910
###Defence of India Rules, 1915
##Two Home Rule Leagues (Dual Movements)
###Bal Gangadhar Tilak's League (April 1916)
####Headquarters: Poona
####First Session: Belgaum
####Regions Covered: Maharashtra (excluding Bombay), Central Provinces, Karnataka, Berar
####Structure: 6 branches
####Demands:
#####Swaraj
#####Linguistic provinces
#####Vernacular education
###Annie Besant's League (September 1916)
####Headquarters: Madras
####Name: All India Home Rule League
####Publications Used:
#####New India
#####Commonweal
####Key Personnel:
#####Organising Secretary: George Arundale
#####Members: B.W. Wadia, C.P. Ramaswamy Aiyar
##Participation & Leadership
###Impact: Mass participation greater than Swadeshi Movement
###Major Leaders:
####Motilal Nehru
####Jawaharlal Nehru
####Bhulabhai Desai
####Madan Mohan Malviya
####Mohammad Ali Jinnah
####C.R. Das
####Tej Bahadur Sapru
####Lala Lajpat Rai`;

// ── canvas constants (ported from the reference studio) ────────────────────
const CARD_WIDTH = 220;
const LAST_VISIBLE_COLUMN_WIDTH = 340;
const CARD_PADDING_X = 16;
const CARD_PADDING_TOP = 10;
const CARD_PADDING_BOTTOM = 8;
const LINE_HEIGHT = 18;
const COLUMN_GAP = 96;
const SIBLING_GAP = 11;
const CANVAS_PADDING_X = 40;
const CANVAS_PADDING_Y = 40;

// Theme colors for the SVG canvas (kept solid so SVG/PNG/PDF exports match).
const SVG_BG = "#101228";
const NODE_FILL = "#1c1f3f";
const ROOT_FILL = "#312e81";
const NODE_STROKE = "#6366f1";
const ROOT_STROKE = "#818cf8";
const COLLAPSED_STROKE = "#a5b4fc";
const LINK_STROKE = "#6366f1";
const TEXT_FILL = "#e0e7ff";
const NOTE_FILL = "#94a3b8";
const TOGGLE_FILL = "#312e81";
const TOGGLE_TEXT = "#c7d2fe";
const FONT_FAMILY = "Avenir Next, Segoe UI, sans-serif";

let nodeIdCounter = 0;
let outlineIdCounter = 0;

// ── tree helpers ────────────────────────────────────────────────────────────
function createNode(title, level) {
  return {
    id: `node-${++nodeIdCounter}`,
    title: String(title || "").trim(),
    level,
    notes: [],
    children: [],
    collapsed: false,
    parent: null,
  };
}

function createOutlineItem(text = "", level = 0) {
  return { id: `outline-${++outlineIdCounter}`, text, level };
}

function parseSource(text) {
  const lines = text.split(/\r?\n/);
  const root = createNode("Mind Map", 0);
  const stack = [root];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = rawLine.match(/^\s*(#{1,6})\s*(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const node = createNode(headingMatch[2], level);
      while (stack.length > level) stack.pop();
      const parent = stack[stack.length - 1] || root;
      node.parent = parent;
      parent.children.push(node);
      stack[level] = node;
      continue;
    }

    const bulletMatch = rawLine.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bulletMatch) {
      const parent = stack[stack.length - 1] || root;
      const node = createNode(bulletMatch[1], Math.min(parent.level + 1, 6));
      node.parent = parent;
      parent.children.push(node);
      continue;
    }

    (stack[stack.length - 1] || root).notes.push(line);
  }

  if (!root.children.length) {
    const fallbackLines = lines.map((l) => l.trim()).filter(Boolean);
    if (!fallbackLines.length) throw new Error("Add some content first.");
    root.title = fallbackLines[0];
    for (const line of fallbackLines.slice(1)) {
      const node = createNode(line, 1);
      node.parent = root;
      root.children.push(node);
    }
  } else if (root.children.length === 1 && root.title === "Mind Map") {
    const promotedRoot = root.children[0];
    promotedRoot.parent = null;
    return promotedRoot;
  }

  return root;
}

function outlineFromTree(root) {
  const items = [];
  const walk = (node, level) => {
    items.push(createOutlineItem(node.title, level));
    node.notes.forEach((note) => items.push(createOutlineItem(note, Math.min(level + 1, 4))));
    node.children.forEach((child) => walk(child, level + 1));
  };
  walk(root, 0);
  return items;
}

function normalizeLevel(items, index, desiredLevel) {
  if (index === 0) return 0;
  const previousLevel = items[index - 1]?.level ?? 0;
  return Math.max(1, Math.min(desiredLevel, previousLevel + 1, 5));
}

function outlineToMarkdown(items) {
  const cleaned = items
    .map((item, index) => ({ text: item.text.trim(), level: normalizeLevel(items, index, item.level) }))
    .filter((item) => item.text);
  if (!cleaned.length) return "";
  cleaned[0].level = 0;
  return cleaned.map((item) => `${"#".repeat(item.level + 1)}${item.text}`).join("\n");
}

function buildTreeFromOutline(items) {
  const cleaned = items
    .map((item, index) => ({ text: item.text.trim(), level: normalizeLevel(items, index, item.level) }))
    .filter((item) => item.text);
  if (!cleaned.length) throw new Error("Add at least one item to build the mind map.");

  cleaned[0].level = 0;
  const root = createNode(cleaned[0].text, 0);
  const stack = [root];
  for (const item of cleaned.slice(1)) {
    while (stack.length - 1 >= item.level) stack.pop();
    const parent = stack[stack.length - 1] || root;
    const node = createNode(item.text, item.level);
    node.parent = parent;
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function serializeTree(node) {
  return {
    title: node.title,
    level: node.level,
    notes: [...node.notes],
    collapsed: !!node.collapsed,
    children: node.children.map(serializeTree),
  };
}

function deserializeTree(data, parent = null) {
  const node = createNode(data.title, data.level ?? 0);
  node.notes = Array.isArray(data.notes) ? [...data.notes] : [];
  node.collapsed = !!data.collapsed;
  node.parent = parent;
  node.children = Array.isArray(data.children) ? data.children.map((c) => deserializeTree(c, node)) : [];
  return node;
}

function findNodeById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const result = findNodeById(child, id);
    if (result) return result;
  }
  return null;
}

function setCollapsedRecursive(node, collapsed) {
  if (node.children.length) node.collapsed = collapsed;
  node.children.forEach((child) => setCollapsedRecursive(child, collapsed));
}

// ── layout (ported verbatim from the reference algorithm) ──────────────────
function wrapText(text, maxCharsPerLine = 22) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    if ((current + " " + word).length <= maxCharsPerLine) current += " " + word;
    else { lines.push(current); current = word; }
  }
  lines.push(current);
  return lines;
}

function maxCharsForWidth(width) {
  return Math.max(16, Math.floor((width - CARD_PADDING_X * 2) / 7.2));
}

function summarizeNotes(notes) {
  if (!notes.length) return "";
  const joined = notes.join(" ");
  return joined.length > 40 ? joined.slice(0, 37) + "..." : joined;
}

function getVisibleMaxDepth(node, depth = 0) {
  if (node.collapsed || !node.children.length) return depth;
  return Math.max(...node.children.map((child) => getVisibleMaxDepth(child, depth + 1)));
}

function buildColumnXPositions(maxVisibleDepth) {
  const positions = [];
  let currentX = CANVAS_PADDING_X;
  for (let depth = 0; depth <= maxVisibleDepth; depth += 1) {
    positions[depth] = currentX;
    const widthForDepth = depth === maxVisibleDepth && depth > 0 ? LAST_VISIBLE_COLUMN_WIDTH : CARD_WIDTH;
    currentX += widthForDepth + COLUMN_GAP;
  }
  return positions;
}

function prepareMetrics(node, depth = 0, maxVisibleDepth = 0) {
  const nodeWidth = depth === maxVisibleDepth && depth > 0 ? LAST_VISIBLE_COLUMN_WIDTH : CARD_WIDTH;
  const titleLines = wrapText(node.title, maxCharsForWidth(nodeWidth));
  const noteSummary = summarizeNotes(node.notes);
  const noteLines = noteSummary ? wrapText(noteSummary, maxCharsForWidth(nodeWidth) + 3).slice(0, 2) : [];
  const contentHeight = (titleLines.length + noteLines.length) * LINE_HEIGHT;
  node.metrics = {
    titleLines,
    noteLines,
    width: nodeWidth,
    height: CARD_PADDING_TOP + contentHeight + CARD_PADDING_BOTTOM,
  };
  node.children.forEach((child) => prepareMetrics(child, depth + 1, maxVisibleDepth));
}

function getRequiredSiblingGap(previousNode, nextNode) {
  const previousLanes = previousNode.laneExtents;
  const nextLanes = nextNode.laneExtents;
  const sharedDepths = [...previousLanes.keys()].filter((depth) => nextLanes.has(depth));
  let requiredGap = previousNode.metrics.height / 2 + nextNode.metrics.height / 2 + SIBLING_GAP;
  for (const depth of sharedDepths) {
    const previousLane = previousLanes.get(depth);
    const nextLane = nextLanes.get(depth);
    requiredGap = Math.max(requiredGap, previousLane.bottom - nextLane.top + SIBLING_GAP);
  }
  return requiredGap;
}

function computeLaneExtents(node) {
  node.childCenterOffsets = [];
  node.laneExtents = new Map([[0, { top: -node.metrics.height / 2, bottom: node.metrics.height / 2 }]]);

  if (node.collapsed || !node.children.length) {
    node.globalTop = -node.metrics.height / 2;
    node.globalBottom = node.metrics.height / 2;
    return;
  }

  node.children.forEach(computeLaneExtents);

  const provisionalCenters = [];
  for (let index = 0; index < node.children.length; index += 1) {
    if (index === 0) { provisionalCenters.push(0); continue; }
    const currentChild = node.children[index];
    let minAllowedCenter = Number.NEGATIVE_INFINITY;
    // Check every earlier sibling branch, not just the previous one, to
    // prevent non-adjacent branch overlaps.
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previousChild = node.children[previousIndex];
      const gap = getRequiredSiblingGap(previousChild, currentChild);
      minAllowedCenter = Math.max(minAllowedCenter, provisionalCenters[previousIndex] + gap);
    }
    provisionalCenters.push(minAllowedCenter);
  }

  let groupTop = Number.POSITIVE_INFINITY;
  let groupBottom = Number.NEGATIVE_INFINITY;
  node.children.forEach((child, index) => {
    groupTop = Math.min(groupTop, provisionalCenters[index] + child.globalTop);
    groupBottom = Math.max(groupBottom, provisionalCenters[index] + child.globalBottom);
  });

  const groupCenterShift = -((groupTop + groupBottom) / 2);

  node.children.forEach((child, index) => {
    const centeredOffset = provisionalCenters[index] + groupCenterShift;
    node.childCenterOffsets[index] = centeredOffset;
    for (const [depth, extent] of child.laneExtents.entries()) {
      const shiftedExtent = { top: extent.top + centeredOffset, bottom: extent.bottom + centeredOffset };
      const existing = node.laneExtents.get(depth + 1);
      if (!existing) {
        node.laneExtents.set(depth + 1, shiftedExtent);
      } else {
        existing.top = Math.min(existing.top, shiftedExtent.top);
        existing.bottom = Math.max(existing.bottom, shiftedExtent.bottom);
      }
    }
  });

  node.globalTop = Number.POSITIVE_INFINITY;
  node.globalBottom = Number.NEGATIVE_INFINITY;
  for (const extent of node.laneExtents.values()) {
    node.globalTop = Math.min(node.globalTop, extent.top);
    node.globalBottom = Math.max(node.globalBottom, extent.bottom);
  }
}

function layoutVisibleNodes(root, columnXPositions) {
  const nodes = [];
  const links = [];
  computeLaneExtents(root);
  const rootCenterY = CANVAS_PADDING_Y - root.globalTop;

  const walk = (node, depth, centerY) => {
    node.depth = depth;
    node.x = columnXPositions[depth] ?? CANVAS_PADDING_X;
    node.y = centerY - node.metrics.height / 2;
    nodes.push(node);
    if (node.collapsed) return;
    node.children.forEach((child, index) => {
      links.push([node, child]);
      walk(child, depth + 1, centerY + node.childCenterOffsets[index]);
    });
  };

  walk(root, 0, rootCenterY);
  return { nodes, links };
}

function computeLayout(root) {
  const maxVisibleDepth = getVisibleMaxDepth(root);
  const columnXPositions = buildColumnXPositions(maxVisibleDepth);
  prepareMetrics(root, 0, maxVisibleDepth);
  const { nodes, links } = layoutVisibleNodes(root, columnXPositions);
  const width = Math.max(...nodes.map((n) => n.x + n.metrics.width + CANVAS_PADDING_X));
  const height = Math.max(...nodes.map((n) => n.y + n.metrics.height + CANVAS_PADDING_Y));
  return { nodes, links, width, height };
}

// ── SVG string builder (shared by SVG/PNG/PDF export) ──────────────────────
function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function linkPath(parent, child) {
  const startX = parent.x + parent.metrics.width;
  const startY = parent.y + parent.metrics.height / 2;
  const endX = child.x;
  const endY = child.y + child.metrics.height / 2;
  const controlOffset = Math.max(42, (endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

function nodeMarkup(node) {
  const { width, height, titleLines, noteLines } = node.metrics;
  const isRoot = !node.parent;
  const rectFill = isRoot ? ROOT_FILL : NODE_FILL;
  const rectStroke = node.children.length && node.collapsed ? COLLAPSED_STROKE : isRoot ? ROOT_STROKE : NODE_STROKE;
  const rectDash = node.children.length && node.collapsed ? "5 4" : "";
  let textY = node.y + CARD_PADDING_TOP;
  const lineMarkup = (line, fill) => {
    const markup = `<tspan x="${node.x + CARD_PADDING_X}" y="${textY}" fill="${fill}">${escapeXml(line)}</tspan>`;
    textY += LINE_HEIGHT;
    return markup;
  };
  const titleMarkup = titleLines.map((line) => lineMarkup(line, TEXT_FILL)).join("");
  const noteMarkup = noteLines.map((line) => lineMarkup(line, NOTE_FILL)).join("");
  const toggleMarkup = node.children.length
    ? `<rect x="${node.x + width - 44}" y="${node.y + 14}" width="28" height="20" rx="10" ry="10" fill="${TOGGLE_FILL}" stroke="${NODE_STROKE}" stroke-width="1"></rect>` +
      `<text x="${node.x + width - 30}" y="${node.y + 24}" fill="${TOGGLE_TEXT}" font-family="${FONT_FAMILY}" font-size="13" font-weight="800" text-anchor="middle" dominant-baseline="central">${node.collapsed ? "+" : "−"}</text>`
    : "";
  return (
    `<g>` +
    `<rect x="${node.x}" y="${node.y}" width="${width}" height="${height}" rx="18" ry="18" fill="${rectFill}" stroke="${rectStroke}" stroke-width="${isRoot ? 1.8 : 1.5}" stroke-linejoin="round" ${rectDash ? `stroke-dasharray="${rectDash}"` : ""} />` +
    toggleMarkup +
    `<text font-family="${FONT_FAMILY}" font-size="14" font-weight="700" dominant-baseline="hanging">${titleMarkup}${noteMarkup}</text>` +
    `</g>`
  );
}

function buildSvgMarkup(root) {
  const { nodes, links, width, height } = computeLayout(root);
  const linkStr = links
    .map(([parent, child]) => `<path stroke="${LINK_STROKE}" d="${linkPath(parent, child)}" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`)
    .join("");
  const nodeStr = nodes.map(nodeMarkup).join("");
  return {
    markup:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${SVG_BG}" />` +
      linkStr +
      nodeStr +
      `</svg>`,
    width,
    height,
  };
}

// ── PDF progressive pagination (ported from reference) ─────────────────────
function countVisibleNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.collapsed) return count;
  node.children.forEach((child) => { count += countVisibleNodes(child); });
  return count;
}

function getSubtreeDepth(node) {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(getSubtreeDepth));
}

function getExpandableVisibleNodes(node) {
  const candidates = [];
  const walk = (current) => {
    if (!current.children.length) return;
    if (current.collapsed) { candidates.push(current); return; }
    current.children.forEach(walk);
  };
  walk(node);
  return candidates;
}

function isSubtreeFullyExpanded(node) {
  if (!node.children.length) return true;
  if (node.collapsed) return false;
  return node.children.every(isSubtreeFullyExpanded);
}

function fullyExpandedCopy(sourceTree) {
  const tree = deserializeTree(serializeTree(sourceTree));
  tree.collapsed = false;
  tree.children.forEach((child) => setCollapsedRecursive(child, false));
  return tree;
}

function buildProgressivePrintTrees(sourceTree, maxVisibleNodes) {
  // PDF exports the WHOLE mind map, fully expanded (unlike PNG/SVG which mirror the
  // on-screen collapse state). If the entire expanded tree fits on one page, emit it
  // as a single fully-expanded page — no fragmentation. Only genuinely large maps get
  // split into progressive per-branch pages so every node stays readable.
  const fullTree = fullyExpandedCopy(sourceTree);
  if (countVisibleNodes(fullTree) <= maxVisibleNodes) {
    return [fullTree];
  }

  const pages = [];
  for (let index = 0; index < sourceTree.children.length; index += 1) {
    const pageTree = deserializeTree(serializeTree(sourceTree));
    pageTree.collapsed = false;
    pageTree.children.forEach((child) => setCollapsedRecursive(child, true));
    const targetChild = pageTree.children[index];
    if (!targetChild) continue;
    targetChild.collapsed = false;

    if (!targetChild.children.length) { pages.push(pageTree); continue; }

    let lastSignature = "";
    let guard = 0;
    while (guard < 300) {
      guard += 1;
      let didProgress = false;

      // Greedily pack this page with as many additional expansions as fit.
      while (true) {
        const candidates = getExpandableVisibleNodes(targetChild);
        let expandedAny = false;
        for (const candidate of candidates) {
          candidate.collapsed = false;
          if (countVisibleNodes(pageTree) <= maxVisibleNodes) {
            expandedAny = true;
            didProgress = true;
          } else {
            candidate.collapsed = true;
          }
        }
        if (!expandedAny) break;
      }

      if (!didProgress) {
        const forceCandidates = getExpandableVisibleNodes(targetChild);
        if (!forceCandidates.length) break;
        forceCandidates[0].collapsed = false;
      }

      const signature = JSON.stringify(serializeTree(pageTree));
      if (signature !== lastSignature) {
        pages.push(deserializeTree(serializeTree(pageTree)));
        lastSignature = signature;
      }
      if (isSubtreeFullyExpanded(targetChild)) break;
    }
  }

  if (!pages.length) {
    const fallback = deserializeTree(serializeTree(sourceTree));
    fallback.collapsed = false;
    fallback.children.forEach((child) => setCollapsedRecursive(child, false));
    pages.push(fallback);
  }
  return pages;
}

function svgMarkupToImage(markup) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not rasterize the SVG.")); };
    image.src = url;
  });
}

function formatSavedDate(value) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// ── page component ──────────────────────────────────────────────────────────
export default function MindmapPage() {
  const [view, setView] = useState("list");
  const [maps, setMaps] = useState([]);
  const [mapsTotal, setMapsTotal] = useState(0);
  const [mapOffset, setMapOffset] = useState(0);
  const [mapHasMore, setMapHasMore] = useState(false);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [currentMapId, setCurrentMapId] = useState(null);
  const [title, setTitle] = useState("");
  const [outlineItems, setOutlineItems] = useState(() => [createOutlineItem("", 0)]);
  const [status, setStatus] = useState({ message: "", tone: "" });
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hashModal, setHashModal] = useState({ open: false, mode: "import", text: "" });
  const [treeVersion, setTreeVersion] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);

  const treeRef = useRef(null);
  const autoSaveTimer = useRef(null);
  const saveInProgress = useRef(false);
  const outlineListRef = useRef(null);
  const fileInputRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { title, outlineItems, currentMapId };

  const say = useCallback((message, tone = "") => setStatus({ message, tone }), []);

  const bumpTree = () => setTreeVersion((v) => v + 1);

  const layout = useMemo(() => {
    if (!treeRef.current) return null;
    try {
      return computeLayout(treeRef.current);
    } catch (_) {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeVersion]);

  // ── saved maps API ──
  const loadSavedMaps = useCallback(async (reset = true, offset = 0) => {
    if (!API_BASE_URL) return;
    setMapsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/mindmaps?limit=${MAP_PAGE_SIZE}&offset=${reset ? 0 : offset}`);
      if (!res.ok) throw new Error(`Mind map list failed: ${res.status}`);
      const payload = await res.json();
      const incoming = payload.maps || [];
      setMaps((prev) => {
        if (reset) return incoming;
        const byId = new Map(prev.map((m) => [m.id, m]));
        incoming.forEach((m) => byId.set(m.id, m));
        return Array.from(byId.values());
      });
      setMapsTotal(Number(payload.total) || 0);
      setMapOffset(Number(payload.nextOffset) || incoming.length);
      setMapHasMore(!!payload.hasMore);
    } catch (error) {
      say(error.message || "Could not load saved maps.", "error");
    } finally {
      setMapsLoading(false);
    }
  }, [say]);

  useEffect(() => { loadSavedMaps(); }, [loadSavedMaps]);

  const getMapPayload = useCallback(() => {
    const { title: curTitle, outlineItems: items } = stateRef.current;
    const mainHeading = items[0]?.text?.trim();
    return {
      title: mainHeading || curTitle.trim() || "Untitled Mind Map",
      markdown: outlineToMarkdown(items),
      outlineItems: items.map((item, index) => ({ text: item.text, level: normalizeLevel(items, index, item.level) })),
      tree: treeRef.current ? serializeTree(treeRef.current) : null,
    };
  }, []);

  const saveCurrentMap = useCallback(async (options = {}) => {
    if (!API_BASE_URL) {
      if (!options.quiet) say("Saving needs a backend URL configured.", "error");
      return;
    }
    if (saveInProgress.current) return;
    saveInProgress.current = true;
    setSaving(true);
    try {
      const payload = getMapPayload();
      const mapId = stateRef.current.currentMapId;
      const res = await apiFetch(mapId ? `${API_BASE_URL}/mindmaps/${mapId}` : `${API_BASE_URL}/mindmaps`, {
        method: mapId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `Save failed: ${res.status}`);
      setCurrentMapId(data.map.id);
      setTitle(data.map.title);
      await loadSavedMaps();
      if (!options.quiet) say(`Saved "${data.map.title}".`, "success");
    } catch (error) {
      say(error.message || "Could not save this map.", "error");
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }, [getMapPayload, loadSavedMaps, say]);

  const scheduleAutoSave = useCallback(() => {
    if (!stateRef.current.currentMapId || !API_BASE_URL) return;
    window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => saveCurrentMap({ quiet: true }), 900);
  }, [saveCurrentMap]);

  useEffect(() => () => window.clearTimeout(autoSaveTimer.current), []);

  const focusOutlineItem = (id) => {
    requestAnimationFrame(() => {
      const input = outlineListRef.current?.querySelector(`[data-outline-id="${id}"]`);
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  };

  // ── outline operations ──
  const setItems = (updater, { autosave = true } = {}) => {
    setOutlineItems((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next[0]) next[0].level = 0;
      return next;
    });
    if (autosave) scheduleAutoSave();
  };

  const loadOutlineFromMarkdown = (text) => {
    const parsedTree = parseSource(text);
    let items = outlineFromTree(parsedTree);
    if (!items.length) items = [createOutlineItem("", 0)];
    setItems(items);
    setTitle(items[0]?.text?.trim() || "");
  };

  const changeItemText = (id, value) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, text: value } : item));
      return next;
    });
    if (outlineItems[0]?.id === id) setTitle(value.trim());
  };

  const indentItem = (id, delta) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index], level: normalizeLevel(next, index, next[index].level + delta) };
      return next;
    });
    focusOutlineItem(id);
  };

  const addItemAfter = (id) => {
    const newItem = createOutlineItem("", 0);
    setItems((prev) => {
      const index = id ? prev.findIndex((item) => item.id === id) : prev.length - 1;
      if (index < 0) return prev;
      newItem.level = index === 0 ? 1 : prev[index].level;
      const next = [...prev];
      next.splice(index + 1, 0, newItem);
      return next;
    });
    focusOutlineItem(newItem.id);
  };

  const deleteItem = (id) => {
    let fallbackId = null;
    setItems((prev) => {
      if (prev.length <= 1) return prev;
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      fallbackId = prev[Math.max(0, index - 1)].id;
      return prev.filter((item) => item.id !== id);
    });
    if (fallbackId) focusOutlineItem(fallbackId);
  };

  const handleOutlineKeyDown = (event, item) => {
    if (event.key === "Tab") {
      event.preventDefault();
      indentItem(item.id, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      addItemAfter(item.id);
      return;
    }
    if (event.key === "Backspace" && !event.currentTarget.value && outlineItems.length > 1) {
      event.preventDefault();
      deleteItem(item.id);
    }
  };

  // ── map actions ──
  const generateMap = () => {
    try {
      const tree = buildTreeFromOutline(stateRef.current.outlineItems);
      tree.collapsed = false;
      tree.children.forEach((child) => setCollapsedRecursive(child, true));
      treeRef.current = tree;
      bumpTree();
      say("Mind map generated. Click a node to open or close its children.", "success");
      saveCurrentMap({ quiet: true });
    } catch (error) {
      treeRef.current = null;
      bumpTree();
      say(error.message || "Could not generate map.", "error");
    }
  };

  const toggleNode = (id) => {
    if (!treeRef.current) return;
    const target = findNodeById(treeRef.current, id);
    if (!target || !target.children.length) return;
    target.collapsed = !target.collapsed;
    bumpTree();
  };

  const expandAll = () => {
    if (!treeRef.current) { say("Generate a map first.", "error"); return; }
    setCollapsedRecursive(treeRef.current, false);
    treeRef.current.collapsed = false;
    bumpTree();
    say("Expanded all nodes.", "success");
  };

  const collapseAll = () => {
    if (!treeRef.current) { say("Generate a map first.", "error"); return; }
    treeRef.current.children.forEach((child) => setCollapsedRecursive(child, true));
    bumpTree();
    say("Collapsed the tree to top-level nodes.", "success");
  };

  const createNewMindmap = async () => {
    setCurrentMapId(null);
    stateRef.current.currentMapId = null;
    setTitle("");
    const first = createOutlineItem("", 0);
    setOutlineItems([first]);
    stateRef.current.outlineItems = [first];
    stateRef.current.title = "";
    treeRef.current = null;
    bumpTree();
    setView("workspace");
    await saveCurrentMap({ quiet: true });
    focusOutlineItem(first.id);
    say("Created a new mind map.", "success");
  };

  const loadMapIntoEditor = (map) => {
    setCurrentMapId(map.id);
    setTitle(map.title || "Untitled Mind Map");
    let items;
    if (Array.isArray(map.outlineItems) && map.outlineItems.length) {
      items = map.outlineItems.map((item) => createOutlineItem(String(item.text || ""), Number(item.level) || 0));
      items[0].level = 0;
    } else if (map.markdown) {
      items = outlineFromTree(parseSource(map.markdown));
    } else {
      items = [createOutlineItem("", 0)];
    }
    setOutlineItems(items);
    treeRef.current = map.tree ? deserializeTree(map.tree) : null;
    bumpTree();
    setView("workspace");
    say(`Loaded "${map.title || "Untitled Mind Map"}".`, "success");
  };

  const loadMindmapById = async (mapId) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/mindmaps/${mapId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `Load failed: ${res.status}`);
      loadMapIntoEditor(data.map);
    } catch (error) {
      say(error.message || "Could not load that map.", "error");
    }
  };

  const deleteMindmap = async (mapId) => {
    if (!(await confirmDialog({ title: "Delete mind map", message: "Delete this mind map?", confirmLabel: "Delete", danger: true }))) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/mindmaps/${mapId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      if (mapId === currentMapId) setCurrentMapId(null);
      await loadSavedMaps();
      say("Mind map deleted.", "success");
    } catch (error) {
      say(error.message || "Could not delete that map.", "error");
    }
  };

  const backToList = () => {
    setFullscreen(false);
    setView("list");
    loadSavedMaps();
    say("Select a map from the list, or create a new one.", "");
  };

  // ── import/export ──
  const handleFileLoad = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      loadOutlineFromMarkdown(text);
      say(`Loaded ${file.name}. You can edit the outline and generate the map.`, "success");
    } catch (error) {
      say(error.message || "Could not read that file.", "error");
    }
  };

  const openHashModal = (mode) => {
    setHashModal({
      open: true,
      mode,
      text: mode === "import" ? "" : outlineToMarkdown(outlineItems),
    });
  };

  const handleHashModalPrimary = async () => {
    if (hashModal.mode === "import") {
      const text = hashModal.text.trim();
      if (!text) { say("Paste some # code first.", "error"); return; }
      try {
        loadOutlineFromMarkdown(text);
        setHashModal((p) => ({ ...p, open: false }));
        say("Inserted # code into the outline editor.", "success");
      } catch (error) {
        say(error.message || "Could not parse the # code.", "error");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(hashModal.text);
      say("Copied # code to clipboard.", "success");
    } catch (_) {
      say("Copy failed. You can still copy the code manually.", "error");
    }
  };

  useEffect(() => {
    if (!hashModal.open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setHashModal((p) => ({ ...p, open: false })); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hashModal.open]);

  const downloadSvg = () => {
    if (!treeRef.current) { say("Generate a map before downloading.", "error"); return; }
    const { markup } = buildSvgMarkup(treeRef.current);
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mindmap-current-view.svg";
    link.click();
    URL.revokeObjectURL(url);
    say("Downloaded current view as SVG.", "success");
  };

  const downloadPng = async () => {
    if (!treeRef.current) { say("Generate a map before downloading.", "error"); return; }
    try {
      const { markup, width, height } = buildSvgMarkup(treeRef.current);
      const image = await svgMarkupToImage(markup);
      const exportScale = Math.max(2, Math.min(4, Math.ceil(window.devicePixelRatio || 1) + 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * exportScale);
      canvas.height = Math.round(height * exportScale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create canvas context for PNG export.");
      context.setTransform(exportScale, 0, 0, exportScale, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = SVG_BG;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) { say("Could not encode PNG for this view.", "error"); return; }
        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = "mindmap-current-view.png";
        link.click();
        URL.revokeObjectURL(pngUrl);
        say(`Downloaded high-resolution PNG (${exportScale}x).`, "success");
      }, "image/png");
    } catch (error) {
      say(error.message || "Could not export PNG for this view.", "error");
    }
  };

  const buildPdfPageImage = async (pageTree) => {
    const { markup, width, height } = buildSvgMarkup(pageTree);
    const image = await svgMarkupToImage(markup);
    const pageAspect = 297 / 210; // A4 landscape
    const exportScale = Math.max(2, Math.min(4, Math.ceil(window.devicePixelRatio || 1) + 1));
    const pageWidth = Math.max(2200, Math.min(5600, Math.round(width * exportScale)));
    const pageHeight = Math.round(pageWidth / pageAspect);
    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create canvas context for PDF export.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = SVG_BG;
    context.fillRect(0, 0, pageWidth, pageHeight);
    const fitScale = Math.min(pageWidth / width, pageHeight / height);
    const drawWidth = width * fitScale;
    const drawHeight = height * fitScale;
    context.drawImage(image, (pageWidth - drawWidth) / 2, (pageHeight - drawHeight) / 2, drawWidth, drawHeight);
    return canvas.toDataURL("image/jpeg", 0.95);
  };

  const downloadPdf = async () => {
    if (!treeRef.current) { say("Generate a map before downloading PDF.", "error"); return; }
    setExportingPdf(true);
    try {
      say("Preparing full mind map pages for PDF...", "");
      // A4 landscape at export resolution stays readable up to ~28 cells; small/medium
      // maps render on a single fully-expanded page, larger ones paginate progressively.
      const maxCellsPerPage = 28;
      const sourceTree = deserializeTree(serializeTree(treeRef.current));
      const progressiveTrees = buildProgressivePrintTrees(sourceTree, maxCellsPerPage);
      const allPages = [];
      for (const pageTree of progressiveTrees) {
        allPages.push(await buildPdfPageImage(pageTree));
      }
      if (!allPages.length) throw new Error("Could not render printable PDF pages.");

      const printWindow = window.open("", "_blank", "width=1280,height=900");
      if (!printWindow) throw new Error("Popup blocked. Allow popups for PDF export.");

      const pageMarkup = allPages
        .map((src, index) => `<section class="pdf-page"><img src="${src}" alt="Mind map page ${index + 1}" /></section>`)
        .join("");
      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>mindmap-print.pdf</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
.pdf-page { width: 100%; break-after: page; page-break-after: always; }
.pdf-page:last-child { break-after: auto; page-break-after: auto; }
.pdf-page img { display: block; width: 100%; height: auto; }
@media screen {
  body { padding: 16px; background: #f2f2f2; }
  .pdf-page { background: #fff; max-width: 1120px; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
}
</style>
</head>
<body>${pageMarkup}
<script>
(function () {
  function waitForImages() {
    var images = Array.prototype.slice.call(document.images);
    if (!images.length) return Promise.resolve();
    return Promise.all(images.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) { img.onload = resolve; img.onerror = resolve; });
    }));
  }
  window.addEventListener("load", function () {
    waitForImages().then(function () {
      setTimeout(function () { window.focus(); window.print(); }, 180);
    });
  });
})();
<\/script>
</body>
</html>`);
      printWindow.document.close();
      printWindow.focus();
      say(`PDF print view ready (landscape, progressive pages, up to ~${maxCellsPerPage} visible cells).`, "success");
    } catch (error) {
      say(error.message || "Could not prepare PDF export.", "error");
    } finally {
      setExportingPdf(false);
    }
  };

  // ── render ──
  const renderCanvas = () => (
    <div className={`mm-canvas-card${fullscreen ? " mm-fullscreen" : ""}`}>
      <div className="mm-canvas-topbar">
        <div className="mm-canvas-copy">
          <h2>Interactive Canvas</h2>
          <p>The layout automatically resizes around the nodes that are currently open.</p>
        </div>
        <div className="mm-toolbar-row">
          <button className="btn-day secondary" onClick={expandAll}>Expand All</button>
          <button className="btn-day secondary" onClick={collapseAll}>Collapse All</button>
          <button className="btn-day secondary" onClick={downloadPdf} disabled={exportingPdf}>
            {exportingPdf ? "Preparing…" : "PDF"}
          </button>
          <button className="btn-day secondary" onClick={downloadSvg}>SVG</button>
          <button className="btn-day secondary" onClick={downloadPng}>PNG</button>
          <button className="btn-day secondary" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? "Exit Focus" : "Focus Mode"}
          </button>
        </div>
      </div>
      <div className="mm-viewport">
        {!layout ? (
          <div className="mm-empty">
            <strong>No map yet</strong>
            Generate from the outline to see the mind map here.
          </div>
        ) : (
          <svg
            width={layout.width}
            height={layout.height}
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Mind map"
          >
            {layout.links.map(([parent, child]) => (
              <path
                key={`${parent.id}-${child.id}`}
                d={linkPath(parent, child)}
                stroke={LINK_STROKE}
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {layout.nodes.map((node) => {
              const { width, height, titleLines, noteLines } = node.metrics;
              const isRoot = !node.parent;
              const collapsed = node.children.length && node.collapsed;
              let textY = node.y + CARD_PADDING_TOP;
              const lines = [
                ...titleLines.map((line) => ({ line, fill: TEXT_FILL })),
                ...noteLines.map((line) => ({ line, fill: NOTE_FILL })),
              ].map(({ line, fill }) => {
                const y = textY;
                textY += LINE_HEIGHT;
                return { line, fill, y };
              });
              return (
                <g
                  key={node.id}
                  className={`mm-node${node.children.length ? " clickable" : ""}`}
                  onClick={() => toggleNode(node.id)}
                >
                  <rect
                    x={node.x} y={node.y} width={width} height={height} rx="18" ry="18"
                    fill={isRoot ? ROOT_FILL : NODE_FILL}
                    stroke={collapsed ? COLLAPSED_STROKE : isRoot ? ROOT_STROKE : NODE_STROKE}
                    strokeWidth={isRoot ? 1.8 : 1.5}
                    strokeLinejoin="round"
                    strokeDasharray={collapsed ? "5 4" : undefined}
                  />
                  {node.children.length > 0 && (
                    <>
                      <rect x={node.x + width - 44} y={node.y + 14} width="28" height="20" rx="10" ry="10"
                        fill={TOGGLE_FILL} stroke={NODE_STROKE} strokeWidth="1" />
                      <text x={node.x + width - 30} y={node.y + 24} fill={TOGGLE_TEXT}
                        fontFamily={FONT_FAMILY} fontSize="11" fontWeight="800"
                        textAnchor="middle" dominantBaseline="middle">
                        {node.collapsed ? "+" : "-"}
                      </text>
                    </>
                  )}
                  <text fontFamily={FONT_FAMILY} fontSize="14" fontWeight="700" dominantBaseline="hanging">
                    {lines.map(({ line, fill, y }, i) => (
                      <tspan key={i} x={node.x + CARD_PADDING_X} y={y} fill={fill}>{line}</tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="mindmap" />
        <p className="subtext">Turn notes into an expandable mind map.</p>
        {!API_BASE_URL ? (
          <p className="api-state warn">Running in local mode — maps cannot be saved without a backend URL.</p>
        ) : null}
      </header>

      {status.message ? (
        <p className={`mm-status${status.tone ? ` ${status.tone}` : ""}`}>{status.message}</p>
      ) : null}

      {view === "list" ? (
        <section className="mm-library">
          <article className="player-card mm-library-card">
            <div className="player-row">
              <h2 className="player-name">Saved Mind Maps</h2>
              <button className="btn-new" onClick={createNewMindmap}>+ Create New</button>
            </div>
            {!maps.length && !mapsLoading ? (
              <p className="dt-empty">No saved maps yet. Use Create New to make your first map.</p>
            ) : (
              <div className="mm-map-list">
                {maps.map((map) => (
                  <div className={`mm-map-item${map.id === currentMapId ? " active" : ""}`} key={map.id}>
                    <div className="mm-map-info">
                      <p className="mm-map-title">{map.title || "Untitled Mind Map"}</p>
                      <p className="mm-map-meta">
                        {map.itemCount || 0} rows · Updated {formatSavedDate(map.updatedAt)}
                      </p>
                      {map.preview ? <p className="mm-map-preview">{map.preview}</p> : null}
                    </div>
                    <div className="mm-map-actions">
                      <button className="btn-day secondary" onClick={() => loadMindmapById(map.id)}>Open</button>
                      <button className="dt-icon-btn danger" title="Delete" onClick={() => deleteMindmap(map.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                ))}
                {mapsLoading ? <p className="dt-empty">Loading…</p> : null}
                {mapHasMore && !mapsLoading ? (
                  <button className="btn-day secondary mm-load-more" onClick={() => loadSavedMaps(false, mapOffset)}>
                    Load More ({maps.length}/{mapsTotal})
                  </button>
                ) : null}
              </div>
            )}
          </article>
        </section>
      ) : (
        <section className="mm-workspace">
          <article className="player-card mm-outline-card">
            <div className="player-row">
              <h2 className="player-name">Outline</h2>
              <button className="btn-day secondary" onClick={backToList}>‹ All Maps</button>
            </div>

            <input
              className="task-select mm-title-input"
              placeholder="Map title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); scheduleAutoSave(); }}
            />

            <div className="mm-toolbar">
              <button className="btn-day secondary" onClick={() => fileInputRef.current?.click()}>Load .txt</button>
              <input ref={fileInputRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={handleFileLoad} />
              <button className="btn-day secondary" onClick={() => openHashModal("import")}>Insert #</button>
              <button className="btn-day secondary" onClick={() => openHashModal("export")}>Extract #</button>
              <button className="btn-day secondary" onClick={() => { loadOutlineFromMarkdown(DEMO_CONTENT); say("Demo content loaded into the outline editor.", "success"); }}>Demo</button>
              <button className="btn-new" onClick={generateMap}>Generate Map</button>
              <button className="btn-day secondary" onClick={() => saveCurrentMap()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            <div className="mm-outline-list" ref={outlineListRef}>
              {outlineItems.map((item, index) => (
                <div className="mm-outline-row" key={item.id} style={{ marginLeft: `${Math.min(item.level, 5) * 20}px` }}>
                  <span className="mm-outline-chip">{index === 0 ? 0 : item.level}</span>
                  <button className="dt-icon-btn" title="Outdent" disabled={index === 0 || item.level <= 1}
                    onClick={() => indentItem(item.id, -1)}><Icon name="chevron-left" size={14} /></button>
                  <button className="dt-icon-btn" title="Indent" disabled={index === 0}
                    onClick={() => indentItem(item.id, 1)}><Icon name="chevron-right" size={14} /></button>
                  <input
                    className="mm-outline-input"
                    data-outline-id={item.id}
                    value={item.text}
                    placeholder={index === 0 ? "Main topic" : "Add point"}
                    onChange={(e) => changeItemText(item.id, e.target.value)}
                    onKeyDown={(e) => handleOutlineKeyDown(e, item)}
                  />
                  <button className="dt-icon-btn" title="Add item below" onClick={() => addItemAfter(item.id)}>+</button>
                  <button className="dt-icon-btn danger" title="Delete item" disabled={outlineItems.length === 1}
                    onClick={() => deleteItem(item.id)}><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
            <div className="mm-outline-foot">
              <button className="btn-day secondary" onClick={() => addItemAfter(outlineItems[outlineItems.length - 1]?.id)}>+ Add Item</button>
              <button
                className="btn-day secondary"
                onClick={() => {
                  const first = createOutlineItem("", 0);
                  setItems([first]);
                  setTitle("");
                  treeRef.current = null;
                  bumpTree();
                  focusOutlineItem(first.id);
                  say("Outline cleared. Start with your main topic.", "success");
                }}
              >Clear</button>
            </div>
            <p className="mm-hint">
              Type each point as a row. Use <code>Tab</code> / <code>Shift+Tab</code> to make sublists,
              <code>Enter</code> to add a row. Click a node on the canvas to expand or collapse it.
            </p>
          </article>

          {renderCanvas()}
        </section>
      )}

      {hashModal.open ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setHashModal((p) => ({ ...p, open: false })); }}>
          <div className="task-modal mm-hash-modal">
            <h3>{hashModal.mode === "import" ? "Insert # Code" : "Extract # Code"}</h3>
            <p className="mm-modal-desc">
              {hashModal.mode === "import"
                ? "Paste heading-based text here. It will be converted into the outline editor."
                : "Copy this heading-based code to regenerate the same mind map later."}
            </p>
            <textarea
              className="task-textarea mm-hash-textarea"
              spellCheck={false}
              readOnly={hashModal.mode !== "import"}
              value={hashModal.text}
              onChange={(e) => setHashModal((p) => ({ ...p, text: e.target.value }))}
              autoFocus
            />
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setHashModal((p) => ({ ...p, open: false }))}>
                {hashModal.mode === "import" ? "Cancel" : "Close"}
              </button>
              <button className="btn-new" onClick={handleHashModalPrimary}>
                {hashModal.mode === "import" ? "Insert Into Editor" : "Copy Code"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
