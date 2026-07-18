'use client'

import { useState, useEffect } from 'react'
import { Plus, LayoutGrid, List, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppStore } from '@/lib/store/app-store'
import { getSupabaseClient } from '@/lib/supabase/client'
import { TodoCard } from './todo-card'
import { TodoDialog } from './todo-dialog'
import type { Todo } from '@/types/database'

const COLUMNS: { status: Todo['status']; label: string; color: string }[] = [
  { status: 'TODO', label: 'To Do', color: '#A8A29E' },
  { status: 'IN_PROGRESS', label: 'In Progress', color: '#F59E0B' },
  { status: 'DONE', label: 'Done', color: '#22C55E' },
]

export function TodoBoard() {
  const {
    workspace, channels, todos, todoView, todoFilterChannel,
    setTodos, setTodoView, setTodoFilterChannel,
    addTodo, updateTodo, removeTodo,
  } = useAppStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTodo, setEditTodo] = useState<Todo | null>(null)
  const [loading, setLoading] = useState(true)

  // Load todos
  useEffect(() => {
    if (!workspace) return
    const client = getSupabaseClient()
    if (!client) return

    let cancelled = false

    async function load() {
      if (!client || !workspace) return

      setLoading(true)
      const { data } = await client
        .from('todos')
        .select('*, assignee:profiles!todos_assigned_to_fkey(id, display_name, avatar_url), creator:profiles!todos_created_by_fkey(id, display_name, avatar_url), channel:channels!todos_channel_id_fkey(id, name)')
        .eq('workspace_id', workspace.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false })

      if (!cancelled && data) {
        setTodos(data as unknown as Todo[])
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [workspace])

  // Subscribe to real-time changes
  useEffect(() => {
    if (!workspace) return
    const client = getSupabaseClient()
    if (!client) return

    const sub = client
      .channel('todos-watcher')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'todos' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const todo = payload.new as Todo
            if (todo.workspace_id === workspace.id) {
              // Re-fetch with joined data (assignee, creator, channel)
              client
                .from('todos')
                .select('*, assignee:profiles!todos_assigned_to_fkey(id, display_name, avatar_url), creator:profiles!todos_created_by_fkey(id, display_name, avatar_url), channel:channels!todos_channel_id_fkey(id, name)')
                .eq('id', todo.id)
                .single()
                .then(({ data }) => {
                  if (data) addTodo(data as unknown as Todo)
                })
            }
          } else if (payload.eventType === 'UPDATE') {
            const todo = payload.new as Todo
            // Re-fetch with joined data
            client
              .from('todos')
              .select('*, assignee:profiles!todos_assigned_to_fkey(id, display_name, avatar_url), creator:profiles!todos_created_by_fkey(id, display_name, avatar_url), channel:channels!todos_channel_id_fkey(id, name)')
              .eq('id', todo.id)
              .single()
              .then(({ data }) => {
                if (data) updateTodo(todo.id, data as unknown as Todo)
              })
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            removeTodo(old.id)
          }
        }
      )
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [workspace])

  function handleEdit(todo: Todo) {
    setEditTodo(todo)
    setDialogOpen(true)
  }

  function handleNewTodo() {
    setEditTodo(null)
    setDialogOpen(true)
  }

  const filteredTodos = todoFilterChannel
    ? todos.filter((t) => t.channel_id === todoFilterChannel)
    : todos

  const regularChannels = channels.filter(
    (c) => !c.name.startsWith('dm-') && !c.name.startsWith('gdm-')
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#E7E5E4' }}>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold" style={{ color: '#1C1917' }}>
            Todos
          </h2>
          <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {filteredTodos.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Channel filter */}
          <Select value={todoFilterChannel || 'all'} onValueChange={(v) => setTodoFilterChannel(v === 'all' ? null : v)}>
            <SelectTrigger className="h-8 w-40 text-[12px]">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {regularChannels.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  #{ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: '#E7E5E4' }}>
            <button
              onClick={() => setTodoView('board')}
              className="h-8 w-8 flex items-center justify-center transition-colors"
              style={{
                background: todoView === 'board' ? '#DC2626' : 'transparent',
                color: todoView === 'board' ? '#fff' : '#A8A29E',
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTodoView('list')}
              className="h-8 w-8 flex items-center justify-center transition-colors"
              style={{
                background: todoView === 'list' ? '#DC2626' : 'transparent',
                color: todoView === 'list' ? '#fff' : '#A8A29E',
              }}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            onClick={handleNewTodo}
            size="sm"
            className="h-8 px-3 text-[12px]"
            style={{ background: '#DC2626', color: '#fff' }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[13px]" style={{ color: '#A8A29E' }}>Loading todos...</div>
        </div>
      ) : todoView === 'board' ? (
        /* Kanban Board */
        <div className="flex-1 flex gap-4 p-6 overflow-x-auto">
          {COLUMNS.map((col) => {
            const columnTodos = filteredTodos.filter((t) => t.status === col.status)
            return (
              <div key={col.status} className="flex-1 min-w-[280px] flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: col.color }}
                  />
                  <span className="text-[13px] font-semibold" style={{ color: '#78716C' }}>
                    {col.label}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#A8A29E' }}>
                    {columnTodos.length}
                  </span>
                </div>

                <ScrollArea className="flex-1 -mx-1">
                  <div className="space-y-2 px-1 pb-4">
                    {columnTodos.length === 0 ? (
                      <div
                        className="p-4 rounded-xl border-2 border-dashed text-center text-[12px]"
                        style={{ borderColor: '#E7E5E4', color: '#A8A29E' }}
                      >
                        No todos
                      </div>
                    ) : (
                      columnTodos.map((todo) => (
                        <TodoCard
                          key={todo.id}
                          todo={todo}
                          onEdit={handleEdit}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )
          })}
        </div>
      ) : (
        /* List View */
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-2">
            {filteredTodos.length === 0 ? (
              <div
                className="p-8 rounded-xl border-2 border-dashed text-center text-[13px]"
                style={{ borderColor: '#E7E5E4', color: '#A8A29E' }}
              >
                No todos yet. Click &quot;New&quot; to create one.
              </div>
            ) : (
              filteredTodos.map((todo) => (
                <TodoCard
                  key={todo.id}
                  todo={todo}
                  onEdit={handleEdit}
                />
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Dialog */}
      <TodoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editTodo={editTodo}
      />
    </div>
  )
}
