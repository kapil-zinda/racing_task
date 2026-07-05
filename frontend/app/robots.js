const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.app";

// Only the public landing page is indexable; the app itself is behind auth.
export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/home", "/recorder", "/interview", "/answer-eval", "/goals",
          "/analytics", "/qna", "/mindmap", "/search", "/content", "/usage",
          "/mission", "/syllabus", "/auth",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
