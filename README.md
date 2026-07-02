# Racing Task — UPSC Prep Platform

A study/productivity platform that began as a two-person points race and grew into a
full UPSC-preparation suite: study-session recording, a voice mock-interview panel,
AI Mains answer evaluation, a content drive with PDF search, a Q&A assistant, mission/
journey planning, an activity tracker, and a voice study agent.

- **Frontend:** Next.js (App Router), also packaged as a mobile app via Capacitor.
- **Backend:** FastAPI served on AWS Lambda via Mangum (also runs locally with Uvicorn).
- **Data/infra:** MongoDB (Atlas), AWS S3 (media/PDF storage), AWS Textract (OCR),
  OpenAI (chat, realtime voice, TTS, Whisper transcription, embeddings).

## Features

| Area | What it does |
|------|--------------|
| **Race** | Points race (`+ New Class` 3, `+ Revision` 2, `+ Ticket` 4), per-day data, history, milestones. |
| **Study Recorder** | Record audio / video / screen / "call" (camera + screen) sessions. Chunks upload live to S3; the backend concatenates them into one file. Offline buffering, heartbeat + auto-finalize of abandoned sessions, marked-PDF-style notes. |
| **Interview** | Virtual 5-member UPSC board (distinct TTS voices). Turn-based voice Q&A (Whisper in, TTS out), 20–30 min timer, final report scored on the 7 official qualities. |
| **Answer Eval** | Upload a Mains answer PDF → backend reads it (pypdf, or Textract OCR for handwriting), evaluates UPSC-style with an LLM, and writes red-ink marks + margin comments back onto the PDF. |
| **Content** | Personal file drive on S3 (folders, upload, move/copy/rename, download, preview). |
| **PDF Search** | OCR + embeddings index over PDFs; semantic search. |
| **QnA** | Retrieval-grounded question answering over indexed content. |
| **Mission / Journey** | Goal/plan tracking with progress nodes. |
| **Tracker** | Day activity tracker with categories. |
| **Agent v2** | Voice/text study assistant (OpenAI Realtime over WebRTC) that can drive the app (switch pages, control the recorder, log entries). |
| **Auth** | Email/OTP signup + API-key auth (optional, gated by `AUTH_REQUIRED`). |

## Project Structure

```
frontend/
  app/
    page.js            # race home
    recorder/          # study session recorder
    interview/         # UPSC interview panel
    answer-eval/       # Mains answer evaluation
    content/           # file drive
    search/            # PDF search
    qna/               # Q&A assistant
    mission/           # mission / journey
    syllabus/          # progress hub
    auth/              # signin / signup / OTP
    components/        # MainMenu, agent widget, trackers, …
    lib/               # auth + agent client helpers
    globals.css
  capacitor.config.json  # mobile (iOS/Android) packaging

backend/
  app.py                 # ASGI entrypoint (app) + Mangum handler
  lambda_function.py     # Lambda handler; routes async self-invoke tasks
  race_api/
    app_factory.py       # FastAPI app, middleware (auth + request logging), all routes
    context.py           # settings, Mongo/S3/Textract clients, logger
    schemas.py           # Pydantic request models
    *_domain.py          # feature logic (session, interview, answer_eval, content, …)
    auth_service.py / auth_router.py
  requirements.txt        # local dev deps
  requirements-app.txt    # Lambda layer deps
  build_app_layer.sh      # builds the dependency Lambda layer
  build_lambda_package.sh # builds the app-code Lambda zip
```

## Run the Frontend (Next.js)

```bash
cd frontend
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_BASE_URL
npm run dev
```

Open `http://localhost:3000`.

`frontend/.env.example`:
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000   # or your API Gateway URL
```

## Run the Backend (FastAPI + Uvicorn)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in MONGODB_URI, OPENAI_API_KEY, RECORDING_BUCKET, …
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

- API docs: `http://localhost:8000/docs`
- The backend auto-loads `backend/.env` via `python-dotenv` (no manual `export` needed).
- Long-running jobs (chunk concat, answer evaluation) run **inline** locally; on Lambda
  they self-invoke asynchronously.

## Configuration (`backend/.env`)

Key environment variables (see `backend/.env.example` for the full list):

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI`, `MONGODB_DB` | MongoDB connection (Atlas). |
| `RECORDING_BUCKET`, `CONTENT_BUCKET` | Buckets for recordings + content. **Backblaze B2** bucket names if B2 is configured, else AWS S3. |
| `B2_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | Backblaze B2 (S3-compatible) credentials. When set, recordings + content live on B2; leave blank to use AWS S3. |
| `PDF_SEARCH_BUCKET` | **Must be an AWS S3 bucket** (Textract OCR only reads from S3). Set explicitly when using B2 for recordings/content. |
| `AWS_REGION` | AWS region for S3/Textract (default `ap-south-1`). |
| `OPENAI_API_KEY` | OpenAI key (chat, realtime, TTS, Whisper, embeddings). |
| `OPENAI_CHAT_MODEL` | Chat/eval model — **set a real model id (e.g. `gpt-4o`)**; the default placeholder won't work. |
| `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` | Agent/interview realtime voice. |
| `OPENAI_TTS_MODEL` / `OPENAI_TRANSCRIPTION_MODEL` | Interview/answer TTS + Whisper. |
| `TEXTRACT_ENABLED` | OCR for scanned/handwritten PDFs (answer-eval, pdf-search). |
| `AUTH_REQUIRED` | `true` to enforce `X-API-Key`; `false` for open local dev. |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | OTP email delivery. |
| `LOG_LEVEL` | `INFO` (default) or `DEBUG` for per-chunk/heartbeat logs. |

## API Overview

Auth: send `X-API-Key: <key>` when `AUTH_REQUIRED=true`. `/`, `/docs`, `/auth/*` are public.

- **Race:** `GET /state`, `POST /points`, `POST /points/delete`, `POST /reset`, `GET /days`, `GET /syllabus`, `GET /mission-control`
- **Recorder:** `POST /sessions`, `GET /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/status|notes|heartbeat|delete`, multipart (`/multipart/start|presign-part|complete|abort`), per-chunk (`/chunk/presign-url`, `/chunks/concat`), `GET /sessions/{id}/playback-url`
- **Interview:** `POST /interview/start`, `POST /interview/{id}/answer`, `POST /interview/{id}/report`, `GET /interview/{id}`
- **Answer Eval:** `POST /answer-eval/presign`, `POST /answer-eval/{id}/evaluate`, `GET /answer-eval`, `GET /answer-eval/{id}`
- **Content:** `GET /content/list|tree|preview-url`, `POST /content/folder|presign-upload|complete-upload|rename|move|copy|delete|download|make-searchable`
- **PDF Search:** `POST /pdf-search/presign-upload|index`, `GET /pdf-search/query`
- **QnA:** `GET/POST /qna/sessions`, `GET /qna/sessions/{id}/messages`, `POST /qna/ask`
- **Mission / Journey:** `GET/PUT /mission`, `GET /mission/options`, `GET/POST/PUT/DELETE /journeys`, `GET/POST /journeys/{id}/progress`
- **Tracker:** `GET/POST /tracker/activities`, `PUT/DELETE /tracker/activities/{id}`, `GET/POST/DELETE /tracker/categories`
- **Agent v2:** `POST /agent-v2/create-agent|realtime/token|chat|memory|entries/prepare|entries/log`, plus `/agent-v2/context|search/*|reports/*|recommendations/*`
- **Auth:** `POST /auth/signup|verify-otp|resend-otp|signin`, `GET /user/me`

## Deploy (AWS Lambda + API Gateway + MongoDB)

The backend ships as **two artifacts**: a dependency **layer** and the **app code**.

```bash
cd backend
./build_app_layer.sh        # -> lambda-layer-app.zip  (deps; manylinux x86_64, py3.13)
./build_lambda_package.sh   # -> lambda-package.zip    (app code only)
```

- Build for ARM: `LAMBDA_ARCH=arm64 ./build_app_layer.sh`.
- Handler: `lambda_function.lambda_handler` (wrapper) or `app.handler` (Mangum directly).

Steps:
1. Publish `lambda-layer-app.zip` as a Lambda layer (it's >10 MB — upload via S3) and attach it to the function.
2. Upload `lambda-package.zip` as the function code.
3. Set the env vars from the Configuration section.
4. API Gateway: proxy all routes to the function and enable CORS.

### Answer-evaluation worker (second Lambda)

Answer marking runs on a **separate Lambda** so the API function stays light. Both
functions use the **same package + layer**, just different handlers:

| Function | Handler | Trigger |
|----------|---------|---------|
| API | `lambda_function.lambda_handler` | API Gateway |
| Eval worker | `answer_eval_worker.lambda_handler` | S3 `ObjectCreated` |

Flow: the frontend gets a presigned URL and uploads the answer PDF (DB record created
as `in_queue`, with the question + max marks). The **S3 upload fires the worker**,
which marks the record `in_process`, OCRs + evaluates, writes the marked PDF, and sets
`completed` (or `failed`). Evaluation is idempotent (atomic status claim), so a stray
manual call can't double-run it.

Deploy the worker:
1. Create a second Lambda from the **same** `lambda-package.zip` + layer; set handler
   `answer_eval_worker.lambda_handler`, timeout **900s**, and the same env vars + IAM
   (S3, Textract) as the API.
2. On the **answer-eval S3 bucket** (`PDF_SEARCH_BUCKET`), add an **Event notification**:
   event `s3:ObjectCreated:*`, prefix `answer-evaluations/`, suffix `.pdf` → the worker.
3. Set `ANSWER_EVAL_S3_TRIGGER=true` on the **API** function so the frontend skips the
   manual `/evaluate` call and lets the upload event drive it.

(Locally there's no S3 event, so `ANSWER_EVAL_S3_TRIGGER` stays `false` and the app
evaluates inline via `/answer-eval/{id}/evaluate`.)

### Required Lambda settings for async features

The recorder's **chunk concat**, **answer evaluation**, and the **stale-session reaper**
run as asynchronous self-invocations, so the function must be able to invoke itself and
run long enough:

- **Timeout:** `900` seconds (concat/OCR + LLM can exceed API Gateway's 29s sync limit).
- **IAM:** the execution role needs `lambda:InvokeFunction` on its **own ARN**, plus S3
  (read/write/list/multipart) and Textract permissions.
- **S3 CORS:** expose the `ETag` header (multipart uploads need it).
- **Optional EventBridge schedule:** invoke the function every few minutes with
  `{"task":"reap_stale"}` to auto-finalize recordings abandoned on a closed tab/crash.

## Storage backend (S3 / Backblaze B2)

Recordings and content use an S3-compatible client (`storage_client()`), so they can
live on **AWS S3** (default) or **Backblaze B2**:

- Set `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY` (+ `B2_REGION`) to route
  recordings + content to B2; leave them blank to stay on AWS S3.
- Configure **CORS** on the B2 bucket to expose the `ETag` header (the recorder's
  multipart/chunk uploads need it).
- **Textract limitation:** AWS Textract can only OCR objects in AWS S3, so PDF-search
  and the answer-eval handwriting OCR keep using `PDF_SEARCH_BUCKET` on AWS S3.
  Making a **B2-stored** content file "searchable" (Textract) isn't supported — keep
  OCR-bound PDFs on the S3 `PDF_SEARCH_BUCKET`.

## Notes

- Persistent data lives in MongoDB; media/PDFs live in S3 or Backblaze B2.
- If MongoDB can't connect locally, it's almost always an Atlas **IP allowlist** or a
  network/VPN blocking port `27017` — not the code.
- `svias/` (a reference UPSC interview prototype) is not part of the deployable app.
