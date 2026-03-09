import os, httpx
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Article, Theme

router = APIRouter()

MACRO_QUERIES = [
    "Federal Reserve interest rates",
    "inflation CPI economic data",
    "China economy GDP",
    "emerging markets currency",
    "central bank policy",
]

# ── Keyword-based theme classification (no API needed) ────────────────────────
THEME_KEYWORDS = {
    "US Inflation": [
        "inflation", "cpi", "pce", "consumer price", "price index",
        "cost of living", "core inflation", "hyperinflation", "deflation",
    ],
    "Federal Reserve Policy": [
        "federal reserve", "fed", "powell", "rate hike", "interest rate",
        "fomc", "monetary policy", "rate cut", "basis points", "tightening",
    ],
    "China Economic Slowdown": [
        "china", "chinese economy", "pbc", "pboc", "yuan", "renminbi",
        "xi jinping", "beijing", "gdp china", "factory output", "caixin",
    ],
    "Japan Yield Curve Control": [
        "bank of japan", "boj", "yield curve", "yen", "ueda", "kuroda",
        "jgb", "japanese bond", "japan rate", "nikkei",
    ],
    "European Energy Crisis": [
        "europe energy", "natural gas", "lng", "ecb", "eurozone",
        "lagarde", "european central bank", "energy crisis", "gas price",
    ],
    "EM Currency Pressure": [
        "emerging market", "em currency", "capital outflow", "dollar strength",
        "usd", "developing market", "em bonds", "currency pressure", "fx reserves",
    ],
}

# ── Sentiment word lists (no API needed) ─────────────────────────────────────
BEARISH_WORDS = [
    "surge", "spike", "rise", "hike", "fear", "concern", "risk", "crisis",
    "fall", "drop", "decline", "recession", "slowdown", "contraction",
    "warn", "threat", "volatile", "uncertainty", "pressure", "selloff",
]
BULLISH_WORDS = [
    "ease", "cut", "recovery", "growth", "rebound", "stabilise", "stabilize",
    "improve", "strong", "resilient", "optimism", "rally", "gain", "boost",
]

def classify_theme(title: str, content: str) -> str:
    text = (title + " " + (content or "")).lower()
    scores = {theme: 0 for theme in THEME_KEYWORDS}
    for theme, keywords in THEME_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                scores[theme] += 1
    best_theme = max(scores, key=lambda t: scores[t])
    return best_theme if scores[best_theme] > 0 else "Other"

def score_sentiment(title: str, content: str) -> float:
    text = (title + " " + (content or "")).lower()
    score = 0
    for word in BEARISH_WORDS:
        if word in text:
            score -= 0.15
    for word in BULLISH_WORDS:
        if word in text:
            score += 0.15
    # Clamp to [-1, 1]
    return max(-1.0, min(1.0, round(score, 2)))

async def fetch_and_store_news(db: Session):
    api_key = os.getenv("NEWS_API_KEY")

    for query in MACRO_QUERIES:
        url = f"https://newsapi.org/v2/everything?q={query}&sortBy=publishedAt&pageSize=5&apiKey={api_key}"
        async with httpx.AsyncClient() as http:
            resp = await http.get(url)
        if resp.status_code != 200:
            continue

        for article in resp.json().get("articles", []):
            exists = db.query(Article).filter(Article.url == article.get("url")).first()
            if exists:
                continue

            title = article.get("title", "")
            content = article.get("description", "")

            # Classify with keywords — no API call needed
            theme_name = classify_theme(title, content)
            sentiment = score_sentiment(title, content)

            db_article = Article(
                title=title,
                content=content,
                source=article.get("source", {}).get("name"),
                url=article.get("url"),
                published_at=article.get("publishedAt"),
                theme=theme_name,
                sentiment=sentiment,
            )
            db.add(db_article)

            theme = db.query(Theme).filter(Theme.name == theme_name).first()
            if theme:
                theme.article_count += 1
            else:
                db.add(Theme(name=theme_name, article_count=1))

    db.commit()

    # Auto-run Bollinger Band trend detection after every ingestion
    from app.trend_engine import recalculate_all_themes
    recalculate_all_themes(db)

@router.post("/ingest")
async def ingest_news(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger news ingestion — Bollinger Band HOT/COOL recalculation runs automatically after."""
    background_tasks.add_task(fetch_and_store_news, db)
    return {"message": "News ingestion started. HOT/COOL status will update automatically."}


@router.post("/recalculate")
def recalculate_trends(db: Session = Depends(get_db)):
    """Manually trigger HOT/COOL Bollinger Band recalculation on all themes."""
    from app.trend_engine import recalculate_all_themes
    results = recalculate_all_themes(db)
    return {"recalculated": len(results), "themes": results}
