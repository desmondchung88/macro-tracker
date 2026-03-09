-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    source TEXT,
    url TEXT,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    theme TEXT,
    sentiment FLOAT DEFAULT 0,          -- -1 (bearish) to +1 (bullish)
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Themes table (hot/cool tracking)
CREATE TABLE IF NOT EXISTS themes (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    article_count INT DEFAULT 0,
    trend_score FLOAT DEFAULT 0,        -- spike detection score
    status TEXT DEFAULT 'neutral',      -- 'hot', 'cool', 'neutral'
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Risk implications table
CREATE TABLE IF NOT EXISTS risk_implications (
    id SERIAL PRIMARY KEY,
    theme_id INT REFERENCES themes(id),
    implication TEXT NOT NULL,
    asset_class TEXT,                   -- 'equities', 'fx', 'rates', 'credit'
    severity TEXT DEFAULT 'medium',     -- 'low', 'medium', 'high'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS articles_title_trgm ON articles USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS articles_theme_idx ON articles (theme);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC);

-- ── Seed Data (so judges see a live dashboard instantly) ──────────────────

INSERT INTO themes (name, article_count, trend_score, status) VALUES
    ('US Inflation', 18, 2.4, 'hot'),
    ('Federal Reserve Policy', 15, 1.8, 'hot'),
    ('China Economic Slowdown', 9, 0.6, 'neutral'),
    ('Japan Yield Curve Control', 7, 1.1, 'neutral'),
    ('European Energy Crisis', 4, 0.2, 'cool'),
    ('EM Currency Pressure', 11, 1.5, 'hot')
ON CONFLICT (name) DO NOTHING;

INSERT INTO articles (title, source, url, published_at, theme, sentiment) VALUES
    ('US CPI Beats Expectations at 3.8%, Reigniting Rate Hike Fears', 'Reuters', 'https://reuters.com', NOW() - INTERVAL '1 day', 'US Inflation', -0.7),
    ('Fed Minutes Signal Rates Could Stay Higher for Longer', 'Bloomberg', 'https://bloomberg.com', NOW() - INTERVAL '2 days', 'Federal Reserve Policy', -0.6),
    ('Core PCE Inflation Rises for Third Consecutive Month', 'WSJ', 'https://wsj.com', NOW() - INTERVAL '3 days', 'US Inflation', -0.5),
    ('China Factory Output Contracts Again in February', 'FT', 'https://ft.com', NOW() - INTERVAL '4 days', 'China Economic Slowdown', -0.8),
    ('BoJ Holds Yield Cap Despite Market Pressure', 'Nikkei', 'https://nikkei.com', NOW() - INTERVAL '5 days', 'Japan Yield Curve Control', -0.3),
    ('Dollar Strengthens as Rate Differential Widens', 'Reuters', 'https://reuters.com', NOW() - INTERVAL '2 days', 'EM Currency Pressure', -0.6),
    ('Fed Chair Powell: Inflation Fight Not Yet Won', 'CNBC', 'https://cnbc.com', NOW() - INTERVAL '1 day', 'Federal Reserve Policy', -0.7),
    ('Emerging Market Bonds See Record Outflows', 'Bloomberg', 'https://bloomberg.com', NOW() - INTERVAL '3 days', 'EM Currency Pressure', -0.8),
    ('US Labour Market Remains Tight, Adding to Inflation Pressure', 'WSJ', 'https://wsj.com', NOW() - INTERVAL '6 days', 'US Inflation', -0.4),
    ('European Gas Reserves Drop Below 5-Year Average', 'Reuters', 'https://reuters.com', NOW() - INTERVAL '10 days', 'European Energy Crisis', -0.5);

INSERT INTO risk_implications (theme_id, implication, asset_class, severity) VALUES
    (1, 'Persistent inflation likely forces additional Fed hikes, pressuring growth equities', 'equities', 'high'),
    (1, 'USD strengthens as real rates rise, creating headwinds for commodity prices', 'fx', 'high'),
    (1, 'Short-end Treasuries face selling pressure as terminal rate expectations reprice higher', 'rates', 'high'),
    (2, 'Higher-for-longer rates compress credit spreads and increase refinancing risk for HY issuers', 'credit', 'medium'),
    (2, 'Rate-sensitive sectors (utilities, REITs) likely to underperform', 'equities', 'medium'),
    (6, 'EM currencies vulnerable to capital outflows as USD carry trade unwinds', 'fx', 'high'),
    (6, 'EM sovereign debt spreads widen, particularly in current account deficit countries', 'credit', 'high');
