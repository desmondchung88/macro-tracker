from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import articles, themes, risks, news, health

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Macro Economics Tracker API",
    description="AI-powered macroeconomic news tracker for asset managers",
    version="1.0.0",
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
