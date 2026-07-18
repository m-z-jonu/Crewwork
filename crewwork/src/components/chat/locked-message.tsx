import { Lock } from 'lucide-react'
import { format } from 'date-fns'

export function LockedMessage({ syncStartTime }: { syncStartTime: string }) {
  const formatted = format(new Date(syncStartTime), 'MMM d, yyyy')
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: '#A8A29E' }}>
      <Lock className="h-3 w-3" />
      <span>Sync enabled on {formatted} — this message was sent before that</span>
    </div>
  )
}
