'use client'

import { MoreHorizontal, Calendar, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Todo } from '@/types/database'

interface TodoCardProps {
  todo: Todo
  onEdit: (todo: Todo) => void
}

const priorityColors = {
  low: { bg: '#E0F2FE', text: '#0369A1', dot: '#38BDF8' },
  medium: { bg: '#FEF3C7', text: '#92400E', dot: '#FBBF24' },
  high: { bg: '#FEE2E2', text: '#991B1B', dot: '#F87171' },
}

export function TodoCard({ todo, onEdit }: TodoCardProps) {
  const colors = priorityColors[todo.priority]

  return (
    <div
      className={cn(
        'group p-3 rounded-xl border transition-all hover:shadow-sm cursor-pointer',
        todo.status === 'DONE' && 'opacity-60'
      )}
      style={{
        background: '#fff',
        borderColor: '#E7E5E4',
      }}
      onClick={() => onEdit(todo)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[13px] font-medium leading-tight',
              todo.status === 'DONE' && 'line-through'
            )}
            style={{ color: '#1C1917' }}
          >
            {todo.title}
          </p>

          {todo.description && (
            <p
              className="text-[11px] mt-1 line-clamp-2"
              style={{ color: '#A8A29E' }}
            >
              {todo.description}
            </p>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit(todo)
          }}
          className="h-6 w-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#FEF2F2]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* Priority badge */}
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: colors.bg, color: colors.text }}
        >
          {todo.priority}
        </span>

        {/* Due date */}
        {todo.due_date && (
          <span
            className="text-[10px] flex items-center gap-1"
            style={{ color: '#A8A29E' }}
          >
            <Calendar className="h-2.5 w-2.5" />
            {new Date(todo.due_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}

        {/* Channel */}
        {todo.channel && (
          <span
            className="text-[10px] flex items-center gap-1"
            style={{ color: '#A8A29E' }}
          >
            <Hash className="h-2.5 w-2.5" />
            {todo.channel.name}
          </span>
        )}

        {/* Assignee */}
        {todo.assignee && (
          <div className="ml-auto">
            {todo.assignee.avatar_url ? (
              <img
                src={todo.assignee.avatar_url}
                alt=""
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div
                className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                style={{ background: '#DC2626' }}
              >
                {todo.assignee.display_name[0]?.toUpperCase()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
