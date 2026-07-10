import "./globals.css";
import { Bebas_Neue, Manrope } from "next/font/google";
import ClientLayout from "./components/ClientLayout";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas",
});

const manrope = Manrope({
  weight: ["400", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

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
  themeColor: "#0b0f1a",
  width: "device-width",
  initialScale: 1,
};

// Applies the stored theme before first paint so a light-theme user never sees
// a dark flash (and vice versa). Dark is the default and needs no attribute.
const THEME_INIT = `(function(){try{if(localStorage.getItem("race_hub_theme")==="light")document.documentElement.dataset.theme="light";}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${bebas.variable} ${manrope.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
