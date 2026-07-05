# Racing Task — UPSC Prep Platform

A study & productivity platform for UPSC aspirants. It began as a two-person points
race and grew into a full preparation suite: record and review study sessions, sit a
voice mock-interview panel, get your Mains answers auto-evaluated, organise your
material in a searchable drive, plan goals and missions, and study alongside a voice AI
assistant.

> **Setting up the project or contributing code?** All install, configuration, API, and
> deployment details live in **[CONTRIBUTING.md](CONTRIBUTING.md)**. This page is about
> *what the app does* and *how to use it*.

## What's inside

| Feature | What it does |
|---------|--------------|
| **🏁 Race (Home)** | A points race between two aspirants. Log activities — new class (+3), revision (+2), ticket (+4) — and track daily scores, history, and milestones. |
| **🎙 Study Recorder** | Record audio, video, screen, or a "call" (camera + screen) study session. Uploads stream to storage live, survive brief network drops, and auto-finalize if you close the tab. Add notes to each session. |
| **⚖️ Interview** | A virtual 5-member UPSC board with distinct voices. Turn-based spoken Q&A (you speak, it transcribes; it replies aloud), a 20–30 min timer, and a final report scored on the 7 official interview qualities. |
| **📝 Answer Eval** | Upload a Mains answer PDF (typed or handwritten). It reads the answer, evaluates it UPSC-style, and writes red-ink marks + margin comments back onto your PDF. |
| **🎯 Goals** | A flexible goal tree — goals, sub-tasks (nodes), metrics, templates, dependencies, reminders, and per-goal analytics/forecasts. |
| **🚩 Mission / Journey** | Set an overarching mission with a target date and track progress across your goals. |
| **📂 Content** | A personal file drive: folders, upload, move/copy/rename, download, and preview. Mark any PDF "searchable" to feed it into Search & QnA. |
| **🔎 Search** | Semantic search across your indexed PDFs. Scope results to a specific goal, or search everything ("global"). |
| **💬 QnA** | Ask questions and get answers grounded in your own indexed content, with inline citations back to the source page. |
| **🧠 Mind Map** | Build and save mind maps to organise topics visually. |
| **📅 Tracker** | A day activity tracker with custom categories to log how your time is spent. |
| **📊 Analytics & Usage** | Dashboards for study/goal progress, plus a usage view with your AI-token consumption and a credits balance you can top up. |
| **🤖 Voice Assistant** | A hands-free study companion that talks with you and can drive the app — switch pages, control the recorder, and log entries for you. |

## How to use

Open the app, create an account, and pick a feature from the top menu.

### Getting started
1. **Sign up** at `/auth/signup` with your name, email, and phone. You'll get a
   one-time code by email — enter it to verify and you're in.
2. Use the **top menu** to move between features. Your data is saved to your account.

### Race (Home)
The landing page. Tap **+ New Class**, **+ Revision**, or **+ Ticket** to add points for
the day. Scores, day-by-day history, and milestones update live.

### Study Recorder
1. Go to **Recorder**, choose a mode (audio / video / screen / call) and start.
2. Recording uploads as you go, so a dropped connection or closed tab won't lose your
   session — it finalizes on its own.
3. Stop when done; play it back and add notes from the session list.

### Interview
1. Open **Interview** and start a session — a 5-member panel greets you.
2. Answer each question **by voice**; the panel listens, then asks the next one.
3. A timer runs (~20–30 min). End early or let it finish to get a **scored report** on
   the seven official qualities.

### Answer Eval
1. Go to **Answer Eval**, enter the **question**, **subject**, and **max marks**, then
   upload your answer **PDF**.
2. Evaluation runs in the background — no need to wait on the page.
3. Reopen it from **My Answers** to see your score and download the **marked PDF** with
   red-ink corrections and margin comments.

### Goals, Mission & Tracker
- **Goals:** create a goal, break it into sub-tasks and metrics, and track progress.
  Use templates to reuse structures, set reminders, and view analytics/forecasts.
- **Mission:** define your top mission and target date; progress rolls up from goals.
- **Tracker:** log daily activities under your own categories to see where time goes.

### Content → Search → QnA
1. In **Content**, upload PDFs into folders. Open a file's menu and choose **Make
   searchable** — pick a **goal** it belongs to, or **Global (all goals)**.
2. Once indexed, use **Search** to find passages by meaning. Filter by a goal (which
   also surfaces global material) or search across everything.
3. Use **QnA** to ask questions in plain language — answers are grounded only in your
   indexed content and cite the exact source page.

### Mind Map
Open **Mind Map** to create, edit, and save maps for organising a topic visually.

### Analytics, Usage & Credits
- **Analytics** shows study and goal dashboards.
- **Usage** shows your AI-token consumption and a **credits balance**. Tap **Add credits**
  to top up via the in-app payment checkout.

### Voice Assistant
The floating assistant lets you study hands-free — talk to it and it can navigate the
app, control the recorder, and log entries on your behalf.

## Tech at a glance

Next.js (App Router) frontend · FastAPI backend on AWS Lambda · MongoDB · S3 / Backblaze
B2 storage · AWS Textract OCR · OpenAI (chat, realtime voice, TTS, transcription,
embeddings). Full architecture, setup, and deployment: **[CONTRIBUTING.md](CONTRIBUTING.md)**.
