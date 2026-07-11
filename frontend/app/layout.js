import "./globals.css";
import {
  Bebas_Neue,
  Manrope,
  Inter,
  Lexend,
  Atkinson_Hyperlegible,
  Source_Sans_3,
  Plus_Jakarta_Sans,
  DM_Sans,
  Figtree,
  Nunito_Sans,
  Work_Sans,
  IBM_Plex_Sans,
  Lora,
} from "next/font/google";
import ClientLayout from "./components/ClientLayout";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas",
});

// The default app font. The rest are user-selectable in Settings (data-font
// on <html> → --app-font in globals.css). All are self-hosted by next/font;
// only the selected family's files are actually downloaded, but the
// non-default ones must not be preloaded (12 preload hints would defeat it).
const manrope = Manrope({
  weight: ["400", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

/* next/font calls are compiled at build time, so every options object must be
   an inline literal (no shared spread). */
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const lexend = Lexend({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-lexend" });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-atkinson" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-sans" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-jakarta" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "700"], variable: "--font-dm-sans" });
const figtree = Figtree({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-figtree" });
const nunito = Nunito_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-nunito" });
const workSans = Work_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-work-sans" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-plex" });
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-lora" });

const FONT_VARS = [
  bebas, manrope, inter, lexend, atkinson, sourceSans, jakarta,
  dmSans, figtree, nunito, workSans, plex, lora,
].map((f) => f.variable).join(" ");

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.uchhal.in";

const DESCRIPTION =
  "Dias is an all-in-one UPSC preparation workspace: day tracking, goal monitoring and " +
  "analytics, task monitoring, AI UPSC Mains answer evaluation, voice mock interviews, " +
  "storing and searching your study content, and content-grounded QnA — with an AI study assistant.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Dias — All-in-one UPSC preparation workspace",
    template: "%s · Dias",
  },
  description: DESCRIPTION,
  applicationName: "Dias",
  keywords: [
    "UPSC preparation",
    "UPSC preparation app",
    "day tracking",
    "study day tracker",
    "goal monitoring",
    "goal tracking and analytics",
    "task monitoring",
    "study analytics",
    "UPSC Mains answer evaluation",
    "AI answer evaluation",
    "UPSC mock interview",
    "AI mock interview",
    "store and search study content",
    "PDF notes search",
    "content QnA",
    "ask questions from your notes",
    "mind maps",
    "IAS preparation app",
    "civil services preparation",
  ],
  authors: [{ name: "Dias" }],
  creator: "Dias",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Dias",
    url: SITE_URL,
    title: "Dias — All-in-one UPSC preparation workspace",
    description: DESCRIPTION,
    images: [{ url: "/dias-icon.png", width: 180, height: 180, alt: "Dias" }],
  },
  twitter: {
    card: "summary",
    title: "Dias — All-in-one UPSC preparation workspace",
    description: DESCRIPTION,
    images: ["/dias-icon.png"],
  },
  icons: { icon: "/dias-icon.png", apple: "/dias-icon.png" },
};

export const viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

// Applies the stored appearance (mode + palette + font) before first paint so
// a light-theme user never sees a dark flash (and vice versa). Dark Focus with
// Manrope is the default and needs no attributes.
const THEME_INIT = `(function(){try{var d=document.documentElement;if(localStorage.getItem("race_hub_theme")==="light")d.dataset.theme="light";var p=localStorage.getItem("race_hub_palette");if(p==="prime"||p==="midnight"||p==="academic")d.dataset.palette=p;var f=localStorage.getItem("race_hub_font");if(/^(inter|lexend|atkinson|source-sans|jakarta|dm-sans|figtree|nunito|work-sans|plex|lora)$/.test(f))d.dataset.font=f;}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={FONT_VARS} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
