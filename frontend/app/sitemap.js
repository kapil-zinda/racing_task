const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.app";

// The public landing page is the only crawlable route; everything else is auth-gated.
export default function sitemap() {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
  ];
}
