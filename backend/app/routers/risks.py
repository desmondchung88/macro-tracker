from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import RiskImplication, Theme

router = APIRouter()

# Pre-written risk implications per theme — no AI API needed
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

@router.get("/")
def get_all_risks(db: Session = Depends(get_db)):
    return db.query(RiskImplication).all()

@router.get("/{theme_id}")
def get_risks_for_theme(theme_id: int, db: Session = Depends(get_db)):
    return db.query(RiskImplication).filter(RiskImplication.theme_id == theme_id).all()

@router.post("/{theme_id}/generate")
def generate_risk_implications(theme_id: int, db: Session = Depends(get_db)):
    """Load pre-written risk implications for a theme (no AI API required)."""
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        return {"error": "Theme not found"}

    db.query(RiskImplication).filter(RiskImplication.theme_id == theme_id).delete()

    implications = STATIC_RISKS.get(theme.name, [
        {"implication": "Monitor developments in this theme closely for cross-asset spillover effects.", "asset_class": "general", "severity": "medium"},
    ])

    saved = []
    for item in implications:
        risk = RiskImplication(
            theme_id=theme_id,
            implication=item["implication"],
            asset_class=item["asset_class"],
            severity=item["severity"],
        )
        db.add(risk)
        saved.append(item)

    db.commit()
    return {"generated": len(saved), "implications": saved}
