'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { Todo } from '@/types/database'

interface TodoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTodo?: Todo | null
}

export function TodoDialog({ open, onOpenChange, editTodo }: TodoDialogProps) {
  const { user, workspace, channels, addTodo, updateTodo } = useAppStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Todo['status']>('TODO')
  const [priority, setPriority] = useState<Todo['priority']>('medium')
  const [channelId, setChannelId] = useState<string>('none')
  const [assignedTo, setAssignedTo] = useState<string>('none')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editTodo) {
      setTitle(editTodo.title)
      setDescription(editTodo.description || '')
      setStatus(editTodo.status)
      setPriority(editTodo.priority)
      setChannelId(editTodo.channel_id || 'none')
      setAssignedTo(editTodo.assigned_to || 'none')
      setDueDate(editTodo.due_date ? editTodo.due_date.split('T')[0] : '')
    } else {
      setTitle('')
      setDescription('')
      setStatus('TODO')
      setPriority('medium')
      setChannelId('none')
      setAssignedTo('none')
      setDueDate('')
    }
  }, [editTodo, open])

  async function handleSave() {
    if (!user || !workspace || !title.trim()) return

    setSaving(true)
    const client = getSupabaseClient()
    if (!client) return

    const todoData = {
      workspace_id: workspace.id,
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      channel_id: channelId === 'none' ? null : channelId,
      assigned_to: assignedTo === 'none' ? null : assignedTo,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    }

    try {
      if (editTodo) {
        const { data, error } = await client
          .from('todos')
          .update({ ...todoData, updated_at: new Date().toISOString() })
          .eq('id', editTodo.id)
          .select()
          .single()

        if (error) throw error
        updateTodo(editTodo.id, data as Todo)
      } else {
        const { data, error } = await client
          .from('todos')
          .insert({
            ...todoData,
            created_by: user.id,
          })
          .select()
          .single()

        if (error) throw error
        addTodo(data as Todo)
      }

      onOpenChange(false)
    } catch (err) {
      console.error('Failed to save todo:', err)
    }
    setSaving(false)
  }

  const regularChannels = channels.filter(
    (c) => !c.name.startsWith('dm-') && !c.name.startsWith('gdm-')
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editTodo ? 'Edit Todo' : 'New Todo'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
              Title
            </Label>
            <Input
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 text-[13px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
              Description
            </Label>
            <Textarea
              placeholder="Add details (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="text-[13px] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Todo['status'])}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODO">To Do</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="DONE">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
                Priority
              </Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Todo['priority'])}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
                Channel
              </Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {regularChannels.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      #{ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
                Due Date
              </Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 text-[13px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="h-9 px-4 text-[13px]"
              style={{ background: '#DC2626', color: '#fff' }}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : editTodo ? (
                'Update'
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
