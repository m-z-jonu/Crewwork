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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Popup */}
      <div
        className="relative w-full max-w-[90vw] sm:max-w-[900px] h-[90vh] sm:h-[85vh] rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden flex flex-col"
        style={{ background: '#ffffff' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 shrink-0" style={{ borderBottom: '1px solid #E7E5E4' }}>
          <h2 className="font-bold text-[15px] sm:text-[17px]" style={{ color: '#1C1917' }}>Todos</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#FEF2F2]"
            style={{ color: '#A8A29E' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <TodoBoard />
        </div>
      </div>
    </div>
  )
}
