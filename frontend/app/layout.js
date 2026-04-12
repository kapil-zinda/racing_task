import "./globals.css";
import GlobalUserSelector from "./components/GlobalUserSelector";

export const metadata = {
  title: "Kapil vs Divya Race",
  description: "Milestone reward race app"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <GlobalUserSelector />
        {children}
      </body>
    </html>
  );
}
