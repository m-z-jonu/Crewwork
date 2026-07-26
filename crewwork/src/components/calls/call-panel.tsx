'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Phone, LogOut, Loader2, Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, Hand, MessageSquare, Users, Settings, Maximize, Minimize } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'

const JITSI_DOMAIN = 'meet.jit.si'

// Load Jitsi External API script
function loadJitsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('jitsi-api-script')) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.id = 'jitsi-api-script'
    script.src = `https://${JITSI_DOMAIN}/external_api.js`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Jitsi API'))
    document.head.appendChild(script)
  })
}

export function CallPanel() {
  const activeCall = useAppStore((s) => s.activeCall)
  const user = useAppStore((s) => s.user)
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const [inLobby, setInLobby] = useState(true)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [participantCount, setParticipantCount] = useState(1)
  const [showChat, setShowChat] = useState(false)

  const handleLeave = useCallback(() => {
    if (apiRef.current) {
      apiRef.current.dispose()
      apiRef.current = null
    }
    useAppStore.getState().setActiveCall(null)
  }, [])

  const handleJoin = useCallback(async () => {
    setInLobby(false)
    setLoading(true)

    try {
      await loadJitsiScript()

      const roomName = `CrewWork-${activeCall?.roomName.split('-').slice(0, 2).join('-') || 'room'}`

      const api = new (window as any).JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName,
        parentNode: containerRef.current,
        width: '100%',
        height: '100%',
        configOverwrite: {
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          prejoinPageEnabled: false,
          enableLobby: false,
          startWithModertor: true,
          enableInsecureRoomNameWarning: false,
          disableDeepLinking: true,
          defaultLanguage: 'en',
          toolbarButtons: [
            'microphone', 'camera', 'closedcaptions', 'desktop',
            'hangup', 'chat', 'settings', 'tileview',
            'togglecamera', 'videoquality'
          ],
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_POWERED_BY: false,
          TOOLBAR_ALWAYS_VISIBLE: true,
          DEFAULT_BACKGROUND: '#ffffff',
          TOOLBAR_COLOR: '#DC2626',
          TOOLBAR_BG_COLOR: '#ffffff',
          TOOLBAR_TEXT_COLOR: '#1C1917',
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
          SHOW_CHROME_EXTENSION_BANNER: false,
        },
        userInfo: {
          displayName: user?.display_name || 'User',
        },
      })

      apiRef.current = api

      // Event listeners
      api.addEventListener('ready', () => {
        setLoading(false)
        // Ensure we're a moderator
        api.executeCommand('toggleParticipantMenu', { hidden: false })
      })

      api.addEventListener('readyToClose', () => {
        handleLeave()
      })

      api.addEventListener('participantJoined', () => {
        setParticipantCount((prev) => prev + 1)
      })

      api.addEventListener('participantLeft', () => {
        setParticipantCount((prev) => Math.max(1, prev - 1))
      })

      api.addEventListener('audioMuteChanged', (e: any) => {
        setMuted(e.muted)
      })

      api.addEventListener('videoMuteChanged', (e: any) => {
        setVideoOff(e.muted)
      })

      setLoading(false)
    } catch (err) {
      console.error('Failed to initialize Jitsi:', err)
      setLoading(false)
    }
  }, [activeCall, user, handleLeave])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (apiRef.current) {
        apiRef.current.dispose()
        apiRef.current = null
      }
    }
  }, [])

  if (!activeCall) return null

  const roomName = `CrewWork-${activeCall.roomName.split('-').slice(0, 2).join('-')}`

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
          <div className="flex items-center gap-2">
            {!inLobby && (
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                {participantCount} participant{participantCount !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={handleLeave}
              className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
              title="End call"
            >
              <X className="h-4 w-4" style={{ color: '#A8A29E' }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 relative">
          {inLobby ? (
            /* Lobby Screen */
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
            /* Jitsi External API container */
            <div className="relative w-full h-full">
              {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-50 z-10">
                  <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#DC2626' }} />
                  <p className="text-sm" style={{ color: '#A8A29E' }}>Connecting to call...</p>
                </div>
              )}
              <div ref={containerRef} className="w-full h-full" />
            </div>
          )}
        </div>

        {/* Footer */}
        {!inLobby && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#E7E5E4] shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (apiRef.current) {
                    apiRef.current.executeCommand('toggleAudio')
                  }
                }}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: muted ? '#FEE2E2' : '#F3F4F6', color: muted ? '#DC2626' : '#78716C' }}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  if (apiRef.current) {
                    apiRef.current.executeCommand('toggleVideo')
                  }
                }}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: videoOff ? '#FEE2E2' : '#F3F4F6', color: videoOff ? '#DC2626' : '#78716C' }}
                title={videoOff ? 'Turn on camera' : 'Turn off camera'}
              >
                {videoOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  if (apiRef.current) {
                    apiRef.current.executeCommand('toggleShareScreen')
                  }
                }}
                className="h-9 w-9 rounded-xl flex items-center justify-center transition-colors hover:bg-gray-100"
                style={{ color: '#78716C' }}
                title="Share screen"
              >
                <ScreenShare className="h-4 w-4" />
              </button>
            </div>
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
