"use client";
// The actual BlockNote instance. Kept in its own client-only module (loaded via
// next/dynamic with ssr:false in [docId]/page.js) since a contentEditable rich
// text editor cannot be server-rendered.

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./blocknote-theme.css";
import { useEffect, useMemo, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { cssVar } from "../lib/theme";
import { uploadNoterAsset, resolveNoterAsset } from "../lib/noterApi";

// BlockNote applies these as CSS custom properties directly on the editor DOM
// node, so we resolve our own design tokens into its theme shape instead of
// picking one of its two built-in themes — keeps the editor chrome (menus,
// hovers, selection) on the same surfaces as the rest of the app.
function buildTheme() {
  return {
    colors: {
      editor: { text: cssVar("--text", "#f4f4f5"), background: cssVar("--card", "#141417") },
      menu: { text: cssVar("--text", "#f4f4f5"), background: cssVar("--card", "#141417") },
      tooltip: { text: cssVar("--card", "#141417"), background: cssVar("--text-bright", "#ffffff") },
      hovered: { text: cssVar("--text", "#f4f4f5"), background: cssVar("--sunken", "#0e0e11") },
      selected: { text: cssVar("--on-accent", "#ffffff"), background: cssVar("--primary", "#6366f1") },
      disabled: { text: cssVar("--faint", "#71717a"), background: cssVar("--sunken", "#0e0e11") },
      shadow: cssVar("--card-border", "#26262b"),
      border: cssVar("--card-border", "#26262b"),
      sideMenu: cssVar("--border-strong", "#313135"),
      // Text-highlight swatches are a content-authoring choice (like Notion's
      // callout colors), not chrome, so BlockNote's own defaults stay as-is.
    },
    borderRadius: 10,
    fontFamily: "var(--app-font, var(--font-manrope))",
  };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

export default function NoterEditor({ docId, initialContent, onChange, editable = true }) {
  const editor = useCreateBlockNote({
    initialContent: initialContent && initialContent.length ? initialContent : undefined,
    uploadFile: async (file) => uploadNoterAsset(docId, file),
    resolveFileUrl: async (url) => {
      if (isHttpUrl(url)) return url;
      const { url: signed } = await resolveNoterAsset(url);
      return signed;
    },
  });

  // Reacts to live theme/palette/font switches (Settings -> Appearance) without
  // remounting the editor: a fresh Theme object triggers BlockNoteView's own
  // internal effect that re-applies the CSS variables.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => setThemeTick((t) => t + 1));
    observer.observe(target, { attributes: true, attributeFilter: ["data-theme", "data-palette", "data-font"] });
    return () => observer.disconnect();
  }, []);
  const theme = useMemo(() => buildTheme(), [themeTick]);

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      editable={editable}
      onChange={() => onChange && onChange(editor.document)}
      className="noter-blocknote"
    />
  );
}
