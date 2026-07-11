"use client";
// Appearance = palette × mode × font, persisted per device in localStorage.
//   mode:    "dark" (default) | "light"      -> <html data-theme="light">
//   palette: "focus" (default) | "prime" | "midnight" | "academic"
//                                            -> <html data-palette="...">
//   font:    "manrope" (default) | FONTS ids -> <html data-font="...">
// The attributes drive the CSS token overrides in globals.css; absent
// attributes mean the defaults. A pre-paint inline script in app/layout.js
// applies the stored appearance before first paint, so this module only
// handles runtime switching and cross-tab sync.

import { useState, useEffect, useCallback } from "react";

export const THEME_KEY = "race_hub_theme";
export const PALETTE_KEY = "race_hub_palette";
export const FONT_KEY = "race_hub_font";

export const PALETTES = ["focus", "prime", "midnight", "academic"];

// User-selectable app fonts. `varName` must match a --font-* variable injected
// by next/font in app/layout.js and a data-font block in globals.css.
export const FONTS = [
  { id: "manrope", label: "Manrope", hint: "Default — warm grotesque", varName: "--font-manrope" },
  { id: "inter", label: "Inter", hint: "The UI standard", varName: "--font-inter" },
  { id: "lexend", label: "Lexend", hint: "Built for reading fluency", varName: "--font-lexend" },
  { id: "atkinson", label: "Atkinson Hyperlegible", hint: "Maximum legibility", varName: "--font-atkinson" },
  { id: "source-sans", label: "Source Sans 3", hint: "Easy long-form reading", varName: "--font-source-sans" },
  { id: "jakarta", label: "Plus Jakarta Sans", hint: "Modern and clean", varName: "--font-jakarta" },
  { id: "dm-sans", label: "DM Sans", hint: "Geometric, low-key", varName: "--font-dm-sans" },
  { id: "figtree", label: "Figtree", hint: "Friendly and simple", varName: "--font-figtree" },
  { id: "nunito", label: "Nunito Sans", hint: "Soft and rounded", varName: "--font-nunito" },
  { id: "work-sans", label: "Work Sans", hint: "Quiet workhorse", varName: "--font-work-sans" },
  { id: "plex", label: "IBM Plex Sans", hint: "Crisp and technical", varName: "--font-plex" },
  { id: "lora", label: "Lora", hint: "Serif — book feel", varName: "--font-lora" },
];

// Browser-chrome color per palette+mode (mirrors each palette's --bg).
const META_THEME_COLOR = {
  focus: { dark: "#09090b", light: "#f9f7f3" },
  prime: { dark: "#000000", light: "#f5f5f7" },
  midnight: { dark: "#07111f", light: "#f6f8fc" },
  academic: { dark: "#111827", light: "#fafaf8" },
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

export function getFont() {
  try {
    const f = localStorage.getItem(FONT_KEY);
    return FONTS.some((o) => o.id === f) ? f : "manrope";
  } catch (_) {
    return "manrope";
  }
}

export function applyAppearance(mode, palette, font) {
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
  if (font && font !== "manrope") {
    root.dataset.font = font;
  } else {
    delete root.dataset.font;
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
  applyAppearance(mode, getPalette(), getFont());
}

export function setPalette(palette) {
  persist(PALETTE_KEY, palette);
  applyAppearance(getTheme(), palette, getFont());
}

export function setFont(font) {
  persist(FONT_KEY, font);
  applyAppearance(getTheme(), getPalette(), font);
}

// Appearance state for UI (settings page): [{ mode, palette, font }, setters].
export function useAppearance() {
  const [state, setState] = useState({ mode: "dark", palette: "focus", font: "manrope" });
  useEffect(() => {
    setState({ mode: getTheme(), palette: getPalette(), font: getFont() });
  }, []);
  const setMode = useCallback((mode) => {
    setTheme(mode);
    setState((s) => ({ ...s, mode }));
  }, []);
  const setPal = useCallback((palette) => {
    setPalette(palette);
    setState((s) => ({ ...s, palette }));
  }, []);
  const setFnt = useCallback((font) => {
    setFont(font);
    setState((s) => ({ ...s, font }));
  }, []);
  return [state, { setMode, setPalette: setPal, setFont: setFnt }];
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
    applyAppearance(getTheme(), getPalette(), getFont());
    const onStorage = (e) => {
      if (e.key === THEME_KEY || e.key === PALETTE_KEY || e.key === FONT_KEY) {
        applyAppearance(getTheme(), getPalette(), getFont());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
