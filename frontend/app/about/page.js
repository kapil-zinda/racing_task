import PublicShell from "../components/PublicShell";

export const metadata = {
  title: "About",
  description:
    "About Dias — an all-in-one UPSC preparation workspace that brings day tracking, " +
    "goal monitoring, analytics, answer evaluation, mock interviews, content search and " +
    "QnA into one focused tool.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PublicShell>
      <div className="lp-doc-head">
        <span className="lp-doc-eyebrow">About</span>
        <h1>One workspace for the whole UPSC journey.</h1>
        <p className="lp-doc-lede">
          Dias exists to replace the scattered pile of apps, folders, and notebooks a UPSC
          aspirant juggles across a multi-year attempt. It brings preparation, practice,
          and progress into a single, calm, focused environment.
        </p>
      </div>

      <h2>Why Dias</h2>
      <p>
        Serious preparation is hard enough without fighting your tools. Most aspirants lose
        hours moving between a recorder, a notes drive, a PDF reader, a planner, and a
        spreadsheet — and still never get an honest picture of their progress. Dias pulls
        all of that into one place so your attention stays on studying, not on managing
        tools.
      </p>

      <h2>What it does</h2>
      <ul>
        <li><strong>Track your day</strong> — log where your time actually goes and see it clearly.</li>
        <li><strong>Monitor goals</strong> — break big goals into tasks and metrics, and watch progress and analytics build over time.</li>
        <li><strong>Evaluate Mains answers</strong> — upload an answer and get it marked with comments.</li>
        <li><strong>Practise interviews</strong> — sit a voice mock interview with a virtual board and get a scored report.</li>
        <li><strong>Store and search content</strong> — keep your PDFs in one drive and search them by meaning.</li>
        <li><strong>Ask your material</strong> — get answers grounded in your own notes, with citations.</li>
        <li><strong>Map and plan</strong> — build mind maps and keep a mission in view.</li>
      </ul>

      <h2>How we think about it</h2>
      <p>
        Dias is built to be lived in for hours a day: a calm dark workspace, honest numbers,
        and one primary task per screen. It is a serious tool for serious candidates — no
        gimmicks, no noise, just a dependable place to do the work.
      </p>

      <h2>Questions?</h2>
      <p>
        We&apos;d love to hear how you prepare and what would help. Reach us any time from the{" "}
        <a href="/contact" style={{ color: "var(--cyan, #72ddf7)" }}>Contact</a> page.
      </p>
    </PublicShell>
  );
}
