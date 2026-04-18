import "./globals.css";
import GlobalUserSelector from "./components/GlobalUserSelector";
import AgentV2Widget from "./components/agent/AgentV2Widget";

export const metadata = {
  title: "Kapil vs Divya Race",
  description: "Milestone reward race app"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <GlobalUserSelector />
        <AgentV2Widget />
        {children}
      </body>
    </html>
  );
}
