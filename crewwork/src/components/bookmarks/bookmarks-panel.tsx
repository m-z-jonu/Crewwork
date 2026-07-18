'use client'

import { useState, useEffect } from 'react'
import { X, Bookmark, Trash2, Loader2, Tag, Zap, ChevronLeft } from 'lucide-react'
import { db } from '@/lib/local/db'
import { useAppStore } from '@/lib/store/app-store'
import { formatDistanceToNow } from 'date-fns'
import type { SavedPost, CompressedKnowledge } from '@/types/database'

interface BookmarksPanelProps {
  open: boolean
  onClose: () => void
}

export function BookmarksPanel({ open, onClose }: BookmarksPanelProps) {
  const { user } = useAppStore()
  const [posts, setPosts] = useState<SavedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPost, setSelectedPost] = useState<SavedPost | null>(null)
  const [knowledge, setKnowledge] = useState<CompressedKnowledge | null>(null)
  const [loadingKnowledge, setLoadingKnowledge] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user) return
    let cancelled = false
    async function load() {
      if (!user) return
      setLoading(true)
      try {
        const allPosts = await db.savedPosts
          .where('userId')
          .equals(user.id)
          .reverse()
          .sortBy('savedAt')
        if (!cancelled) {
          setPosts(allPosts)
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to load saved posts:', err)
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, user])

  async function loadKnowledge(savedPostId: string) {
    setLoadingKnowledge(true)
    setKnowledge(null)
    try {
      const result = await db.compressedKnowledge
        .where('savedPostId')
        .equals(savedPostId)
        .first()
      setKnowledge(result || null)
    } catch (err) {
      console.error('Failed to load knowledge:', err)
    }
    setLoadingKnowledge(false)
  }

  async function handleDelete(post: SavedPost) {
    setDeleting(post.id)
    try {
      await db.compressedKnowledge.where('savedPostId').equals(post.id).delete()
      await db.savedPosts.delete(post.id)
      setPosts((prev) => prev.filter((p) => p.id !== post.id))
      if (selectedPost?.id === post.id) {
        setSelectedPost(null)
        setKnowledge(null)
      }
    } catch (err) {
      console.error('Failed to delete post:', err)
    }
    setDeleting(null)
  }

  function handleSelectPost(post: SavedPost) {
    setSelectedPost(post)
    if (post.compressed) {
      loadKnowledge(post.id)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-80 h-full shadow-2xl animate-in slide-in-from-right duration-200 flex flex-col"
        style={{ background: '#FDFCFA' }}
      >
        {/* Header */}
        <div className="px-5 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid #E7E5E4' }}>
          <div className="flex items-center gap-2">
            {selectedPost && (
              <button
                onClick={() => { setSelectedPost(null); setKnowledge(null) }}
                className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
                style={{ color: '#A8A29E' }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4" style={{ color: '#DC2626' }} />
              <span className="font-semibold text-[15px]" style={{ color: '#1C1917' }}>
                {selectedPost ? 'Saved Post' : 'Knowledge Base'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#FEF2F2]"
            style={{ color: '#A8A29E' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {selectedPost ? (
            /* Detail view */
            <div className="p-4 space-y-4">
              {/* Meta */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                    #{selectedPost.channelName || 'channel'}
                  </span>
                  <span className="text-xs" style={{ color: '#A8A29E' }}>
                    {formatDistanceToNow(new Date(selectedPost.savedAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs" style={{ color: '#A8A29E' }}>
                  by {selectedPost.senderName}
                </p>
              </div>

              {/* Original content */}
              <div className="p-3 rounded-xl text-[14px] leading-relaxed whitespace-pre-wrap" style={{ background: '#ffffff', border: '1px solid #E7E5E4', color: '#1C1917' }}>
                {selectedPost.content}
              </div>

              {/* AI compression status */}
              {selectedPost.compressed ? (
                loadingKnowledge ? (
                  <div className="flex items-center justify-center py-4 gap-2" style={{ color: '#A8A29E' }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading analysis...</span>
                  </div>
                ) : knowledge ? (
                  <div className="space-y-3">
                    {/* Summary */}
                    {knowledge.summary && (
                      <div className="p-3 rounded-xl" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Zap className="h-3 w-3" style={{ color: '#DC2626' }} />
                          <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>AI Summary</span>
                        </div>
                        <p className="text-[13px] leading-relaxed" style={{ color: '#1C1917' }}>
                          {knowledge.summary}
                        </p>
                      </div>
                    )}

                    {/* Concepts */}
                    {knowledge.concepts.length > 0 && (
                      <div>
                        <span className="text-xs font-semibold mb-1.5 block" style={{ color: '#78716C' }}>Key Concepts</span>
                        <div className="flex flex-wrap gap-1.5">
                          {knowledge.concepts.map((concept, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
                            >
                              {concept}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Items */}
                    {knowledge.actionItems.length > 0 && (
                      <div>
                        <span className="text-xs font-semibold mb-1.5 block" style={{ color: '#78716C' }}>Action Items</span>
                        <div className="space-y-1">
                          {knowledge.actionItems.map((item, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 text-[13px] p-2 rounded-lg"
                              style={{ background: '#ffffff', border: '1px solid #E7E5E4' }}
                            >
                              <span style={{ color: '#DC2626' }}>-</span>
                              <span style={{ color: '#1C1917' }}>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {knowledge.tags.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Tag className="h-3 w-3" style={{ color: '#A8A29E' }} />
                          <span className="text-xs font-semibold" style={{ color: '#78716C' }}>Tags</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {knowledge.tags.map((tag, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: '#ffffff', color: '#78716C', border: '1px solid #E7E5E4' }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm" style={{ color: '#A8A29E' }}>No AI analysis available</p>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center gap-2 py-4" style={{ color: '#A8A29E' }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">AI analysis in progress...</span>
                </div>
              )}

              {/* Delete */}
              <button
                onClick={() => handleDelete(selectedPost)}
                disabled={deleting === selectedPost.id}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-red-50"
                style={{ color: '#E55B5B', border: '1px solid #E7E5E4' }}
              >
                {deleting === selectedPost.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Remove from knowledge base
              </button>
            </div>
          ) : (
            /* List view */
            <div className="p-2">
              {loading ? (
                <div className="flex items-center justify-center py-12 gap-2" style={{ color: '#A8A29E' }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="h-12 w-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: '#FEF2F2' }}>
                    <Bookmark className="h-6 w-6" style={{ color: '#DC2626' }} />
                  </div>
                  <p className="text-sm font-medium mb-1" style={{ color: '#1C1917' }}>No saved posts yet</p>
                  <p className="text-xs" style={{ color: '#A8A29E' }}>
                    Hover over a message and click the bookmark icon to save it to your knowledge base.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {posts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => handleSelectPost(post)}
                      className="w-full text-left p-3 rounded-xl transition-all hover:shadow-sm group"
                      style={{ background: '#ffffff', border: '1px solid #E7E5E4' }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                            #{post.channelName || 'channel'}
                          </span>
                          {post.compressed && (
                            <span title="AI analyzed">
                              <Zap className="h-3 w-3 shrink-0" style={{ color: '#F59E0B' }} />
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(post) }}
                          disabled={deleting === post.id}
                          className="h-6 w-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 shrink-0"
                          style={{ color: '#E55B5B' }}
                        >
                          {deleting === post.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      <p className="text-[13px] line-clamp-2 mb-1" style={{ color: '#1C1917' }}>
                        {post.content}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px]" style={{ color: '#A8A29E' }}>
                          {post.senderName}
                        </span>
                        <span className="text-[11px]" style={{ color: '#A8A29E' }}>
                          {formatDistanceToNow(new Date(post.savedAt), { addSuffix: true })}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
