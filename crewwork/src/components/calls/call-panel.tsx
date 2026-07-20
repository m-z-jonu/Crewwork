'use client'

import { useState } from 'react'
import {
  LiveKitRoom,
  VideoConference,
  ControlBar,
  RoomAudioRenderer,
  ConnectionState,
  useParticipants,
} from '@livekit/components-react'
import '@livekit/components-styles'
import {
  Phone, Mic, MicOff, Video, VideoOff,
  LogOut, MessageSquare,
} from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { Button } from '@/components/ui/button'

function LobbyScreen({ onJoin, onLeave }: { onJoin: () => void; onLeave: () => void }) {
  const { user } = useAppStore()
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold" style={{ color: '#1C1917' }}>Join Call</h2>
        <p className="text-sm" style={{ color: '#A8A29E' }}>Configure your audio and video before joining</p>
      </div>

      {/* Preview area */}
      <div className="w-64 h-48 rounded-2xl overflow-hidden" style={{ background: '#1C1917' }}>
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-4xl font-bold text-white">
            {user?.display_name?.[0]?.toUpperCase() || '?'}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMuted(!muted)}
          className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
            muted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          onClick={() => setVideoOff(!videoOff)}
          className={`h-12 w-12 rounded-full flex items-center justify-center transition-all ${
            videoOff ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={videoOff ? 'Turn on camera' : 'Turn off camera'}
        >
          {videoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={onLeave}
          variant="outline"
          className="rounded-xl px-6"
        >
          Cancel
        </Button>
        <Button
          onClick={onJoin}
          className="rounded-xl px-8 bg-green-600 hover:bg-green-700 text-white"
        >
          <Phone className="h-4 w-4 mr-2" />
          Join Call
        </Button>
      </div>
    </div>
  )
}

function CallControls() {
  const { setActiveCall } = useAppStore()
  const [showChat, setShowChat] = useState(false)
  const participants = useParticipants()

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-[#E7E5E4]">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-sm font-medium" style={{ color: '#78716C' }}>
          {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowChat(!showChat)}
          className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-sm transition-colors hover:bg-gray-100"
          style={{ color: '#78716C' }}
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
        <button
          onClick={() => setActiveCall(null)}
          className="h-9 px-4 rounded-xl flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          Leave
        </button>
      </div>
    </div>
  )
}

function CallContent() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <VideoConference />
      </div>
      <ControlBar />
      <CallControls />
      <RoomAudioRenderer />
    </div>
  )
}

export function CallPanel() {
  const { activeCall } = useAppStore()
  const [inLobby, setInLobby] = useState(true)

  if (!activeCall) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <LiveKitRoom
          serverUrl={activeCall.serverUrl}
          token={activeCall.token}
          connect={!inLobby}
          video={!inLobby}
          audio={!inLobby}
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        >
          {inLobby ? (
            <LobbyScreen
              onJoin={() => setInLobby(false)}
              onLeave={() => useAppStore.getState().setActiveCall(null)}
            />
          ) : (
            <ConnectionState>
              <CallContent />
            </ConnectionState>
          )}
        </LiveKitRoom>
      </div>
    </div>
  )
}
