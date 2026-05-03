import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchLogs } from '@/lib/api'
import { useSocketEvent } from '@/hooks/useSocket'
import { cn } from '@/lib/utils'

const LEVEL_COLORS = {
  info : 'text-slate-300',
  warn : 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-slate-500',
  perf : 'text-cyan-400',
}

const LEVELS = ['all', 'info', 'warn', 'error']

export default function LogsTab({ name }) {
  const [levelFilter, setLevelFilter] = useState('all')
  const [search, setSearch]           = useState('')
  const [liveLogs, setLiveLogs]       = useState([])
  const [autoScroll, setAutoScroll]   = useState(true)
  const bottomRef  = useRef(null)
  const scrollRef  = useRef(null)

  const { data: initialLogs = [], isLoading } = useQuery({
    queryKey: ['logs', name],
    queryFn : () => fetchLogs(name, 300),
    staleTime: 30_000,
  })

  // Seed liveLogs from initial fetch
  useEffect(() => {
    if (initialLogs.length > 0) setLiveLogs(initialLogs)
  }, [initialLogs])

  // Append live log lines from socket.io
  useSocketEvent('bot:log', useCallback((ev) => {
    if (ev.profile !== name) return
    setLiveLogs(prev => {
      const next = [...prev, ev]
      return next.length > 1500 ? next.slice(-1500) : next
    })
  }, [name]))

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [liveLogs, autoScroll])

  const allLogs = liveLogs.length > 0 ? liveLogs : initialLogs

  const filtered = allLogs.filter(log => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false
    if (search && !log.text?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function handleScroll(e) {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(atBottom)
  }

  function downloadLogs() {
    const text = filtered.map(l => l.raw || `${l.level.toUpperCase()} ${l.text}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${name}-logs.txt` })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Level filter buttons */}
        <div className="flex gap-1">
          {LEVELS.map(l => (
            <Button
              key={l}
              size="sm"
              variant={levelFilter === l ? 'secondary' : 'ghost'}
              className={cn('h-8 px-2.5 capitalize text-xs', l === 'warn' && levelFilter === l && 'text-yellow-400', l === 'error' && levelFilter === l && 'text-red-400')}
              onClick={() => setLevelFilter(l)}
            >
              {l}
            </Button>
          ))}
        </div>

        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <span className="text-xs text-muted-foreground">{filtered.length} lines</span>

        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setLiveLogs([])} title="Clear display">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={downloadLogs} title="Download logs">
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Log viewport */}
      <div
        className="h-[calc(100vh-260px)] min-h-80 overflow-y-auto rounded-md border bg-black/40 font-mono text-xs"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {isLoading ? (
          <div className="p-4 text-muted-foreground">Loading logs…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-muted-foreground">No log lines{search ? ' matching search' : ' yet'}</div>
        ) : (
          <div className="p-2 space-y-0.5">
            {filtered.map((log, i) => (
              <LogLine key={i} log={log} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!autoScroll && (
        <Button
          size="sm" variant="secondary" className="w-full text-xs"
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView() }}
        >
          ↓ Jump to bottom
        </Button>
      )}
    </div>
  )
}

function LogLine({ log }) {
  const ts = log.ts ? new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
  const color = LEVEL_COLORS[log.level] || LEVEL_COLORS.info

  return (
    <div className={cn('flex gap-2 leading-5 whitespace-pre-wrap break-all', color)}>
      {ts && <span className="shrink-0 text-slate-600">{ts}</span>}
      {log.level !== 'info' && (
        <span className={cn('shrink-0 uppercase font-bold text-[10px]', color)}>[{log.level}]</span>
      )}
      <span className="text-slate-300">{log.text}</span>
    </div>
  )
}
