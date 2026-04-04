'use client'

interface Props {
  deckId: string
}

export function StudyView({ deckId }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="glass rounded-xl p-8 text-center">
        <h1 className="text-2xl font-bold text-neon-purple">Study Session</h1>
        <p className="mt-2 text-white/50">Deck: {deckId} — coming soon</p>
      </div>
    </div>
  )
}
