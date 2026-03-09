from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import Theme, Article
from sqlalchemy import func

router = APIRouter()

@router.get("/")
def get_themes(db: Session = Depends(get_db)):
    themes = db.query(Theme).order_by(desc(Theme.trend_score)).all()
    return themes

@router.get("/{theme_name}/timeline")
def get_theme_timeline(theme_name: str, db: Session = Depends(get_db)):
    """Returns daily article count for a theme — used for trend charts."""
    rows = (
        db.query(
            func.date_trunc("day", Article.published_at).label("day"),
            func.count(Article.id).label("count"),
            func.avg(Article.sentiment).label("avg_sentiment"),
        )
        .filter(Article.theme == theme_name)
        .group_by("day")
        .order_by("day")
        .all()
    )
    return [{"date": str(r.day), "count": r.count, "sentiment": round(r.avg_sentiment or 0, 2)} for r in rows]

@router.get("/{theme_name}/trend-debug")
def get_trend_debug(theme_name: str, db: Session = Depends(get_db)):
    """
    Returns full Bollinger Band calculation for a theme — useful for explaining
    the algorithm to judges. Shows raw daily counts, rolling mean, std, bands,
    and final Z-score.
    """
    import numpy as np
    from app.trend_engine import get_daily_counts, EWM_SPAN, HOT_THRESHOLD, COOL_THRESHOLD

    counts = get_daily_counts(theme_name, db)
    if len(counts) < 3:
        return {"error": "Not enough data yet", "counts": counts}

    # EWM smoothing
    alpha = 2.0 / (EWM_SPAN + 1)
    smoothed = []
    ewm = counts[0]
    for c in counts:
        ewm = alpha * c + (1 - alpha) * ewm
        smoothed.append(round(ewm, 3))

    history = np.array(smoothed[:-1])
    today = smoothed[-1]
    mu = float(np.mean(history))
    sigma = float(np.std(history))
    if sigma < 0.1:
        sigma = 0.1

    upper_band = mu + HOT_THRESHOLD * sigma
    lower_band = mu + COOL_THRESHOLD * sigma
    z_score = (today - mu) / sigma

    theme = db.query(Theme).filter(Theme.name == theme_name).first()

    return {
        "theme": theme_name,
        "algorithm": "Bollinger Band Anomaly Detection (same as Financial Times trending topics)",
        "current_status": theme.status if theme else "unknown",
        "z_score": round(z_score, 3),
        "rolling_mean": round(mu, 3),
        "rolling_std": round(sigma, 3),
        "upper_band_hot_threshold": round(upper_band, 3),
        "lower_band_cool_threshold": round(lower_band, 3),
        "todays_smoothed_count": round(today, 3),
        "raw_daily_counts_14d": counts,
        "ewm_smoothed_counts_14d": smoothed,
        "interpretation": (
            f"Today's count ({today:.1f}) is {abs(z_score):.1f} standard deviations "
            f"{'above' if z_score > 0 else 'below'} the 14-day mean ({mu:.1f}). "
            f"HOT threshold = {upper_band:.1f}, COOL threshold = {lower_band:.1f}."
        )
    }
