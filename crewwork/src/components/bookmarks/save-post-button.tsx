'use client'

import { useState, useEffect } from 'react'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import { db } from '@/lib/local/db'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import type { Message } from '@/types/database'

interface SavePostButtonProps {
  message: Message
  channelName: string
}

export function SavePostButton({ message, channelName }: SavePostButtonProps) {
  const { user } = useAppStore()
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    db.savedPosts
      .where('messageId')
      .equals(message.id)
      .first()
      .then((existing) => {
        if (existing) setSaved(true)
      })
  }, [message.id, user])

  async function handleSave() {
    if (!user || saved || loading) return
    setLoading(true)

    try {
      const id = crypto.randomUUID()
      await db.savedPosts.add({
        id,
        userId: user.id,
        messageId: message.id,
        channelId: message.channel_id,
        channelName,
        senderId: message.sender_id || '',
        senderName: message.sender?.display_name || 'Unknown',
        content: message.content,
        savedAt: new Date().toISOString(),
        compressed: false,
      })
      setSaved(true)
      compressInBackground(id, message.content, channelName, message.sender?.display_name || 'Unknown')
    } catch (err) {
      console.error('Failed to save post:', err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <button className="h-8 w-8 flex items-center justify-center rounded-lg" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#A8A29E' }} />
      </button>
    )
  }

  return (
    <button
      onClick={handleSave}
      className="h-8 w-8 flex items-center justify-center hover:bg-[#FEF2F2] rounded-lg transition-colors"
      title={saved ? 'Saved' : 'Save to knowledge base'}
    >
      {saved ? (
        <BookmarkCheck className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
      ) : (
        <Bookmark className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
      )}
    </button>
  )
}

async function compressInBackground(
  savedPostId: string,
  content: string,
  channelName: string,
  senderName: string
) {
  try {
    const client = getSupabaseClient()
    const { data: { session } } = await client?.auth.getSession() || { data: { session: null } }

    const res = await fetch('/api/ai/compress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ content, channelName, senderName }),
    })
    if (!res.ok) return
    const result = await res.json()
    const post = await db.savedPosts.get(savedPostId)
    if (!post) return
    await db.compressedKnowledge.add({
      id: crypto.randomUUID(),
      userId: post.userId,
      savedPostId,
      concepts: result.concepts || [],
      relationships: result.relationships || [],
      actionItems: result.actionItems || [],
      summary: result.summary || '',
      tags: result.tags || [],
      compressedAt: new Date().toISOString(),
    })
    await db.savedPosts.update(savedPostId, { compressed: true })
  } catch (err) {
    console.error('Background compression failed:', err)
  }
}
