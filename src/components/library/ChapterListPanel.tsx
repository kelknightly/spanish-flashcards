'use client'

import type { Book } from '@/data/books'

interface Props {
  book: Book
  selectedChapter: number | null
  onSelect: (chapterNumber: number) => void
}

export function ChapterListPanel({ book, selectedChapter, onSelect }: Props) {
  return (
    <aside className="w-64 shrink-0 border-r border-white/10 overflow-y-auto">
      <div className="p-4 border-b border-white/10">
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Chapters</p>
        <p className="text-sm text-neon-pink font-medium mt-0.5 truncate">{book.titleEs}</p>
      </div>
      <ul className="py-2">
        {book.chapters.map((chapter) => {
          const active = selectedChapter === chapter.number
          const hasText = !!chapter.hasText
          return (
            <li key={chapter.number}>
              <button
                onClick={() => onSelect(chapter.number)}
                className={`w-full text-left px-4 py-2.5 transition-colors group ${
                  active
                    ? 'bg-neon-purple/15 border-r-2 border-neon-purple'
                    : 'hover:bg-white/5'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 min-w-[1.5rem] text-xs font-bold ${
                      active ? 'text-neon-purple' : 'text-white/30'
                    }`}
                  >
                    {chapter.number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm leading-snug truncate ${
                        active ? 'text-white font-medium' : 'text-white/70'
                      }`}
                    >
                      {chapter.titleEs}
                    </p>
                    {!hasText && (
                      <p className="text-xs text-white/25 mt-0.5">No text loaded</p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
