// Public landing page (server component) — owns SEO metadata + structured data and
// renders the interactive <Landing> client component.

import Landing from "./components/Landing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.uchhal.in";

export const metadata = {
  // Absolute so the homepage title leads with the brand (helps Google show "Dias"
  // as the site name instead of the bare domain).
  title: { absolute: "Dias — All-in-one UPSC preparation workspace" },
  description:
    "Prepare for UPSC in one place: record study sessions, take AI mock interviews, " +
    "get Mains answers evaluated, search your notes, plan goals, and study with an AI buddy.",
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      // WebSite.name is Google's primary signal for the site name shown in results.
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Dias",
      alternateName: "Dias — UPSC preparation workspace",
      url: SITE_URL,
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
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
        "An all-in-one UPSC preparation workspace: day tracking, goal monitoring and " +
        "analytics, task monitoring, AI Mains answer evaluation, voice mock interviews, " +
        "content storage and semantic search, and content-grounded QnA.",
      featureList: [
        "Day tracking",
        "Goal monitoring and analytics",
        "Task monitoring",
        "UPSC Mains answer evaluation",
        "AI mock interviews",
        "Store and search study content",
        "Content-grounded QnA",
        "Mind maps",
        "Study session recorder",
      ],
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
