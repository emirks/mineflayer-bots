import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer,
} from 'recharts'
import { DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchBalance } from '@/lib/api'
import { useSocketEvent } from '@/hooks/useSocket'
import { formatMoney, formatTs, rangeToTimestamps, formatDatetime } from '@/lib/format'

const RANGES = [
  { value: 'today', label: 'Today'  },
  { value: '7d',    label: '7 Days' },
  { value: '30d',   label: '30 Days'},
  { value: 'all',   label: 'All Time'},
]

export default function BalanceTab({ name, bot }) {
  const [range, setRange] = useState('7d')
  const qc = useQueryClient()
  const { from, to } = rangeToTimestamps(range)

  const { data, isLoading } = useQuery({
    queryKey: ['balance', name, range],
    queryFn : () => fetchBalance(name, { from, to }),
    refetchInterval: 30_000,
  })

  useSocketEvent('bot:balance', (ev) => {
    if (ev.profile !== name) return
    qc.setQueryData(['balance', name, range], (prev) => {
      if (!prev) return prev
      return { ...prev, snaps: [...(prev.snaps ?? []), { ts: ev.ts, balance: ev.balance }], latest: { ts: ev.ts, balance: ev.balance } }
    })
  })

  const snaps  = data?.snaps  ?? []
  const latest = data?.latest ?? null

  const tsFormatter  = (ts) => formatTs(ts, range === 'today' ? 'hour' : 'day')
  const moneyTick    = (v)  => formatMoney(v)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {latest && (
          <div className="flex items-center gap-2 bg-card rounded-lg border px-3 py-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Current Balance</p>
              <p className="text-base font-mono font-bold text-green-400">{formatMoney(latest.balance)}</p>
              <p className="text-xs text-muted-foreground">{formatDatetime(latest.ts)}</p>
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Balance Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-72 p-0 pr-4 pb-4">
          {isLoading ? (
            <div className="h-full w-full animate-pulse rounded bg-muted/30" />
          ) : snaps.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No balance snapshots yet. Bot runs /bal automatically.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snaps} margin={{ top: 10, left: 0, right: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217.2 32.6% 17.5%)" />
                <XAxis dataKey="ts" tickFormatter={tsFormatter} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} minTickGap={60} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11, fill: 'hsl(215 20.2% 65.1%)' }} width={60} />
                <ReTooltip
                  contentStyle={{ background: 'hsl(222.2 84% 4.9%)', border: '1px solid hsl(217.2 32.6% 17.5%)', borderRadius: '6px', fontSize: '12px' }}
                  labelFormatter={ts => new Date(ts).toLocaleString()}
                  formatter={(v) => [formatMoney(v), 'Balance']}
                />
                <Line type="monotone" dataKey="balance" stroke="hsl(30, 80%, 55%)" strokeWidth={2} dot={snaps.length < 50} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
