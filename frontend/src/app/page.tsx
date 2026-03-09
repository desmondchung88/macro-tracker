'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, Newspaper } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Theme = { id: number; name: string; article_count: number; trend_score: number; status: string }
type Article = { id: number; title: string; source: string; published_at: string; theme: string; sentiment: number; url: string }
type Risk = { id: number; implication: string; asset_class: string; severity: string }

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  hot:     { label: 'HOT',     color: '#ef4444', icon: TrendingUp },
  cool:    { label: 'COOL',    color: '#3b82f6', icon: TrendingDown },
  neutral: { label: 'NEUTRAL', color: '#94a3b8', icon: Minus },
}

const SEVERITY_COLOR: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#10b981',
}

const ASSET_ICON: Record<string, string> = {
  equities: '📈', fx: '💱', rates: '📊', credit: '🏦', general: '🌐',
}

export default function Dashboard() {
  const [themes, setThemes] = useState<Theme[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [risks, setRisks] = useState<Risk[]>([])
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null)
  const [loading, setLoading] = useState(true)
  const [ingesting, setIngesting] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [t, a, r] = await Promise.all([
        fetch(`${API}/api/themes/`).then(r => r.json()),
        fetch(`${API}/api/articles/?limit=30`).then(r => r.json()),
        fetch(`${API}/api/risks/`).then(r => r.json()),
      ])
      setThemes(t)
      setArticles(a.articles || [])
      setRisks(r)
      if (t.length > 0 && !selectedTheme) setSelectedTheme(t[0])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const ingestNews = async () => {
    setIngesting(true)
    await fetch(`${API}/api/news/ingest`, { method: 'POST' })
    setTimeout(() => { fetchAll(); setIngesting(false) }, 4000)
  }

  const generateRisks = async (themeId: number) => {
    await fetch(`${API}/api/risks/${themeId}/generate`, { method: 'POST' })
    const r = await fetch(`${API}/api/risks/`).then(r => r.json())
    setRisks(r)
  }

  const filteredArticles = selectedTheme
    ? articles.filter(a => a.theme === selectedTheme.name)
    : articles

  const themeRisks = selectedTheme
    ? risks.filter(r => {
        // match by theme_id if available, or just show all risks for now
        return true
      })
    : risks

  const chartData = themes.slice(0, 6).map(t => ({
    name: t.name.split(' ').slice(0, 2).join(' '),
    articles: t.article_count,
    score: Math.round(t.trend_score * 10) / 10,
  }))

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="text-center">
        <div className="animate-spin w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-slate-400">Loading macro dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#0f172a', fontFamily: 'Georgia, serif' }}>
      {/* Header */}
      <header style={{ background: '#0f1729', borderBottom: '1px solid #1e293b' }} className="px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e2e8f0' }}>
              📡 Macro Economics Tracker
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              AI-powered macro intelligence for asset managers
            </p>
          </div>
          <button
            onClick={ingestNews}
            disabled={ingesting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: ingesting ? '#1e293b' : '#7c3aed', color: '#fff', border: 'none', cursor: ingesting ? 'wait' : 'pointer' }}
          >
            <RefreshCw size={14} className={ingesting ? 'animate-spin' : ''} />
            {ingesting ? 'Fetching news...' : 'Ingest News'}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-12 gap-6">

        {/* Themes Sidebar */}
        <div className="col-span-3">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#64748b' }}>
            Macro Themes
          </h2>
          <div className="space-y-2">
            {themes.map(theme => {
              const cfg = STATUS_CONFIG[theme.status] || STATUS_CONFIG.neutral
              const Icon = cfg.icon
              const isSelected = selectedTheme?.id === theme.id
              return (
                <button
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme)}
                  className="w-full text-left p-3 rounded-xl transition-all"
                  style={{
                    background: isSelected ? '#1e1b4b' : 'rgba(15,23,42,0.8)',
                    border: isSelected ? '1px solid #7c3aed' : '1px solid #1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: cfg.color + '22', color: cfg.color }}>
                      {cfg.label}
                    </span>
                    <span className="text-xs" style={{ color: '#64748b' }}>
                      {theme.article_count} articles
                    </span>
                  </div>
                  <p className="text-sm font-medium" style={{ color: '#e2e8f0' }}>{theme.name}</p>
                  <div className="mt-1.5 h-1 rounded-full" style={{ background: '#1e293b' }}>
                    <div className="h-1 rounded-full transition-all"
                      style={{ width: `${Math.min(100, theme.trend_score * 30)}%`, background: cfg.color }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Panel */}
        <div className="col-span-6 space-y-6">
          {/* Chart */}
          <div className="p-4 rounded-xl" style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
            <h2 className="text-sm font-bold mb-4" style={{ color: '#94a3b8' }}>
              Theme Activity Overview
            </h2>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Bar dataKey="articles" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Articles Feed */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
                <Newspaper size={12} className="inline mr-1" />
                {selectedTheme ? selectedTheme.name : 'All'} — Latest Articles
              </h2>
              <span className="text-xs" style={{ color: '#475569' }}>{filteredArticles.length} articles</span>
            </div>
            <div className="space-y-2">
              {filteredArticles.slice(0, 8).map(article => (
                <div key={article.id} className="p-3 rounded-xl" style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b' }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug" style={{ color: '#e2e8f0' }}>{article.title}</p>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: article.sentiment < -0.3 ? '#ef444422' : article.sentiment > 0.3 ? '#10b98122' : '#94a3b822',
                        color: article.sentiment < -0.3 ? '#ef4444' : article.sentiment > 0.3 ? '#10b981' : '#94a3b8',
                      }}>
                      {article.sentiment < -0.3 ? '↓' : article.sentiment > 0.3 ? '↑' : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs font-medium" style={{ color: '#7c3aed' }}>{article.source}</span>
                    <span className="text-xs" style={{ color: '#475569' }}>
                      {article.published_at ? new Date(article.published_at).toLocaleDateString() : ''}
                    </span>
                    {article.url && (
                      <a href={article.url} target="_blank" rel="noreferrer"
                        className="text-xs ml-auto" style={{ color: '#3b82f6' }}>
                        Read →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Risk Panel */}
        <div className="col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
              <AlertTriangle size={12} className="inline mr-1" />
              Risk Implications
            </h2>
            {selectedTheme && (
              <button
                onClick={() => generateRisks(selectedTheme.id)}
                className="text-xs px-2 py-1 rounded-lg transition-all"
                style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', cursor: 'pointer' }}
              >
                ✨ Generate
              </button>
            )}
          </div>
          <div className="space-y-2">
            {risks.slice(0, 8).map(risk => (
              <div key={risk.id} className="p-3 rounded-xl"
                style={{ background: 'rgba(15,23,42,0.8)', border: `1px solid ${SEVERITY_COLOR[risk.severity]}44` }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{ASSET_ICON[risk.asset_class] || '🌐'}</span>
                  <span className="text-xs font-bold uppercase" style={{ color: SEVERITY_COLOR[risk.severity] }}>
                    {risk.severity}
                  </span>
                  <span className="text-xs capitalize" style={{ color: '#64748b' }}>{risk.asset_class}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>{risk.implication}</p>
              </div>
            ))}
            {risks.length === 0 && (
              <div className="p-4 rounded-xl text-center" style={{ border: '1px dashed #334155' }}>
                <p className="text-xs" style={{ color: '#475569' }}>
                  Select a theme and click ✨ Generate to produce AI risk implications
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
