import os, httpx, asyncio, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Article, Theme
import re

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
    "European Energy Crisis": [
        "ecb", "eurozone", "lagarde", "european central bank",
        "natural gas europe", "lng europe", "energy crisis europe", "european gas",
        "europe inflation", "euro area", "germany economy", "eu economy",
        "energy prices europe", "electricity prices europe", "europe recession",
        "ttf gas", "dutch gas", "nord stream", "gazprom", "european energy",
        "eu energy", "europe energy", "european utility",
    ],
    "EM Currency Pressure": [
        "emerging market", "em currency", "capital outflow", "dollar strength",
        "developing market", "em bonds", "fx reserves", "dollar index",
        "dxy", "strong dollar", "usd rally", "india rupee", "brazil real",
        "turkey lira", "peso", "rand", "ringgit", "baht", "rupiah",
    ],
}

# Geographic required terms per theme — article MUST contain at least one
THEME_GEO_REQUIRED = {
    "European Energy Crisis": [
        "europe", "european", "eu ", "ecb", "eurozone", "euro area",
        "germany", "france", "italy", "spain", "netherlands", "belgium",
        "lagarde", "ttf", "gazprom", "nord stream", "brussels",
    ],
    "China Economic Slowdown": [
        "china", "chinese", "beijing", "shanghai", "pboc", "yuan",
        "renminbi", "hong kong", "xi jinping", "caixin",
    ],
    "Federal Reserve Policy": [
        "federal reserve", "fed ", "powell", "fomc", "fed funds",
        "wall street", "us economy", "u.s.", "american economy",
    ],
}

# Lifestyle / off-topic publication signals — reject these regardless of keywords
LIFESTYLE_BLOCKLIST = [
    "elle magazine", "vogue", "interview with elle", "fashion week",
    "lifestyle", "red carpet", "celebrity", "pop culture",
    "drivers worried", "la drivers", "los angeles drivers",
    "petrol prices uk drivers", "motorists",  # local traffic news
    "energy secretary says", # US energy secretary != European energy crisis
]

# Source credibility tiers for ranking (higher = better)
SOURCE_TIER = {
    # Tier 1 — premium wire / financial press
    "reuters": 10, "bloomberg": 10, "financial post": 9, "ft.com": 10,
    "wsj": 10, "wall street journal": 10,
    # Tier 2 — quality broadcast / digital
    "cnbc": 8, "bbc": 8, "nytimes": 8, "economist": 9,
    # Tier 3 — central bank / regulatory (authoritative but slow)
    "federal reserve": 9, "ecb press": 9, "bank of japan": 9,
    "mas singapore": 9, "sec": 8, "imf": 8, "bis": 8,
    # Tier 4 — regional quality press
    "times of india": 6, "straits times": 6, "nikkei": 7, "scmp": 7,
    # Tier 5 — community / reddit
    "r/investing": 4, "r/economics": 4, "r/wallstreetbets": 3,
    # Tier 6 — unknown / unranked
    "_default": 5,
}

BEARISH_WORDS = [
    # Market language
    "selloff", "sell-off", "crash", "plunge", "tumble", "slump", "rout",
    "bearish", "bear market", "downgrade", "downside", "underperform",
    # Economic stress
    "recession", "contraction", "slowdown", "stagflation", "deflation",
    "crisis", "collapse", "default", "contagion", "bubble", "headwinds",
    # Negative momentum
    "fall", "drop", "decline", "slide", "sink", "dip", "retreat",
    # Risk language
    "risk", "fear", "concern", "warn", "warning", "threat", "threatens",
    "volatile", "volatility", "uncertainty", "uncertain", "instability",
    "pressure", "stress", "strain", "burden", "squeeze", "struggle",
    # Conflict / macro shock
    "war", "conflict", "sanction", "tariff", "trade war", "escalat",
    "looms", "roils", "rattles", "shocks", "disruption", "shortage",
    # Rate / inflation pain (Note: standalone 'inflation' is context-dependent, handled in regex)
    "hawkish", "overheat", "inflationary",
]

BULLISH_WORDS = [
    # Rate / policy relief
    "cut", "ease", "easing", "dovish", "pause", "pivot", "relief", "stimulus",
    # Economic strength
    "growth", "recovery", "rebound", "expansion", "resilient", "resilience",
    "strong", "strength", "robust", "solid", "beat", "outperform", "tailwinds",
    # Market positivity
    "rally", "gain", "gains", "rise", "climb", "advance",
    "bull", "bullish", "upgrade", "upside", "optimism", "optimistic",
    # Stabilisation
    "stabilise", "stabilize", "stabilising", "stabilizing",
    "improve", "improving", "improvement", "boost", "lifted",
]

# ── Source quality control ───────────────────────────────────────────────────
# Whitelisted domains — professional, institutional-grade sources only
SOURCE_WHITELIST_DOMAINS = {
    # Wire services
    "reuters.com", "apnews.com", "bloomberg.com", "afp.com",
    # Financial press
    "wsj.com", "ft.com", "financialpost.com", "barrons.com",
    "marketwatch.com", "investing.com", "seekingalpha.com",
    "businessinsider.com", "fortune.com", "forbes.com",
    # Broadcast / digital
    "cnbc.com", "bbc.com", "theguardian.com", "nytimes.com",
    "washingtonpost.com", "economist.com",
    # Asia / regional quality press
    "straitstimes.com", "nikkei.com", "scmp.com", "thehindu.com",
    "timesofindia.com", "economictimes.indiatimes.com",
    # Commodity / energy
    "oilprice.com", "spglobal.com", "icis.com",
    # Official / institutional (always allow)
    "federalreserve.gov", "ecb.europa.eu", "boj.or.jp",
    "mas.gov.sg", "bankofengland.co.uk", "bis.org",
    "imf.org", "worldbank.org", "sec.gov", "cftc.gov",
    "europa.eu", "oecd.org",
    # Reddit (community signal — keep but tag)
    "reddit.com",
    # YouTube channels (Bloomberg, Reuters, CNBC official)
    "youtube.com",
}

# Known low-quality / partisan / tabloid domains — explicitly block
SOURCE_BLACKLIST_DOMAINS = {
    "thegatewaypundit.com", "breitbart.com", "infowars.com",
    "naturalnews.com", "zerohedge.com", "dailywire.com",
    "theepochtimes.com", "newsmax.com", "oann.com",
    "rt.com", "sputniknews.com", "tass.com",  # state propaganda
    "dailymail.co.uk", "thesun.co.uk", "nypost.com",  # tabloids
}

def is_allowed_source(url: str, source_name: str) -> bool:
    """Return True only for whitelisted institutional sources."""
    if not url:
        # No URL — allow central bank / regulatory RSS (trusted by source name)
        trusted_names = ["federal reserve", "ecb", "bank of japan", "mas",
                        "bank of england", "sec", "cftc", "bis", "imf",
                        "reuters", "bloomberg", "cnbc", "ft ", "bbc"]
        return any(t in source_name.lower() for t in trusted_names)

    url_lower = url.lower()

    # Block explicitly blacklisted domains first
    for blocked in SOURCE_BLACKLIST_DOMAINS:
        if blocked in url_lower:
            return False

    # Check whitelist
    for allowed in SOURCE_WHITELIST_DOMAINS:
        if allowed in url_lower:
            return True

    # For Reddit and YouTube (already in whitelist) always allow
    # For anything else — reject unknown sources
    return False

# ── Improved sentiment: sensationalist headline detection ─────────────────────
SENSATIONAL_BEARISH = [
    "betrayal", "tanks market", "market meltdown", "market crash", "economic collapse",
    "crisis deepens", "catastrophe", "disaster", "emergency", "alarming",
    "shocking", "explosive", "bombshell", "refuses", "wartime",
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

# Topics that are explicitly NOT macro-level — filter these out even if keywords partially match
NON_MACRO_BLOCKLIST = [
    # Healthcare / biotech
    "biotech", "clinical trial", "fda approval", "drug trial", "cgm", "medical device",
    "pharma", "therapeutics", "vaccine", "cancer", "diabetes", "oncology", "biopharma",
    # Individual company / earnings (micro)
    "earnings per share", "quarterly results", "product launch", "ceo resigns",
    "merger agreement", "acquisition deal", "ipo filing", "stock buyback",
    # Sports / entertainment
    "nba", "nfl", "fifa", "oscars", "grammy", "box office",
    # Tech products (not macro)
    "iphone", "android", "app store", "software update", "cybersecurity breach",
    # Real estate micro
    "home listing", "mortgage rate today", "zillow", "redfin",
]

# Require these minimum scores per theme to avoid weak matches
THEME_MIN_SCORES = {
    "Federal Reserve Policy": 2,   # must match at least 2 keywords OR 1 in title
    "US Inflation": 2,
    "China Economic Slowdown": 2,
    "European Energy Crisis": 2,
    "EM Currency Pressure": 2,
}

def classify_theme(title: str, content: str) -> str:
    title_lower = title.lower()
    text = (title + " " + (content or "")).lower()

    # Reject non-macro content
    for blocked in NON_MACRO_BLOCKLIST:
        if blocked in title_lower:
            return "Other"

    # Reject lifestyle / off-topic content regardless of keywords
    for blocked in LIFESTYLE_BLOCKLIST:
        if blocked in text:
            return "Other"

    scores = {theme: 0 for theme in THEME_KEYWORDS}
    for theme, keywords in THEME_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                scores[theme] += 3 if kw in title_lower else 1

    best = max(scores, key=lambda t: scores[t])
    min_score = THEME_MIN_SCORES.get(best, 2)

    if scores[best] < min_score:
        return "Other"

    title_keywords = [kw for kw in THEME_KEYWORDS[best] if kw in title_lower and len(kw) >= 4]
    content_keywords = [kw for kw in THEME_KEYWORDS[best] if kw in text and len(kw) >= 5]
    if not title_keywords and len(content_keywords) < 2:
        return "Other"

    # Geographic constraint — article must contain at least one required geo term
    if best in THEME_GEO_REQUIRED:
        geo_terms = THEME_GEO_REQUIRED[best]
        if not any(g in text for g in geo_terms):
            return "Other"

    return best

def score_sentiment(title: str, content: str) -> float:
    title_lower = title.lower()
    text = (title + " " + (content or "")).lower()
    score = 0.0

    # 1. Base Keyword Scoring (using your expanded lists)
    score += sum(-0.15 for w in BEARISH_WORDS if w in text)
    score += sum(0.15 for w in BULLISH_WORDS if w in text)

    # 2. MACRO-ECONOMIC PHRASE MATCHING (The Game Changer)
    # These catch the "dry" facts that are inherently bearish/bullish for markets
    macro_bearish_patterns = [
        r"prices (jump|surge|rise|rose|climb)", r"quickest jump", r"tariffs raise", 
        r"cost of living", r"inflationary pressure", r"yields (spike|surge|jump)",
        r"bonds (plunge|selloff|rout)", r"market (crash|tumble|rout)",
        r"higher for longer", r"sticky inflation", r"consumer squeeze",
        r"rate hike", r"rates higher", r"spending slows", r"supply chain disruption"
    ]
    
    macro_bullish_patterns = [
        r"inflation (cools|drops|falls|eases)", r"soft landing", r"rate cut",
        r"dovish pivot", r"beats expectations", r"growth accelerates",
        r"consumer resilience", r"prices (fall|drop|ease)"
    ]

    for pattern in macro_bearish_patterns:
        if re.search(pattern, text):
            score -= 0.35  # Heavy weight for macro events

    for pattern in macro_bullish_patterns:
        if re.search(pattern, text):
            score += 0.35  # Heavy weight for macro events

    # 3. Sensationalist headlines in title are strongly bearish
    score += sum(-0.3 for w in SENSATIONAL_BEARISH if w in title_lower)
    
    # 4. Geopolitical risk language — bearish for markets
    geo_risk = ["war", "conflict", "military", "sanctions", "dominance", "blitz",
                "lawfare", "tension", "rivalry", "bide its time", "hide its strength",
                "creeping", "aggression", "threat", "missile", "nuclear"]
    score += sum(-0.2 for w in geo_risk if w in text)
    
    # 5. Explicit bullish signals
    bullish_signals = ["beat expectations", "surges to record", "relieved", "signals ending",
                       "trade surplus", "sharply beat", "highest on record"]
    score += sum(0.25 for w in bullish_signals if w in text)
    
    # 6. Punctuation signals: "?" + "!" in title = uncertainty/alarm
    if title.count("?") >= 1 and title.count("!") >= 1:
        score -= 0.2

    # Return clamped score between -1.0 and 1.0
    return max(-1.0, min(1.0, round(score, 2)))

import re as _re
from difflib import SequenceMatcher

def normalise_title(title: str) -> str:
    """Strip punctuation/case for fuzzy dedup matching."""
    return _re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()

def title_similarity(a: str, b: str) -> float:
    """Return 0-1 similarity score between two titles."""
    return SequenceMatcher(None, normalise_title(a), normalise_title(b)).ratio()

def get_source_tier(source: str) -> int:
    """Return credibility tier score for a source (higher = better)."""
    s = (source or "").lower()
    for name, tier in SOURCE_TIER.items():
        if name in s:
            return tier
    return SOURCE_TIER["_default"]

def levenshtein_similarity(s1: str, s2: str) -> float:
    """Returns 0.0 (totally different) to 1.0 (identical) similarity score."""
    if not s1 or not s2:
        return 0.0
    # Use the shorter string length as cap
    m, n = len(s1), len(s2)
    if abs(m - n) / max(m, n) > 0.5:
        return 0.0  # Length differs too much — fast reject
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, n + 1):
            temp = dp[j]
            if s1[i-1] == s2[j-1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j-1])
            prev = temp
    distance = dp[n]
    return 1.0 - distance / max(m, n)

def get_source_tier(source: str) -> int:
    """Return credibility tier score for a source name."""
    s = source.lower()
    for key, tier in SOURCE_TIER.items():
        if key in s:
            return tier
    return SOURCE_TIER["_default"]

def save_article(db: Session, title: str, content: str, source: str,
                 url: str, published_at, source_type: str = "news") -> bool:
    if not title or title == "[Removed]" or len(title) < 10:
        return False

    # Source quality gate — reject blacklisted/unknown domains
    if source_type not in ("central_bank", "regulatory"):
        if not is_allowed_source(url or "", source or ""):
            return False

    theme_name = classify_theme(title, content or "")

    # Drop articles that dont match any macro theme — keeps feed clean and relevant
    if theme_name == "Other":
        return False

    # Hard dedup on URL
    if url and db.query(Article).filter(Article.url == url).first():
        return False

    # Exact title dedup (global — across all themes)
    if db.query(Article).filter(Article.title == title).first():
        return False

    # Fuzzy title dedup using Levenshtein — catches near-duplicate headlines
    norm = normalise_title(title)
    # Fetch recent titles globally (not just same theme) for comparison
    recent_titles = db.query(Article.title).order_by(Article.id.desc()).limit(500).all()
    for (existing_title,) in recent_titles:
        sim = levenshtein_similarity(norm, normalise_title(existing_title))
        if sim > 0.85:  # 85% similarity = near-duplicate
            return False

    sentiment = score_sentiment(title, content or "")
    tier = get_source_tier(source)

    db.add(Article(
        title=title, content=content, source=f"[{source_type.upper()}] {source}",
        url=url, published_at=published_at,
        theme=theme_name, sentiment=sentiment, source_tier=tier,
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

@router.delete("/theme/{theme_name}")
def delete_theme(theme_name: str, db: Session = Depends(get_db)):
    """Delete a theme and all its articles from the database."""
    from app.models import Theme as ThemeModel, RiskImplication
    from sqlalchemy import text
    db.query(Article).filter(Article.theme == theme_name).delete()
    db.query(RiskImplication).filter(
        RiskImplication.theme_id.in_(
            db.query(ThemeModel.id).filter(ThemeModel.name == theme_name)
        )
    ).delete(synchronize_session=False)
    deleted = db.query(ThemeModel).filter(ThemeModel.name == theme_name).delete()
    db.commit()
    return {"deleted": deleted > 0, "theme": theme_name}

@router.post("/rescore")
def rescore_all_articles(db: Session = Depends(get_db)):
    """Re-score AND re-classify all existing articles with latest keyword/sentiment lists.
    Call after updating THEME_KEYWORDS, BEARISH_WORDS, or BULLISH_WORDS."""
    from app.models import Article as ArticleModel
    articles = db.query(ArticleModel).all()
    removed = 0
    rescored = 0
    for a in articles:
        new_theme = classify_theme(a.title or "", a.content or "")
        a.sentiment = score_sentiment(a.title or "", a.content or "")
        if new_theme == "Other":
            db.delete(a)
            removed += 1
        else:
            a.theme = new_theme
            rescored += 1
    db.commit()

    # Recalculate HOT/COOL with updated classifications
    from app.trend_engine import recalculate_all_themes
    recalculate_all_themes(db)

    return {
        "rescored": rescored,
        "removed_noise": removed,
        "message": f"Re-classified {rescored} articles, removed {removed} off-topic articles"
    }
