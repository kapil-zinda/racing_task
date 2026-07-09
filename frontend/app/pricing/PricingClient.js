"use client";

import { useRouter } from "next/navigation";
import PublicShell from "../components/PublicShell";
import PlanCards from "../components/PlanCards";
import { useAuth } from "../lib/auth";

export default function PricingClient() {
  const { auth } = useAuth();
  const router = useRouter();

  const handleChoosePlan = (plan, interval) => {
    const next = `/usage?plan=${plan}&interval=${interval}`;
    if (auth) {
      router.push(next);
    } else {
      router.push(`/auth/signup?next=${encodeURIComponent(next)}`);
    }
  };

  return (
    <PublicShell>
      <div className="lp-doc-head">
        <span className="lp-doc-eyebrow">Pricing</span>
        <h1>Plans that scale with your prep.</h1>
        <p className="lp-doc-lede">
          Start free. Move to Pro or Max when you need more mock interviews, answer
          evaluations, and storage — or just top up credits and pay per use, no plan required.
        </p>
      </div>
      <PlanCards currentPlan={null} onChoosePlan={handleChoosePlan} />
      <p className="goal-hint" style={{ marginTop: 24 }}>
        Prefer pay-as-you-go? Every plan (including Free) can also add credits and pay per
        action once its quota runs out — see the full breakdown on the{" "}
        <a href="/usage" style={{ color: "var(--cyan, #72ddf7)" }}>Usage</a> page after signing in.
      </p>
    </PublicShell>
  );
}
