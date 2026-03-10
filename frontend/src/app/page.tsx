'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Newspaper, Search, WifiOff, X, Info, BarChart2, Clock } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Theme = { id: number; name: string; article_count: number; trend_score: number; status: string }
type Article = { id: number; title: string; source: string; published_at: string; theme: string; sentiment: number; url: string }
type Risk = { id: number; implication: string; asset_class: string; severity: string; theme_id: number; sources_json?: string; confidence?: number }
type Toast = { id: number; message: string; type: 'success' | 'error' | 'info' }
type TrendDebug = { z_score: number; rolling_mean: number; upper_band_hot_threshold: number; lower_band_cool_threshold: number; interpretation: string; algorithm: string } | null
type TimelinePoint = { date: string; count: number; sentiment: number }

const STATUS: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  hot:     { label: 'HOT',     color: '#ef4444', bg: '#ef444422', Icon: TrendingUp },
  cool:    { label: 'COOL',    color: '#3b82f6', bg: '#3b82f622', Icon: TrendingDown },
  neutral: { label: 'NEUTRAL', color: '#94a3b8', bg: '#94a3b822', Icon: Minus },
}
const SEV_COLOR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' }
const ASSET_ICON: Record<string, string> = { equities: '📈', fx: '💱', rates: '📊', credit: '🏦', general: '🌐' }

const THEME_CORRELATIONS: Record<string, {theme: string; correlation: number; reason: string}[]> = {
  'European Energy Crisis': [
    { theme: 'US Inflation',            correlation: +0.7, reason: 'Energy prices feed global CPI' },
    { theme: 'EM Currency Pressure',    correlation: +0.6, reason: 'Dollar strengthens on Europe stress' },
    { theme: 'Federal Reserve Policy',  correlation: +0.5, reason: 'Global inflation pressures Fed' },
  ],
  'US Inflation': [
    { theme: 'Federal Reserve Policy',  correlation: +0.9, reason: 'Inflation drives Fed decisions' },
    { theme: 'EM Currency Pressure',    correlation: +0.6, reason: 'High US rates strengthen dollar' },
    { theme: 'European Energy Crisis',  correlation: +0.7, reason: 'Energy prices feed global CPI' },
  ],
  'Federal Reserve Policy': [
    { theme: 'US Inflation',            correlation: +0.9, reason: 'Inflation drives Fed decisions' },
    { theme: 'EM Currency Pressure',    correlation: +0.7, reason: 'Rate hikes pressure EM currencies' },
    { theme: 'China Economic Slowdown', correlation: -0.4, reason: 'China eases as US tightens' },
  ],
  'China Economic Slowdown': [
    { theme: 'EM Currency Pressure',    correlation: +0.6, reason: 'China slowdown hits EM exports' },
    { theme: 'Federal Reserve Policy',  correlation: -0.4, reason: 'China eases as US tightens' },
    { theme: 'European Energy Crisis',  correlation: -0.3, reason: 'China slowdown reduces energy demand' },
  ],
  'EM Currency Pressure': [
    { theme: 'Federal Reserve Policy',  correlation: +0.7, reason: 'Rate hikes strengthen dollar' },
    { theme: 'China Economic Slowdown', correlation: +0.6, reason: 'China slowdown hits EM exports' },
    { theme: 'US Inflation',            correlation: +0.6, reason: 'High US rates strengthen dollar' },
  ],
}

const THEME_KEYWORDS: Record<string, string[]> = {
  'US Inflation':              ['inflation', 'cpi', 'pce', 'consumer price', 'price index', 'cost of living', 'core inflation'],
  'Federal Reserve Policy':    ['federal reserve', 'fed', 'powell', 'rate hike', 'interest rate', 'fomc', 'monetary policy', 'rate cut', 'basis points'],
  'China Economic Slowdown':   ['china', 'chinese economy', 'yuan', 'renminbi', 'beijing', 'factory output', 'caixin'],
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

function SmartSearch({ value, onChange, onThemeSwitch }: { value: string; onChange: (v: string) => void; onThemeSwitch: (theme: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)

  const suggestions = value.length >= 2 ? ALL_KEYWORDS.filter(k => k.word.includes(value.toLowerCase())).slice(0, 6) : []
  const showDrop = focused && (suggestions.length > 0 || !value || (value.length >= 2 && suggestions.length === 0))

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter' && activeIdx >= 0) {
      const s = suggestions[activeIdx]; onChange(s.word); onThemeSwitch(s.theme); setFocused(false)
    } else if (e.key === 'Escape') { setFocused(false); onChange('') }
  }

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: '420px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.875rem', borderRadius: '10px', background: '#1e293b', border: '1px solid ' + (focused ? '#7c3aed' : '#334155') }}>
        <Search size={13} style={{ color: '#475569', flexShrink: 0 }} />
        <input ref={ref} value={value} onChange={e => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} onKeyDown={handleKey}
          placeholder="Search by keyword, source..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.82rem', color: '#e2e8f0', fontFamily: 'Georgia, serif' }} />
        {value && <button onMouseDown={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', padding: 0 }}><X size={12} /></button>}
      </div>
      {showDrop && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#0f1729', border: '1px solid #334155', borderRadius: '10px', zIndex: 999, maxHeight: '300px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          {suggestions.map((s, i) => (
            <div key={i} onMouseDown={() => { onChange(s.word); onThemeSwitch(s.theme); setFocused(false) }}
              style={{ padding: '0.5rem 0.875rem', cursor: 'pointer', background: i === activeIdx ? '#1e293b' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>{s.word}</span>
              <span style={{ fontSize: '0.65rem', color: '#475569', background: '#1e293b', padding: '0.1rem 0.4rem', borderRadius: '999px' }}>{s.theme.replace(' Policy','').replace(' Crisis','')}</span>
            </div>
          ))}
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

// ── Timeline Chart Component ──────────────────────────────────────────────────
function TimelineChart({ data, themeName }: { data: TimelinePoint[]; themeName: string }) {
  const [hover, setHover] = useState<TimelinePoint | null>(null)
  if (!data.length) return (
    <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#475569', fontSize: '0.82rem' }}>
      No historical data yet — ingest news to start building your timeline
    </div>
  )

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Article volume bar chart */}
      <div style={{ padding: '0.875rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>📰 Article Volume — 14-day window</span>
          <span style={{ color: '#334155' }}>Bollinger Band anomaly detection</span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: '#0f1729', border: '1px solid #334155', borderRadius: '8px', fontSize: '0.75rem' }}
              formatter={(v: any) => [v + ' articles', 'Volume']}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.count >= maxCount * 0.8 ? '#ef4444' : entry.count >= maxCount * 0.5 ? '#f59e0b' : '#334155'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem' }}>
          {[['#ef4444','High volume (HOT signal)'],['#f59e0b','Elevated'],['#334155','Normal']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '2px', background: c }} />
              <span style={{ fontSize: '0.62rem', color: '#475569' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sentiment trend line */}
      <div style={{ padding: '0.875rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>📉 Sentiment Trend — ML Pipeline Output</span>
          <span style={{ color: '#334155' }}>avg score per day</span>
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
            <YAxis hide domain={[-1, 1]} />
            <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{ background: '#0f1729', border: '1px solid #334155', borderRadius: '8px', fontSize: '0.75rem' }}
              formatter={(v: any) => {
                const val = parseFloat(v)
                return [val.toFixed(2) + (val < -0.25 ? ' 🔴 Bearish' : val > 0.25 ? ' 🟢 Bullish' : ' ⚪ Neutral'), 'Avg Sentiment']
              }}
            />
            <Line type="monotone" dataKey="sentiment" stroke="#7c3aed" strokeWidth={2} dot={{ fill: '#7c3aed', r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem' }}>
          {[['#10b981','> 0 Bullish'],['#94a3b8','≈ 0 Neutral'],['#ef4444','< 0 Bearish']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: 8, height: 2, background: c }} />
              <span style={{ fontSize: '0.62rem', color: '#475569' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
        {[
          { label: 'Peak Day',    value: data.reduce((a, b) => b.count > a.count ? b : a, data[0])?.date || '—', sub: data.reduce((a, b) => b.count > a.count ? b : a, data[0])?.count + ' articles', color: '#ef4444' },
          { label: 'Total Articles', value: data.reduce((s, d) => s + d.count, 0), sub: 'over ' + data.length + ' days tracked', color: '#e2e8f0' },
          { label: 'Avg Sentiment', value: (data.reduce((s, d) => s + d.sentiment, 0) / data.length).toFixed(2), sub: data.reduce((s, d) => s + d.sentiment, 0) / data.length < -0.1 ? 'Broadly Bearish' : 'Broadly Neutral', color: data.reduce((s, d) => s + d.sentiment, 0) / data.length < -0.1 ? '#ef4444' : '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.62rem', color: '#475569', textTransform: 'uppercase', marginBottom: '0.25rem' }}>{s.label}</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
            <div style={{ fontSize: '0.62rem', color: '#334155', marginTop: '0.1rem' }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [themes, setThemes]               = useState<Theme[]>([])
  const [articles, setArticles]           = useState<Article[]>([])
  const [risks, setRisks]                 = useState<Risk[]>([])
  const [sparklines, setSparklines]       = useState<Record<string, number[]>>({})
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null)
  const [search, setSearch]               = useState('')
  const [loading, setLoading]             = useState(true)
  const [ingesting, setIngesting]         = useState(false)
  const [apiStatus, setApiStatus]         = useState<'ok' | 'error' | 'checking'>('checking')
  const [toasts, setToasts]               = useState<Toast[]>([])
  const [trendDebug, setTrendDebug]       = useState<TrendDebug>(null)
  const [showDebug, setShowDebug]         = useState(false)
  const [genRisks, setGenRisks]           = useState(false)
  const [riskSource, setRiskSource]       = useState<'groq-ai' | 'static' | null>(null)
  const [activeTab, setActiveTab]         = useState<'feed' | 'timeline'>('feed')
  const [timelineData, setTimelineData]   = useState<TimelinePoint[]>([])
  const [themeSentiments, setThemeSentiments] = useState<Record<string, {label: string; color: string}>>({})

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
        fetchThemeSentiments(t)
      }
    } catch { toast('Failed to load dashboard', 'error') }
    setLoading(false)
  }, [toast, fetchSparklines, fetchThemeSentiments])

  const fetchTimeline = useCallback(async (name: string) => {
    try {
      const r = await fetch(API + '/api/themes/' + encodeURIComponent(name) + '/timeline')
      const d = await r.json()
      setTimelineData(d.slice(-14).map((x: any) => ({
        date: new Date(x.date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }),
        count: x.count,
        sentiment: parseFloat((x.sentiment || 0).toFixed(2)),
      })))
    } catch { setTimelineData([]) }
  }, [])

  // Fetch full sentiment for each theme (not limited by 200-article slice)
  const fetchThemeSentiments = useCallback(async (themeList: Theme[]) => {
    const out: Record<string, {label: string; color: string}> = {}
    await Promise.all(themeList.map(async t => {
      try {
        const r = await fetch(API + '/api/articles/?theme=' + encodeURIComponent(t.name) + '&limit=200')
        const d = await r.json()
        const arts: Article[] = d.articles || []
        if (!arts.length) { out[t.name] = { label: '→ Neutral', color: '#475569' }; return }
        const avg = arts.reduce((s, a) => s + a.sentiment, 0) / arts.length
        const bearPct = Math.round((arts.filter(a => a.sentiment < -0.3).length / arts.length) * 100)
        const bullPct = Math.round((arts.filter(a => a.sentiment >  0.3).length / arts.length) * 100)
        const sent = (bearPct > 35 || avg < -0.25) ? 'Bearish' : (bullPct > 35 || avg > 0.25) ? 'Bullish' : 'Neutral'
        out[t.name] = {
          label: sent === 'Bearish' ? '↓ Bearish' : sent === 'Bullish' ? '↑ Bullish' : '→ Neutral',
          color: sent === 'Bearish' ? '#ef4444' : sent === 'Bullish' ? '#10b981' : '#475569'
        }
      } catch { out[t.name] = { label: '→ Neutral', color: '#475569' } }
    }))
    setThemeSentiments(out)
  }, [])

  useEffect(() => {
    checkHealth(); fetchAll()
    const iv = setInterval(checkHealth, 30000)
    return () => clearInterval(iv)
  }, [checkHealth, fetchAll])

  useEffect(() => {
    if (selectedTheme) { fetchTimeline(selectedTheme.name); setActiveTab('feed') }
  }, [selectedTheme, fetchTimeline])

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
      toast(data.source === 'groq-ai' ? 'AI-generated risks ready for ' + name : 'Risk implications loaded for ' + name, 'success')
    } catch { toast('Risk generation failed', 'error') }
    setGenRisks(false)
  }

  // Smart search: auto-switch theme
  useEffect(() => {
    if (!search || search.length < 3) return
    const sl = search.toLowerCase()
    for (const [themeName, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(k => k.includes(sl) || sl.includes(k))) {
        const match = themes.find(t => t.name === themeName)
        if (match && match.id !== selectedTheme?.id) setSelectedTheme(match)
        return
      }
    }
    const counts: Record<string, number> = {}
    articles.forEach(a => { if (a.title.toLowerCase().includes(sl)) counts[a.theme] = (counts[a.theme] || 0) + 1 })
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    if (best) { const match = themes.find(t => t.name === best[0]); if (match && match.id !== selectedTheme?.id) setSelectedTheme(match) }
  }, [search])

  const searchLower  = search.toLowerCase()
  const activeTheme  = selectedTheme
  const filtered     = articles.filter(a => {
    const byTheme  = activeTheme ? a.theme === activeTheme.name : true
    const bySearch = search ? a.title.toLowerCase().includes(searchLower) || (a.source || '').toLowerCase().includes(searchLower) : true
    return byTheme && bySearch
  })
  const themeRisks   = selectedTheme ? risks.filter(r => r.theme_id === selectedTheme.id) : risks.slice(0, 8)

  const sentStyle = (s: number) => {
    if (s < -0.3) return { border: '1px solid #ef444433', background: 'rgba(239,68,68,0.04)' }
    if (s > 0.3)  return { border: '1px solid #10b98133', background: 'rgba(16,185,129,0.04)' }
    return { border: '1px solid #1e293b', background: 'rgba(15,23,42,0.8)' }
  }
  const getSourceInfo = (source: string) => {
    const match = source?.match(/^\[(\w+)\]/)
    const key   = match?.[1]?.toLowerCase().replace('_', '') || 'news'
    return { cfg: SOURCE_BADGE[key] || SOURCE_BADGE.news, clean: source?.replace(/^\[\w+\]\s*/, '') || '' }
  }

  // Stats computation
  const bullish     = filtered.filter(a => a.sentiment >  0.3).length
  const bearish     = filtered.filter(a => a.sentiment < -0.3).length
  const neutral     = filtered.length - bullish - bearish
  const total       = filtered.length || 1
  const bullPct     = Math.round((bullish / total) * 100)
  const bearPct     = Math.round((bearish / total) * 100)
  const neutPct     = 100 - bullPct - bearPct
  const avgSent     = filtered.length ? filtered.reduce((s, a) => s + a.sentiment, 0) / filtered.length : 0
  const sentLabel   = (bearPct > 35 || avgSent < -0.25) ? 'Bearish' : (bullPct > 35 || avgSent > 0.25) ? 'Bullish' : 'Neutral'
  const sentColor   = sentLabel === 'Bearish' ? '#ef4444' : sentLabel === 'Bullish' ? '#10b981' : '#94a3b8'
  const articlesToday = filtered.filter(a => new Date(a.published_at).toDateString() === new Date().toDateString()).length
  const latestDate  = filtered.length ? new Date(Math.max(...filtered.map(a => new Date(a.published_at).getTime()))) : null

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

      {/* Bollinger Band Debug Modal */}
      {showDebug && trendDebug && (() => {
        const z = trendDebug.z_score
        const mean = trendDebug.rolling_mean
        const hot  = trendDebug.upper_band_hot_threshold
        const cool = trendDebug.lower_band_cool_threshold
        const status = z > 1 ? 'HOT' : z < -0.3 ? 'COOL' : 'NEUTRAL'
        const statusColor = status === 'HOT' ? '#ef4444' : status === 'COOL' ? '#3b82f6' : '#94a3b8'
        return (
          <div onClick={() => setShowDebug(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#0f1729', border: '1px solid #7c3aed', borderRadius: '16px', padding: '1.5rem', maxWidth: '540px', width: '100%', animation: 'fadeIn 0.2s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <h3 style={{ color: '#a78bfa', margin: '0 0 0.25rem', fontSize: '1rem' }}>📊 Why is this theme <span style={{ color: statusColor }}>{status}</span>?</h3>
                  <p style={{ color: '#475569', fontSize: '0.72rem', margin: 0 }}>Bollinger Band anomaly detection — same method as FT trending topics</p>
                </div>
                <button onClick={() => setShowDebug(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              <div style={{ background: status === 'HOT' ? '#ef444411' : status === 'COOL' ? '#3b82f611' : '#94a3b811', border: '1px solid ' + statusColor + '44', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                <p style={{ color: '#e2e8f0', fontSize: '0.88rem', lineHeight: 1.65, margin: 0 }}>
                  {status === 'HOT'     && <>This theme is receiving <strong style={{ color: '#ef4444' }}>{z.toFixed(1)}× more coverage than usual</strong>. The 14-day average is <strong>{mean.toFixed(1)} articles/day</strong> — today crossed the HOT threshold of <strong>{hot.toFixed(1)} articles/day</strong>, signalling an anomalous media spike asset managers should monitor.</>}
                  {status === 'COOL'    && <>This theme is receiving <strong style={{ color: '#3b82f6' }}>less coverage than usual</strong>. The 14-day average is <strong>{mean.toFixed(1)} articles/day</strong> — today dropped below the COOL threshold of <strong>{cool.toFixed(1)} articles/day</strong>, suggesting the theme is fading from market attention.</>}
                  {status === 'NEUTRAL' && <>This theme is receiving <strong style={{ color: '#94a3b8' }}>normal levels of coverage</strong>. The 14-day average is <strong>{mean.toFixed(1)} articles/day</strong>. Today's volume is within the expected range ({cool.toFixed(1)} – {hot.toFixed(1)} articles/day).</>}
                </p>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#475569', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>How it's calculated</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Z-Score (today vs history)', value: z.toFixed(2),    color: statusColor },
                  { label: '14-day avg (articles/day)',  value: mean.toFixed(2), color: '#e2e8f0' },
                  { label: 'HOT threshold (μ + 1σ)',     value: hot.toFixed(2),  color: '#ef4444' },
                  { label: 'COOL threshold (μ − 0.3σ)',  value: cool.toFixed(2), color: '#3b82f6' },
                ].map(item => (
                  <div key={item.label} style={{ background: '#1e293b', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.25rem' }}>{item.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#1e293b', borderRadius: '8px', padding: '0.875rem' }}>
                <div style={{ fontSize: '0.68rem', color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Volume band (14-day window)</div>
                <div style={{ position: 'relative', height: '8px', background: '#0f172a', borderRadius: '999px', marginBottom: '0.5rem' }}>
                  <div style={{ position: 'absolute', left: '20%', right: '20%', top: 0, bottom: 0, background: '#1e3a2f', borderRadius: '999px' }} />
                  <div style={{ position: 'absolute', left: '20%', width: '2px', top: '-3px', bottom: '-3px', background: '#3b82f6' }} />
                  <div style={{ position: 'absolute', right: '20%', width: '2px', top: '-3px', bottom: '-3px', background: '#ef4444' }} />
                  <div style={{ position: 'absolute', left: '50%', width: '2px', top: '-3px', bottom: '-3px', background: '#475569' }} />
                  <div style={{ position: 'absolute', left: Math.min(95, Math.max(2, 50 + z * 15)) + '%', width: '10px', height: '10px', borderRadius: '50%', background: statusColor, top: '-1px', transform: 'translateX(-50%)', boxShadow: '0 0 6px ' + statusColor }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#475569' }}>
                  <span style={{ color: '#3b82f6' }}>← COOL ({cool.toFixed(1)})</span>
                  <span>NEUTRAL ZONE</span>
                  <span style={{ color: '#ef4444' }}>HOT ({hot.toFixed(1)}) →</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Header */}
      <header style={{ background: '#0f1729', borderBottom: '1px solid #1e293b', padding: '0.875rem 1.5rem' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>📡 Macro Economics Tracker</h1>
            <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0.15rem 0 0' }}>AI-powered macro intelligence for asset managers</p>
          </div>
          <SmartSearch value={search} onChange={v => setSearch(v)} onThemeSwitch={name => { const t = themes.find(th => th.name === name); if (t) setSelectedTheme(t) }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
            {apiStatus === 'ok'    ? <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} /><span style={{ color: '#10b981' }}>API Connected</span></> : null}
            {apiStatus === 'error' ? <><WifiOff size={12} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>API Offline</span></> : null}
            {apiStatus === 'checking' ? <><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /><span style={{ color: '#f59e0b' }}>Checking...</span></> : null}
          </div>
          <button onClick={ingestNews} disabled={ingesting} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', background: ingesting ? '#1e293b' : '#7c3aed', color: '#fff', border: 'none', cursor: ingesting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            <RefreshCw size={13} className={ingesting ? 'spin' : ''} />
            {ingesting ? 'Fetching...' : 'Ingest News'}
          </button>
        </div>
      </header>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.25rem 1.5rem' }}>
        <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', gap: '1.25rem', alignItems: 'start' }}>

          {/* Sidebar — Theme list */}
          <div className="sidebar">
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Macro Themes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {loading ? Array(5).fill(0).map((_, i) => (
                <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}><Skeleton w="48px" h="18px" r="999px" /><Skeleton w="60px" h="18px" r="999px" /></div>
                  <Skeleton h="14px" />
                  <div style={{ marginTop: '0.5rem' }}><Skeleton h="32px" r="4px" /></div>
                </div>
              )) : themes.map(theme => {
                const cfg = STATUS[theme.status] || STATUS.neutral
                const isSelected = selectedTheme?.id === theme.id
                const themeArticles = articles.filter(a => a.theme === theme.name)
                // Use pre-fetched per-theme sentiment (full dataset, not truncated 200-slice)
                const sentInfo = themeSentiments[theme.name] || { label: '→ Neutral', color: '#475569' }
                const themeSentLabel = sentInfo.label
                const themeSentColor = sentInfo.color
                return (
                  <button key={theme.id} onClick={() => setSelectedTheme(theme)} style={{ width: '100%', textAlign: 'left', padding: '0.875rem', borderRadius: '12px', cursor: 'pointer', background: isSelected ? '#1e1b4b' : 'rgba(15,23,42,0.8)', border: isSelected ? '1px solid #7c3aed' : '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.62rem', color: themeSentColor, fontWeight: 600 }}>{themeSentLabel}</span>
                        <span style={{ fontSize: '0.68rem', color: '#475569' }}>{themeArticles.length || theme.article_count}</span>
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
            {!loading && selectedTheme && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', animation: 'fadeIn 0.3s ease' }}>

                {/* Top stat row — 4 cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.6rem' }}>
                  {[
                    { label: 'Articles Today', value: articlesToday > 0 ? String(articlesToday) : '0', sub: articlesToday === 0 && latestDate ? 'Last: ' + latestDate.toLocaleDateString('en-SG', { day:'numeric', month:'short' }) : articlesToday > 0 ? 'ingested today' : 'Run Ingest News', color: articlesToday > 0 ? '#e2e8f0' : '#475569' },
                    { label: 'Total Articles',  value: String(filtered.length),  sub: selectedTheme.name.replace(' Slowdown','').replace(' Crisis',''), color: '#e2e8f0' },
                    { label: 'Sentiment',       value: sentLabel,                 sub: 'avg ' + avgSent.toFixed(2), color: sentColor },
                    { label: 'Z-Score',         value: selectedTheme.trend_score?.toFixed(2) ?? '—', sub: (STATUS[selectedTheme.status] || STATUS.neutral).label + ' trend', color: (STATUS[selectedTheme.status] || STATUS.neutral).color },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: '0.62rem', color: '#475569', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                      <div style={{ fontSize: '0.62rem', color: '#334155', marginTop: '0.15rem' }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Sentiment distribution bar */}
                {filtered.length > 0 && (
                  <div style={{ padding: '0.875rem 1rem', borderRadius: '10px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Sentiment Distribution — ML Pipeline Output</span>
                      <span style={{ fontSize: '0.68rem', color: '#475569' }}>{filtered.length} articles analysed</span>
                    </div>

                    {/* Correlated themes row */}
                    {(() => {
                      const corrs = THEME_CORRELATIONS[selectedTheme?.name || ''] || []
                      if (!corrs.length) return null
                      return (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>🔗 Correlated:</span>
                          {corrs.map(c => {
                            const isPos = c.correlation > 0
                            const col = isPos ? '#f59e0b' : '#3b82f6'
                            return (
                              <button key={c.theme} onClick={() => { const t = themes.find(th => th.name === c.theme); if (t) setSelectedTheme(t) }} title={c.reason}
                                style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: col + '15', color: col, border: '1px solid ' + col + '44', cursor: 'pointer', fontFamily: 'inherit' }}>
                                {c.theme.replace(' Policy','').replace(' Crisis','').replace(' Pressure','').replace(' Slowdown','')}
                                <span style={{ fontWeight: 700, marginLeft: '0.25rem' }}>{isPos ? '+' : ''}{c.correlation.toFixed(1)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* Stacked bar */}
                    <div style={{ display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden', gap: '1px', marginBottom: '0.5rem' }}>
                      {bullPct > 0 && <div style={{ width: bullPct + '%', background: 'linear-gradient(90deg,#10b981,#34d399)', transition: 'width 0.6s ease' }} title={bullPct + '% Bullish'} />}
                      {neutPct > 0 && <div style={{ width: neutPct + '%', background: '#334155', transition: 'width 0.6s ease' }} title={neutPct + '% Neutral'} />}
                      {bearPct > 0 && <div style={{ width: bearPct + '%', background: 'linear-gradient(90deg,#f97316,#ef4444)', transition: 'width 0.6s ease' }} title={bearPct + '% Bearish'} />}
                    </div>
                    <div style={{ display: 'flex', gap: '1.25rem' }}>
                      {[{ label:'Bullish', pct:bullPct, count:bullish, color:'#10b981' },{ label:'Neutral', pct:neutPct, count:neutral, color:'#64748b' },{ label:'Bearish', pct:bearPct, count:bearish, color:'#ef4444' }].map(item => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                          <span style={{ fontSize: '0.72rem', color: item.color, fontWeight: 600 }}>{item.pct}%</span>
                          <span style={{ fontSize: '0.72rem', color: '#475569' }}>{item.label}</span>
                          <span style={{ fontSize: '0.68rem', color: '#334155' }}>({item.count})</span>
                        </div>
                      ))}
                      <div style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#475569' }}>avg: <span style={{ color: sentColor, fontWeight: 700, fontFamily: 'monospace' }}>{avgSent.toFixed(2)}</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab bar */}
            {!loading && selectedTheme && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0', borderRadius: '8px', overflow: 'hidden', border: '1px solid #1e293b' }}>
                    {([['feed', Newspaper, 'News Feed'], ['timeline', BarChart2, '14-Day History']] as const).map(([tab, Icon, label]) => (
                      <button key={tab} onClick={() => setActiveTab(tab as any)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.875rem', fontSize: '0.75rem', background: activeTab === tab ? '#7c3aed' : 'rgba(15,23,42,0.8)', color: activeTab === tab ? '#fff' : '#475569', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <Icon size={12} />{label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Newspaper size={11} />{selectedTheme ? selectedTheme.name : 'All Themes'}{search && <span style={{ color: '#7c3aed' }}>· "{search}"</span>}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#334155' }}>{filtered.length} articles</span>
                  </div>
                </div>

                {/* Timeline Tab */}
                {activeTab === 'timeline' && <TimelineChart data={timelineData} themeName={selectedTheme?.name || ''} />}

                {/* Feed Tab */}
                {activeTab === 'feed' && (
                  loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {Array(5).fill(0).map((_, i) => (
                        <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                          <Skeleton h="16px" w="85%" /><div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}><Skeleton h="12px" w="60px" /><Skeleton h="12px" w="80px" /></div>
                        </div>
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', border: '1px dashed #334155', borderRadius: '12px' }}>
                      {search ? (
                        <div>
                          <p style={{ color: '#64748b', margin: '0 0 1rem', fontSize: '0.9rem' }}>No articles matching <strong style={{ color: '#f59e0b' }}>"{search}"</strong></p>
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
                        filtered.forEach(a => { const key = (a.source?.match(/^\[(\w+)\]/)?.[1] || 'NEWS').toLowerCase().replace('_', ''); counts[key] = (counts[key] || 0) + 1 })
                        return (
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(15,23,42,0.6)', borderRadius: '8px', border: '1px solid #1e293b', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: '#475569', marginRight: '0.25rem' }}>SOURCES:</span>
                            {Object.entries(counts).map(([type, count]) => {
                              const b = SOURCE_BADGE[type] || SOURCE_BADGE.news
                              return <span key={type} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: b.color + '22', color: b.color }}>{b.icon} {b.label} <strong>{count}</strong></span>
                            })}
                          </div>
                        )
                      })()}

                      {/* Article cards */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
                        {filtered.slice(0, 100).map((article, idx) => {
                          const { cfg, clean } = getSourceInfo(article.source)
                          return (
                            <div key={article.id} style={{ padding: '0.875rem', borderRadius: '12px', animation: 'fadeIn 0.2s ease', animationDelay: (idx * 0.03) + 's', animationFillMode: 'both', ...sentStyle(article.sentiment) }}>
                              <p style={{ fontSize: '0.88rem', fontWeight: 500, color: '#e2e8f0', margin: '0 0 0.4rem', lineHeight: 1.45 }}>{article.title.replace(/^\[VIDEO\]\s*/, '')}</p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '999px', background: cfg.color + '22', color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed' }}>{clean}</span>
                                <span style={{ fontSize: '0.72rem', color: '#334155' }}>{article.published_at ? new Date(article.published_at).toLocaleDateString('en-SG', { day:'numeric', month:'short' }) : ''}</span>
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
                  )
                )}
              </div>
            )}
          </div>

          {/* Risk Panel */}
          <div className="risk-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangle size={11} /> Risk Implications
                {riskSource === 'groq-ai' && <span style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44' }}>✨ AI</span>}
              </div>
              {selectedTheme && (
                <button onClick={() => generateRisks(selectedTheme.id, selectedTheme.name)} disabled={genRisks}
                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: '8px', background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', cursor: genRisks ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                  {genRisks ? '...' : '✨ Generate'}
                </button>
              )}
            </div>

            {/* Competitive context banner */}
            {!loading && themeRisks.length === 0 && (
              <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: '#1e1b4b', border: '1px solid #7c3aed44', borderRadius: '8px', fontSize: '0.72rem', color: '#a78bfa', lineHeight: 1.5 }}>
                💡 <strong>Bloomberg Terminal</strong> costs $24k/yr per seat. Click Generate for instant AI risk analysis — free.
              </div>
            )}

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {Array(4).fill(0).map((_, i) => (
                  <div key={i} style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}><Skeleton w="20px" h="20px" r="4px" /><Skeleton w="50px" h="16px" r="4px" /></div>
                    <Skeleton h="12px" /><div style={{ marginTop: '0.35rem' }}><Skeleton h="12px" w="75%" /></div>
                  </div>
                ))}
              </div>
            ) : themeRisks.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', border: '1px dashed #334155', borderRadius: '12px' }}>
                <p style={{ color: '#475569', fontSize: '0.82rem', margin: 0 }}>Select a theme and click ✨ Generate to load AI risk analysis</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '70vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {themeRisks.map((risk, idx) => {
                  let sources: {title: string; url: string; source: string}[] = []
                  try { sources = JSON.parse(risk.sources_json || '[]') } catch {}
                  const conf = risk.confidence || 0
                  const confColor = conf >= 0.8 ? '#10b981' : conf >= 0.5 ? '#f59e0b' : '#94a3b8'
                  const confLabel = conf >= 0.8 ? 'High' : conf >= 0.5 ? 'Medium' : 'Low'
                  return (
                    <div key={risk.id} style={{ padding: '0.875rem', borderRadius: '12px', animation: 'fadeIn 0.2s ease', animationDelay: (idx * 0.05) + 's', animationFillMode: 'both', background: 'rgba(15,23,42,0.8)', border: '1px solid ' + SEV_COLOR[risk.severity] + '33', borderLeft: '3px solid ' + SEV_COLOR[risk.severity] }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '1rem' }}>{ASSET_ICON[risk.asset_class] || '🌐'}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: SEV_COLOR[risk.severity], textTransform: 'uppercase' }}>{risk.severity}</span>
                        <span style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'capitalize' }}>{risk.asset_class}</span>
                        {conf > 0 && (
                          <span style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: confColor + '22', color: confColor, border: '1px solid ' + confColor + '44' }} title="AI confidence based on supporting headlines">
                            {confLabel} confidence
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55, margin: '0 0 0.6rem' }}>{risk.implication}</p>
                      {sources.length > 0 && (
                        <div style={{ borderTop: '1px solid #1e293b', paddingTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.62rem', color: '#475569', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📎 Sources cited</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {sources.map((s, si) => (
                              <div key={si} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                                <span style={{ color: '#475569', fontSize: '0.65rem', flexShrink: 0, marginTop: '0.1rem' }}>↳</span>
                                {s.url ? (
                                  <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#7c3aed', textDecoration: 'none', lineHeight: 1.4 }}>
                                    {s.title.length > 60 ? s.title.slice(0, 60) + '…' : s.title}
                                    <span style={{ color: '#475569', marginLeft: '0.3rem' }}>({s.source})</span>
                                  </a>
                                ) : (
                                  <span style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>
                                    {s.title.length > 60 ? s.title.slice(0, 60) + '…' : s.title}
                                    <span style={{ color: '#475569', marginLeft: '0.3rem' }}>({s.source})</span>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
