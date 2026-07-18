'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { MessageBubble } from './message-bubble'
import { MessageInput } from './message-input'
import { ThreadPanel } from './thread-panel'
import { UserProfilePanel } from './user-profile-panel'
import { ChannelSettingsDialog } from './channel-settings-dialog'
import { LockedMessage } from './locked-message'
import { AIChat } from '@/components/ai/ai-chat'
import { db, type LocalMessage } from '@/lib/local/db'
import { shouldSyncMessage, getSyncStartTime, storeMessage, getChannelMessages, markMessageSynced, decryptContent } from '@/lib/local/sync'
import type { Channel, Message } from '@/types/database'
import { Hash, Lock, Users, Loader2, LogIn, Menu, Phone } from 'lucide-react'
import { useMobile } from '@/hooks/use-mobile'
import { CallSetupDialog } from '@/components/calls/call-setup-dialog'

const PAGE_SIZE = 50
const AI_CHANNEL_NAME = '#ai-assistant'

interface ChannelViewProps {
  channel: Channel
  isPreview?: boolean
}

export function ChannelView({ channel, isPreview = false }: ChannelViewProps) {
  const { user, workspace, threadParentMessage, profileUserId, dmChannels, openProfile, addChannel, setCurrentChannelId, setPreviewChannel, toggleSidebar, multiDeviceEnabled } = useAppStore()
  const { isDesktop } = useMobile()
  const isDm = channel.name.startsWith('dm-')
  const isGroupDm = channel.name.startsWith('gdm-')
  const isDirectMessage = isDm || isGroupDm
  const isAIChannel = channel.name === AI_CHANNEL_NAME
  const dmInfo = isDirectMessage ? dmChannels.find((d) => d.id === channel.id) : null
  const displayChannelName = isGroupDm
    ? (dmInfo?.memberProfiles || []).map(m => m.display_name).join(', ') || 'Group DM'
    : isDm && dmInfo?.otherUser
      ? dmInfo.otherUser.display_name
      : channel.name
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false)
  const [callSetupOpen, setCallSetupOpen] = useState(false)
  const [joiningChannel, setJoiningChannel] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [localSyncStart, setLocalSyncStart] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<Message[]>([])
  const isInitialLoad = useRef(true)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return

    const client = getSupabaseClient()
    if (!client) return

    setLoadingMore(true)
    const oldestMessage = messages[0]
    const scrollContainer = scrollContainerRef.current
    const prevScrollHeight = scrollContainer?.scrollHeight || 0

    const { data } = await client
      .from('messages')
      .select('*, sender:profiles(*)')
      .eq('channel_id', channel.id)
      .eq('is_deleted', false)
      .is('parent_id', null)
      .lt('created_at', oldestMessage.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (data) {
      const olderMessages = (data as Message[]).reverse()
      if (olderMessages.length < PAGE_SIZE) {
        setHasMore(false)
      }
      if (olderMessages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id))
          const unique = olderMessages.filter((m) => !existingIds.has(m.id))
          return [...unique, ...prev]
        })
        requestAnimationFrame(() => {
          if (scrollContainer) {
            const newScrollHeight = scrollContainer.scrollHeight
            scrollContainer.scrollTop = newScrollHeight - prevScrollHeight
          }
        })
      }
    }

    setLoadingMore(false)
  }, [loadingMore, hasMore, messages, channel.id])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    function handleScroll() {
      if (container!.scrollTop < 100 && !loadingMore && hasMore && !loading) {
        loadOlderMessages()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loadOlderMessages, loadingMore, hasMore, loading])

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) return

    async function loadMessages() {
      setLoading(true)
      setHasMore(true)
      isInitialLoad.current = true

      const syncStart = await getSyncStartTime()
      setLocalSyncStart(syncStart)

      // Load from local IndexedDB first
      const localMsgs = await getChannelMessages(channel.id)

      // Also load from Supabase (for any synced messages or initial load)
      const { data } = await client!
        .from('messages')
        .select('*, sender:profiles(*)')
        .eq('channel_id', channel.id)
        .eq('is_deleted', false)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      const cloudMsgs = (data as Message[] || []).reverse()

      // Merge: dedupe by id, prefer cloud version (has sender profile)
      const msgMap = new Map<string, Message>()
      for (const msg of localMsgs) {
        msgMap.set(msg.id, {
          id: msg.id,
          channel_id: msg.channel_id,
          sender_id: msg.sender_id,
          content: msg.content,
          parent_id: msg.parent_id,
          thread_reply_count: 0,
          is_edited: false,
          is_deleted: msg.is_deleted,
          metadata: null,
          created_at: msg.created_at,
          updated_at: msg.created_at,
          sender: {
            id: msg.sender_id,
            display_name: msg.sender_name,
            avatar_url: msg.sender_avatar,
            email: null,
            status_emoji: null,
            status_text: null,
            is_online: false,
            last_seen_at: null,
            created_at: '',
            sync_started_at: null,
          } as import('@/types/database').Profile,
        })
      }
      for (const msg of cloudMsgs) {
        msgMap.set(msg.id, msg)
      }

      const merged = Array.from(msgMap.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      // Decrypt all messages
      const decryptedMessages: Message[] = []
      for (const msg of merged) {
        try {
          const decryptedContent = await decryptContent(
            msg.content,
            channel.id,
            msg.sender_id || ''
          )
          decryptedMessages.push({ ...msg, content: decryptedContent })
        } catch (error) {
          console.error('Failed to decrypt message:', error)
          decryptedMessages.push({ ...msg, content: '[Encrypted message]' })
        }
      }

      setMessages(decryptedMessages)
      if (cloudMsgs.length < PAGE_SIZE) {
        setHasMore(false)
      }
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' })
        isInitialLoad.current = false
      }, 100)
      setLoading(false)
    }

    async function fetchMessage(id: string): Promise<Message | null> {
      const { data } = await client!
        .from('messages')
        .select('*, sender:profiles(*)')
        .eq('id', id)
        .single()
      return data as Message | null
    }

    loadMessages()

    const channelSub = client
      .channel(`messages:${channel.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channel.id}`,
        },
        async (payload) => {
          if (payload.new.parent_id) return

          const fullMessage = await fetchMessage(payload.new.id)
          if (fullMessage) {
            // Decrypt the message content
            try {
              const decryptedContent = await decryptContent(
                fullMessage.content,
                channel.id,
                fullMessage.sender_id || ''
              )
              fullMessage.content = decryptedContent
            } catch (error) {
              console.error('Failed to decrypt incoming message:', error)
              fullMessage.content = '[Encrypted message]'
            }

            setMessages((prev) => {
              if (prev.some((m) => m.id === fullMessage.id)) return prev
              return [...prev, fullMessage]
            })
            const container = scrollContainerRef.current
            if (container) {
              const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
              if (isNearBottom || payload.new.sender_id === user?.id) {
                scrollToBottom()
              }
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channel.id}`,
        },
        async (payload) => {
          if (payload.new.is_deleted) {
            setMessages((prev) => prev.filter((m) => m.id !== payload.new.id))
          } else {
            const updated = await fetchMessage(payload.new.id)
            if (updated) {
              // Decrypt the updated message content
              try {
                const decryptedContent = await decryptContent(
                  updated.content,
                  channel.id,
                  updated.sender_id || ''
                )
                updated.content = decryptedContent
              } catch (error) {
                console.error('Failed to decrypt updated message:', error)
                updated.content = '[Encrypted message]'
              }

              setMessages((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m))
              )
            }
          }
        }
      )
      .subscribe()

    return () => {
      channelSub.unsubscribe()
    }
  }, [channel.id, scrollToBottom, user?.id])

  async function handleSendMessage(content: string) {
    const client = getSupabaseClient()
    if (!client || !user) return

    const msgId = crypto.randomUUID()
    const now = new Date().toISOString()

    // Always store locally
    await storeMessage({
      id: msgId,
      channel_id: channel.id,
      sender_id: user.id,
      content,
      created_at: now,
      sender_name: user.display_name,
      sender_avatar: user.avatar_url,
    })

    // Update local UI immediately
    const newMsg: Message = {
      id: msgId,
      channel_id: channel.id,
      sender_id: user.id,
      content,
      parent_id: null,
      thread_reply_count: 0,
      is_edited: false,
      is_deleted: false,
      metadata: null,
      created_at: now,
      updated_at: now,
      sender: user,
    }
    setMessages((prev) => [...prev, newMsg])
    scrollToBottom()

    // Conditionally sync to Supabase
    const shouldSync = await shouldSyncMessage(now)
    if (shouldSync) {
      // Get the encrypted content from IndexedDB
      const localMsg = await db.messages.get(msgId)
      const encryptedContent = localMsg?.content || content

      await client.from('messages').insert({
        id: msgId,
        channel_id: channel.id,
        sender_id: user.id,
        content: encryptedContent,  // Send encrypted content to Supabase
      })
      await markMessageSynced(msgId)
    }
  }

  async function handleJoinPreview() {
    const client = getSupabaseClient()
    if (!client || !user) return

    setJoiningChannel(true)
    try {
      await client.from('channel_members').insert({
        channel_id: channel.id,
        profile_id: user.id,
        role: 'member',
      })

      addChannel(channel)
      setPreviewChannel(null)
      setCurrentChannelId(channel.id)
    } catch (err) {
      console.error('Failed to join channel:', err)
    }
    setJoiningChannel(false)
  }

  async function handleStartCall() {
    if (!workspace?.calls_enabled || channel.calls_enabled === false) {
      setCallSetupOpen(true)
      return
    }
    const client = getSupabaseClient()
    if (!client || !user) return

    const roomName = `${workspace.id}-${channel.id}-${Date.now()}`
    try {
      const { data: { session } } = await client.auth.getSession()
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ roomName, workspaceId: workspace.id, channelId: channel.id }),
      })
      if (!res.ok) {
        const err = await res.json()
        console.error('Failed to get call token:', err.error)
        return
      }
      const { server_url, participant_token } = await res.json()
      useAppStore.getState().setActiveCall({
        roomName,
        serverUrl: server_url,
        token: participant_token,
      })
    } catch (err) {
      console.error('Failed to start call:', err)
    }
  }

  return (
    <div className="flex-1 flex h-full">
      {/* Main channel area */}
      <div className="flex-1 flex flex-col h-full min-w-0" style={{ background: '#ffffff' }}>
        {/* Channel header */}
        <div className="px-5 py-3 flex items-center justify-between shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #E7E5E4' }}>
          <div className="flex items-center gap-2.5">
            {!isDesktop && (
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors mr-1"
              >
                <Menu className="h-5 w-5" style={{ color: '#A8A29E' }} />
              </button>
            )}
            {isGroupDm ? (
              <>
                <div className="relative h-7 w-7 shrink-0">
                  {dmInfo?.memberProfiles?.[0]?.avatar_url ? (
                    <img src={dmInfo.memberProfiles[0].avatar_url} alt="" className="absolute top-0 left-0 h-[18px] w-[18px] rounded-md object-cover border-2 border-white" />
                  ) : (
                    <div className="absolute top-0 left-0 h-[18px] w-[18px] rounded-md flex items-center justify-center text-[8px] font-bold text-white border-2 border-white" style={{ background: '#DC2626' }}>
                      {dmInfo?.memberProfiles?.[0]?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  {dmInfo?.memberProfiles?.[1]?.avatar_url ? (
                    <img src={dmInfo.memberProfiles[1].avatar_url} alt="" className="absolute bottom-0 right-0 h-[18px] w-[18px] rounded-md object-cover border-2 border-white" />
                  ) : (
                    <div className="absolute bottom-0 right-0 h-[18px] w-[18px] rounded-md flex items-center justify-center text-[8px] font-bold text-white border-2 border-white" style={{ background: '#9B7DFF' }}>
                      {dmInfo?.memberProfiles?.[1]?.display_name?.[0]?.toUpperCase() || '+'}
                    </div>
                  )}
                </div>
                <h2 className="font-bold text-[17px] truncate max-w-md" style={{ color: '#1C1917' }}>
                  {displayChannelName}
                </h2>
                <span className="text-xs shrink-0 px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                  {(dmInfo?.memberProfiles?.length || 0) + 1}
                </span>
              </>
            ) : isDm ? (
              <>
                {dmInfo?.otherUser?.avatar_url ? (
                  <img
                    src={dmInfo.otherUser.avatar_url}
                    alt={displayChannelName}
                    className="h-7 w-7 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: '#DC2626' }}>
                    {dmInfo?.otherUser?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <button
                  onClick={() => dmInfo?.otherUser?.id && openProfile(dmInfo.otherUser.id)}
                  className="font-bold text-[17px] hover:underline cursor-pointer"
                  style={{ color: '#1C1917' }}
                >
                  {displayChannelName}
                </button>
              </>
            ) : (
              <>
                <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: '#FEE2E2' }}>
                  {channel.is_private ? (
                    <Lock className="h-4 w-4" style={{ color: '#DC2626' }} />
                  ) : (
                    <Hash className="h-4 w-4" style={{ color: '#DC2626' }} />
                  )}
                </div>
                <h2 className="font-bold text-[17px]" style={{ color: '#1C1917' }}>{channel.name}</h2>
                {channel.description && (
                  <>
                    <span style={{ color: '#E7E5E4' }}>|</span>
                    <span className="text-sm truncate max-w-md" style={{ color: '#A8A29E' }}>
                      {channel.description}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!isDirectMessage && channel.calls_enabled !== false && (
              <button
                onClick={handleStartCall}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
                title="Start a call"
              >
                <Phone className="h-4 w-4" style={{ color: '#A8A29E' }} />
              </button>
            )}
            {!isDirectMessage && (
              <button
                onClick={() => setChannelSettingsOpen(true)}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
                title="Channel settings & members"
              >
                <Users className="h-4 w-4" style={{ color: '#A8A29E' }} />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        {isAIChannel ? (
          <AIChat channelId={channel.id} />
        ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5">
          <div className="py-4 space-y-0.5">
            {loadingMore && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin mr-2" style={{ color: '#DC2626' }} />
                <span className="text-xs" style={{ color: '#A8A29E' }}>Loading older messages...</span>
              </div>
            )}

            {!hasMore && messages.length > 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                {isDirectMessage ? (
                  <>
                    {isGroupDm ? (
                      <div className="relative h-14 w-14 mb-3">
                        {dmInfo?.memberProfiles?.[0]?.avatar_url ? (
                          <img src={dmInfo.memberProfiles[0].avatar_url} alt="" className="absolute top-0 left-0 h-9 w-9 rounded-xl object-cover border-2 border-white" />
                        ) : (
                          <div className="absolute top-0 left-0 h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold text-white border-2 border-white" style={{ background: '#DC2626' }}>
                            {dmInfo?.memberProfiles?.[0]?.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        {dmInfo?.memberProfiles?.[1]?.avatar_url ? (
                          <img src={dmInfo.memberProfiles[1].avatar_url} alt="" className="absolute bottom-0 right-0 h-9 w-9 rounded-xl object-cover border-2 border-white" />
                        ) : (
                          <div className="absolute bottom-0 right-0 h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold text-white border-2 border-white" style={{ background: '#9B7DFF' }}>
                            {dmInfo?.memberProfiles?.[1]?.display_name?.[0]?.toUpperCase() || '+'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white mb-3" style={{ background: '#DC2626' }}>
                        {dmInfo?.otherUser?.avatar_url ? (
                          <img src={dmInfo.otherUser.avatar_url} alt="" className="h-14 w-14 rounded-2xl object-cover" />
                        ) : (
                          dmInfo?.otherUser?.display_name?.[0]?.toUpperCase() || '?'
                        )}
                      </div>
                    )}
                    <h3 className="text-base font-bold" style={{ color: '#1C1917' }}>{displayChannelName}</h3>
                    <p className="text-sm" style={{ color: '#A8A29E' }}>
                      This is the beginning of your conversation.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: '#FEE2E2' }}>
                      <Hash className="h-7 w-7" style={{ color: '#DC2626' }} />
                    </div>
                    <h3 className="text-base font-bold" style={{ color: '#1C1917' }}>Welcome to #{channel.name}!</h3>
                    <p className="text-sm" style={{ color: '#A8A29E' }}>
                      This is the start of the #{channel.name} channel.
                    </p>
                  </>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12" style={{ color: '#A8A29E' }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" style={{ color: '#DC2626' }} />
                Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                {isDirectMessage ? (
                  <>
                    {isGroupDm ? (
                      <div className="relative h-16 w-16 mb-4">
                        {dmInfo?.memberProfiles?.[0]?.avatar_url ? (
                          <img src={dmInfo.memberProfiles[0].avatar_url} alt="" className="absolute top-0 left-0 h-10 w-10 rounded-xl object-cover border-2 border-white" />
                        ) : (
                          <div className="absolute top-0 left-0 h-10 w-10 rounded-xl flex items-center justify-center text-lg font-bold text-white border-2 border-white" style={{ background: '#DC2626' }}>
                            {dmInfo?.memberProfiles?.[0]?.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        {dmInfo?.memberProfiles?.[1]?.avatar_url ? (
                          <img src={dmInfo.memberProfiles[1].avatar_url} alt="" className="absolute bottom-0 right-0 h-10 w-10 rounded-xl object-cover border-2 border-white" />
                        ) : (
                          <div className="absolute bottom-0 right-0 h-10 w-10 rounded-xl flex items-center justify-center text-lg font-bold text-white border-2 border-white" style={{ background: '#9B7DFF' }}>
                            {dmInfo?.memberProfiles?.[1]?.display_name?.[0]?.toUpperCase() || '+'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white mb-4" style={{ background: '#DC2626' }}>
                        {dmInfo?.otherUser?.avatar_url ? (
                          <img src={dmInfo.otherUser.avatar_url} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                        ) : (
                          dmInfo?.otherUser?.display_name?.[0]?.toUpperCase() || '?'
                        )}
                      </div>
                    )}
                    <h3 className="text-lg font-bold" style={{ color: '#1C1917' }}>{displayChannelName}</h3>
                    <p style={{ color: '#A8A29E' }}>
                      {isGroupDm
                        ? 'This is the start of your group conversation.'
                        : `This is the start of your conversation with ${displayChannelName}.`
                      }
                    </p>
                  </>
                ) : (
                  <>
                    <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#FEE2E2' }}>
                      <Hash className="h-8 w-8" style={{ color: '#DC2626' }} />
                    </div>
                    <h3 className="text-lg font-bold" style={{ color: '#1C1917' }}>Welcome to #{channel.name}!</h3>
                    <p style={{ color: '#A8A29E' }}>
                      This is the start of the #{channel.name} channel.
                      {channel.description && ` ${channel.description}`}
                    </p>
                  </>
                )}
              </div>
            ) : (
              messages.map((message, i) => {
                const prevMessage = i > 0 ? messages[i - 1] : null
                const showHeader =
                  !prevMessage ||
                  prevMessage.sender_id !== message.sender_id ||
                  new Date(message.created_at).getTime() -
                    new Date(prevMessage.created_at).getTime() >
                    5 * 60 * 1000

                const isLocked = multiDeviceEnabled &&
                  localSyncStart &&
                  message.created_at < localSyncStart &&
                  message.sender_id !== user?.id

                return isLocked ? (
                  <LockedMessage key={message.id} syncStartTime={localSyncStart!} />
                ) : (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    showHeader={showHeader}
                    isOwn={message.sender_id === user?.id}
                    channelName={channel.name}
                  />
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>
        )}

        {/* Message input or Join banner */}
        {!isAIChannel && (
          isPreview ? (
            <div className="px-5 py-4 shrink-0" style={{ borderTop: '1px solid #E7E5E4' }}>
              <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: '#FEF2F2' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: '#1C1917' }}>
                    You&apos;re previewing <strong>#{channel.name}</strong>
                  </p>
                  <p className="text-[13px]" style={{ color: '#A8A29E' }}>
                    Join this channel to start sending messages
                  </p>
                </div>
                <button
                  onClick={handleJoinPreview}
                  disabled={joiningChannel}
                  className="px-6 py-2.5 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-90 flex items-center gap-2 shrink-0"
                  style={{ background: '#DC2626' }}
                >
                  {joiningChannel ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  Join Channel
                </button>
              </div>
            </div>
          ) : (
            <MessageInput
              channelId={channel.id}
              channelName={displayChannelName}
              onSend={handleSendMessage}
              placeholder={isDirectMessage ? `Message ${displayChannelName}` : undefined}
            />
          )
        )}
      </div>

      {/* Thread panel */}
      {!isPreview && threadParentMessage && <ThreadPanel />}

      {/* User profile panel */}
      {!isPreview && profileUserId && <UserProfilePanel />}

      {/* Channel settings dialog */}
      {!isPreview && !isDirectMessage && (
        <ChannelSettingsDialog
          open={channelSettingsOpen}
          onOpenChange={setChannelSettingsOpen}
          channel={channel}
        />
      )}

      {/* Call setup dialog (shown when calls are disabled) */}
      <CallSetupDialog open={callSetupOpen} onOpenChange={setCallSetupOpen} />
    </div>
  )
}
