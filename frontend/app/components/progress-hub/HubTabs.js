"use client";

export default function HubTabs({ tabs, active, onChange }) {
  return (
    <div className="session-tabs hub-tabs" role="tablist" aria-label="Progress Hub sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`session-tab hub-tab ${active === tab.key ? "active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.icon ? <span className="hub-tab-icon" aria-hidden="true">{tab.icon}</span> : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
