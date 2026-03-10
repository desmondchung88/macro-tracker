import os, httpx, asyncio, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Article, Theme

router = APIRouter()

# ── NewsAPI queries ────────────────────────────────────────────────────────────
MACRO_QUERIES = [
    "inflation CPI consumer price index",
    "core PCE price index federal reserve",
    "US inflation data economic",
    "Federal Reserve interest rates Powell",
    "FOMC meeting monetary policy decision",
    "fed rate hike cut basis points",
    "China economy GDP slowdown",
    "China factory output manufacturing PMI",
    "PBOC yuan renminbi policy",
    "Bank of Japan yield curve control",
    "yen JPY BOJ monetary policy",
    "ECB European Central Bank rates Lagarde",
    "Europe energy crisis natural gas",
    "emerging markets currency dollar strength",
    "EM capital outflows sovereign debt",
]

# ── General financial RSS feeds ───────────────────────────────────────────────
RSS_FEEDS = [
    ("Reuters Business",  "https://feeds.reuters.com/reuters/businessNews"),
    ("Reuters Markets",   "https://feeds.reuters.com/reuters/companyNews"),
    ("CNBC Economy",      "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("MarketWatch",       "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines"),
    ("Investing.com",     "https://www.investing.com/rss/news.rss"),
    ("Yahoo Finance",     "https://finance.yahoo.com/news/rssindex"),
]

# ── Central bank official RSS feeds ──────────────────────────────────────────
CENTRAL_BANK_FEEDS = [
    ("Federal Reserve",   "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("Federal Reserve Research", "https://www.federalreserve.gov/feeds/feds.xml"),
    ("ECB Press",         "https://www.ecb.europa.eu/rss/press.html"),
    ("ECB Research",      "https://www.ecb.europa.eu/rss/pub.html"),
    ("Bank of Japan",     "https://www.boj.or.jp/en/rss/news.xml"),
    ("MAS Singapore",     "https://www.mas.gov.sg/news/rss"),
    ("Bank of England",   "https://www.bankofengland.co.uk/rss/publications"),
]

# ── SEC / Regulatory RSS feeds ────────────────────────────────────────────────
REGULATORY_FEEDS = [
    ("SEC Press Releases", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&dateb=&owner=include&count=20&output=atom"),
    ("SEC Risk Alerts",    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=RR&dateb=&owner=include&count=20&output=atom"),
    ("CFTC News",          "https://www.cftc.gov/rss/pressreleases.xml"),
    ("BIS Research",       "https://www.bis.org/doclist/wppubls.rss"),
    ("IMF News",           "https://www.imf.org/en/News/RSS?language=eng"),
]

# ── Reddit communities ────────────────────────────────────────────────────────
REDDIT_SUBS = [
    ("r/investing",       "https://www.reddit.com/r/investing/top.json?limit=25&t=day"),
    ("r/economics",       "https://www.reddit.com/r/economics/top.json?limit=25&t=day"),
    ("r/wallstreetbets",  "https://www.reddit.com/r/wallstreetbets/top.json?limit=25&t=day"),
    ("r/finance",         "https://www.reddit.com/r/finance/top.json?limit=25&t=day"),
    ("r/MacroEconomics",  "https://www.reddit.com/r/MacroEconomics/top.json?limit=25&t=day"),
]

# ── YouTube channels (requires YOUTUBE_API_KEY) ───────────────────────────────
YOUTUBE_CHANNELS = [
    ("Bloomberg Television", "UCIALMKvObZNtJ6AmdCLP7Lg"),
    ("CNBC Television",      "UCvJJ_dzjViJCoLf5uKUTwoA"),
    ("Reuters",              "UChqUTb7kYRX8-EiaN3XFrSQ"),
    ("Financial Times",      "UCwP4gHMgOe5BPAOwONHs8wg"),
]

# ── Theme classifier ──────────────────────────────────────────────────────────
THEME_KEYWORDS = {
    "US Inflation": [
        "inflation", "cpi", "pce", "consumer price", "price index",
        "cost of living", "core inflation", "deflation", "prices rose",
        "prices fell", "price pressures", "wage growth", "tariff", "tariffs",
        "trade war", "import prices", "producer price", "ppi",
    ],
    "Federal Reserve Policy": [
        "federal reserve", "fed", "powell", "rate hike", "interest rate",
        "fomc", "monetary policy", "rate cut", "basis points", "tightening",
        "quantitative", "balance sheet", "fed funds", "reserve bank",
        "central bank", "rate decision", "bps", "rate pause", "pivot",
    ],
    "China Economic Slowdown": [
        "china", "chinese economy", "pboc", "yuan", "renminbi",
        "beijing", "factory output", "caixin", "xi jinping",
        "hong kong", "shanghai", "shenzhen", "trade surplus", "exports china",
        "property crisis", "evergrande", "china gdp", "china pmi",
    ],
    "Japan Yield Curve Control": [
        "bank of japan", "boj", "yield curve", "yen", "ueda",
        "jgb", "japanese bond", "nikkei", "japan inflation",
        "japan rate", "japan economy", "tokyo cpi", "yen weakens", "yen strengthens",
    ],
    "European Energy Crisis": [
        "ecb", "eurozone", "lagarde", "european central bank",
        "natural gas", "lng", "energy crisis", "gas price",
        "europe inflation", "euro area", "germany economy", "eu economy",
        "energy prices", "electricity prices", "europe recession",
    ],
    "EM Currency Pressure": [
        "emerging market", "em currency", "capital outflow", "dollar strength",
        "developing market", "em bonds", "fx reserves", "dollar index",
        "dxy", "strong dollar", "usd rally", "india rupee", "brazil real",
        "turkey lira", "peso", "rand", "ringgit", "baht", "rupiah",
    ],
}

BEARISH_WORDS = [
    # Market language
    "selloff", "sell-off", "crash", "plunge", "tumble", "slump", "rout",
    "bearish", "bear market", "downgrade", "downside",
    # Economic stress
    "recession", "contraction", "slowdown", "stagflation", "deflation",
    "crisis", "collapse", "default", "contagion", "bubble",
    # Negative momentum
    "fall", "drop", "decline", "slide", "sink", "dip", "retreat",
    "surge", "spike", "soar", "jump",  # these are bearish for inflation/rates
    # Risk language
    "risk", "fear", "concern", "warn", "warning", "threat", "threatens",
    "volatile", "volatility", "uncertainty", "uncertain", "instability",
    "pressure", "stress", "strain", "burden", "squeeze",
    # Conflict / macro shock
    "war", "conflict", "sanction", "tariff", "trade war", "escalat",
    "looms", "roils", "rattles", "shocks", "disruption", "shortage",
    # Rate / inflation pain
    "hike", "tighten", "hawkish", "higher for longer", "overheat",
    "inflation", "inflationary", "price surge", "cost surge",
]
BULLISH_WORDS = [
    # Rate / policy relief
    "cut", "ease", "easing", "dovish", "pause", "pivot", "relief",
    # Economic strength
    "growth", "recovery", "rebound", "expansion", "resilient", "resilience",
    "strong", "strength", "robust", "solid", "beat", "beats expectations",
    "surge in exports", "record exports", "record high",
    # Market positivity
    "rally", "gain", "gains", "rise", "climb", "advance", "outperform",
    "bull", "bullish", "upgrade", "upside", "optimism", "optimistic",
    # Stabilisation
    "stabilise", "stabilize", "stabilising", "stabilizing",
    "improve", "improving", "improvement", "boost", "lifted",
    "cooling", "moderat",  # inflation cooling is bullish
]

SOURCE_TYPE_MAP = {
    "Federal Reserve": "central_bank",
    "Federal Reserve Research": "central_bank",
    "ECB Press": "central_bank",
    "ECB Research": "central_bank",
    "Bank of Japan": "central_bank",
    "MAS Singapore": "central_bank",
    "Bank of England": "central_bank",
    "SEC Press Releases": "regulatory",
    "SEC Risk Alerts": "regulatory",
    "CFTC News": "regulatory",
    "BIS Research": "regulatory",
    "IMF News": "regulatory",
}

def classify_theme(title: str, content: str) -> str:
    text = (title + " " + (content or "")).lower()
    scores = {theme: 0 for theme in THEME_KEYWORDS}
    for theme, keywords in THEME_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                scores[theme] += 1 + (2 if kw in title.lower() else 0)
    best = max(scores, key=lambda t: scores[t])
    return best if scores[best] > 0 else "Other"

def score_sentiment(title: str, content: str) -> float:
    text = (title + " " + (content or "")).lower()
    score = sum(-0.15 for w in BEARISH_WORDS if w in text)
    score += sum(0.15 for w in BULLISH_WORDS if w in text)
    return max(-1.0, min(1.0, round(score, 2)))

def save_article(db: Session, title: str, content: str, source: str,
                 url: str, published_at, source_type: str = "news") -> bool:
    if not title or title == "[Removed]" or len(title) < 10:
        return False

    theme_name = classify_theme(title, content or "")

    # Drop articles that dont match any macro theme — keeps feed clean and relevant
    if theme_name == "Other":
        return False

    if url and db.query(Article).filter(Article.url == url).first():
        return False
    if db.query(Article).filter(Article.title == title).first():
        return False

    sentiment = score_sentiment(title, content or "")

    db.add(Article(
        title=title, content=content, source=f"[{source_type.upper()}] {source}",
        url=url, published_at=published_at,
        theme=theme_name, sentiment=sentiment,
    ))

    # Safe upsert — never creates duplicate theme rows even under parallel load
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models import Theme as ThemeModel
    stmt = pg_insert(ThemeModel.__table__).values(
        name=theme_name, article_count=1, trend_score=0, status="neutral"
    ).on_conflict_do_update(
        index_elements=["name"],
        set_={"article_count": ThemeModel.__table__.c.article_count + 1}
    )
    db.execute(stmt)
    return True

# ── Parser helpers ────────────────────────────────────────────────────────────
def parse_rss_items(xml_text: str, source_name: str, source_type: str, db: Session, max_items: int = 20) -> int:
    saved = 0
    try:
        root = ET.fromstring(xml_text)
        ns   = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall(".//item") or root.findall(".//atom:entry", ns)
        for item in items[:max_items]:
            title = (
                getattr(item.find("title"), "text", "") or
                getattr(item.find("atom:title", ns), "text", "") or ""
            ).strip()
            link = (
                getattr(item.find("link"), "text", "") or
                (item.find("atom:link", ns) or {}).get("href", "") or ""  # type: ignore
            ).strip()
            desc = (
                getattr(item.find("description"), "text", "") or
                getattr(item.find("atom:summary", ns), "text", "") or
                getattr(item.find("atom:content", ns), "text", "") or ""
            ).strip()
            pub  = (
                getattr(item.find("pubDate"), "text", "") or
                getattr(item.find("atom:updated", ns), "text", "") or
                datetime.now(timezone.utc)
            )
            # Central bank & regulatory: store regardless of theme match — always relevant
            if source_type in ("central_bank", "regulatory"):
                if save_article(db, title, desc, source_name, link, pub, source_type):
                    saved += 1
            else:
                theme = classify_theme(title, desc)
                if theme != "Other":
                    if save_article(db, title, desc, source_name, link, pub, source_type):
                        saved += 1
    except Exception:
        pass
    return saved

# ── Source 1: NewsAPI ─────────────────────────────────────────────────────────
async def fetch_from_newsapi(db: Session) -> int:
    api_key = os.getenv("NEWS_API_KEY")
    if not api_key:
        return 0

    async def _fetch(client: httpx.AsyncClient, query: str) -> list:
        try:
            r = await client.get("https://newsapi.org/v2/everything",
                params={"q": query, "sortBy": "publishedAt", "pageSize": 10,
                        "language": "en", "apiKey": api_key}, timeout=10)
            return r.json().get("articles", []) if r.status_code == 200 else []
        except Exception:
            return []

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_fetch(client, q) for q in MACRO_QUERIES])

    saved = 0
    for articles in results:
        for a in articles:
            if save_article(db, a.get("title",""), a.get("description",""),
                           a.get("source",{}).get("name",""), a.get("url",""),
                           a.get("publishedAt"), "news"):
                saved += 1
    return saved

# ── Source 2: General RSS ─────────────────────────────────────────────────────
async def fetch_from_rss(db: Session) -> int:
    async def _fetch(client: httpx.AsyncClient, name: str, url: str) -> int:
        try:
            r = await client.get(url, timeout=10)
            return parse_rss_items(r.text, name, "news", db) if r.status_code == 200 else 0
        except Exception:
            return 0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        counts = await asyncio.gather(*[_fetch(client, n, u) for n, u in RSS_FEEDS])
    return sum(counts)

# ── Source 3: Central bank RSS ────────────────────────────────────────────────
async def fetch_from_central_banks(db: Session) -> int:
    async def _fetch(client: httpx.AsyncClient, name: str, url: str) -> int:
        try:
            r = await client.get(url, timeout=10)
            return parse_rss_items(r.text, name, "central_bank", db, max_items=10) if r.status_code == 200 else 0
        except Exception:
            return 0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        counts = await asyncio.gather(*[_fetch(client, n, u) for n, u in CENTRAL_BANK_FEEDS])
    return sum(counts)

# ── Source 4: Regulatory RSS ──────────────────────────────────────────────────
async def fetch_from_regulatory(db: Session) -> int:
    async def _fetch(client: httpx.AsyncClient, name: str, url: str) -> int:
        try:
            r = await client.get(url, timeout=10)
            return parse_rss_items(r.text, name, "regulatory", db, max_items=10) if r.status_code == 200 else 0
        except Exception:
            return 0

    async with httpx.AsyncClient(follow_redirects=True) as client:
        counts = await asyncio.gather(*[_fetch(client, n, u) for n, u in REGULATORY_FEEDS])
    return sum(counts)

# ── Source 5: Reddit ──────────────────────────────────────────────────────────
async def fetch_from_reddit(db: Session) -> int:
    headers = {"User-Agent": "MacroTracker/1.0 (hackathon project)"}
    saved   = 0

    async def _fetch(client: httpx.AsyncClient, name: str, url: str) -> int:
        count = 0
        try:
            r = await client.get(url, timeout=10)
            if r.status_code != 200:
                return 0
            posts = r.json().get("data", {}).get("children", [])
            for post in posts:
                d = post.get("data", {})
                title    = d.get("title", "")
                selftext = d.get("selftext", "")[:500]
                link     = f"https://reddit.com{d.get('permalink','')}"
                score    = d.get("score", 0)
                # Only keep posts with some engagement
                if score < 10:
                    continue
                pub = datetime.fromtimestamp(d.get("created_utc", 0), tz=timezone.utc)
                if save_article(db, title, f"[Reddit {name} | {score} upvotes] {selftext}",
                               name, link, pub, "community"):
                    count += 1
        except Exception:
            pass
        return count

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        counts = await asyncio.gather(*[_fetch(client, n, u) for n, u in REDDIT_SUBS])
    return sum(counts)

# ── Source 6: YouTube ─────────────────────────────────────────────────────────
async def fetch_from_youtube(db: Session) -> int:
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return 0

    saved = 0
    async with httpx.AsyncClient() as client:
        for channel_name, channel_id in YOUTUBE_CHANNELS:
            try:
                r = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={
                        "key": api_key, "channelId": channel_id,
                        "part": "snippet", "order": "date",
                        "maxResults": 10, "type": "video",
                        "relevanceLanguage": "en",
                    },
                    timeout=10,
                )
                if r.status_code != 200:
                    continue

                for item in r.json().get("items", []):
                    snippet = item.get("snippet", {})
                    title   = snippet.get("title", "")
                    desc    = snippet.get("description", "")[:300]
                    vid_id  = item.get("id", {}).get("videoId", "")
                    url     = f"https://youtube.com/watch?v={vid_id}"
                    pub     = snippet.get("publishedAt", datetime.now(timezone.utc))

                    theme = classify_theme(title, desc)
                    if theme != "Other":
                        if save_article(db, f"[VIDEO] {title}", desc,
                                       channel_name, url, pub, "video"):
                            saved += 1
            except Exception:
                continue
    return saved

# ── Source 7: GNews (optional) ────────────────────────────────────────────────
async def fetch_from_gnews(db: Session) -> int:
    api_key = os.getenv("GNEWS_API_KEY")
    if not api_key:
        return 0
    saved = 0
    async with httpx.AsyncClient() as client:
        for query in ["inflation economy", "central bank rates", "emerging markets", "china economy"]:
            try:
                r = await client.get("https://gnews.io/api/v4/search",
                    params={"q": query, "token": api_key, "lang": "en", "max": 10}, timeout=10)
                if r.status_code == 200:
                    for a in r.json().get("articles", []):
                        if save_article(db, a.get("title",""), a.get("description",""),
                                       a.get("source",{}).get("name","GNews"),
                                       a.get("url",""), a.get("publishedAt"), "news"):
                            saved += 1
            except Exception:
                continue
    return saved

# ── Master ingestion ──────────────────────────────────────────────────────────
async def fetch_and_store_news(db: Session):
    # Run all sources in parallel
    results = await asyncio.gather(
        fetch_from_newsapi(db),
        fetch_from_rss(db),
        fetch_from_central_banks(db),
        fetch_from_regulatory(db),
        fetch_from_reddit(db),
        fetch_from_youtube(db),
        fetch_from_gnews(db),
    )

    labels = ["NewsAPI", "RSS", "Central Banks", "Regulatory", "Reddit", "YouTube", "GNews"]
    db.commit()

    total = sum(results)
    breakdown = {labels[i]: results[i] for i in range(len(labels))}
    print(f"Ingested {total} new articles: {breakdown}")

    from app.trend_engine import recalculate_all_themes
    recalculate_all_themes(db)
    return breakdown

@router.post("/ingest")
async def ingest_news(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Multi-source ingestion across 7 source types:
    - NewsAPI:       15 queries × 10 = ~150 articles
    - RSS feeds:     6 outlets × 20  = ~120 articles
    - Central Banks: Fed, ECB, BoJ, MAS, BoE speeches & press releases
    - Regulatory:    SEC, CFTC, BIS, IMF announcements
    - Reddit:        r/investing, r/economics, r/wallstreetbets, r/finance
    - YouTube:       Bloomberg, CNBC, Reuters, FT (requires YOUTUBE_API_KEY)
    - GNews:         Optional extra source (requires GNEWS_API_KEY)
    All run in parallel. HOT/COOL Bollinger Band recalculation runs after.
    """
    background_tasks.add_task(fetch_and_store_news, db)
    return {
        "message": "Multi-source ingestion started across 7 source types.",
        "sources": {
            "NewsAPI":       "~150 articles (requires NEWS_API_KEY)",
            "RSS":           "~120 articles (free, no key)",
            "Central Banks": "Fed + ECB + BoJ + MAS + BoE (free, no key)",
            "Regulatory":    "SEC + CFTC + BIS + IMF (free, no key)",
            "Reddit":        "r/investing + r/economics + r/wallstreetbets (free, no key)",
            "YouTube":       "Bloomberg + CNBC + Reuters + FT (requires YOUTUBE_API_KEY)",
            "GNews":         "Optional (requires GNEWS_API_KEY)",
        }
    }

@router.post("/recalculate")
def recalculate_trends(db: Session = Depends(get_db)):
    from app.trend_engine import recalculate_all_themes
    results = recalculate_all_themes(db)
    return {"recalculated": len(results), "themes": results}

@router.post("/rescore")
def rescore_all_articles(db: Session = Depends(get_db)):
    """Re-score all existing articles with the latest sentiment word lists.
    Call this once after updating BEARISH_WORDS / BULLISH_WORDS."""
    from app.models import Article as ArticleModel
    articles = db.query(ArticleModel).all()
    for a in articles:
        a.sentiment = score_sentiment(a.title or "", a.content or "")
    db.commit()

    # Immediately recalculate HOT/COOL with new scores
    from app.trend_engine import recalculate_all_themes
    recalculate_all_themes(db)

    return {"rescored": len(articles), "message": "All articles rescored and trends recalculated"}
