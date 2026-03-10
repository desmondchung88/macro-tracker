import os, json, httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import RiskImplication, Theme, Article

router = APIRouter()

STATIC_RISKS = {
    "US Inflation": [
        {"implication": "Persistent inflation forces additional Fed hikes, compressing equity multiples especially in growth stocks.", "asset_class": "equities", "severity": "high"},
        {"implication": "USD strengthens as real rates rise, creating headwinds for commodity prices and USD-denominated debt.", "asset_class": "fx", "severity": "high"},
        {"implication": "Short-end Treasuries face selling pressure as terminal rate expectations reprice higher.", "asset_class": "rates", "severity": "high"},
        {"implication": "HY credit spreads widen as higher rates increase refinancing risk for leveraged issuers.", "asset_class": "credit", "severity": "medium"},
    ],
    "Federal Reserve Policy": [
        {"implication": "Higher-for-longer rates compress valuations in rate-sensitive sectors: utilities, REITs, and long-duration tech.", "asset_class": "equities", "severity": "high"},
        {"implication": "USD carry trades unwind as rate differential with other G10 currencies narrows.", "asset_class": "fx", "severity": "medium"},
        {"implication": "Yield curve likely to steepen as long-end bonds sell off on fiscal supply concerns.", "asset_class": "rates", "severity": "high"},
        {"implication": "Investment grade spreads widen modestly; covenant-lite loans face covenant breach risk.", "asset_class": "credit", "severity": "medium"},
    ],
    "China Economic Slowdown": [
        {"implication": "Commodity-exposed equities (mining, energy) face demand headwinds as Chinese industrial activity contracts.", "asset_class": "equities", "severity": "high"},
        {"implication": "AUD, BRL, CLP weaken as Chinese demand for raw materials falls, pressuring commodity currencies.", "asset_class": "fx", "severity": "high"},
        {"implication": "Global growth expectations fall, supporting safe-haven bond demand and pushing yields lower.", "asset_class": "rates", "severity": "medium"},
        {"implication": "Asian EM credit spreads widen; supply chain disruptions increase counterparty risk.", "asset_class": "credit", "severity": "medium"},
    ],
    "Japan Yield Curve Control": [
        {"implication": "BoJ YCC adjustment triggers JPY short squeeze; exporters (Toyota, Sony) face earnings headwind.", "asset_class": "equities", "severity": "medium"},
        {"implication": "JPY strengthens sharply on any YCC policy shift, unwinding years of yen carry trades globally.", "asset_class": "fx", "severity": "high"},
        {"implication": "JGB yields rise and could spill into global bond markets, pushing up term premia worldwide.", "asset_class": "rates", "severity": "high"},
        {"implication": "Japanese institutional investors repatriate foreign bonds, pressuring US and EU yields.", "asset_class": "credit", "severity": "medium"},
    ],
    "European Energy Crisis": [
        {"implication": "Energy-intensive European industrials face margin compression; utilities benefit from elevated power prices.", "asset_class": "equities", "severity": "medium"},
        {"implication": "EUR weakens as energy import costs weigh on current account and growth outlook.", "asset_class": "fx", "severity": "high"},
        {"implication": "ECB faces stagflationary dilemma — hiking into weakness keeps rates elevated, pressuring peripheral bonds.", "asset_class": "rates", "severity": "high"},
        {"implication": "Southern European sovereign spreads widen as energy subsidies strain fiscal positions.", "asset_class": "credit", "severity": "medium"},
    ],
    "EM Currency Pressure": [
        {"implication": "EM equities de-rate as foreign investors exit; domestic demand stocks more resilient than exporters.", "asset_class": "equities", "severity": "high"},
        {"implication": "EM currencies with current account deficits (TRY, ZAR, BRL) face disorderly depreciation risk.", "asset_class": "fx", "severity": "high"},
        {"implication": "EM central banks forced to hike defensively, increasing recession risk in vulnerable economies.", "asset_class": "rates", "severity": "high"},
        {"implication": "EM sovereign and corporate USD-denominated bonds face spread widening as refinancing costs surge.", "asset_class": "credit", "severity": "high"},
    ],
}

async def generate_with_groq(theme_name: str, status: str, trend_score: float, articles: list) -> list:
    """Call Groq API (free tier) with live article headlines to generate dynamic risk implications."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return []

    headlines = "\n".join([
        f"- [{a.source or 'Unknown'}] {a.title} (sentiment: {'+' if a.sentiment > 0 else ''}{a.sentiment:.2f})"
        for a in articles[:10]
    ])

    avg_sentiment = sum(a.sentiment for a in articles) / len(articles) if articles else 0
    sentiment_label = "bearish" if avg_sentiment < -0.2 else "bullish" if avg_sentiment > 0.2 else "neutral"

    # Build numbered headline list so AI can cite by index
    numbered_headlines = "\n".join([
        f"[{i+1}] [{a.source or 'Unknown'}] {a.title} (sentiment: {'+' if a.sentiment > 0 else ''}{a.sentiment:.2f}) | URL: {a.url or 'n/a'}"
        for i, a in enumerate(articles[:10])
    ])

    prompt = f"""You are a senior macro strategist at a top asset management firm.
Analyse the following live news headlines about "{theme_name}" and propose exactly 4 risk implications for asset managers.

THEME STATUS: {status.upper()} (Z-score: {trend_score:.2f})
AVERAGE SENTIMENT: {sentiment_label} ({avg_sentiment:.2f})
ARTICLE COUNT: {len(articles)}

LATEST HEADLINES (cite by number):
{numbered_headlines}

Return a JSON array of exactly 4 objects. Each object must have:
- "implication": a specific, actionable 1-2 sentence risk statement grounded in the headlines above
- "asset_class": one of "equities", "fx", "rates", "credit"
- "severity": one of "high", "medium", "low"
- "cited_indices": array of headline numbers (e.g. [1, 3]) that directly support this implication
- "confidence": a float 0.0-1.0 reflecting how strongly the headlines support this implication

Cover all 4 asset classes (one each). Be specific — reference actual events from the headlines.
Return ONLY the JSON array, no other text, no markdown fences."""

    print(f"[Groq] Calling API for theme: {theme_name}")
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.1-8b-instant",
                "max_tokens": 1024,
                "temperature": 0.3,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )

    print(f"[Groq] Response status: {response.status_code}")
    if response.status_code != 200:
        print(f"[Groq] Error: {response.text[:300]}")
        return []

    raw = response.json()["choices"][0]["message"]["content"].strip()
    print(f"[Groq] Raw response: {raw[:200]}")

    # Strip markdown fences if present
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    implications = json.loads(raw.strip())

    valid = []
    for item in implications:
        if all(k in item for k in ("implication", "asset_class", "severity")):
            item["asset_class"] = item["asset_class"].lower()
            item["severity"]    = item["severity"].lower()
            if item["severity"] not in ("high", "medium", "low"):
                item["severity"] = "medium"

            # Resolve cited indices to actual article objects
            cited = []
            for idx in item.get("cited_indices", []):
                if isinstance(idx, int) and 1 <= idx <= len(articles):
                    a = articles[idx - 1]
                    clean_source = (a.source or "")
                    if "] " in clean_source:
                        clean_source = clean_source.split("] ", 1)[-1]
                    cited.append({
                        "title":  a.title,
                        "url":    a.url or "",
                        "source": clean_source,
                    })
            item["sources"]    = cited
            item["confidence"] = float(item.get("confidence", 0.7))
            valid.append(item)

    return valid[:4]

@router.get("/")
def get_all_risks(db: Session = Depends(get_db)):
    return db.query(RiskImplication).all()

@router.get("/{theme_id}")
def get_risks_for_theme(theme_id: int, db: Session = Depends(get_db)):
    return db.query(RiskImplication).filter(RiskImplication.theme_id == theme_id).all()

@router.post("/{theme_id}/generate")
async def generate_risk_implications(theme_id: int, db: Session = Depends(get_db)):
    """
    Generate risk implications for a theme.
    - If ANTHROPIC_API_KEY is set: uses Claude to analyse live article headlines
    - Fallback: returns curated static implications
    """
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        return {"error": "Theme not found"}

    # Fetch the 10 most recent articles for this theme
    recent_articles = (
        db.query(Article)
        .filter(Article.theme == theme.name)
        .order_by(Article.published_at.desc())
        .limit(10)
        .all()
    )

    implications = []
    source = "static"

    # Try Anthropic API first if key is available and we have articles
    if os.getenv("GROQ_API_KEY") and recent_articles:
        try:
            implications = await generate_with_groq(
                theme_name=theme.name,
                status=theme.status or "neutral",
                trend_score=theme.trend_score or 0,
                articles=recent_articles,
            )
            if implications:
                source = "groq-ai"
        except Exception as e:
            print(f"[Groq] Generation failed, falling back to static: {e}")

    # Fallback to static if AI failed or no key
    if not implications:
        implications = STATIC_RISKS.get(theme.name, [
            {"implication": "Monitor developments in this theme closely for cross-asset spillover effects.", "asset_class": "general", "severity": "medium"},
        ])

    # Clear old risks and save new ones
    db.query(RiskImplication).filter(RiskImplication.theme_id == theme_id).delete()
    saved = []
    for item in implications:
        risk = RiskImplication(
            theme_id=theme_id,
            implication=item["implication"],
            asset_class=item["asset_class"],
            severity=item["severity"],
            sources_json=json.dumps(item.get("sources", [])),
            confidence=item.get("confidence", 0.0),
        )
        db.add(risk)
        saved.append(item)

    db.commit()
    return {"generated": len(saved), "source": source, "implications": saved}
