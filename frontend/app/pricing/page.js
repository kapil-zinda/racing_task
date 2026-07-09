import PricingClient from "./PricingClient";

export const metadata = {
  title: "Pricing",
  description:
    "Dias pricing — Free, Pro and Max plans for UPSC prep, plus pay-per-use credits for " +
    "mock interviews, answer evaluation, and QnA.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return <PricingClient />;
}
