from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base, SessionLocal
from app.routers import articles, themes, risks, news, health

Base.metadata.create_all(bind=engine)

# Safe migration — add new columns to existing DB without wiping data
from sqlalchemy import text
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE risk_implications ADD COLUMN IF NOT EXISTS sources_json TEXT DEFAULT '[]'"))
        conn.execute(text("ALTER TABLE risk_implications ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 0.0"))
        conn.commit()
except Exception as _e:
    print(f"Migration note: {_e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        db = SessionLocal()
        from app.trend_engine import recalculate_all_themes
        recalculate_all_themes(db)
        db.close()
    except Exception as e:
        print(f"Startup trend recalculation skipped: {e}")
    yield

app = FastAPI(
    title="Macro Economics Tracker API",
    description="AI-powered macroeconomic news tracker for asset managers",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(articles.router, prefix="/api/articles", tags=["Articles"])
app.include_router(themes.router, prefix="/api/themes", tags=["Themes"])
app.include_router(risks.router, prefix="/api/risks", tags=["Risk Implications"])
app.include_router(news.router, prefix="/api/news", tags=["News Ingestion"])

@app.get("/")
def root():
    return {"message": "Macro Economics Tracker API", "docs": "/docs"}
