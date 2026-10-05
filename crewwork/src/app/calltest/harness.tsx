'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store/app-store'
import { CallPanel } from '@/components/calls/call-panel'
import { buildCallRoomName } from '@/lib/calls/room-name'

const WS = '11111111-2222-3333-4444-555555555555'

export function CallTestHarness() {
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__calltestReady = true
  }, [])

  const start = (channelId: string) => {
    useAppStore.getState().setActiveCall({
      roomName: buildCallRoomName(WS, channelId),
      serverUrl: '',
      token: '',
    })
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Call Test Harness</h1>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button data-testid="start-chan-a" onClick={() => start('aaaaaaaa-0000-0000-0000-000000000001')}>
          Start call channel A
        </button>
        <button data-testid="start-chan-b" onClick={() => start('bbbbbbbb-0000-0000-0000-000000000002')}>
          Start call channel B
        </button>
        <button data-testid="start-chan-a-again" onClick={() => start('aaaaaaaa-0000-0000-0000-000000000001')}>
          Start call channel A again
        </button>
      </div>
      <CallPanel />
    </div>
  )
}
