from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from app.database import get_db
from app.models import Article

router = APIRouter()

@router.get("/")
def get_articles(
    theme: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    db: Session = Depends(get_db)
):
    query = db.query(Article)
    if theme:
        query = query.filter(Article.theme == theme)
    articles = query.order_by(desc(Article.published_at)).offset(offset).limit(limit).all()
    total = query.count()
    return {"articles": articles, "total": total}

@router.get("/{article_id}")
def get_article(article_id: int, db: Session = Depends(get_db)):
    return db.query(Article).filter(Article.id == article_id).first()
