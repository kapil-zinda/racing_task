const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.uchhal.in";

// Public marketing pages are indexable; the app itself is behind auth.
export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/how-to-use", "/contact"],
        disallow: [
          "/home", "/recorder", "/interview", "/answer-eval", "/goals",
          "/analytics", "/qna", "/mindmap", "/search", "/content", "/usage",
          "/auth",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
