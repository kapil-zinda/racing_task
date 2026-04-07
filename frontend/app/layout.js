import "./globals.css";
import { Bebas_Neue, Manrope } from "next/font/google";

const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata = {
  title: "Kapil vs Divya Race",
  description: "Milestone reward race app"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${bebas.variable} ${manrope.variable}`}>{children}</body>
    </html>
  );
}
