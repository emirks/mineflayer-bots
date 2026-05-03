import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Play, Square, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { fetchBots, startBot, stopBot } from '@/lib/api'
import { useSocketEvent } from '@/hooks/useSocket'
import { STATE_BG, formatMoney } from '@/lib/format'
import GainsTab   from '@/components/GainsTab'
import BalanceTab from '@/components/BalanceTab'
import LogsTab    from '@/components/LogsTab'
import OrdersTab  from '@/components/OrdersTab'
import ConfigTab  from '@/components/ConfigTab'

export default function BotDetail() {
  const { name } = useParams()
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const { data: bots = [] } = useQuery({
    queryKey    : ['bots'],
    queryFn     : fetchBots,
    refetchInterval: 10_000,
  })

  const bot = bots.find(b => b.profile === name) ?? { profile: name, state: 'idle' }

  useSocketEvent('bot:stateChange', (data) => {
    if (data.profile !== name) return
    qc.setQueryData(['bots'], (prev) =>
      prev?.map(b => b.profile === name ? { ...b, ...data } : b) ?? prev
    )
  })

  useSocketEvent('bot:balance', (data) => {
    if (data.profile !== name) return
    qc.setQueryData(['bots'], (prev) =>
      prev?.map(b => b.profile !== name ? b : { ...b, latestBalance: data.balance }) ?? prev
    )
  })

  const isRunning = ['connected', 'connecting', 'reconnecting'].includes(bot.state)
  const stateBadge = STATE_BG[bot.state] || STATE_BG.idle

  const startMut = useMutation({
    mutationFn: () => startBot(name),
    onSuccess : () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  const stopMut = useMutation({
    mutationFn: () => stopBot(name),
    onSuccess : () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container max-w-7xl mx-auto flex h-14 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2 flex-1">
            <span className="text-base font-semibold">{name}</span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${stateBadge}`}>
              {bot.state === 'connected' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {bot.state}
            </span>
            {bot.latestBalance != null && (
              <span className="text-xs text-muted-foreground ml-2">
                bal: <span className="font-mono text-foreground">{formatMoney(bot.latestBalance)}</span>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-green-400 border-green-500/30 hover:bg-green-500/10"
              disabled={isRunning || startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              <Play className="h-3.5 w-3.5" />
              Connect
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
              disabled={!isRunning || stopMut.isPending}
              onClick={() => stopMut.mutate()}
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="container max-w-7xl mx-auto px-4 py-4">
        <Tabs defaultValue="gains">
          <TabsList className="mb-4">
            <TabsTrigger value="gains">Gains</TabsTrigger>
            <TabsTrigger value="balance">Balance</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>

          <TabsContent value="gains">
            <GainsTab name={name} bot={bot} />
          </TabsContent>

          <TabsContent value="balance">
            <BalanceTab name={name} bot={bot} />
          </TabsContent>

          <TabsContent value="logs">
            <LogsTab name={name} />
          </TabsContent>

          <TabsContent value="orders">
            <OrdersTab name={name} bot={bot} />
          </TabsContent>

          <TabsContent value="config">
            <ConfigTab name={name} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
