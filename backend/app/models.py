from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class Article(Base):
    __tablename__ = "articles"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    content = Column(Text)
    source = Column(String(100))
    url = Column(Text)
    published_at = Column(DateTime(timezone=True), server_default=func.now())
    theme = Column(String(100), index=True)
    sentiment = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Theme(Base):
    __tablename__ = "themes"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), unique=True, nullable=False)
    article_count = Column(Integer, default=0)
    trend_score = Column(Float, default=0)
    status = Column(String(20), default="neutral")
    last_updated = Column(DateTime(timezone=True), server_default=func.now())

class RiskImplication(Base):
    __tablename__ = "risk_implications"
    id = Column(Integer, primary_key=True, index=True)
    theme_id = Column(Integer, ForeignKey("themes.id"))
    implication = Column(Text, nullable=False)
    asset_class = Column(String(50))
    severity = Column(String(20), default="medium")
    sources_json = Column(Text, default="[]")  # JSON array of {title, url, source}
    confidence = Column(Float, default=0.0)    # 0.0 to 1.0
    created_at = Column(DateTime(timezone=True), server_default=func.now())
