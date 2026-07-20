'use client'

import { useState, useCallback } from 'react'
import { X, Phone, LogOut, Loader2 } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'

const JITSI_DOMAIN = 'meet.jit.si'

export function CallPanel() {
  const activeCall = useAppStore((s) => s.activeCall)
  const user = useAppStore((s) => s.user)
  const [inLobby, setInLobby] = useState(true)
  const [iframeLoading, setIframeLoading] = useState(true)

  const handleLeave = useCallback(() => {
    useAppStore.getState().setActiveCall(null)
  }, [])

  const handleJoin = useCallback(() => {
    setInLobby(false)
    setIframeLoading(true)
  }, [])

  if (!activeCall) return null

  const roomName = `CrewWork-${activeCall.roomName.split('-').slice(0, 2).join('-')}`

  const jitsiUrl = `https://${JITSI_DOMAIN}/${roomName}#config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.prejoinPageEnabled=false&config.toolbarButtons=["microphone","camera","closedcaptions","desktop","hangup","chat","settings","tileview","togglecamera","videoquality"]&userInfo.displayName=${encodeURIComponent(user?.display_name || 'User')}`

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E7E5E4] shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: '#FEE2E2' }}>
              <Phone className="h-4 w-4" style={{ color: '#DC2626' }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: '#1C1917' }}>
                {inLobby ? 'Join Call' : 'Call in Progress'}
              </h3>
              {!inLobby && (
                <p className="text-xs" style={{ color: '#A8A29E' }}>Room: {roomName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleLeave}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
            title="End call"
          >
            <X className="h-4 w-4" style={{ color: '#A8A29E' }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 relative">
          {inLobby ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
              <div className="w-32 h-32 rounded-full flex items-center justify-center" style={{ background: '#FEE2E2' }}>
                <span className="text-4xl font-bold" style={{ color: '#DC2626' }}>
                  {user?.display_name?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold" style={{ color: '#1C1917' }}>
                  {user?.display_name || 'User'}
                </h2>
                <p className="text-sm" style={{ color: '#A8A29E' }}>Ready to join the call</p>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleLeave}
                  className="h-11 px-6 rounded-xl border border-[#E7E5E4] text-sm font-medium transition-colors hover:bg-gray-50"
                  style={{ color: '#78716C' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleJoin}
                  className="h-11 px-8 rounded-xl text-sm font-semibold text-white transition-colors hover:opacity-90 flex items-center gap-2"
                  style={{ background: '#DC2626' }}
                >
                  <Phone className="h-4 w-4" />
                  Join Call
                </button>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full">
              {iframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-50">
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#DC2626' }} />
                  <p className="text-sm" style={{ color: '#A8A29E' }}>Connecting to call...</p>
                </div>
              )}
              <iframe
                src={jitsiUrl}
                className="w-full h-full border-0"
                allow="camera; microphone; fullscreen; display-capture; screen-wake-lock; autoplay"
                title="Video Call"
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          )}
        </div>

        {!inLobby && (
          <div className="flex items-center justify-center px-5 py-3 border-t border-[#E7E5E4] shrink-0">
            <button
              onClick={handleLeave}
              className="h-10 px-6 rounded-xl flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: '#DC2626' }}
            >
              <LogOut className="h-4 w-4" />
              Leave Call
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
