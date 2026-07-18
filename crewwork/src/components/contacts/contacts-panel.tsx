'use client'

import { useState } from 'react'
import { X, Search, Circle, UserMinus, MessageCircle, Check, XIcon, UserPlus } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { getSupabaseClient } from '@/lib/supabase/client'
import { AddContactDialog } from './add-contact-dialog'
import type { Profile, Contact } from '@/types/database'

interface ContactsPanelProps {
  open: boolean
  onClose: () => void
}

export function ContactsPanel({ open, onClose }: ContactsPanelProps) {
  const { contacts, pendingContacts, user, setCurrentChannelId, personalWorkspace, unhideDm, removePendingContact, acceptPendingContact, addContact } = useAppStore()
  const [search, setSearch] = useState('')
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Pending requests I RECEIVED (others wanting to add me)
  const myPendingRequests = pendingContacts.filter(
    (c) => c.contact_id === user?.id && c.status === 'pending'
  )

  const filtered = contacts.filter((c) => {
    const profile = c.contact_profile
    if (!profile) return false
    const q = search.toLowerCase()
    return (
      profile.display_name.toLowerCase().includes(q) ||
      profile.email?.toLowerCase().includes(q)
    )
  })

  async function removeContact(contactId: string) {
    const client = getSupabaseClient()
    if (!client) return
    setRemoving(contactId)
    try {
      await client.from('contacts').delete().eq('id', contactId)
      useAppStore.getState().removeContact(contactId)
    } catch (err) {
      console.error('Failed to remove contact:', err)
    } finally {
      setRemoving(null)
    }
  }

  async function acceptRequest(request: Contact) {
    const client = getSupabaseClient()
    if (!client || !user) return

    setProcessingId(request.id)
    try {
      // 1. Update A→B row to 'accepted'
      await client
        .from('contacts')
        .update({ status: 'accepted' })
        .eq('id', request.id)

      // 2. Insert reverse B→A row with 'accepted'
      const { data: reverseContact } = await client
        .from('contacts')
        .insert({
          user_id: user.id,
          contact_id: request.user_id,
          status: 'accepted',
        })
        .select('*, contact_profile:profiles(*)')
        .single()

      // 3. Remove from pending, add to accepted contacts
      acceptPendingContact(request.id)

      if (reverseContact) {
        addContact(reverseContact as Contact)
      }
    } catch (err) {
      console.error('Failed to accept request:', err)
    } finally {
      setProcessingId(null)
    }
  }

  async function rejectRequest(request: Contact) {
    const client = getSupabaseClient()
    if (!client) return

    setProcessingId(request.id)
    try {
      await client.from('contacts').delete().eq('id', request.id)
      removePendingContact(request.id)
    } catch (err) {
      console.error('Failed to reject request:', err)
    } finally {
      setProcessingId(null)
    }
  }

  async function startDm(contact: Profile) {
    const client = getSupabaseClient()
    if (!client || !user || !personalWorkspace) return

    const ids = [user.id, contact.id].sort()
    const dmName = `dm-${ids[0].slice(0, 8)}-${ids[1].slice(0, 8)}`

    const { data: existing } = await client
      .from('channels')
      .select('*')
      .eq('workspace_id', personalWorkspace.id)
      .eq('name', dmName)
      .limit(1)

    let channelId: string

    if (existing && existing.length > 0) {
      channelId = existing[0].id
      const state = useAppStore.getState()
      if (state.hiddenDmIds.includes(channelId)) {
        unhideDm(channelId)
      }
    } else {
      const id = crypto.randomUUID()
      const { error } = await client.from('channels').insert({
        id,
        workspace_id: personalWorkspace.id,
        name: dmName,
        description: `DM between ${user.display_name} and ${contact.display_name}`,
        is_private: true,
        created_by: user.id,
      })
      if (error) throw error

      const { error: memberError } = await client.from('channel_members').insert([
        { channel_id: id, profile_id: user.id, role: 'admin' },
        { channel_id: id, profile_id: contact.id, role: 'admin' },
      ])
      if (memberError) throw memberError
      channelId = id
    }

    const { data: channelData } = await client
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .single()

    if (channelData) {
      useAppStore.getState().addDmChannel({ ...channelData, otherUser: contact })
    }

    setCurrentChannelId(channelId)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-[400px] max-w-[90vw] h-full shadow-2xl animate-in slide-in-from-right duration-200 flex flex-col"
        style={{ background: '#FEF2F2' }}
      >
        {/* Header */}
        <div className="px-4 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid #FECACA' }}>
          <h2 className="text-[16px] font-[800]" style={{ color: '#1C1917' }}>Contacts</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#FECACA]"
            style={{ color: '#A8A29E' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + Add button */}
        <div className="px-4 py-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#A8A29E' }} />
            <input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl text-[13px] bg-white border border-[#E7E5E4] focus:outline-none focus:ring-2 focus:ring-[#DC2626]/20"
              style={{ color: '#1C1917' }}
            />
          </div>
          <button
            onClick={() => setAddContactOpen(true)}
            className="px-3 py-2 rounded-xl text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: '#DC2626' }}
          >
            Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {/* Pending Requests Section */}
          {myPendingRequests.length > 0 && (
            <div className="mb-4">
              <div className="px-2 py-0.5 mb-0.5">
                <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: '#DC2626' }}>
                  Pending Requests ({myPendingRequests.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {myPendingRequests.map((request) => {
                  const profile = request.contact_profile
                  if (!profile) return null
                  const isProcessing = processingId === request.id
                  return (
                    <div
                      key={request.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
                      style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}
                    >
                      <div className="relative shrink-0">
                        {profile.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt={profile.display_name}
                            className="h-9 w-9 rounded-xl object-cover"
                          />
                        ) : (
                          <div
                            className="h-9 w-9 rounded-xl flex items-center justify-center text-[14px] font-bold text-white"
                            style={{ background: '#DC2626' }}
                          >
                            {profile.display_name[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium truncate" style={{ color: '#1C1917' }}>
                          {profile.display_name}
                        </p>
                        {profile.email && (
                          <p className="text-[12px] truncate" style={{ color: '#A8A29E' }}>
                            {profile.email}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => acceptRequest(request)}
                          disabled={isProcessing}
                          className="h-7 w-7 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: '#16A34A', color: '#fff' }}
                          title="Accept"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => rejectRequest(request)}
                          disabled={isProcessing}
                          className="h-7 w-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[#FEE2E2]"
                          style={{ color: '#A8A29E' }}
                          title="Reject"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Contacts List */}
          {filtered.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-[14px] font-medium mb-1" style={{ color: '#78716C' }}>
                {search ? 'No contacts found' : 'No contacts yet'}
              </p>
              <p className="text-[12px]" style={{ color: '#A8A29E' }}>
                {search ? 'Try a different search' : 'Click "Add" to find people'}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((contact) => {
                const profile = contact.contact_profile
                if (!profile) return null
                return (
                  <div
                    key={contact.id}
                    className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#FECACA] transition-colors"
                  >
                    <button
                      onClick={() => startDm(profile)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="relative shrink-0">
                        {profile.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt={profile.display_name}
                            className="h-9 w-9 rounded-xl object-cover"
                          />
                        ) : (
                          <div
                            className="h-9 w-9 rounded-xl flex items-center justify-center text-[14px] font-bold text-white"
                            style={{ background: '#DC2626' }}
                          >
                            {profile.display_name[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        <Circle
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${
                            profile.is_online
                              ? 'fill-green-500 text-green-500'
                              : 'fill-gray-300 text-gray-300'
                          }`}
                          strokeWidth={3}
                          stroke="#FEF2F2"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium truncate" style={{ color: '#1C1917' }}>
                          {profile.display_name}
                        </p>
                        {profile.email && (
                          <p className="text-[12px] truncate" style={{ color: '#A8A29E' }}>
                            {profile.email}
                          </p>
                        )}
                      </div>
                      <MessageCircle
                        className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: '#DC2626' }}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeContact(contact.id)
                      }}
                      disabled={removing === contact.id}
                      className="h-7 w-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#FEE2E2] shrink-0"
                      title="Remove contact"
                      style={{ color: '#A8A29E' }}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <AddContactDialog open={addContactOpen} onOpenChange={setAddContactOpen} />
      </div>
    </div>
  )
}
