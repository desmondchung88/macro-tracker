'use client'
import { useEffect, useState, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Newspaper, Search, Wifi, WifiOff, X, Info } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Theme = { id: number; name: string; article_count: number; trend_score: number; status: string; last_updated: string }
type Article = { id: number; title: string; source: string; published_at: string; theme: string; sentiment: number; url: string }
type Risk = { id: number; implication: string; asset_class: string; severity: string; theme_id: number }
type Toast = { id: number; message: string; type: 'success' | 'error' | 'info' }
type TrendDebug = { z_score: number; rolling_mean: number; upper_band_hot_threshold: number; lower_band_cool_threshold: number; interpretation: string; algorithm: string } | null

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  hot:     { label: 'HOT',     color: '#ef4444', bg: '#ef444422', icon: TrendingUp },
  cool:    { label: 'COOL',    color: '#3b82f6', bg: '#3b82f622', icon: TrendingDown },
  neutral: { label: 'NEUTRAL', color: '#94a3b8', bg: '#94a3b822', icon: Minus },
}
const SEVERITY_COLOR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' }
const ASSET_ICON: Record<string, string> = { equities: '📈', fx: '💱', rates: '📊', credit: '🏦', general: '🌐' }

// Skeleton loader component
function Skeleton({ w = '100%', h = '1rem', rounded = '6px' }: { w?: string; h?: string; rounded?: string }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: rounded,
      background: 'linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
    }} />
  )
}

// Sparkline mini chart
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)
  const points = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#sg-${color.replace('#','')})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function Dashboard() {
  const [themes, setThemes] = useState<Theme[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [risks, setRisks] = useState<Risk[]>([])
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({})
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)
  const [apiStatus, setApiStatus] = useState<'ok' | 'error' | 'checking'>('checking')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [trendDebug, setTrendDebug] = useState<TrendDebug>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [generatingRisks, setGeneratingRisks] = useState(false)

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await res.json()
      setApiStatus(data.status === 'ok' ? 'ok' : 'error')
    } catch {
      setApiStatus('error')
    }
  }, [])

  const fetchSparklines = useCallback(async (themeList: Theme[]) => {
    const results: Record<string, number[]> = {}
    await Promise.all(themeList.slice(0, 6).map(async (t) => {
      try {
        const encoded = encodeURIComponent(t.name)
        const res = await fetch(`${API}/api/themes/${encoded}/timeline`)
        const data = await res.json()
        results[t.name] = data.slice(-7).map((d: any) => d.count)
      } catch { results[t.name] = [] }
    }))
    setSparklines(results)
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [t, a, r] = await Promise.all([
        fetch(`${API}/api/themes/`).then(r => r.json()).catch(() => []),
        fetch(`${API}/api/articles/?limit=50`).then(r => r.json()).catch(() => ({ articles: [] })),
        fetch(`${API}/api/risks/`).then(r => r.json()).catch(() => []),
      ])
      setThemes(t)
      setArticles(a.articles || [])
      setRisks(r)
      if (t.length > 0) {
        setSelectedTheme(prev => prev ? t.find((x: Theme) => x.id === prev.id) || t[0] : t[0])
        fetchSparklines(t)
      }
    } catch {
      addToast('Failed to load dashboard data', 'error')
    }
    setLoading(false)
  }, [addToast, fetchSparklines])

  useEffect(() => {
    checkHealth()
    fetchAll()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [checkHealth, fetchAll])

  const fetchTrendDebug = async (themeName: string) => {
    try {
      const res = await fetch(`${API}/api/themes/${encodeURIComponent(themeName)}/trend-debug`)
      const data = await res.json()
      setTrendDebug(data)
      setShowDebug(true)
    } catch { addToast('Could not load trend data', 'error') }
  }

  const ingestNews = async () => {
    setIngesting(true)
    addToast('Fetching latest macro news...', 'info')
    try {
      await fetch(`${API}/api/news/ingest`, { method: 'POST' })
      setTimeout(async () => {
        await fetchAll()
        setIngesting(false)
        addToast('✓ News ingestion complete — HOT/COOL status updated', 'success')
      }, 5000)
    } catch {
      setIngesting(false)
      addToast('News ingestion failed', 'error')
    }
  }

  const generateRisks = async (themeId: number, themeName: string) => {
    setGeneratingRisks(true)
    addToast(`Generating risk analysis for ${themeName}...`, 'info')
    try {
      await fetch(`${API}/api/risks/${themeId}/generate`, { method: 'POST' })
      const r = await fetch(`${API}/api/risks/`).then(r => r.json())
      setRisks(r)
      addToast(`✓ Risk implications ready for ${themeName}`, 'success')
    } catch {
      addToast('Risk generation failed', 'error')
    }
    setGeneratingRisks(false)
  }

  // Filtered articles by theme + search
  const filteredArticles = articles.filter(a => {
    const matchesTheme = selectedTheme ? a.theme === selectedTheme.name : true
    const matchesSearch = search
      ? a.title.toLowerCase().includes(search.toLowerCase()) ||
        (a.source || '').toLowerCase().includes(search.toLowerCase())
      : true
    return matchesTheme && matchesSearch
  })

  // Risks for selected theme
  const themeRisks = selectedTheme
    ? risks.filter(r => r.theme_id === selectedTheme.id)
    : risks.slice(0, 8)

  const getSentimentStyle = (s: number) => {
    if (s < -0.3) return { border: '1px solid #ef444433', background: 'rgba(239,68,68,0.04)' }
    if (s > 0.3)  return { border: '1px solid #10b98133', background: 'rgba(16,185,129,0.04)' }
    return { border: '1px solid #1e293b', background: 'rgba(15,23,42,0.8)' }
  }

  return (
    <>
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        @keyframes slideIn { from { transform: translateX(120%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px } ::-webkit-scrollbar-track { background: #0f172a }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px }
        @media (max-width: 1024px) {
          .dashboard-grid { grid-template-columns: 1fr !important; }
          .sidebar { order: 2 }
          .main-panel { order: 1 }
          .risk-panel { order: 3 }
        }
      `}</style>

      {/* Toast notifications */}
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.85rem',
            background: t.type === 'success' ? '#064e3b' : t.type === 'error' ? '#450a0a' : '#1e1b4b',
            border: `1px solid ${t.type === 'success' ? '#10b981' : t.type === 'error' ? '#ef4444' : '#7c3aed'}`,
            color: '#e2e8f0', animation: 'slideIn 0.3s ease', maxWidth: '320px',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
            {t.message}
          </div>
        ))}
      </div>

      {/* Trend Debug Modal */}
      {showDebug && trendDebug && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }} onClick={() => setShowDebug(false)}>
          <div style={{
            background: '#0f1729', border: '1px solid #7c3aed', borderRadius: '16px',
            padding: '1.5rem', maxWidth: '520px', width: '100%', animation: 'fadeIn 0.2s ease',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ color: '#a78bfa', margin: 0, fontSize: '1rem' }}>📊 Bollinger Band Analysis</h3>
              <button onClick={() => setShowDebug(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '1rem', fontStyle: 'italic' }}>
              {trendDebug.algorithm}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                { label: 'Z-Score', value: trendDebug.z_score?.toFixed(3), color: trendDebug.z_score > 2 ? '#ef4444' : trendDebug.z_score < -0.5 ? '#3b82f6' : '#94a3b8' },
                { label: 'Rolling Mean', value: trendDebug.rolling_mean?.toFixed(2), color: '#e2e8f0' },
                { label: 'HOT Threshold', value: trendDebug.upper_band_hot_threshold?.toFixed(2), color: '#ef4444' },
                { label: 'COOL Threshold', value: trendDebug.lower_band_cool_threshold?.toFixed(2), color: '#3b82f6' },
              ].map(item => (
                <div key={item.label} style={{ background: '#1e293b', borderRadius: '8px', padding: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem' }}>{item.label}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '700', color: item.color, fontFamily: 'monospace' }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ background: '#1e293b', borderRadius: '8px', padding: '0.75rem' }}>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{trendDebug.interpretation}</p>
            </div>
          </div>
        </div>
      )}

      <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'Georgia, serif', color: '#e2e8f0' }}>
        {/* Header */}
        <header style={{ background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '0.875rem 1.5rem' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <h1 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#e2e8f0', margin: 0 }}>
                📡 Macro Economics Tracker
              </h1>
              <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0.15rem 0 0' }}>
                AI-powered macro intelligence for asset managers
              </p>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', flex: 2, minWidth: '200px', maxWidth: '380px' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search articles, sources..."
                style={{
                  width: '100%', padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                  background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                  color: '#e2e8f0', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* API status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
              {apiStatus === 'ok'
                ? <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} /><span style={{ color: '#10b981' }}>API Connected</span></>
                : apiStatus === 'error'
                ? <><WifiOff size={12} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>API Offline</span></>
                : <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /><span style={{ color: '#f59e0b' }}>Checking...</span></>
              }
            </div>

            <button onClick={ingestNews} disabled={ingesting} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
              background: ingesting ? '#1e293b' : '#7c3aed', color: '#fff',
              border: 'none', cursor: ingesting ? 'wait' : 'pointer', fontFamily: 'inherit',
              transition: 'all 0.2s',
            }}>
              <RefreshCw size={13} style={{ animation: ingesting ? 'spin 1s linear infinite' : 'none' }} />
              {ingesting ? 'Fetching...' : 'Ingest News'}
            </button>
          </div>
        </header>

        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.25rem 1.5rem' }}>
          <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', gap: '1.25rem', alignItems: 'start' }}>

            {/* ── Themes Sidebar ─────────────────────────────────── */}
            <div className="sidebar">
              <div style={{ fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                Macro Themes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {loading ? Array(6).fill(0).map((_, i) => (
                  <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <Skeleton w="48px" h="18px" rounded="999px" />
                      <Skeleton w="60px" h="18px" rounded="999px" />
                    </div>
                    <Skeleton h="14px" />
                    <div style={{ marginTop: '0.5rem' }}><Skeleton h="32px" rounded="4px" /></div>
                  </div>
                )) : themes.map(theme => {
                  const cfg = STATUS_CONFIG[theme.status] || STATUS_CONFIG.neutral
                  const isSelected = selectedTheme?.id === theme.id
                  const sparkData = sparklines[theme.name] || []
                  return (
                    <button key={theme.id} onClick={() => setSelectedTheme(theme)} style={{
                      width: '100%', textAlign: 'left', padding: '0.875rem',
                      borderRadius: '12px', cursor: 'pointer', transition: 'all 0.15s',
                      background: isSelected ? '#1e1b4b' : 'rgba(15,23,42,0.8)',
                      border: isSelected ? `1px solid #7c3aed` : '1px solid #1e293b',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: '700', padding: '0.15rem 0.55rem', borderRadius: '999px', background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.68rem', color: '#475569' }}>{theme.article_count}</span>
                          <button
                            onClick={e => { e.stopPropagation(); fetchTrendDebug(theme.name) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: '0', display: 'flex' }}
                            title="Why this status?"
                          >
                            <Info size={11} />
                          </button>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.82rem', fontWeight: '500', color: '#e2e8f0', margin: '0 0 0.5rem' }}>{theme.name}</p>
                      {sparkData.length > 1 && <Sparkline data={sparkData} color={cfg.color} />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Main Panel ─────────────────────────────────────── */}
            <div className="main-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* Stats bar */}
              {!loading && selectedTheme && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', animation: 'fadeIn 0.3s ease' }}>
                  {[
                    { label: 'Articles Today', value: filteredArticles.filter(a => new Date(a.published_at).toDateString() === new Date().toDateString()).length },
                    { label: 'Avg Sentiment', value: filteredArticles.length ? (filteredArticles.reduce((s, a) => s + a.sentiment, 0) / filteredArticles.length).toFixed(2) : '—' },
                    { label: 'Z-Score', value: selectedTheme.trend_score?.toFixed(2) ?? '—' },
                  ].map(stat => (
                    <div key={stat.label} style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: '0.68rem', color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#e2e8f0', fontFamily: 'monospace' }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Article feed */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Newspaper size={11} />
                    {selectedTheme ? selectedTheme.name : 'All Themes'}
                    {search && <span style={{ color: '#7c3aed' }}>· "{search}"</span>}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#334155' }}>{filteredArticles.length} articles</span>
                </div>

                {loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {Array(5).fill(0).map((_, i) => (
                      <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                        <Skeleton h="16px" w="85%" />
                        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                          <Skeleton h="12px" w="60px" />
                          <Skeleton h="12px" w="80px" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredArticles.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed #334155', borderRadius: '12px' }}>
                    <p style={{ color: '#475569', margin: 0 }}>{search ? `No articles matching "${search}"` : 'No articles yet — click Ingest News to fetch the latest macro news'}</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '65vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {filteredArticles.slice(0, 20).map((article, idx) => (
                      <div key={article.id} style={{
                        padding: '0.875rem', borderRadius: '12px',
                        animation: `fadeIn 0.2s ease ${idx * 0.03}s both`,
                        ...getSentimentStyle(article.sentiment),
                      }}>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '0.88rem', fontWeight: '500', color: '#e2e8f0', margin: '0 0 0.4rem', lineHeight: 1.45 }}>{article.title}</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: '600', color: '#7c3aed' }}>{article.source}</span>
                              <span style={{ fontSize: '0.72rem', color: '#334155' }}>
                                {article.published_at ? new Date(article.published_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : ''}
                              </span>
                              <span style={{
                                fontSize: '0.68rem', fontWeight: '600', padding: '0.1rem 0.45rem', borderRadius: '999px',
                                background: article.sentiment < -0.3 ? '#ef444422' : article.sentiment > 0.3 ? '#10b98122' : '#94a3b822',
                                color: article.sentiment < -0.3 ? '#ef4444' : article.sentiment > 0.3 ? '#10b981' : '#94a3b8',
                              }}>
                                {article.sentiment < -0.3 ? '↓ Bearish' : article.sentiment > 0.3 ? '↑ Bullish' : '→ Neutral'}
                              </span>
                              {article.url && (
                                <a href={article.url} target="_blank" rel="noreferrer"
                                  style={{ fontSize: '0.72rem', color: '#3b82f6', marginLeft: 'auto', textDecoration: 'none' }}>
                                  Read →
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Risk Panel ─────────────────────────────────────── */}
            <div className="risk-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertTriangle size={11} /> Risk Implications
                </div>
                {selectedTheme && (
                  <button onClick={() => generateRisks(selectedTheme.id, selectedTheme.name)} disabled={generatingRisks}
                    style={{
                      fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '8px',
                      background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44',
                      cursor: generatingRisks ? 'wait' : 'pointer', fontFamily: 'inherit',
                    }}>
                    {generatingRisks ? '...' : '✨ Generate'}
                  </button>
                )}
              </div>

              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {Array(4).fill(0).map((_, i) => (
                    <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <Skeleton w="20px" h="20px" rounded="4px" />
                        <Skeleton w="50px" h="16px" rounded="4px" />
                      </div>
                      <Skeleton h="12px" />
                      <div style={{ marginTop: '0.35rem' }}><Skeleton h="12px" w="75%" /></div>
                    </div>
                  ))}
                </div>
              ) : themeRisks.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', border: '1px dashed #334155', borderRadius: '12px' }}>
                  <p style={{ color: '#475569', fontSize: '0.82rem', margin: 0 }}>Select a theme and click ✨ Generate to load risk analysis</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '70vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
                  {themeRisks.map((risk, idx) => (
                    <div key={risk.id} style={{
                      padding: '0.875rem', borderRadius: '12px', animation: `fadeIn 0.2s ease ${idx * 0.05}s both`,
                      background: 'rgba(15,23,42,0.8)',
                      border: `1px solid ${SEVERITY_COLOR[risk.severity]}33`,
                      borderLeft: `3px solid ${SEVERITY_COLOR[risk.severity]}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '1rem' }}>{ASSET_ICON[risk.asset_class] || '🌐'}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: '700', color: SEVERITY_COLOR[risk.severity], textTransform: 'uppercase' }}>{risk.severity}</span>
                        <span style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'capitalize' }}>{risk.asset_class}</span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55, margin: 0 }}>{risk.implication}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
