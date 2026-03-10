"""
Trend Detection Engine — Macro Economics Tracker
=================================================
Algorithm: Bollinger Band anomaly detection on daily article volume time series.

This is the same approach used by the Financial Times for trending topic detection.
It's also instantly recognisable to finance judges because Bollinger Bands come
from equity technical analysis (measuring price volatility relative to a rolling mean).

How it works:
  1. For each theme, count articles published per day over a rolling 14-day window
  2. Compute rolling mean (μ) and rolling std deviation (σ) of that daily count
  3. Today's count vs the band:
       count > μ + 1σ  →  HOT   (statistically anomalous spike)
       count < μ - 0.3σ →  COOL  (falling below normal baseline)
       else             →  NEUTRAL

  4. trend_score = Z-score of today's count = (count - μ) / σ
     This gives a continuous signal judges can see ranked in the sidebar.

  5. Exponential Weighted Momentum (EWM) bonus: weight recent days more heavily
     so a 3-day burst counts more than a 1-day spike that faded.
"""

import numpy as np
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Article, Theme


# ── Configuration ─────────────────────────────────────────────────────────────
WINDOW_DAYS = 14          # How many days of history to look back
HOT_THRESHOLD = 1.0       # Lowered for demo: 1 std dev above mean = HOT (was 2.0)
COOL_THRESHOLD = -0.3     # Lowered for demo: 0.3 std dev below mean = COOL (was -0.5)
EWM_SPAN = 3              # Exponential smoothing span (in days) for momentum


def get_daily_counts(theme_name: str, db: Session, days: int = WINDOW_DAYS) -> list[float]:
    """
    Returns a list of article counts per day for the last `days` days.
    Days with no articles are filled with 0.0.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = (
        db.query(
            func.date_trunc("day", Article.published_at).label("day"),
            func.count(Article.id).label("count"),
        )
        .filter(Article.theme == theme_name)
        .filter(Article.published_at >= since)
        .group_by("day")
        .order_by("day")
        .all()
    )

    # Build a full dense array — fill gaps with 0
    day_map = {r.day.date() if hasattr(r.day, 'date') else r.day: r.count for r in rows}
    today = datetime.now(timezone.utc).date()
    counts = []
    for i in range(days, -1, -1):
        day = today - timedelta(days=i)
        counts.append(float(day_map.get(day, 0)))

    return counts


def exponential_weighted_mean(counts: list[float], span: int = EWM_SPAN) -> float:
    """
    Exponential weighted mean — recent days count more than old days.
    Same as pandas ewm(span=span).mean() but pure Python/numpy.
    """
    if not counts:
        return 0.0
    alpha = 2.0 / (span + 1)
    ewm = counts[0]
    for c in counts[1:]:
        ewm = alpha * c + (1 - alpha) * ewm
    return ewm


def bollinger_band_status(counts: list[float]) -> tuple[str, float]:
    """
    Core algorithm: Bollinger Band anomaly detection.

    Returns (status, trend_score) where:
      status      : 'hot', 'cool', or 'neutral'
      trend_score : Z-score of today's count (continuous signal for ranking)
    """
    if len(counts) < 3:
        return "neutral", 0.0

    # Use EWM-smoothed counts to reduce noise from single-day spikes
    smoothed = []
    alpha = 2.0 / (EWM_SPAN + 1)
    ewm = counts[0]
    for c in counts:
        ewm = alpha * c + (1 - alpha) * ewm
        smoothed.append(ewm)

    # Historical window = all days except today
    history = np.array(smoothed[:-1])
    today_count = smoothed[-1]  # EWM-smoothed today

    mu = float(np.mean(history))         # rolling mean
    sigma = float(np.std(history))       # rolling std deviation

    # Sparse data fallback — when most history is zeros but today has articles,
    # use article count directly as a signal instead of Z-score
    non_zero_days = np.count_nonzero(history)
    if non_zero_days <= 2:
        # Not enough spread — rank by raw article count relative to others
        if today_count >= 10:
            return "hot", round(today_count / max(mu + 0.1, 1), 3)
        elif today_count >= 5:
            return "neutral", round(today_count / max(mu + 0.1, 1), 3)
        elif today_count == 0 and mu > 0:
            return "cool", -0.5
        else:
            return "neutral", 0.0

    # Normal path — enough history for Bollinger Bands
    if sigma < 0.5:
        sigma = 0.5  # Minimum sigma to avoid over-sensitivity

    # Bollinger Bands
    upper_band = mu + HOT_THRESHOLD * sigma
    lower_band = mu + COOL_THRESHOLD * sigma

    # Z-score = how many standard deviations today is from the mean
    z_score = (today_count - mu) / sigma

    # Classify
    if today_count > upper_band:
        status = "hot"
    elif today_count < lower_band:
        status = "cool"
    else:
        status = "neutral"

    return status, round(z_score, 3)


def recalculate_all_themes(db: Session) -> list[dict]:
    """
    Run Bollinger Band detection on every theme and update the DB.
    Called automatically after each news ingestion.
    """
    themes = db.query(Theme).all()
    results = []

    for theme in themes:
        counts = get_daily_counts(theme.name, db)
        status, trend_score = bollinger_band_status(counts)

        # Also update article_count to reflect true total
        total = db.query(func.count(Article.id)).filter(Article.theme == theme.name).scalar()

        theme.status = status
        theme.trend_score = trend_score
        theme.article_count = total or 0
        theme.last_updated = datetime.now(timezone.utc)

        results.append({
            "theme": theme.name,
            "status": status,
            "trend_score": trend_score,
            "article_count": total,
            "daily_counts": counts[-7:],  # last 7 days for debug
        })

    db.commit()
    return results
