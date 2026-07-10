"use client";
// Appearance = palette × mode, persisted per device in localStorage.
//   mode:    "dark" (default) | "light"      -> <html data-theme="light">
//   palette: "focus" (default) | "prime" | "midnight" | "academic"
//                                            -> <html data-palette="...">
// The attributes drive the CSS token overrides in globals.css; absent
// attributes mean the defaults. A pre-paint inline script in app/layout.js
// applies the stored appearance before first paint, so this module only
// handles runtime switching and cross-tab sync.

import { useState, useEffect, useCallback } from "react";

export const THEME_KEY = "race_hub_theme";
export const PALETTE_KEY = "race_hub_palette";

export const PALETTES = ["focus", "prime", "midnight", "academic"];

// Browser-chrome color per palette+mode (mirrors each palette's --bg).
const META_THEME_COLOR = {
  focus: { dark: "#09090b", light: "#f8fafc" },
  prime: { dark: "#000000", light: "#f5f5f7" },
  midnight: { dark: "#07111f", light: "#f6f8fc" },
  academic: { dark: "#111827", light: "#f9fafb" },
};

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}

export function getPalette() {
  try {
    const p = localStorage.getItem(PALETTE_KEY);
    return PALETTES.includes(p) ? p : "focus";
  } catch (_) {
    return "focus";
  }
}

export function applyAppearance(mode, palette) {
  const root = document.documentElement;
  if (mode === "light") {
    root.dataset.theme = "light";
  } else {
    delete root.dataset.theme;
  }
  if (palette && palette !== "focus") {
    root.dataset.palette = palette;
  } else {
    delete root.dataset.palette;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const colors = META_THEME_COLOR[palette] || META_THEME_COLOR.focus;
  if (meta) meta.setAttribute("content", colors[mode] || colors.dark);
}

function persist(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* private mode — appearance still applies for this page load */
  }
}

export function setTheme(mode) {
  persist(THEME_KEY, mode);
  applyAppearance(mode, getPalette());
}

export function setPalette(palette) {
  persist(PALETTE_KEY, palette);
  applyAppearance(getTheme(), palette);
}

// Appearance state for UI (settings page): [{ mode, palette }, setters].
export function useAppearance() {
  const [state, setState] = useState({ mode: "dark", palette: "focus" });
  useEffect(() => {
    setState({ mode: getTheme(), palette: getPalette() });
  }, []);
  const setMode = useCallback((mode) => {
    setTheme(mode);
    setState((s) => ({ ...s, mode }));
  }, []);
  const setPal = useCallback((palette) => {
    setPalette(palette);
    setState((s) => ({ ...s, palette }));
  }, []);
  return [state, { setMode, setPalette: setPal }];
}

// Back-compat: mode-only hook.
export function useTheme() {
  const [{ mode }, { setMode }] = useAppearance();
  return [mode, setMode];
}

// Resolve a CSS custom property to its current value — for consumers that
// can't use var() directly (Plotly layouts, canvas). Charts re-read on mount,
// which is enough: the appearance is switched on /settings, away from any chart.
export function cssVar(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Mounted once in ClientLayout: keeps the meta theme-color in sync after
// hydration and follows appearance changes made in another tab.
export function ThemeSync() {
  useEffect(() => {
    applyAppearance(getTheme(), getPalette());
    const onStorage = (e) => {
      if (e.key === THEME_KEY || e.key === PALETTE_KEY) {
        applyAppearance(getTheme(), getPalette());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
