'use client'

import { Phone, X } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'

export function IncomingCallBanner() {
  const { activeCall, setActiveCall } = useAppStore()

  if (!activeCall) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top duration-300">
      <div className="flex items-center gap-3 px-5 py-3 rounded-2xl shadow-lg border" style={{ background: '#ffffff', borderColor: '#FECACA' }}>
        <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: '#FEE2E2' }}>
          <Phone className="h-4.5 w-4.5 animate-pulse" style={{ color: '#DC2626' }} />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>
            Call in progress
          </span>
          <span className="text-xs" style={{ color: '#A8A29E' }}>
            {activeCall.roomName}
          </span>
        </div>
        <button
          onClick={() => setActiveCall(null)}
          className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors ml-2"
        >
          <X className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
        </button>
      </div>
    </div>
  )
}
