const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.uchhal.in";

// Public marketing pages are crawlable; the app itself is auth-gated.
export default function sitemap() {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/how-to-use`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
