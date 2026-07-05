import "./globals.css";
import ClientLayout from "./components/ClientLayout";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://dias.app";

const DESCRIPTION =
  "Dias is an all-in-one UPSC preparation workspace: record and review study sessions, " +
  "take AI voice mock interviews, get Mains answers evaluated, search your own notes, " +
  "plan goals, and study alongside an AI assistant.";

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
    "UPSC mock interview",
    "Mains answer evaluation",
    "UPSC notes search",
    "UPSC study tracker",
    "UPSC goals planner",
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
    images: [{ url: "/dias-icon.png", width: 512, height: 512, alt: "Dias" }],
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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
