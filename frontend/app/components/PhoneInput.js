"use client";
import "./phone-input.css";

// Phone field with a country-code selector: a flag + dial-code button that opens
// a searchable country dropdown, followed by the local-number input.

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { COUNTRIES, flagOf } from "../lib/countries";

export default function PhoneInput({ country, number, onCountryChange, onNumberChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const bare = q.replace(/^\+/, "");
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase() === q ||
        c.dial.startsWith(bare)
    );
  }, [query]);

  const select = (c) => {
    onCountryChange(c);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="phone-input" ref={wrapRef}>
      <div className="phone-row">
        <button
          type="button"
          className="phone-cc"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country code: ${country.name} +${country.dial}`}
        >
          <span className="phone-flag" aria-hidden="true">{flagOf(country.iso)}</span>
          <span className="phone-dial">+{country.dial}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        <input
          className="auth-input phone-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          required
        />
      </div>

      {open && (
        <div className="phone-dropdown" role="listbox">
          <div className="phone-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              placeholder="Search country or code"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul className="phone-list">
            {filtered.map((c) => (
              <li key={c.iso + c.dial}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.iso === country.iso}
                  className={`phone-opt${c.iso === country.iso ? " is-active" : ""}`}
                  onClick={() => select(c)}
                >
                  <span className="phone-flag" aria-hidden="true">{flagOf(c.iso)}</span>
                  <span className="phone-name">{c.name}</span>
                  <span className="phone-optdial">+{c.dial}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="phone-empty">No match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
