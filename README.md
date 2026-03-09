# 📡 Macro Economics Tracker
> AI-powered macro news intelligence for asset managers

## 🚀 Quick Start (3 steps)

### 1. Clone & enter the project
```bash
git clone <your-repo-url>
cd macro-tracker
```

### 2. Add your API keys
```bash
cp .env.example .env
```
Open `.env` and fill in:
- `OPENAI_API_KEY` — from https://platform.openai.com
- `NEWS_API_KEY` — from https://newsapi.org (free tier works)

### 3. Start everything with Docker
```bash
docker compose up --build
```

**That's it.** Visit http://localhost:3000 — the dashboard loads with pre-seeded data instantly.

---

## 🗺️ What You'll See

| Feature | Where |
|---|---|
| Macro theme sidebar with HOT/COOL/NEUTRAL status | Left panel |
| Article feed filtered by theme | Centre panel |
| Theme activity bar chart | Centre top |
| AI-generated risk implications | Right panel |
| Live news ingestion button | Top right header |

### Generating AI Risk Implications
1. Click any theme in the left sidebar
2. Click the **✨ Generate** button in the Risk panel
3. GPT-4o produces asset-class specific risk cards in seconds

### Ingesting Live News
- Click **Ingest News** in the header
- Wait ~4 seconds — new articles appear automatically

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│  Browser → Next.js (port 3000)              │
│              ↓                              │
│  FastAPI Backend (port 8000)                │
│    ├── /api/themes   — trend detection      │
│    ├── /api/articles — news feed            │
│    ├── /api/risks    — AI risk cards        │
│    └── /api/news     — ingestion            │
│              ↓                              │
│  PostgreSQL + pgvector (port 5432)          │
│  Redis (port 6379)                          │
└─────────────────────────────────────────────┘
```

## 🔧 Tech Stack
- **Frontend**: Next.js 14, Tailwind CSS, Recharts
- **Backend**: FastAPI (Python), SQLAlchemy, Celery
- **Database**: PostgreSQL 16 + pgvector
- **AI**: OpenAI GPT-4o (risk generation), GPT-4o-mini (classification)
- **Data**: NewsAPI, FRED API

## 📋 API Reference
Interactive docs available at http://localhost:8000/docs once running.

Key endpoints:
- `GET  /health` — system health check
- `GET  /api/themes/` — all macro themes with trend scores
- `GET  /api/themes/{name}/timeline` — daily article counts for charting
- `GET  /api/articles/?theme=X` — filtered article feed
- `POST /api/risks/{id}/generate` — AI risk generation
- `POST /api/news/ingest` — trigger live news ingestion

## 🛑 Stopping the app
```bash
docker compose down
```
To also clear the database:
```bash
docker compose down -v
```
