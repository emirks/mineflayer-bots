import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { DollarSign, TrendingUp, ShoppingCart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchGains, fetchSessionEvents } from '@/lib/api'
import { useSocketEvent } from '@/hooks/useSocket'
import { formatMoney, formatTs, computeRollingRate, rangeToTimestamps } from '@/lib/format'

const RANGES = [
  { value: 'live',  label: 'Live (1h)' },
  { value: 'today', label: 'Today'     },
  { value: '7d',    label: '7 Days'    },
  { value: '30d',   label: '30 Days'   },
  { value: 'all',   label: 'All Time'  },
]

export default function GainsTab({ name, bot }) {
  const [range, setRange] = useState('today')
  const qc = useQueryClient()

  const { from, to } = rangeToTimestamps(range)

  const { data, isLoading } = useQuery({
    queryKey   : ['gains', name, range],
    queryFn    : () => fetchGains(name, { from, to, bucket: 'raw' }),
    refetchInterval: range === 'live' ? 10_000 : false,
  })

  const { data: sessionEvts = [] } = useQuery({
    queryKey: ['session-events', name, range],
    queryFn : () => fetchSessionEvents(name, { from, to }),
  })

  // Append new live sales to the gains query cache
  useSocketEvent('bot:sale', (ev) => {
    if (ev.profile !== name) return
    qc.setQueryData(['gains', name, range], (prev) => {
      if (!prev) return prev
      const newEvent = { ts: ev.ts, amount: ev.amount }
      const events = [...(prev.cumulative ?? []), { ...newEvent, cumulative: (prev.cumulative?.at(-1)?.cumulative ?? 0) + ev.amount }]
      return { ...prev, cumulative: events, totals: { ...prev.totals, total: (prev.totals?.total ?? 0) + ev.amount, count: (prev.totals?.count ?? 0) + 1 } }
    })
  })

  const cumulative = data?.cumulative ?? []
  const totals     = data?.totals ?? { total: 0, count: 0 }
  const today      = data?.today  ?? { total: 0, count: 0 }
  const rateData   = computeRollingRate(cumulative)

  const tsFormatter = (ts) => formatTs(ts, range === 'live' || range === 'today' ? 'hour' : 'day')
  const moneyTick   = (v) => formatMoney(v)

  const connectedMarkers = sessionEvts.filter(e => e.event_type === 'connected').map(e => e.ts)
  const disconnMarkers   = sessionEvts.filter(e => e.event_type === 'disconnected' || e.event_type === 'reconnecting').map(e => e.ts)

  const currentRate = rateData.at(-1)?.rate ?? null

  return (
    <div className="space-y-4">
      {/* Controls + KPIs */}
      <div className="flex flex-wrap items-center gap-4">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex gap-4 flex-wrap">
          <KPI icon={DollarSign}   label="Total Earned" value={formatMoney(totals.total)} />
          <KPI icon={ShoppingCart} label="Sales"        value={String(totals.count)}      />
          <KPI icon={TrendingUp}   label="Current $/min" value={currentRate != null ? formatMoney(currentRate) : '–'} />
          <KPI icon={DollarSign}   label="Today"        value={formatMoney(today.total)}  />
        </div>
      </div>

      {/* Cumulative earnings area chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Cumulative Earnings</CardTitle>
        </CardHeader>
        <CardContent className="h-56 p-0 pr-4 pb-4">
          {isLoading ? <ChartSkeleton /> : cumulative.length === 0 ? <NoData /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulative} margin={{ top: 10, left: 0, right: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(142, 70%, 45%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142, 70%, 45%)" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
                <XAxis dataKey="ts" tickFormatter={tsFormatter} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} minTickGap={60} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} width={60} />
                <ReTooltip
                  contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: '6px', fontSize: '12px' }}
                  labelFormatter={ts => new Date(ts).toLocaleString()}
                  formatter={(v, name) => [formatMoney(v), name === 'cumulative' ? 'Cumulative' : 'Sale']}
                />
                {connectedMarkers.map(ts => <ReferenceLine key={`c${ts}`} x={ts} stroke="hsl(142 70% 45% / 0.5)" strokeDasharray="4 2" />)}
                {disconnMarkers.map(ts   => <ReferenceLine key={`d${ts}`} x={ts} stroke="hsl(0 62.8% 50.6% / 0.5)"  strokeDasharray="4 2" />)}
                <Area type="monotone" dataKey="cumulative" stroke="hsl(142, 70%, 45%)" fill="url(#cumulGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* $/min rate line chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Earnings Rate ($/min, 5-min rolling window)</CardTitle>
        </CardHeader>
        <CardContent className="h-48 p-0 pr-4 pb-4">
          {isLoading ? <ChartSkeleton /> : rateData.length === 0 ? <NoData /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rateData} margin={{ top: 10, left: 0, right: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
                <XAxis dataKey="ts" tickFormatter={tsFormatter} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} minTickGap={60} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} width={60} />
                <ReTooltip
                  contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: '6px', fontSize: '12px' }}
                  labelFormatter={ts => new Date(ts).toLocaleString()}
                  formatter={(v) => [formatMoney(v), '$/min']}
                />
                <Line type="monotone" dataKey="rate" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function KPI({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-card rounded-lg border px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className="text-sm font-mono font-semibold">{value}</p>
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return <div className="h-full w-full animate-pulse rounded bg-muted/30" />
}

function NoData() {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data in this range</div>
}
