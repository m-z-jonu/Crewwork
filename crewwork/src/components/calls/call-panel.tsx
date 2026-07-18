'use client'

import { useState } from 'react'
import {
  LiveKitRoom,
  VideoConference,
  ControlBar,
  RoomAudioRenderer,
  useParticipants,
  ConnectionState,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { X, Phone, Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'

function CallControls() {
  const { setActiveCall } = useAppStore()
  const participants = useParticipants()
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white border-t border-[#E7E5E4]">
      <div className="flex items-center gap-1.5 mr-auto">
        <Phone className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
        <span className="text-xs font-medium" style={{ color: '#78716C' }}>
          {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </span>
      </div>
      <button
        onClick={() => setMuted(!muted)}
        className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
          muted ? '' : 'hover:bg-[#E7E5E4]'
        }`}
        style={muted ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#F3F4F6', color: '#78716C' }}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        onClick={() => setVideoOff(!videoOff)}
        className={`h-9 w-9 rounded-xl flex items-center justify-center transition-colors ${
          videoOff ? '' : 'hover:bg-[#E7E5E4]'
        }`}
        style={videoOff ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#F3F4F6', color: '#78716C' }}
        title={videoOff ? 'Turn on camera' : 'Turn off camera'}
      >
        {videoOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
      </button>
      <button
        onClick={() => setActiveCall(null)}
        className="h-9 px-4 rounded-xl flex items-center justify-center transition-colors ml-2 hover:opacity-90"
        style={{ background: '#DC2626', color: '#ffffff' }}
        title="Leave call"
      >
        <X className="h-4 w-4 mr-1" />
        Leave
      </button>
    </div>
  )
}

function CallContent() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <VideoConference />
      </div>
      <CallControls />
      <RoomAudioRenderer />
    </div>
  )
}

export function CallPanel() {
  const { activeCall, user } = useAppStore()

  if (!activeCall) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[80vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <LiveKitRoom
          serverUrl={activeCall.serverUrl}
          token={activeCall.token}
          connect={true}
          video={true}
          audio={true}
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        >
          <ConnectionState>
            <CallContent />
          </ConnectionState>
        </LiveKitRoom>
      </div>
    </div>
  )
}
