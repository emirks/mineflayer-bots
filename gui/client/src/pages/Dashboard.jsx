import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, DollarSign, Activity } from 'lucide-react'
import { fetchBots } from '@/lib/api'
import { useSocketEvent } from '@/hooks/useSocket'
import { formatMoney } from '@/lib/format'
import BotCard from '@/components/BotCard'

export default function Dashboard() {
  const qc = useQueryClient()

  const { data: bots = [], isLoading } = useQuery({
    queryKey    : ['bots'],
    queryFn     : fetchBots,
    refetchInterval: 10_000,
  })

  // Live state updates
  useSocketEvent('bot:init', (initBots) => {
    qc.setQueryData(['bots'], initBots)
  })

  useSocketEvent('bot:stateChange', (data) => {
    qc.setQueryData(['bots'], (prev) => {
      if (!prev) return prev
      const exists = prev.some(b => b.profile === data.profile)
      if (exists) return prev.map(b => b.profile === data.profile ? { ...b, ...data } : b)
      // Bot was started from CLI / auto-start — add it to the list
      return [...prev, { profile: data.profile, state: data.state, todayEarned: 0, latestBalance: null }]
    })
  })

  useSocketEvent('bot:sale', (data) => {
    qc.setQueryData(['bots'], (prev) =>
      prev?.map(b => b.profile !== data.profile ? b : {
        ...b,
        todayEarned: (b.todayEarned || 0) + data.amount,
        todayCount : (b.todayCount  || 0) + 1,
      }) ?? prev
    )
  })

  useSocketEvent('bot:balance', (data) => {
    qc.setQueryData(['bots'], (prev) =>
      prev?.map(b => b.profile !== data.profile ? b : {
        ...b,
        latestBalance  : data.balance,
        latestBalanceTs: data.ts,
      }) ?? prev
    )
  })

  const activeCount   = bots.filter(b => b.state === 'connected').length
  const totalEarnings = bots.reduce((s, b) => s + (b.todayEarned || 0), 0)

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container max-w-7xl mx-auto flex h-14 items-center gap-3 px-4">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight">Bot Dashboard</span>
        </div>
      </header>

      <main className="container max-w-7xl mx-auto px-4 py-6">
        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <SummaryCard icon={Bot}        label="Active Bots"    value={`${activeCount} / ${bots.length}`} />
          <SummaryCard icon={DollarSign} label="Earnings Today" value={formatMoney(totalEarnings)}       />
          <SummaryCard icon={Activity}   label="Total Profiles" value={String(bots.length)}              />
        </div>

        {/* Bot grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 rounded-lg bg-card border animate-pulse" />
            ))}
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Bot className="h-12 w-12 opacity-30" />
            <p className="text-lg">No bots running</p>
            <p className="text-sm">Start a bot with <code className="bg-muted px-1.5 py-0.5 rounded text-xs">node gui/server.js &lt;profile&gt;</code></p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map(bot => <BotCard key={bot.profile} bot={bot} />)}
          </div>
        )}
      </main>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-4">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold font-mono">{value}</p>
      </div>
    </div>
  )
}
