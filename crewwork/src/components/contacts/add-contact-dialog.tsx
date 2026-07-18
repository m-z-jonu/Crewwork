'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { Circle, Search, UserPlus, Check, Clock } from 'lucide-react'
import type { Profile } from '@/types/database'

interface AddContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const { user, contacts, pendingContacts, addPendingContact } = useAppStore()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch('')
      setResults([])
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!search.trim() || !user) {
      setResults([])
      return
    }

    const timeout = setTimeout(async () => {
      const client = getSupabaseClient()
      if (!client) return

      setLoading(true)
      try {
        const { data } = await client
          .from('profiles')
          .select('*')
          .neq('id', user.id)
          .or(`display_name.ilike.%${search}%,email.ilike.%${search}%`)
          .limit(20)

        if (data) {
          setResults(data as Profile[])
        }
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timeout)
  }, [search, user])

  function getContactStatus(profileId: string): 'none' | 'accepted' | 'pending_sent' | 'pending_received' {
    // Check if already an accepted contact
    const accepted = contacts.some(
      (c) => c.contact_id === profileId || c.user_id === profileId
    )
    if (accepted) return 'accepted'

    // Check if I sent a pending request
    const sent = pendingContacts.some(
      (c) => c.user_id === user?.id && c.contact_id === profileId
    )
    if (sent) return 'pending_sent'

    // Check if they sent me a pending request
    const received = pendingContacts.some(
      (c) => c.contact_id === user?.id && c.user_id === profileId
    )
    if (received) return 'pending_received'

    return 'none'
  }

  async function sendRequest(profile: Profile) {
    const client = getSupabaseClient()
    if (!client || !user) return

    setAddingId(profile.id)
    setError(null)
    try {
      // Only insert A→B with status 'pending'
      const { data, error } = await client
        .from('contacts')
        .insert({
          user_id: user.id,
          contact_id: profile.id,
          status: 'pending',
        })
        .select()
        .single()

      if (error) throw error

      if (data) {
        addPendingContact({ ...data, contact_profile: profile })
      }
    } catch (err) {
      console.error('Failed to send request:', err)
      setError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading && (
            <p className="text-sm text-muted-foreground text-center py-4">Searching...</p>
          )}
          {!loading && search && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
          )}
          {!loading && !search && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Type a name or email to search
            </p>
          )}
          {results.map((profile) => {
            const status = getContactStatus(profile.id)
            return (
              <div
                key={profile.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors"
              >
                <div className="relative">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt={profile.display_name} className="h-8 w-8 rounded-lg object-cover" />
                    ) : (
                      profile.display_name[0]?.toUpperCase() || '?'
                    )}
                  </div>
                  <Circle
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${
                      profile.is_online
                        ? 'fill-green-500 text-green-500'
                        : 'fill-muted-foreground/30 text-muted-foreground/30'
                    }`}
                    strokeWidth={3}
                    stroke="hsl(var(--background))"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{profile.display_name}</p>
                  {profile.email && (
                    <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                  )}
                </div>
                {status === 'accepted' && (
                  <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#16A34A' }}>
                    <Check className="h-3.5 w-3.5" />
                    <span>Contact</span>
                  </div>
                )}
                {status === 'pending_sent' && (
                  <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#A8A29E' }}>
                    <Clock className="h-3.5 w-3.5" />
                    <span>Sent</span>
                  </div>
                )}
                {status === 'pending_received' && (
                  <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#DC2626' }}>
                    <Clock className="h-3.5 w-3.5" />
                    <span>Pending</span>
                  </div>
                )}
                {status === 'none' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendRequest(profile)}
                    disabled={addingId === profile.id}
                    className="shrink-0"
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
