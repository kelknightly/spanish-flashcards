/**
 * Server-only module for loading chapter text from .txt files.
 * Do NOT import this in client components.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const TEXT_DIR = join(process.cwd(), 'src/data/books/text')

/**
 * Load the Spanish chapter text from src/data/books/text/bookN-chN.txt.
 * Returns empty string if the file doesn't exist or is empty.
 */
export function getChapterText(bookNumber: number, chapterNumber: number): string {
  const file = join(TEXT_DIR, `book${bookNumber}-ch${chapterNumber}.txt`)
  try {
    if (!existsSync(file)) return ''
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
