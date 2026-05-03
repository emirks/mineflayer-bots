import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { RefreshCw, Package, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { queryOrders } from '@/lib/api'
import { formatMoney, formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function OrdersTab({ name, bot }) {
  const [orders, setOrders] = useState(null)
  const isConnected = bot.state === 'connected'

  const { mutate, isPending, error, isError } = useMutation({
    mutationFn: () => queryOrders(name),
    onSuccess : (data) => setOrders(Array.isArray(data) ? data : []),
  })

  const totalRemaining = orders?.reduce((s, o) => s + (o.remaining ?? 0), 0) ?? 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => mutate()}
          disabled={isPending || !isConnected}
          size="sm"
          className="gap-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
          {isPending ? 'Querying…' : 'Refresh Orders'}
        </Button>

        {!isConnected && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            Bot must be connected to query orders
          </span>
        )}

        {orders != null && (
          <span className="text-xs text-muted-foreground">
            {orders.length} order{orders.length !== 1 ? 's' : ''}
            {' · '}
            <span className="font-mono text-foreground">{formatCount(totalRemaining)}</span> total remaining
          </span>
        )}
      </div>

      {isError && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          Error: {error?.message}
        </div>
      )}

      {orders === null && !isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Package className="h-10 w-10 opacity-30" />
          <p>Click "Refresh Orders" to load current order status from the bot.</p>
          <p className="text-xs">This briefly opens the /order GUI on the running bot.</p>
        </div>
      )}

      {orders != null && orders.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="h-10 w-10 opacity-30 mx-auto mb-3" />
          <p>No orders found</p>
        </div>
      )}

      {orders != null && orders.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Item</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Price Each</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Delivered</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Total</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Remaining</th>
                <th className="px-4 py-2.5 w-36 text-xs font-medium text-muted-foreground">Progress</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, i) => {
                const pct = order.total ? Math.round(((order.delivered ?? 0) / order.total) * 100) : 0
                return (
                  <tr key={i} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{order.displayName}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">
                      {order.price != null ? formatMoney(order.price) : '–'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {order.delivered != null ? formatCount(order.delivered) : '–'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {order.total != null ? formatCount(order.total) : '–'}
                    </td>
                    <td className={cn('px-4 py-3 text-right font-mono font-semibold', (order.remaining ?? 0) > 0 ? 'text-orange-400' : 'text-green-400')}>
                      {order.remaining != null ? formatCount(order.remaining) : '–'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
