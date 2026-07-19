'use client'

import React, { useState, useRef, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, MoreHorizontal, Pencil, Trash2, Bot } from 'lucide-react'
import { SavePostButton } from '@/components/bookmarks/save-post-button'
import { Button } from '@/components/ui/button'
import { getSupabaseClient } from '@/lib/supabase/client'
import DOMPurify from 'dompurify'
import { useAppStore } from '@/lib/store/app-store'
import { encryptForStorage } from '@/lib/crypto'
import { QUICK_REACTIONS } from './emoji-picker'
import type { Message } from '@/types/database'

const mentionNameCache: Record<string, string> = {}

function renderMessageContent(text: string, mentionNames?: Record<string, string>): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  html = html.replace(/```\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>')
  html = html.replace(/@([a-f0-9-]{36})/g, (_match, uuid) => {
    const name = mentionNames?.[uuid] || mentionNameCache[uuid] || uuid.slice(0, 8)
    return `<span class="mention-highlight">@${name}</span>`
  })
  html = html.replace(/@(\w+)/g, '<span class="mention-highlight">@$1</span>')
  html = html.replace(
    /📎\s*\[([^\]]+)\]\(([^)]+)\)/g,
    '📎 <a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  html = html.replace(
    /(?<!["\w])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  )

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['strong', 'em', 'code', 'pre', 'a', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  })
}

interface MessageBubbleProps {
  message: Message
  showHeader: boolean
  isOwn: boolean
  isThread?: boolean
  channelName?: string
}

export const MessageBubble = React.memo(function MessageBubble({ message, showHeader, isOwn, isThread, channelName = '' }: MessageBubbleProps) {
  const { user, openThread, openProfile } = useAppStore()
  const [hovered, setHovered] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [mentionNames, setMentionNames] = useState<Record<string, string>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const sender = message.sender
  const displayName = sender?.display_name || 'Unknown'
  const initial = displayName[0]?.toUpperCase() || '?'
  const time = formatDistanceToNow(new Date(message.created_at), { addSuffix: true })
  const isAIMessage = message.sender_id === (process.env.NEXT_PUBLIC_AI_AGENT_ID ?? '00000000-0000-0000-0000-000000000000')

  useEffect(() => {
    const uuids = [...message.content.matchAll(/@([a-f0-9-]{36})/g)].map((m) => m[1])
    if (uuids.length === 0) return

    const uncached = uuids.filter((id) => !mentionNameCache[id])
    if (uncached.length === 0) {
      setMentionNames({ ...mentionNameCache })
      return
    }

    const client = getSupabaseClient()
    if (!client) return

    client
      .from('profiles')
      .select('id, display_name')
      .in('id', uncached)
      .then(({ data }) => {
        if (data) {
          const resolved: Record<string, string> = { ...mentionNameCache }
          data.forEach((p: { id: string; display_name: string }) => {
            mentionNameCache[p.id] = p.display_name
            resolved[p.id] = p.display_name
          })
          setMentionNames(resolved)
        }
      })
  }, [message.content])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showMoreMenu])

  async function handleEdit() {
    const client = getSupabaseClient()
    if (!client || !editContent.trim()) return

    // Encrypt content before updating in Supabase
    const encryptedContent = await encryptForStorage(
      editContent.trim(),
      message.channel_id,
      message.sender_id || ''
    )

    await client.from('messages').update({ content: encryptedContent, is_edited: true }).eq('id', message.id)
    message.content = editContent.trim()
    message.is_edited = true
    setEditing(false)
  }

  async function handleDelete() {
    const client = getSupabaseClient()
    if (!client) return
    await client.from('messages').update({ is_deleted: true }).eq('id', message.id)
    setShowMoreMenu(false)
  }

  const showToolbar = hovered || showMoreMenu

  return (
    <div ref={containerRef}>
      <div
        className={`relative flex gap-2.5 px-3 -mx-3 rounded-xl ${showHeader ? 'pt-2 py-1' : 'py-0.5'} ${showToolbar ? 'bg-[#FEF2F2]' : 'hover:bg-[#FEF2F2]'}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* ACTION TOOLBAR */}
        {showToolbar && !editing && (
          <div className="absolute top-0 right-2 flex items-center bg-white border border-[#E7E5E4] rounded-xl shadow-sm z-10 -translate-y-1/2">
            {/* Quick reactions */}
            <div className="flex items-center gap-0.5 px-1">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  className="h-8 w-8 flex items-center justify-center hover:bg-[#FEF2F2] rounded-lg transition-colors text-sm"
                  title={`React with ${emoji}`}
                  onClick={async () => {
                    const client = getSupabaseClient()
                    if (!client || !user) return
                    // Store reaction as a message reply with emoji prefix
                    await client.from('messages').insert({
                      channel_id: message.channel_id,
                      sender_id: user.id,
                      content: emoji,
                      parent_id: message.id,
                    })
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-[#E7E5E4]" />
            <SavePostButton message={message} channelName={channelName} />
            <div className="w-px h-6 bg-[#E7E5E4]" />
            {!isThread && (
              <button
                onClick={() => openThread(message)}
                className="h-8 w-8 flex items-center justify-center hover:bg-[#FEF2F2] rounded-xl transition-colors text-[#A8A29E]"
                title="Reply in thread"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => { setShowMoreMenu(!showMoreMenu) }}
                className="h-8 w-8 flex items-center justify-center hover:bg-[#FEF2F2] rounded-xl transition-colors text-[#A8A29E]"
                title="More actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-9 bg-white border border-[#E7E5E4] rounded-xl shadow-lg py-1 min-w-[180px] z-50">
                  {isOwn && (
                    <button
                      onClick={() => { setEditing(true); setEditContent(message.content); setShowMoreMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#FEF2F2] text-left text-[#1C1917] rounded-lg mx-0"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit message
                    </button>
                  )}
                  {!isThread && (
                    <button
                      onClick={() => { openThread(message); setShowMoreMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#FEF2F2] text-left text-[#1C1917] rounded-lg"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Reply in thread
                    </button>
                  )}
                  {isOwn && (
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-50 text-[#E55B5B] text-left rounded-lg"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete message
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AVATAR / TIMESTAMP */}
        {showHeader ? (
          <button
            onClick={() => message.sender_id && openProfile(message.sender_id)}
            className="h-9 w-9 rounded-xl shrink-0 mt-0.5 hover:opacity-80 transition-opacity cursor-pointer overflow-hidden"
          >
            {sender?.avatar_url ? (
              <img src={sender.avatar_url} alt={displayName} className="h-9 w-9 rounded-xl object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: '#DC2626' }}>
                {initial}
              </div>
            )}
          </button>
        ) : (
          <div className="w-9 shrink-0 flex items-center justify-center">
            <span className={`text-[10px] text-[#A8A29E] transition-opacity ${showToolbar ? 'opacity-100' : 'opacity-0'}`}>
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {/* CONTENT */}
        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="flex items-baseline gap-2">
              <button
                onClick={() => message.sender_id && openProfile(message.sender_id)}
                className="font-semibold text-[15px] hover:underline cursor-pointer"
                style={{ color: '#1C1917' }}
              >
                {displayName}
              </button>
              {isAIMessage && (
                <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                  <Bot className="w-3 h-3" />
                  AI
                </span>
              )}
              <span className="text-xs" style={{ color: '#A8A29E' }}>{time}</span>
              {message.is_edited && <span className="text-xs italic" style={{ color: '#A8A29E' }}>(edited)</span>}
            </div>
          )}
          {editing ? (
            <div className="mt-1">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full text-[15px] bg-white rounded-xl p-3 border border-[#E7E5E4] focus:outline-none focus:ring-2 focus:ring-[#DC2626] focus:border-transparent"
                rows={2}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit() }
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={handleEdit} style={{ background: '#DC2626', color: '#fff' }}>Save</Button>
              </div>
            </div>
          ) : (
            <div
              className="text-[15px] leading-[1.5] whitespace-pre-wrap break-words message-content"
              style={{ color: '#1C1917' }}
              dangerouslySetInnerHTML={{ __html: renderMessageContent(message.content, mentionNames) }}
            />
          )}
        </div>
      </div>

      {/* THREAD INDICATOR */}
      {!isThread && message.thread_reply_count > 0 && (
        <button
          onClick={() => openThread(message)}
          className="flex items-center gap-1.5 ml-11 mt-1 text-xs hover:underline font-semibold"
          style={{ color: '#DC2626' }}
        >
          <MessageSquare className="h-3 w-3" />
          {message.thread_reply_count} {message.thread_reply_count === 1 ? 'reply' : 'replies'}
        </button>
      )}
    </div>
  )
})
