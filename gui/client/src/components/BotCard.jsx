import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Wifi, WifiOff, Clock, TrendingUp, DollarSign, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatMoney, formatUptime, STATE_BG } from '@/lib/format'
import { startBot, stopBot } from '@/lib/api'

export default function BotCard({ bot }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [uptime, setUptime] = useState(0)

  const isConnected = bot.state === 'connected'
  const isRunning   = ['connected', 'connecting', 'reconnecting'].includes(bot.state)

  // Live uptime ticker
  useEffect(() => {
    if (!isConnected || !bot.sessionStartedAt) { setUptime(0); return }
    const tick = () => setUptime(Date.now() - bot.sessionStartedAt)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isConnected, bot.sessionStartedAt])

  const startMut = useMutation({
    mutationFn: () => startBot(bot.profile),
    onSuccess : () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  const stopMut = useMutation({
    mutationFn: () => stopBot(bot.profile),
    onSuccess : () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  const stateBadgeCls = STATE_BG[bot.state] || STATE_BG.idle
  const ratePerMin = isConnected && uptime > 60_000
    ? (bot.todayEarned || 0) / (uptime / 60_000)
    : null

  return (
    <Card
      className="group relative cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => navigate(`/bot/${bot.profile}`)}
    >
      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {bot.profile}
            </h2>
            <span className={`inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full border ${stateBadgeCls}`}>
              {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {bot.state}
            </span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Stat icon={DollarSign} label="Today" value={formatMoney(bot.todayEarned || 0)} />
          <Stat icon={TrendingUp} label="$/min"  value={ratePerMin != null ? formatMoney(ratePerMin) : '–'} />
          <Stat icon={DollarSign} label="Balance" value={bot.latestBalance != null ? formatMoney(bot.latestBalance) : '–'} />
          <Stat icon={Clock}      label="Uptime"  value={isConnected ? formatUptime(uptime) : '–'} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-green-400 border-green-500/30 hover:bg-green-500/10"
            disabled={isRunning || startMut.isPending}
            onClick={() => startMut.mutate()}
          >
            <Play className="h-3.5 w-3.5" />
            Connect
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
            disabled={!isRunning || stopMut.isPending}
            onClick={() => stopMut.mutate()}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <span className="text-sm font-mono font-medium text-foreground">{value}</span>
    </div>
  )
}
