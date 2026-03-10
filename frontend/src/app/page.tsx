'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Newspaper, Search, WifiOff, X, Info } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Theme = { id: number; name: string; article_count: number; trend_score: number; status: string }
type Article = { id: number; title: string; source: string; published_at: string; theme: string; sentiment: number; url: string }
type Risk = { id: number; implication: string; asset_class: string; severity: string; theme_id: number }
type Toast = { id: number; message: string; type: 'success' | 'error' | 'info' }
type TrendDebug = { z_score: number; rolling_mean: number; upper_band_hot_threshold: number; lower_band_cool_threshold: number; interpretation: string; algorithm: string } | null

const STATUS: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  hot:     { label: 'HOT',     color: '#ef4444', bg: '#ef444422', Icon: TrendingUp },
  cool:    { label: 'COOL',    color: '#3b82f6', bg: '#3b82f622', Icon: TrendingDown },
  neutral: { label: 'NEUTRAL', color: '#94a3b8', bg: '#94a3b822', Icon: Minus },
}
const SEV_COLOR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' }
const ASSET_ICON: Record<string, string> = { equities: '📈', fx: '💱', rates: '📊', credit: '🏦', general: '🌐' }

const THEME_KEYWORDS: Record<string, string[]> = {
  'US Inflation':              ['inflation', 'cpi', 'pce', 'consumer price', 'price index', 'cost of living', 'core inflation'],
  'Federal Reserve Policy':    ['federal reserve', 'fed', 'powell', 'rate hike', 'interest rate', 'fomc', 'monetary policy', 'rate cut', 'basis points'],
  'China Economic Slowdown':   ['china', 'chinese economy', 'yuan', 'renminbi', 'beijing', 'factory output', 'caixin'],
  'Japan Yield Curve Control': ['bank of japan', 'boj', 'yield curve', 'yen', 'jgb', 'japanese bond', 'nikkei'],
  'European Energy Crisis':    ['europe energy', 'natural gas', 'lng', 'ecb', 'eurozone', 'lagarde', 'energy crisis', 'gas price'],
  'EM Currency Pressure':      ['emerging market', 'em currency', 'capital outflow', 'dollar strength', 'usd', 'em bonds', 'fx reserves'],
}
const ALL_KEYWORDS = Object.entries(THEME_KEYWORDS).flatMap(([theme, words]) => words.map(word => ({ word, theme })))

const SOURCE_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  centralbank: { label: 'Central Bank', color: '#f59e0b', icon: '🏛️' },
  regulatory:  { label: 'Regulatory',   color: '#8b5cf6', icon: '⚖️' },
  community:   { label: 'Community',    color: '#10b981', icon: '💬' },
  video:       { label: 'Video',        color: '#ef4444', icon: '▶️' },
  news:        { label: 'News',         color: '#3b82f6', icon: '📰' },
}

function Skeleton({ w = '100%', h = '1rem', r = '6px' }: { w?: string; h?: string; r?: string }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg,#1e293b 25%,#334155 50%,#1e293b 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const id = color.replace('#', 'c')
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={'url(#' + id + ')'} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function SmartSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)

  const suggestions = value.length >= 2 ? ALL_KEYWORDS.filter(k => k.word.includes(value.toLowerCase())).slice(0, 6) : []
  const showDrop = focused && (suggestions.length > 0 || !value || (value.length >= 2 && suggestions.length === 0))

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter' && activeIdx >= 0) { onChange(suggestions[activeIdx].word); setFocused(false) }
    if (e.key === 'Escape') { setFocused(false); onChange('') }
  }

  return (
    <div style={{ position: 'relative', flex: 2, minWidth: '200px', maxWidth: '420px' }}>
      <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', zIndex: 1 }} />
      <input
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); setActiveIdx(-1) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={handleKey}
        placeholder="Search by keyword, source..."
        autoComplete="off"
        style={{ width: '100%', padding: '0.5rem 2rem 0.5rem 2.25rem', background: focused ? '#1e293b' : '#1a2236', border: '1px solid ' + (focused ? '#7c3aed' : '#334155'), borderRadius: showDrop ? '8px 8px 0 0' : '8px', color: '#e2e8f0', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' }}
      />
      {value && (
        <button onMouseDown={() => { onChange(''); ref.current?.focus() }} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}>
          <X size={12} />
        </button>
      )}
      {showDrop && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9990, background: '#0f1729', border: '1px solid #7c3aed', borderTop: 'none', borderRadius: '0 0 10px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: '360px', overflowY: 'auto' }}>
          {suggestions.length > 0 && (
            <div>
              <div style={{ padding: '0.4rem 0.75rem 0.2rem', fontSize: '0.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Matching keywords</div>
              {suggestions.map((s, i) => (
                <button key={i} onMouseDown={() => { onChange(s.word); setFocused(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', background: i === activeIdx ? '#1e1b4b' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.85rem' }}>
                  <Search size={11} style={{ color: '#7c3aed', flexShrink: 0 }} />
                  <span>{s.word.split(new RegExp('(' + value + ')', 'i')).map((p, j) => p.toLowerCase() === value.toLowerCase() ? <strong key={j} style={{ color: '#a78bfa' }}>{p}</strong> : p)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#475569', whiteSpace: 'nowrap' }}>{s.theme}</span>
                </button>
              ))}
            </div>
          )}
          {value.length >= 2 && suggestions.length === 0 && (
            <div>
              <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.82rem', color: '#64748b', borderBottom: '1px solid #1e293b' }}>
                No match for <strong style={{ color: '#f59e0b' }}>"{value}"</strong> — try:
              </div>
              {Object.entries(THEME_KEYWORDS).map(([theme, words]) => (
                <div key={theme} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1e293b' }}>
                  <div style={{ fontSize: '0.65rem', color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>{theme}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {words.slice(0, 4).map(w => (
                      <button key={w} onMouseDown={() => { onChange(w); setFocused(false) }}
                        style={{ padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!value && Object.entries(THEME_KEYWORDS).map(([theme, words]) => (
            <div key={theme} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.65rem', color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>{theme}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {words.slice(0, 3).map(w => (
                  <button key={w} onMouseDown={() => { onChange(w); setFocused(false) }}
                    style={{ padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.75rem', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [genRisks, setGenRisks] = useState(false)
  const [riskSource, setRiskSource] = useState<'groq-ai' | 'static' | null>(null)

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(API + '/health', { signal: AbortSignal.timeout(3000) })
      const d = await r.json()
      setApiStatus(d.status === 'ok' ? 'ok' : 'error')
    } catch { setApiStatus('error') }
  }, [])

  const fetchSparklines = useCallback(async (list: Theme[]) => {
    const out: Record<string, number[]> = {}
    await Promise.all(list.slice(0, 6).map(async t => {
      try {
        const r = await fetch(API + '/api/themes/' + encodeURIComponent(t.name) + '/timeline')
        const d = await r.json()
        out[t.name] = d.slice(-7).map((x: any) => x.count)
      } catch { out[t.name] = [] }
    }))
    setSparklines(out)
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [t, a, r] = await Promise.all([
        fetch(API + '/api/themes/').then(r => r.json()).catch(() => []),
        fetch(API + '/api/articles/?limit=200').then(r => r.json()).catch(() => ({ articles: [] })),
        fetch(API + '/api/risks/').then(r => r.json()).catch(() => []),
      ])
      setThemes(t)
      setArticles(a.articles || [])
      setRisks(r)
      if (t.length > 0) {
        setSelectedTheme((prev: Theme | null) => prev ? t.find((x: Theme) => x.id === prev.id) || t[0] : t[0])
        fetchSparklines(t)
      }
    } catch { toast('Failed to load dashboard', 'error') }
    setLoading(false)
  }, [toast, fetchSparklines])

  useEffect(() => {
    checkHealth(); fetchAll()
    const iv = setInterval(checkHealth, 30000)
    return () => clearInterval(iv)
  }, [checkHealth, fetchAll])

  const fetchDebug = async (name: string) => {
    try {
      const r = await fetch(API + '/api/themes/' + encodeURIComponent(name) + '/trend-debug')
      setTrendDebug(await r.json()); setShowDebug(true)
    } catch { toast('Could not load trend data', 'error') }
  }

  const ingestNews = async () => {
    setIngesting(true); toast('Fetching latest macro news...', 'info')
    try {
      await fetch(API + '/api/news/ingest', { method: 'POST' })
      setTimeout(async () => { await fetchAll(); setIngesting(false); toast('News ingestion complete', 'success') }, 5000)
    } catch { setIngesting(false); toast('News ingestion failed', 'error') }
  }

  const generateRisks = async (id: number, name: string) => {
    setGenRisks(true); toast('Generating risk analysis with AI...', 'info')
    try {
      const res = await fetch(API + '/api/risks/' + id + '/generate', { method: 'POST' })
      const data = await res.json()
      setRiskSource(data.source)
      setRisks(await fetch(API + '/api/risks/').then(r => r.json()))
      const msg = data.source === 'groq-ai'
        ? 'AI-generated risks ready for ' + name
        : 'Risk implications loaded for ' + name
      toast(msg, 'success')
    } catch { toast('Risk generation failed', 'error') }
    setGenRisks(false)
  }

  const filtered = articles.filter(a => {
    const byTheme = selectedTheme ? a.theme === selectedTheme.name : true
    const bySearch = search ? a.title.toLowerCase().includes(search.toLowerCase()) || (a.source || '').toLowerCase().includes(search.toLowerCase()) : true
    return byTheme && bySearch
  })

  const themeRisks = selectedTheme ? risks.filter(r => r.theme_id === selectedTheme.id) : risks.slice(0, 8)

  const sentStyle = (s: number) => {
    if (s < -0.3) return { border: '1px solid #ef444433', background: 'rgba(239,68,68,0.04)' }
    if (s > 0.3)  return { border: '1px solid #10b98133', background: 'rgba(16,185,129,0.04)' }
    return { border: '1px solid #1e293b', background: 'rgba(15,23,42,0.8)' }
  }

  const getSourceInfo = (source: string) => {
    const match = source?.match(/^\[(\w+)\]/)
    const key = match?.[1]?.toLowerCase().replace('_', '') || 'news'
    return { cfg: SOURCE_BADGE[key] || SOURCE_BADGE.news, clean: source?.replace(/^\[\w+\]\s*/, '') || '' }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'Georgia, serif', color: '#e2e8f0' }}>

      {/* Toasts */}
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.85rem', animation: 'slideIn 0.3s ease', background: t.type === 'success' ? '#064e3b' : t.type === 'error' ? '#450a0a' : '#1e1b4b', border: '1px solid ' + (t.type === 'success' ? '#10b981' : t.type === 'error' ? '#ef4444' : '#7c3aed'), color: '#e2e8f0', maxWidth: '320px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
            {t.message}
          </div>
        ))}
      </div>

      {/* Trend Debug Modal */}
      {showDebug && trendDebug && (
        <div onClick={() => setShowDebug(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f1729', border: '1px solid #7c3aed', borderRadius: '16px', padding: '1.5rem', maxWidth: '520px', width: '100%', animation: 'fadeIn 0.2s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ color: '#a78bfa', margin: 0, fontSize: '1rem' }}>📊 Bollinger Band Analysis</h3>
              <button onClick={() => setShowDebug(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '1rem', fontStyle: 'italic' }}>{trendDebug.algorithm}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                { label: 'Z-Score',        value: trendDebug.z_score?.toFixed(3),                    color: trendDebug.z_score > 2 ? '#ef4444' : trendDebug.z_score < -0.5 ? '#3b82f6' : '#94a3b8' },
                { label: 'Rolling Mean',   value: trendDebug.rolling_mean?.toFixed(2),               color: '#e2e8f0' },
                { label: 'HOT Threshold',  value: trendDebug.upper_band_hot_threshold?.toFixed(2),   color: '#ef4444' },
                { label: 'COOL Threshold', value: trendDebug.lower_band_cool_threshold?.toFixed(2),  color: '#3b82f6' },
              ].map(item => (
                <div key={item.label} style={{ background: '#1e293b', borderRadius: '8px', padding: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem' }}>{item.label}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ background: '#1e293b', borderRadius: '8px', padding: '0.75rem' }}>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{trendDebug.interpretation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '0.875rem 1.5rem' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>📡 Macro Economics Tracker</h1>
            <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0.15rem 0 0' }}>AI-powered macro intelligence for asset managers</p>
          </div>
          <SmartSearch value={search} onChange={setSearch} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
            {apiStatus === 'ok'
              ? <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} /><span style={{ color: '#10b981' }}>API Connected</span></>
              : apiStatus === 'error'
              ? <><WifiOff size={12} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>API Offline</span></>
              : <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /><span style={{ color: '#f59e0b' }}>Checking...</span></>}
          </div>
          <button onClick={ingestNews} disabled={ingesting} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', background: ingesting ? '#1e293b' : '#7c3aed', color: '#fff', border: 'none', cursor: ingesting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            <RefreshCw size={13} className={ingesting ? 'spin' : ''} />
            {ingesting ? 'Fetching...' : 'Ingest News'}
          </button>
        </div>
      </header>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.25rem 1.5rem' }}>
        <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', gap: '1.25rem', alignItems: 'start' }}>

          {/* Sidebar */}
          <div className="sidebar">
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Macro Themes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {loading ? Array(6).fill(0).map((_, i) => (
                <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}><Skeleton w="48px" h="18px" r="999px" /><Skeleton w="60px" h="18px" r="999px" /></div>
                  <Skeleton h="14px" />
                  <div style={{ marginTop: '0.5rem' }}><Skeleton h="32px" r="4px" /></div>
                </div>
              )) : themes.map(theme => {
                const cfg = STATUS[theme.status] || STATUS.neutral
                const isSelected = selectedTheme?.id === theme.id
                return (
                  <button key={theme.id} onClick={() => setSelectedTheme(theme)} style={{ width: '100%', textAlign: 'left', padding: '0.875rem', borderRadius: '12px', cursor: 'pointer', background: isSelected ? '#1e1b4b' : 'rgba(15,23,42,0.8)', border: isSelected ? '1px solid #7c3aed' : '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.68rem', color: '#475569' }} title="Total articles in database">
                          {articles.filter(a => a.theme === theme.name).length || theme.article_count}
                        </span>
                        <button onClick={e => { e.stopPropagation(); fetchDebug(theme.name) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 0, display: 'flex' }} title="Why this status?"><Info size={11} /></button>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#e2e8f0', margin: '0 0 0.5rem' }}>{theme.name}</p>
                    {(sparklines[theme.name] || []).length > 1 && <Sparkline data={sparklines[theme.name]} color={cfg.color} />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Main Panel */}
          <div className="main-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!loading && selectedTheme && (() => {
              const bullish  = filtered.filter(a => a.sentiment >  0.3).length
              const bearish  = filtered.filter(a => a.sentiment < -0.3).length
              const neutral  = filtered.length - bullish - bearish
              const total    = filtered.length || 1
              const bullPct  = Math.round((bullish / total) * 100)
              const bearPct  = Math.round((bearish / total) * 100)
              const neutPct  = 100 - bullPct - bearPct
              const avgSent  = filtered.length ? filtered.reduce((s, a) => s + a.sentiment, 0) / filtered.length : 0
              const sentLabel = avgSent < -0.2 ? 'Bearish' : avgSent > 0.2 ? 'Bullish' : 'Neutral'
              const sentColor = avgSent < -0.2 ? '#ef4444' : avgSent > 0.2 ? '#10b981' : '#94a3b8'
              const articlesToday = filtered.filter(a => new Date(a.published_at).toDateString() === new Date().toDateString()).length
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', animation: 'fadeIn 0.3s ease' }}>
                  {/* Top stat row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem' }}>
                    {[
                      { label: 'Articles Today', value: articlesToday, color: '#e2e8f0' },
                      { label: 'Sentiment',      value: sentLabel,     color: sentColor  },
                      { label: 'Z-Score',        value: selectedTheme.trend_score?.toFixed(2) ?? '—', color: '#e2e8f0' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '0.68rem', color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Sentiment distribution bar */}
                  {filtered.length > 0 && (
                    <div style={{ padding: '0.875rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                        <span style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                          Sentiment Distribution — ML Pipeline Output
                        </span>
                        <span style={{ fontSize: '0.68rem', color: '#475569' }}>{filtered.length} articles analysed</span>
                      </div>

                      {/* Stacked bar */}
                      <div style={{ display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden', gap: '1px', marginBottom: '0.6rem' }}>
                        {bullPct > 0 && (
                          <div style={{ width: bullPct + '%', background: 'linear-gradient(90deg, #10b981, #34d399)', borderRadius: bullPct === 100 ? '999px' : '999px 0 0 999px', transition: 'width 0.6s ease' }} title={bullPct + '% Bullish'} />
                        )}
                        {neutPct > 0 && (
                          <div style={{ width: neutPct + '%', background: '#334155', transition: 'width 0.6s ease' }} title={neutPct + '% Neutral'} />
                        )}
                        {bearPct > 0 && (
                          <div style={{ width: bearPct + '%', background: 'linear-gradient(90deg, #f97316, #ef4444)', borderRadius: bearPct === 100 ? '999px' : '0 999px 999px 0', transition: 'width 0.6s ease' }} title={bearPct + '% Bearish'} />
                        )}
                      </div>

                      {/* Legend */}
                      <div style={{ display: 'flex', gap: '1.25rem' }}>
                        {[
                          { label: 'Bullish',  pct: bullPct,  count: bullish, color: '#10b981' },
                          { label: 'Neutral',  pct: neutPct,  count: neutral, color: '#64748b' },
                          { label: 'Bearish',  pct: bearPct,  count: bearish, color: '#ef4444' },
                        ].map(item => (
                          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                            <span style={{ fontSize: '0.72rem', color: item.color, fontWeight: 600 }}>{item.pct}%</span>
                            <span style={{ fontSize: '0.72rem', color: '#475569' }}>{item.label}</span>
                            <span style={{ fontSize: '0.68rem', color: '#334155' }}>({item.count})</span>
                          </div>
                        ))}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.68rem', color: '#475569' }}>avg score:</span>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: sentColor, fontFamily: 'monospace' }}>{avgSent.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Newspaper size={11} />
                  {selectedTheme ? selectedTheme.name : 'All Themes'}
                  {search && <span style={{ color: '#7c3aed' }}>· "{search}"</span>}
                </div>
                <span style={{ fontSize: '0.72rem', color: '#334155' }}>{filtered.length} articles</span>
              </div>

              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {Array(5).fill(0).map((_, i) => (
                    <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                      <Skeleton h="16px" w="85%" />
                      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}><Skeleton h="12px" w="60px" /><Skeleton h="12px" w="80px" /></div>
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', border: '1px dashed #334155', borderRadius: '12px' }}>
                  {search ? (
                    <div>
                      <p style={{ color: '#64748b', margin: '0 0 1rem', fontSize: '0.9rem' }}>No articles matching <strong style={{ color: '#f59e0b' }}>"{search}"</strong></p>
                      <p style={{ color: '#475569', margin: '0 0 0.75rem', fontSize: '0.78rem' }}>Try a recognised keyword:</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' }}>
                        {(THEME_KEYWORDS[selectedTheme?.name || ''] || Object.values(THEME_KEYWORDS).flat()).slice(0, 8).map(w => (
                          <button key={w} onClick={() => setSearch(w)} style={{ padding: '0.25rem 0.65rem', borderRadius: '999px', fontSize: '0.78rem', background: '#1e293b', border: '1px solid #7c3aed44', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit' }}>{w}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: '#475569', margin: 0 }}>No articles yet — click <strong style={{ color: '#7c3aed' }}>Ingest News</strong> to fetch the latest macro news</p>
                  )}
                </div>
              ) : (
                <div>
                  {/* Source diversity bar */}
                  {(() => {
                    const counts: Record<string, number> = {}
                    filtered.forEach(a => {
                      const key = (a.source?.match(/^\[(\w+)\]/)?.[1] || 'NEWS').toLowerCase().replace('_', '')
                      counts[key] = (counts[key] || 0) + 1
                    })
                    return (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(15,23,42,0.6)', borderRadius: '8px', border: '1px solid #1e293b' }}>
                        <span style={{ fontSize: '0.65rem', color: '#475569', alignSelf: 'center', marginRight: '0.25rem' }}>SOURCES:</span>
                        {Object.entries(counts).map(([type, count]) => {
                          const b = SOURCE_BADGE[type] || SOURCE_BADGE.news
                          return <span key={type} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: b.color + '22', color: b.color }}>{b.icon} {b.label} <strong>{count}</strong></span>
                        })}
                      </div>
                    )
                  })()}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {filtered.slice(0, 30).map((article, idx) => {
                      const { cfg, clean } = getSourceInfo(article.source)
                      return (
                        <div key={article.id} style={{ padding: '0.875rem', borderRadius: '12px', animation: 'fadeIn 0.2s ease', animationDelay: (idx * 0.03) + 's', animationFillMode: 'both', ...sentStyle(article.sentiment) }}>
                          <p style={{ fontSize: '0.88rem', fontWeight: 500, color: '#e2e8f0', margin: '0 0 0.4rem', lineHeight: 1.45 }}>{article.title.replace(/^\[VIDEO\]\s*/, '')}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '999px', background: cfg.color + '22', color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed' }}>{clean}</span>
                            <span style={{ fontSize: '0.72rem', color: '#334155' }}>{article.published_at ? new Date(article.published_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : ''}</span>
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.45rem', borderRadius: '999px', background: article.sentiment < -0.3 ? '#ef444422' : article.sentiment > 0.3 ? '#10b98122' : '#94a3b822', color: article.sentiment < -0.3 ? '#ef4444' : article.sentiment > 0.3 ? '#10b981' : '#94a3b8' }}>
                              {article.sentiment < -0.3 ? '↓ Bearish' : article.sentiment > 0.3 ? '↑ Bullish' : '→ Neutral'}
                            </span>
                            {article.url && <a href={article.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#3b82f6', marginLeft: 'auto', textDecoration: 'none' }}>Read →</a>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Risk Panel */}
          <div className="risk-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangle size={11} /> Risk Implications
                {riskSource === 'groq-ai' && (
                  <span style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44', fontWeight: 700 }}>✨ AI</span>
                )}
              </div>
              {selectedTheme && (
                <button onClick={() => generateRisks(selectedTheme.id, selectedTheme.name)} disabled={genRisks}
                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '8px', background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', cursor: genRisks ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  {genRisks ? '...' : '✨ Generate'}
                </button>
              )}
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {Array(4).fill(0).map((_, i) => (
                  <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}><Skeleton w="20px" h="20px" r="4px" /><Skeleton w="50px" h="16px" r="4px" /></div>
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
                  <div key={risk.id} style={{ padding: '0.875rem', borderRadius: '12px', animation: 'fadeIn 0.2s ease', animationDelay: (idx * 0.05) + 's', animationFillMode: 'both', background: 'rgba(15,23,42,0.8)', border: '1px solid ' + SEV_COLOR[risk.severity] + '33', borderLeft: '3px solid ' + SEV_COLOR[risk.severity] }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '1rem' }}>{ASSET_ICON[risk.asset_class] || '🌐'}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: SEV_COLOR[risk.severity], textTransform: 'uppercase' }}>{risk.severity}</span>
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
  )
}
