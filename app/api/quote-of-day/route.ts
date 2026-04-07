import { NextResponse } from 'next/server'
import { getBooks } from '@/data/books'
import { getChapterText } from '@/data/books/text-loader'

export async function GET() {
  const books = getBooks()

  const chunks: Array<{ text: string; bookNumber: number; chapterNumber: number }> = []

  for (const book of books) {
    for (const chapter of book.chapters) {
      if (!chapter.hasText) continue
      const raw = getChapterText(book.bookNumber, chapter.number)
      if (!raw.trim()) continue

      // Split into ~55-word windows stepping 25 words at a time
      const words = raw.split(/\s+/).filter(Boolean)
      for (let i = 0; i < words.length - 55; i += 25) {
        const snippet = words.slice(i, i + 55).join(' ')
        // Only use windows that start near a sentence boundary
        if (snippet.length > 80 && snippet.length < 400) {
          chunks.push({ text: snippet, bookNumber: book.bookNumber, chapterNumber: chapter.number })
        }
      }
    }
  }

  if (chunks.length === 0) {
    return NextResponse.json({
      quote: '— El texto del capítulo llegará pronto. ¡Sigue estudiando!',
      bookNumber: 1,
      chapterNumber: 1,
    })
  }

  const dayIndex = Math.floor(Date.now() / 86_400_000)
  const chunk = chunks[dayIndex % chunks.length]

  return NextResponse.json({
    quote: chunk.text,
    bookNumber: chunk.bookNumber,
    chapterNumber: chunk.chapterNumber,
  })
}
