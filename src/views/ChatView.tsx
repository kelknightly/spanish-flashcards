'use client'

import { ChatPanel } from '@/components/ChatPanel'

export function ChatView() {
  return (
    // Full height minus the Shell header (56px)
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <ChatPanel />
    </div>
  )
}
