'use client'

import type { Book } from '@/data/books'

interface Props {
  books: Book[]
  selectedBook: number | null
  onSelect: (bookNumber: number) => void
}

export function BookListPanel({ books, selectedBook, onSelect }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r border-white/10 overflow-y-auto">
      <div className="p-4 border-b border-white/10">
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Books</p>
      </div>
      <ul className="py-2">
        {books.map((book) => {
          const active = selectedBook === book.bookNumber
          return (
            <li key={book.bookNumber}>
              <button
                onClick={() => onSelect(book.bookNumber)}
                className={`w-full text-left px-4 py-3 transition-colors group ${
                  active
                    ? 'bg-neon-pink/15 border-r-2 border-neon-pink'
                    : 'hover:bg-white/5'
                }`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-wider mb-0.5 ${
                    active ? 'text-neon-pink' : 'text-white/40 group-hover:text-white/60'
                  }`}
                >
                  Book {book.bookNumber}
                </p>
                <p
                  className={`text-sm leading-snug ${
                    active ? 'text-white font-medium' : 'text-white/70'
                  }`}
                >
                  {book.titleEs}
                </p>
                <p className="text-xs text-white/30 mt-0.5">{book.chapters.length} chapters</p>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
