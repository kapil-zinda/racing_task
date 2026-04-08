# Kapil vs Divya Race App

Attractive **Next.js frontend** + Python Lambda backend for a points race:

- `+ New Class` = 3 points
- `+ Revision` = 2 points
- `+ Ticket Resolved` = 4 points
- Milestone rewards at 20, 40, 70, 100 points

## Project Structure

- `frontend/app/page.js` - Next.js UI + logic
- `frontend/app/globals.css` - Styling and animations
- `frontend/app/layout.js` - Layout + fonts
- `frontend/package.json` - Next.js scripts/dependencies
- `backend/lambda_function.py` - AWS Lambda backend

## Frontend Run (Next.js)

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open: `http://localhost:3000`

Set API base URL in `.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=https://<your-api-id>.execute-api.<region>.amazonaws.com/<stage>
```

If `NEXT_PUBLIC_API_BASE_URL` is empty, frontend uses localStorage fallback.

## Backend Run Local (FastAPI + Uvicorn)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
export $(grep -v '^#' .env | xargs)
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open API docs: `http://localhost:8000/docs`
Note: backend now auto-loads variables from `backend/.env` via `python-dotenv`.

## Activity History

- Every `POST /points` now accepts optional `detail` text.
- Backend stores per-player activity history in MongoDB with:
  - `action_type`
  - `action_label`
  - `detail` (what class/revision/ticket)
  - `points`
  - `created_at`
- `GET /state` returns `history` for both players.

## Daily Race Mode

- Race data is stored per day (`YYYY-MM-DD`) in MongoDB.
- `POST /points` and `POST /reset` always edit only today's race.
- `GET /state?date=YYYY-MM-DD` can fetch any day in read-only mode.
- `GET /days` returns available race dates and winner-day counters.

## Study Session Recorder

- Create session with metadata:
  - `date`, `subject`, `topic`, `session_type` (`study`/`revision`)
  - `start_time` and `total_time_minutes` are auto-calculated by recorder status events
- Track session controls:
  - `started`, `paused`, `resumed`, `stopped`
- Upload media to S3 through presigned URLs:
  - `audio`, `video`, `screen`

API endpoints:
- `POST /sessions`
- `GET /sessions?user_id=kapil|divya` (today by default)
- `GET /sessions/{session_id}`
- `POST /sessions/{session_id}/status`
- `POST /sessions/{session_id}/presign`

## Backend Deploy (AWS Lambda + API Gateway + MongoDB)

1. Create a Lambda function (Python 3.11).
2. Paste code from `backend/lambda_function.py`.
3. Install backend dependencies and upload with Lambda package/layer:

```bash
cd backend
pip install -r requirements.txt -t python
```

4. Configure Lambda environment variables:
   - `MONGODB_URI`
   - `MONGODB_DB` (default: `racing_challenge`)
   - `MONGODB_COLLECTION` (default: `race_state`)
   - `RACE_DOC_ID` (default: `kapil_divya_race`)
5. Create API Gateway routes:
   - `GET /state`
   - `POST /points`
   - `POST /reset`
   - `OPTIONS /{proxy+}` for CORS
6. Enable CORS.
7. Deploy API.

Lambda handler value can be:
- `lambda_function.lambda_handler` (current wrapper)
- or `app.handler` (Mangum handler directly)

### Build Lambda Zip

Use Docker for AWS-compatible (Linux) package:

```bash
cd backend
./build_lambda_package.sh
```

Output:

- `backend/dist/lambda_package_py311_linux.zip` (upload this to Lambda)

## Notes

- Backend now stores persistent race data in MongoDB.
- Sample env keys are in `backend/.env.example`.
