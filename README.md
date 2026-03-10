# 📡 Macro Economics Tracker
> AI-powered macro news intelligence for asset managers

**Macro Economics Tracker** aggregates news in real-time from 7 source types, classifies articles into macro themes, detects sentiment shifts, and generates AI-powered risk implications — giving asset managers early warning signals before themes move markets.

Bloomberg Terminal costs $24,000/year per seat. This runs entirely on free-tier APIs.

---

## 🎯 What It Solves

Asset managers spend hours manually scanning newswires, central bank releases, and regulatory filings to track themes like Fed policy or EM currency stress — often missing signals before they move markets.

This tracker automates that pipeline end-to-end:
1. **Ingests** from Reuters, Bloomberg TV, ECB, Fed, SEC, Reddit, and YouTube simultaneously
2. **Classifies** each article into a macro theme using keyword scoring with geographic constraints
3. **Scores sentiment** with a weighted NLP scorer — title hits count 2× body hits
4. **Detects HOT/COOL themes** via Bollinger Band anomaly detection on 14-day rolling article volume
5. **Generates risk implications** using Groq AI (Llama 3.1), citing the exact headlines that triggered each risk

---

## ✨ Key Features

| Feature | Detail |
|---|---|
| 🔴 HOT / COOL theme detection | Bollinger Band anomaly detection — same method as FT trending topics |
| 🧠 AI risk cards | Groq Llama 3.1 generates 4 asset-class risks per theme, with cited sources |
| 📊 14-day timeline | Article volume bar chart + daily sentiment trend line per theme |
| 🔗 Correlated themes | Cross-theme correlations (e.g. European Energy ↔ US Inflation +0.7) |
| ⚖️ Source quality tiers | 40+ whitelisted institutional domains; tabloids and state media blocked |
| 🌍 Geographic NLP filter | European Energy Crisis requires European geo-terms — LA gas prices filtered out |
| 🔁 Fuzzy deduplication | Levenshtein similarity catches near-duplicate headlines at 85% threshold |
| 📎 AI citation traceability | Every risk card links back to the headlines that triggered it |

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop installed and running

### 1. Clone the repo
```bash
git clone https://github.com/desmondchung88/macro-tracker.git
cd macro-tracker
```

### 2. Add your API keys
```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
NEWS_API_KEY=       # https://newsapi.org (free tier)
GROQ_API_KEY=       # https://console.groq.com (free — 14,400 req/day)
YOUTUBE_API_KEY=    # https://console.cloud.google.com (optional)
```

### 3. Start everything
```bash
docker compose up --build
```

Visit **http://localhost:3000** — dashboard loads immediately.

### 4. Ingest live news
Click **Ingest News** in the header → wait ~5 seconds → articles populate across themes.

### 5. Generate AI risk analysis
Click any theme → click **✨ Generate** in the Risk panel → Groq AI produces 4 risk cards with source citations.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser → Next.js 14 (port 3000)               │
│                   ↓                             │
│  FastAPI Backend (port 8000)                    │
│    ├── /api/themes    — Bollinger Band trends   │
│    ├── /api/articles  — filtered news feed      │
│    ├── /api/risks     — Groq AI risk cards      │
│    └── /api/news      — 7-source ingestion      │
│                   ↓                             │
│  PostgreSQL 16 + pgvector (port 5432)           │
│  Redis (port 6379)                              │
└─────────────────────────────────────────────────┘
```

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, Recharts |
| Backend | FastAPI (Python), SQLAlchemy |
| Database | PostgreSQL 16 + pgvector |
| AI | Groq API — Llama 3.1 8B Instant (risk generation) |
| Trend Detection | Bollinger Band anomaly detection + EWM smoothing |
| Sentiment | Weighted keyword NLP scorer (title 2× body) |
| Deduplication | Levenshtein fuzzy similarity (85% threshold) |
| Infrastructure | Docker Compose (4 containers) |
| Data Sources | NewsAPI, RSS feeds, Central Banks, SEC/CFTC/BIS, Reddit, YouTube, GNews |

---

## 📋 API Reference

Interactive Swagger docs at **http://localhost:8000/docs**

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | System health check |
| GET | `/api/themes/` | All themes with HOT/COOL/NEUTRAL status |
| GET | `/api/themes/{name}/timeline` | 14-day daily article counts + sentiment |
| GET | `/api/themes/{name}/trend-debug` | Full Bollinger Band calculation breakdown |
| GET | `/api/articles/?theme=X&limit=200` | Filtered article feed |
| POST | `/api/risks/{id}/generate` | Generate AI risk implications |
| POST | `/api/news/ingest` | Trigger live 7-source ingestion |
| POST | `/api/news/rescore` | Re-classify + re-score all existing articles |

---

## 🛑 Stopping

```bash
docker compose down          # stop containers
docker compose down -v       # stop + clear database
```
