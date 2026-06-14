let idCounter = 0;
export function newNodeId() {
  idCounter += 1;
  return `tnode_${Date.now()}_${idCounter}`;
}

export const ROOT_PARENT_ID = null;

export function createTreeNode(label = "") {
  return { id: newNodeId(), label: String(label).trim(), children: [], counters: [] };
}

// Recursively ensure every node has an id and a counters array (fixes legacy data on load)
export function ensureNodeIds(nodes) {
  return (nodes || []).map((node) => ({
    ...node,
    id: node?.id || newNodeId(),
    label: String(node?.label || ""),
    children: ensureNodeIds(node?.children),
    counters: Array.isArray(node?.counters) ? node.counters : [],
  }));
}

export function findNode(nodes, nodeId) {
  for (const node of nodes || []) {
    if (node.id === nodeId) return node;
    const found = findNode(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

// Returns { node, ancestors } where ancestors is root->parent order, or null if not found
export function findNodeWithAncestors(nodes, nodeId, ancestors = []) {
  for (const node of nodes || []) {
    if (node.id === nodeId) return { node, ancestors };
    const found = findNodeWithAncestors(node.children, nodeId, [...ancestors, node]);
    if (found) return found;
  }
  return null;
}

export function updateNodeInTree(nodes, nodeId, updaterFn) {
  return (nodes || []).map((node) => {
    if (node.id === nodeId) return updaterFn(node);
    return { ...node, children: updateNodeInTree(node.children, nodeId, updaterFn) };
  });
}

export function deleteNodeFromTree(nodes, nodeId) {
  return (nodes || [])
    .filter((node) => node.id !== nodeId)
    .map((node) => ({ ...node, children: deleteNodeFromTree(node.children, nodeId) }));
}

export function addChildToTree(nodes, parentId, childNode) {
  if (parentId === ROOT_PARENT_ID) return [...(nodes || []), childNode];
  return (nodes || []).map((node) => {
    if (node.id === parentId) return { ...node, children: [...(node.children || []), childNode] };
    return { ...node, children: addChildToTree(node.children, parentId, childNode) };
  });
}

export function countAllNodes(nodes) {
  return (nodes || []).reduce((total, node) => total + 1 + countAllNodes(node.children), 0);
}

// Display-only merge of inherited + own counters.
// ancestors: root->parent order. Nearest ancestor wins for inherited value;
// the node's own definition overrides any inherited value for the same key.
export function getEffectiveCounters(node, ancestors) {
  const map = new Map();
  (ancestors || []).forEach((ancestor) => {
    (ancestor.counters || []).forEach((c) => {
      map.set(c.key, { key: c.key, count: c.count, inherited: true });
    });
  });
  (node?.counters || []).forEach((c) => {
    map.set(c.key, { key: c.key, count: c.count, inherited: false });
  });
  return Array.from(map.values());
}
