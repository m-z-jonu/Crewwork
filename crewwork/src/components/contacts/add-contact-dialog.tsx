'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { Circle, Search, UserPlus, Check, Clock, UserCheck } from 'lucide-react'
import { contactErrorMessage, sendContactRequest, acceptContactRequest } from '@/lib/contacts'
import type { Profile } from '@/types/database'

interface AddContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const { user, contacts, pendingContacts, suggestedContacts, addPendingContact, acceptPendingContact, addContact } = useAppStore()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch('')
      setResults([])
      setError(null)
      setSuccess(null)
    }
  }, [open])

  useEffect(() => {
    if (!search.trim() || !user) {
      setResults([])
      return
    }

    const controller = new AbortController()

    const timer = setTimeout(async () => {
      const client = getSupabaseClient()
      if (!client) return

      setLoading(true)
      try {
        const { data: { session } } = await client.auth.getSession()

        const res = await fetch(`/api/users/search?q=${encodeURIComponent(search.trim())}`, {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
          signal: controller.signal,
        })

        if (!res.ok) {
          const err = await res.json()
          setError(err.error || 'Search failed')
          setLoading(false)
          return
        }

        const { users } = await res.json()
        setResults(users || [])
        setError(null)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Search failed:', err)
          setError('Search failed. Please try again.')
        }
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
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
    setSuccess(null)
    try {
      const { row, alreadyExisted, error: sendError } = await sendContactRequest(client, user, profile)

      if (sendError) {
        setError(sendError)
        return
      }

      if (row) {
        // Sync store — works for both a fresh request and one that already
        // existed in the database (state was lost on reload)
        addPendingContact({ ...row, contact_profile: profile })
        setSuccess(
          alreadyExisted
            ? `Request to ${profile.display_name} is already pending`
            : `Request sent to ${profile.display_name}`
        )
      }
    } catch (err) {
      console.error('Failed to send request:', err)
      setError(contactErrorMessage(err))
    } finally {
      setAddingId(null)
    }
  }

  async function acceptRequest(profile: Profile) {
    const client = getSupabaseClient()
    if (!client || !user) return

    const request = pendingContacts.find(
      (c) => c.user_id === profile.id && c.contact_id === user.id && c.status === 'pending'
    )
    if (!request) {
      setError('This request is no longer available.')
      return
    }

    setAddingId(profile.id)
    setError(null)
    setSuccess(null)
    try {
      const { reverseContact, error: acceptError } = await acceptContactRequest(client, user, request)
      if (acceptError) {
        setError(acceptError)
        return
      }
      acceptPendingContact(request.id)
      if (reverseContact) addContact(reverseContact)
      setSuccess(`You and ${profile.display_name} are now contacts`)
    } catch (err) {
      console.error('Failed to accept request:', err)
      setError(contactErrorMessage(err))
    } finally {
      setAddingId(null)
    }
  }

  function contactAction(profile: Profile) {
    const status = getContactStatus(profile.id)
    const busy = addingId === profile.id

    if (status === 'accepted') {
      return (
        <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#16A34A' }}>
          <Check className="h-3.5 w-3.5" />
          <span>Contact</span>
        </div>
      )
    }
    if (status === 'pending_sent') {
      return (
        <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#A8A29E' }}>
          <Clock className="h-3.5 w-3.5" />
          <span>Sent</span>
        </div>
      )
    }
    if (status === 'pending_received') {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => acceptRequest(profile)}
          disabled={busy}
          className="shrink-0"
        >
          <UserCheck className="h-3.5 w-3.5 mr-1" />
          Accept
        </Button>
      )
    }
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => sendRequest(profile)}
        disabled={busy}
        className="shrink-0"
      >
        <UserPlus className="h-3.5 w-3.5 mr-1" />
        Add
      </Button>
    )
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
        {success && (
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#DCFCE7', color: '#16A34A' }}>
            {success}
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
          {!loading && !search && suggestedContacts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Type a name or email to search
            </p>
          )}

          {/* Suggestions when search is empty */}
          {!loading && !search && suggestedContacts.length > 0 && (
            <div className="space-y-3 mt-2">
              <p className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: '#A8A29E' }}>
                People You May Know
              </p>
              <div className="space-y-1">
                {suggestedContacts.slice(0, 5).map((profile) => (
                  <div key={profile.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    <div className="relative">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {profile.avatar_url ? (
                          <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                        ) : (
                          profile.display_name[0]?.toUpperCase() || '?'
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{profile.display_name}</p>
                      {profile.email && (
                        <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                      )}
                    </div>
                    {contactAction(profile)}
                  </div>
                ))}
              </div>
            </div>
          )}
          {results.map((profile) => {
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
                {contactAction(profile)}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
