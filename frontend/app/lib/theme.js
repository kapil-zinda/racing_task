"use client";
// Theme selection: "dark" (default) or "light", persisted per device in
// localStorage. The <html data-theme="light"> attribute drives the CSS token
// overrides in globals.css; no attribute means dark. A pre-paint inline script
// in app/layout.js applies the stored theme before first paint, so this module
// only needs to handle runtime switching and cross-tab sync.

import { useState, useEffect, useCallback } from "react";

export const THEME_KEY = "race_hub_theme";
const META_THEME_COLOR = { dark: "#0b0f1a", light: "#eef1f7" };

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.dataset.theme = "light";
  } else {
    delete root.dataset.theme;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META_THEME_COLOR[theme] || META_THEME_COLOR.dark);
}

export function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {
    /* private mode — theme still applies for this page load */
  }
  applyTheme(theme);
}

// Resolve a CSS custom property to its current value — for consumers that
// can't use var() directly (Plotly layouts, canvas). Charts re-read on mount,
// which is enough: the theme is switched on /settings, away from any chart.
export function cssVar(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function useTheme() {
  const [theme, setThemeState] = useState("dark");
  useEffect(() => {
    setThemeState(getTheme());
  }, []);
  const set = useCallback((t) => {
    setTheme(t);
    setThemeState(t);
  }, []);
  return [theme, set];
}

// Mounted once in ClientLayout: keeps the meta theme-color in sync after
// hydration and follows theme changes made in another tab.
export function ThemeSync() {
  useEffect(() => {
    applyTheme(getTheme());
    const onStorage = (e) => {
      if (e.key === THEME_KEY) applyTheme(getTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
