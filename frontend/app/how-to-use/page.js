import PublicShell from "../components/PublicShell";
import Icon from "../components/Icon";

export const metadata = {
  title: "How to use Dias efficiently",
  description:
    "A complete guide to using Dias: uploading and searching content, content-grounded " +
    "QnA, goal monitoring with metrics, mind maps, UPSC Mains answer evaluation, mock " +
    "interviews, the study recorder, day tracking, analytics, and credits.",
  alternates: { canonical: "/how-to-use" },
};

const USECASES = [
  {
    icon: "folder",
    title: "Content, Search & QnA — the pipeline",
    lede: "Search and QnA only work on material you've indexed. The flow is always: upload → make searchable → then it shows up in Search and QnA.",
    steps: [
      "Open Content and upload your PDFs into folders (organise them however you like).",
      "On a file (or folder), choose Make searchable and pick where it belongs — a specific goal, or Global (all goals).",
      "Indexing runs in the background. Once done, that material becomes available to both Search and QnA.",
      "In Search, filter by a goal to scope results (a goal filter also surfaces Global material), or search across everything.",
      "In QnA, ask a question in plain language — answers are built only from your indexed content and cite the source page.",
    ],
    note: "Tip: index a document under the goal it supports, so a goal-scoped search or QnA stays focused on the right material.",
  },
  {
    icon: "search",
    title: "Search",
    lede: "Semantic search across your indexed PDFs — it matches meaning, not just exact words.",
    steps: [
      "Type what you're looking for; Dias finds the most relevant passages across your content.",
      "Use the goal filter to narrow to one goal's material, or leave it on all goals.",
      "Open a result to jump straight to the page it came from.",
    ],
  },
  {
    icon: "chat",
    title: "QnA",
    lede: "Ask questions and get answers grounded strictly in your own material, with citations back to the exact page.",
    steps: [
      "Start a chat and ask a question about your indexed content.",
      "The assistant retrieves the relevant passages, then answers using only those — with inline citations you can open.",
      "Scope a chat to a goal to keep answers within that goal's material.",
    ],
  },
  {
    icon: "goals",
    title: "Goals — monitoring, metrics & status",
    lede: "Turn a big objective into a living tree of tasks and measurable metrics, and watch progress and analytics build.",
    steps: [
      "Create a goal, then break it into sub-tasks (nodes) — add or remove nodes any time as your plan changes.",
      "Attach metrics to track quantities (e.g. tests done, pages revised); increment them as you go and their status updates automatically.",
      "Mark nodes' status as you progress; the goal rolls this up into overall progress.",
      "Use templates to reuse a structure, add dependencies between items, and set reminders/recurring tasks.",
      "Open a goal's analytics for progress over time and a simple forecast toward the target.",
    ],
    note: "Everything is editable: add or delete goals, nodes, and metrics whenever your strategy shifts.",
  },
  {
    icon: "brain",
    title: "Mind Map",
    lede: "Lay a topic out visually and save it to revise from later.",
    steps: [
      "Open Mind Map and create a new map; add nodes and branches to organise a topic or a whole subject.",
      "Edit freely — rearrange, rename, and connect ideas as your understanding grows.",
      "Every saved map gets its own unique code (its map id) so you can reopen exactly that map and pick up where you left off.",
    ],
  },
  {
    icon: "file",
    title: "Answer Evaluation (UPSC Mains)",
    lede: "Upload a written answer and get it evaluated like an examiner would — marks plus specific feedback.",
    steps: [
      "Open Answer Eval, enter the question, subject, and maximum marks, and upload your answer as a PDF (typed or handwritten).",
      "Evaluation runs in the background — you don't have to wait on the page.",
      "Reopen it from My Answers to see the result and download the marked PDF.",
    ],
    note: "The evaluation gives an overall examiner remark, a score against the max marks (with a per-question breakdown), and red-ink marks with margin comments written back onto your PDF pointing out what worked and what to improve.",
  },
  {
    icon: "interview",
    title: "Mock Interview",
    lede: "Practise a UPSC-style personality test by voice with a virtual board.",
    steps: [
      "Start an interview — a five-member panel opens with distinct voices.",
      "Answer each question by speaking; the panel listens, then asks the next one.",
      "A timer runs (~20–30 minutes). End early or let it finish to get a report scored on the seven official interview qualities.",
    ],
  },
  {
    icon: "mic",
    title: "Study Recorder",
    lede: "Record a study session and never lose it to a dropped connection or a closed tab.",
    steps: [
      "Pick a mode — audio, video, screen, or a call (camera + screen) — and start recording.",
      "It uploads as you go and finalises on its own even if the tab closes.",
      "Play sessions back later and attach notes.",
    ],
  },
  {
    icon: "calendar",
    title: "Day Tracker",
    lede: "See where your day actually goes.",
    steps: [
      "Create categories that match how you spend time.",
      "Log activities against them through the day.",
      "Review the summary to spot where time leaks and adjust.",
    ],
  },
  {
    icon: "chart",
    title: "Analytics & Usage",
    lede: "Honest numbers on your study and your account.",
    steps: [
      "Analytics shows study and goal dashboards — momentum, streaks, and progress.",
      "Usage shows your credit balance, what each action costs, and how much you've used.",
    ],
  },
  // {
  //   icon: "wallet",
  //   title: "Credits & free usage",
  //   lede: "Some actions are free to start; after that they draw from your credit balance (shown in US dollars).",
  //   steps: [
  //     "You get a free allowance to begin: 5 answer evaluations, 2 mock interviews, and 100 searches.",
  //     "Once the free allowance is used, those actions and QnA draw from your credits.",
  //     "Add credits any time on the Usage page; if you run out, Dias prompts you before the action so nothing fails midway.",
  //   ],
  // },
];

export default function HowToUsePage() {
  return (
    <PublicShell>
      <div className="lp-doc-head">
        <span className="lp-doc-eyebrow">Guide</span>
        <h1>How to use Dias efficiently</h1>
        <p className="lp-doc-lede">
          A quick tour of everything Dias does and the fastest way to use each part. The
          one flow worth remembering first: to search or ask questions about your material,
          you upload it in Content and make it searchable — then it appears in Search and QnA.
        </p>
      </div>

      {USECASES.map((u) => (
        <section key={u.title} className="lp-usecase">
          <div className="lp-usecase-head">
            <span className="lp-usecase-icon"><Icon name={u.icon} size={20} /></span>
            <h2>{u.title}</h2>
          </div>
          <p>{u.lede}</p>
          <ol className="lp-steps-list">
            {u.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {u.note ? <p style={{ color: "var(--muted)" }}>{u.note}</p> : null}
        </section>
      ))}
    </PublicShell>
  );
}
