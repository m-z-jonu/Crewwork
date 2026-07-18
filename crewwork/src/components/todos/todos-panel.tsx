'use client'

import { X } from 'lucide-react'
import { TodoBoard } from './todo-board'

interface TodosPanelProps {
  open: boolean
  onClose: () => void
}

export function TodosPanel({ open, onClose }: TodosPanelProps) {
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
        className="relative w-[800px] max-w-[90vw] h-full shadow-2xl animate-in slide-in-from-right duration-200"
        style={{ background: '#F8F6FF' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#FECACA]"
          style={{ color: '#A8A29E' }}
        >
          <X className="h-4 w-4" />
        </button>

        <TodoBoard />
      </div>
    </div>
  )
}
