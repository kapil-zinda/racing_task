"use client";
// Shared Free/Pro/Max plan grid with a monthly/annual toggle. Used on the public
// /pricing page and the "change plan" section of /usage. Fetches the catalog itself
// (GET /plans is public) so both call sites stay numerically in sync with the backend.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listPlans } from "../lib/plansApi";
import Icon from "./Icon";

const FREE_FEATURES = (storageGb) => [
  `${storageGb} GB storage`,
  "Time tracking",
  "Goal management",
  "Analytics",
  "Recorder",
  "Mind maps",
];

function paidFeatures(plan, quota) {
  const qna = quota.qna === null || quota.qna === undefined ? "Unlimited QnA" : `${quota.qna} QnA questions`;
  return [
    `${plan.storage_gb} GB storage`,
    `${quota.interview} mock interviews`,
    `${quota.answer_eval} answer evaluations`,
    qna,
    "Everything in Free",
  ];
}

export default function PlanCards({ currentPlan = null, onChoosePlan, onChooseFree }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(null);
  const [interval, setIntervalKey] = useState("monthly");
  const [error, setError] = useState("");

  useEffect(() => {
    listPlans()
      .then((data) => setCatalog(data.plans))
      .catch(() => setError("Couldn't load plans right now — please try again."));
  }, []);

  const handleFree = () => {
    if (onChooseFree) onChooseFree();
    else router.push("/auth/signup");
  };

  const handlePaid = (planKey) => {
    if (onChoosePlan) onChoosePlan(planKey, interval);
  };

  if (error) return <p className="goal-error">{error}</p>;
  if (!catalog) return <p className="goal-hint">Loading plans…</p>;

  const free = catalog.free;
  const pro = catalog.pro;
  const max = catalog.max;

  return (
    <div>
      <div className="plan-toggle" role="tablist" aria-label="Billing interval">
        <button
          type="button"
          role="tab"
          aria-selected={interval === "monthly"}
          className={interval === "monthly" ? "active" : ""}
          onClick={() => setIntervalKey("monthly")}
        >
          Monthly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={interval === "annual"}
          className={interval === "annual" ? "active" : ""}
          onClick={() => setIntervalKey("annual")}
        >
          Annual <span className="plan-toggle-save">save more</span>
        </button>
      </div>

      <div className="plan-grid">
        <div className="plan-card">
          <h3 className="plan-card-name">Free</h3>
          <div className="plan-card-price-row">
            <span className="plan-card-price">₹0</span>
          </div>
          <span className="plan-card-period">Forever</span>
          <ul className="plan-card-features">
            {FREE_FEATURES(free.storage_gb).map((f) => (
              <li key={f}><Icon name="check" size={16} /> {f}</li>
            ))}
          </ul>
          <button className="goal-btn ghost plan-card-cta" onClick={handleFree} disabled={currentPlan === "free"}>
            {currentPlan === "free" ? "Current plan" : "Get started"}
          </button>
        </div>

        {[{ key: "pro", plan: pro }, { key: "max", plan: max }].map(({ key, plan }) => {
          const pricing = plan[interval];
          return (
            <div key={key} className={`plan-card ${key === "pro" ? "featured" : ""}`}>
              <h3 className="plan-card-name">{plan.name}</h3>
              <div className="plan-card-price-row">
                <span className="plan-card-price">₹{pricing.price_inr}</span>
                <span className="plan-card-strike">₹{pricing.strike_inr}</span>
                <span className="plan-card-save">Save {pricing.save_pct}%</span>
              </div>
              <span className="plan-card-period">per {interval === "monthly" ? "month" : "year"}</span>
              <ul className="plan-card-features">
                {paidFeatures(plan, plan.quota).map((f) => (
                  <li key={f}><Icon name="check" size={16} /> {f}</li>
                ))}
              </ul>
              <button
                className={`goal-btn ${key === "pro" ? "primary" : "ghost"} plan-card-cta`}
                onClick={() => handlePaid(key)}
                disabled={currentPlan === key}
              >
                {currentPlan === key ? "Current plan" : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
