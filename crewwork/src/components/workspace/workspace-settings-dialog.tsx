'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Settings,
  Circle,
  Crown,
  Shield,
  ShieldCheck,
  UserMinus,
  Check,
  X,
  UserX,
  Video,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import type { Profile } from '@/types/database'

interface WorkspaceSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface MemberWithRole {
  profile: Profile
  role: 'owner' | 'admin' | 'member'
}

export function WorkspaceSettingsDialog({ open, onOpenChange }: WorkspaceSettingsDialogProps) {
  const { user, workspace, workspaceRole, setWorkspace } = useAppStore()
  const [members, setMembers] = useState<MemberWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const [callsEnabled, setCallsEnabled] = useState(false)
  const [savingCalls, setSavingCalls] = useState(false)
  const [callsSaved, setCallsSaved] = useState(false)

  const isAdmin = workspaceRole === 'admin' || workspaceRole === 'owner'
  const isOwner = workspaceRole === 'owner'

  useEffect(() => {
    if (!open) {
      setSearch('')
      setConfirmRemoveId(null)
      return
    }
    loadMembers()
    loadCallsConfig()
  }, [open])

  async function loadMembers() {
    const client = getSupabaseClient()
    if (!client || !workspace) return

    setLoading(true)
    const { data } = await client
      .from('workspace_members')
      .select('profile_id, role, profile:profiles(*)')
      .eq('workspace_id', workspace.id)

    if (data) {
      const mems = data
        .map((d) => ({
          profile: d.profile as unknown as Profile,
          role: d.role as 'owner' | 'admin' | 'member',
        }))
        .filter((m) => m.profile)
        .sort((a, b) => {
          const order = { owner: 0, admin: 1, member: 2 }
          return order[a.role] - order[b.role] || a.profile.display_name.localeCompare(b.profile.display_name)
        })

      setMembers(mems)
    }
    setLoading(false)
  }

  async function loadCallsConfig() {
    const client = getSupabaseClient()
    if (!client || !workspace) return

    const { data, error } = await client
      .from('workspaces')
      .select('calls_enabled')
      .eq('id', workspace.id)
      .maybeSingle()

    if (!error && data) {
      setCallsEnabled(data.calls_enabled || false)
    }
  }

  async function saveCallsConfig() {
    const client = getSupabaseClient()
    if (!client || !workspace) return

    setSavingCalls(true)
    setCallsSaved(false)

    try {
      const { error } = await client
        .from('workspaces')
        .update({
          calls_enabled: callsEnabled,
        })
        .eq('id', workspace.id)

      if (error) throw error
      setCallsSaved(true)
      setTimeout(() => setCallsSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save calls config:', err)
    }
    setSavingCalls(false)
  }

  async function handleChangeRole(profileId: string, newRole: 'admin' | 'member') {
    const client = getSupabaseClient()
    if (!client || !workspace) return

    try {
      await client
        .from('workspace_members')
        .update({ role: newRole })
        .eq('workspace_id', workspace.id)
        .eq('profile_id', profileId)

      setMembers((prev) =>
        prev.map((m) =>
          m.profile.id === profileId ? { ...m, role: newRole } : m
        )
      )
    } catch (err) {
      console.error('Failed to change role:', err)
    }
  }

  async function handleRemoveMember(profileId: string) {
    const client = getSupabaseClient()
    if (!client || !workspace) return

    setRemoving(true)
    try {
      const { data: channels } = await client
        .from('channels')
        .select('id')
        .eq('workspace_id', workspace.id)

      if (channels) {
        for (const ch of channels) {
          await client
            .from('channel_members')
            .delete()
            .eq('channel_id', ch.id)
            .eq('profile_id', profileId)
        }
      }

      await client
        .from('workspace_members')
        .delete()
        .eq('workspace_id', workspace.id)
        .eq('profile_id', profileId)

      setMembers((prev) => prev.filter((m) => m.profile.id !== profileId))
      setConfirmRemoveId(null)
    } catch (err) {
      console.error('Failed to remove member:', err)
    }
    setRemoving(false)
  }

  const filteredMembers = members.filter((m) =>
    m.profile.display_name.toLowerCase().includes(search.toLowerCase()) ||
    m.profile.email?.toLowerCase().includes(search.toLowerCase())
  )

  function roleLabel(role: string) {
    switch (role) {
      case 'owner': return 'Owner'
      case 'admin': return 'Admin'
      default: return 'Member'
    }
  }

  function roleIcon(role: string) {
    switch (role) {
      case 'owner':
        return <Crown className="h-3 w-3" style={{ color: '#F59E0B' }} />
      case 'admin':
        return <ShieldCheck className="h-3 w-3" style={{ color: '#DC2626' }} />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" style={{ color: '#DC2626' }} />
            Workspace Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Workspace name */}
          <div className="space-y-2">
            <Label className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
              Workspace name
            </Label>
            <div className="flex items-center gap-2.5 flex-1 px-3 py-2 rounded-lg" style={{ background: '#FEF2F2' }}>
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ background: '#DC2626' }}
              >
                {(workspace?.name || 'O')[0]?.toUpperCase()}
              </div>
              <span className="text-[15px] font-semibold" style={{ color: '#1C1917' }}>
                {workspace?.name}
              </span>
            </div>
          </div>

          {/* Members */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
                Members ({members.length})
              </Label>
            </div>

            {members.length > 5 && (
              <Input
                placeholder="Search members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: '#DC2626' }} />
              </div>
            ) : (
              <div className="space-y-1">
                {filteredMembers.map((m) => {
                  const isSelf = m.profile.id === user?.id
                  const canManage = isAdmin && !isSelf && m.role !== 'owner'
                  const canPromote = isOwner && !isSelf && m.role !== 'owner'

                  return (
                    <div
                      key={m.profile.id}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg group hover:bg-[#FEF2F2] transition-colors"
                    >
                      <div className="relative shrink-0">
                        {m.profile.avatar_url ? (
                          <img
                            src={m.profile.avatar_url}
                            alt=""
                            className="h-8 w-8 rounded-lg object-cover"
                          />
                        ) : (
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-[12px] font-bold text-white"
                            style={{ background: '#DC2626' }}
                          >
                            {m.profile.display_name[0]?.toUpperCase()}
                          </div>
                        )}
                        <Circle
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${
                            m.profile.is_online
                              ? 'fill-green-500 text-green-500'
                              : 'fill-gray-300 text-gray-300'
                          }`}
                          strokeWidth={3}
                          stroke="white"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[13px] font-medium truncate"
                            style={{ color: '#1C1917' }}
                          >
                            {m.profile.display_name}
                          </span>
                          {isSelf && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: '#FEF2F2', color: '#A8A29E' }}
                            >
                              you
                            </span>
                          )}
                          {roleIcon(m.role)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px]" style={{ color: '#A8A29E' }}>
                            {roleLabel(m.role)}
                          </span>
                          {m.profile.email && (
                            <>
                              <span style={{ color: '#C4C0D0' }}>&middot;</span>
                              <span className="text-[11px] truncate" style={{ color: '#A8A29E' }}>
                                {m.profile.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canPromote && (
                            <button
                              onClick={() =>
                                handleChangeRole(
                                  m.profile.id,
                                  m.role === 'admin' ? 'member' : 'admin'
                                )
                              }
                              className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors hover:bg-[#FEE2E2]"
                              style={{ color: '#DC2626' }}
                              title={
                                m.role === 'admin'
                                  ? 'Demote to member'
                                  : 'Promote to admin'
                              }
                            >
                              {m.role === 'admin' ? (
                                <>
                                  <Shield className="h-3 w-3" />
                                  Demote
                                </>
                              ) : (
                                <>
                                  <ShieldCheck className="h-3 w-3" />
                                  Admin
                                </>
                              )}
                            </button>
                          )}

                          {confirmRemoveId === m.profile.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRemoveMember(m.profile.id)}
                                disabled={removing}
                                className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors bg-[#FEE2E2] hover:bg-[#FECACA]"
                                style={{ color: '#E55B5B' }}
                              >
                                {removing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Confirm'
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmRemoveId(null)}
                                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#FEF2F2]"
                              >
                                <X className="h-3 w-3" style={{ color: '#A8A29E' }} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRemoveId(m.profile.id)}
                              className="h-7 w-7 rounded-md flex items-center justify-center transition-colors hover:bg-red-50"
                              title="Remove from workspace"
                            >
                              <UserMinus className="h-3.5 w-3.5" style={{ color: '#E55B5B' }} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Video Calls (LiveKit) */}
          {isAdmin && (
            <div className="space-y-3">
              <Label className="text-[13px] font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: '#A8A29E' }}>
                <Video className="h-3.5 w-3.5" />
                Video Calls (LiveKit)
              </Label>

              <div className="p-3 rounded-xl space-y-3" style={{ background: '#FEF2F2', border: '1px solid #E7E5E4' }}>
                <p className="text-[12px]" style={{ color: '#A8A29E' }}>
                  Calls are powered by{' '}
                  <a
                    href="https://livekit.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                    style={{ color: '#DC2626' }}
                  >
                    LiveKit
                  </a>
                  . Server credentials (API key, secret, URL) are configured via environment variables.
                </p>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={callsEnabled}
                      onChange={(e) => setCallsEnabled(e.target.checked)}
                      className="rounded"
                      style={{ accentColor: '#DC2626' }}
                    />
                    <span className="text-[13px] font-medium" style={{ color: '#1C1917' }}>
                      Enable calls
                    </span>
                  </label>

                  <Button
                    size="sm"
                    onClick={saveCallsConfig}
                    disabled={savingCalls}
                    className="h-8 px-4 text-[12px]"
                    style={{ background: '#DC2626', color: '#fff' }}
                  >
                    {savingCalls ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : callsSaved ? (
                      <><Check className="h-3 w-3 mr-1" />Saved</>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Your role info */}
          <div className="px-3 py-2 rounded-lg text-[12px]" style={{ background: '#FEF2F2', color: '#A8A29E' }}>
            Your role: <strong style={{ color: '#1C1917' }}>{roleLabel(workspaceRole || 'member')}</strong>
            {isAdmin && ' — You can manage members and workspace settings.'}
            {!isAdmin && ' — Contact an admin to change workspace settings.'}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
