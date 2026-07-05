// Public landing page (server component) — owns SEO metadata + structured data and
// renders the interactive <Landing> client component.

import Landing from "./components/Landing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.app";

export const metadata = {
  title: "All-in-one UPSC preparation workspace",
  description:
    "Prepare for UPSC in one place: record study sessions, take AI mock interviews, " +
    "get Mains answers evaluated, search your notes, plan goals, and study with an AI buddy.",
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Dias",
      url: SITE_URL,
      logo: `${SITE_URL}/dias-icon.png`,
    },
    {
      "@type": "WebApplication",
      name: "Dias",
      url: SITE_URL,
      applicationCategory: "EducationApplication",
      operatingSystem: "Web",
      description:
        "An all-in-one UPSC preparation workspace: study recorder, AI mock interviews, " +
        "Mains answer evaluation, semantic notes search, grounded QnA, goal planning, " +
        "and a voice study assistant.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Landing />
    </>
  );
}
