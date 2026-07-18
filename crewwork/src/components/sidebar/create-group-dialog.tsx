'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/lib/store/app-store'
import { getSupabaseClient } from '@/lib/supabase/client'
import { Circle, X, Users, Check } from 'lucide-react'
import type { Profile } from '@/types/database'

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const { user, contacts, personalWorkspace, setCurrentChannelId, addDmChannel } = useAppStore()
  const [selectedMembers, setSelectedMembers] = useState<Profile[]>([])
  const [groupName, setGroupName] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = contacts
    .map((c) => c.contact_profile)
    .filter((p): p is Profile => !!p && p.id !== user?.id)
    .filter((p) => {
      const q = search.toLowerCase()
      return (
        p.display_name.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q)
      )
    })

  function toggleMember(member: Profile) {
    setSelectedMembers((prev) => {
      const exists = prev.some((m) => m.id === member.id)
      if (exists) return prev.filter((m) => m.id !== member.id)
      return [...prev, member]
    })
  }

  async function createGroup() {
    const client = getSupabaseClient()
    if (!client || !user || !personalWorkspace || selectedMembers.length < 1) return

    setLoading(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const gdmName = `gdm-${id.slice(0, 12)}`
      const memberNames = selectedMembers.map((m) => m.display_name).join(', ')
      const autoName = groupName.trim() || `${user.display_name}, ${memberNames}`

      const { error } = await client.from('channels').insert({
        id,
        workspace_id: personalWorkspace.id,
        name: gdmName,
        description: autoName,
        is_private: isPrivate,
        created_by: user.id,
      })
      if (error) throw error

      const memberInserts = [
        { channel_id: id, profile_id: user.id, role: 'admin' },
        ...selectedMembers.map((m) => ({
          channel_id: id,
          profile_id: m.id,
          role: 'member' as string,
        })),
      ]
      await client.from('channel_members').insert(memberInserts)

      const { data: channelData } = await client
        .from('channels')
        .select('*')
        .eq('id', id)
        .single()

      if (channelData) {
        addDmChannel({ ...channelData, memberProfiles: selectedMembers })
      }

      setCurrentChannelId(id)
      onOpenChange(false)
      setSelectedMembers([])
      setGroupName('')
      setSearch('')
    } catch (err) {
      console.error('Failed to create group:', err)
      setError(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setSelectedMembers([])
    setGroupName('')
    setSearch('')
    setIsPrivate(false)
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
        </DialogHeader>

        {/* Group name */}
        <div className="space-y-2">
          <Label htmlFor="group-name">Group Name (optional)</Label>
          <Input
            id="group-name"
            placeholder="e.g., Weekend Plans"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>

        {/* Visibility toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-sm">Visibility</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: isPrivate ? '#A8A29E' : '#1C1917' }}>Public</span>
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              style={{ background: isPrivate ? '#DC2626' : '#E7E5E4' }}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPrivate ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
            <span className="text-sm" style={{ color: isPrivate ? '#1C1917' : '#A8A29E' }}>Private</span>
          </div>
        </div>

        {/* Selected members chips */}
        {selectedMembers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
              >
                {member.display_name}
                <button onClick={() => toggleMember(member)} className="hover:opacity-70">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <Input
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && (
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {error}
          </div>
        )}

        {/* Contacts list */}
        <div className="max-h-48 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {search ? 'No contacts found' : 'No contacts available'}
            </p>
          ) : (
            filtered.map((member) => {
              const isSelected = selectedMembers.some((m) => m.id === member.id)
              return (
                <button
                  key={member.id}
                  onClick={() => toggleMember(member)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors text-left"
                >
                  <div className="relative">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt={member.display_name} className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        member.display_name[0]?.toUpperCase() || '?'
                      )}
                    </div>
                    <Circle
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${
                        member.is_online
                          ? 'fill-green-500 text-green-500'
                          : 'fill-muted-foreground/30 text-muted-foreground/30'
                      }`}
                      strokeWidth={3}
                      stroke="hsl(var(--background))"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{member.display_name}</p>
                  </div>
                  <div
                    role="checkbox"
                    aria-checked={isSelected}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleMember(member)
                    }}
                    className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#DC2626] border-[#DC2626] text-white'
                        : 'border-[#FECACA] hover:border-[#DC2626]'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Create button */}
        <Button
          onClick={createGroup}
          disabled={loading || selectedMembers.length < 1}
          className="w-full"
          style={{ background: '#DC2626', color: '#fff' }}
        >
          <Users className="h-4 w-4 mr-2" />
          Create Group ({selectedMembers.length + 1} people)
        </Button>
      </DialogContent>
    </Dialog>
  )
}
