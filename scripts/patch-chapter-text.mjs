#!/usr/bin/env node
/**
 * scripts/patch-chapter-text.mjs
 *
 * Writes transcribed chapter text to a .txt file and flips hasText=true in
 * the book JSON. Always uses JSON.parse/stringify so accented characters are
 * handled correctly.
 *
 * Usage (supply text via stdin — the normal path after transcribing screenshots):
 *   cat src/data/books/text/book2-ch3.txt | node scripts/patch-chapter-text.mjs 2 3
 *
 * Usage (text already exists in .txt, just flip the JSON flag):
 *   node scripts/patch-chapter-text.mjs 2 3 --mark-only
 *
 * Usage (inline text, mainly for testing):
 *   node scripts/patch-chapter-text.mjs 2 3 "Some text here"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { createInterface } from 'readline'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../src/data/books')

const args = process.argv.slice(2)
const [bookStr, chapterStr, ...rest] = args
const bookNumber = parseInt(bookStr)
const chapterNumber = parseInt(chapterStr)
const markOnly = rest.includes('--mark-only')

if (!bookNumber || !chapterNumber) {
  console.error('Usage: node scripts/patch-chapter-text.mjs <bookNumber> <chapterNumber> [--mark-only | text]')
  process.exit(1)
}

const txtPath = resolve(dataDir, 'text', `book${bookNumber}-ch${chapterNumber}.txt`)
mkdirSync(resolve(dataDir, 'text'), { recursive: true })

async function getText() {
  if (markOnly) {
    // Just read the existing file — we only need the length for the log line
    if (!existsSync(txtPath)) {
      console.error(`❌  No txt file found at ${txtPath}. Transcribe the chapter first.`)
      process.exit(1)
    }
    return readFileSync(txtPath, 'utf8')
  }
  const inlineText = rest.filter(r => r !== '--mark-only').join(' ')
  if (inlineText.trim()) return inlineText
  // Read from stdin
  const rl = createInterface({ input: process.stdin })
  const lines = []
  for await (const line of rl) lines.push(line)
  return lines.join('\n')
}

const text = await getText()
if (!text.trim()) {
  console.error('No text provided.')
  process.exit(1)
}

// Write text to the .txt file (skip in mark-only mode — file already correct)
if (!markOnly) {
  writeFileSync(txtPath, text, 'utf8')
}

// Update hasText flag via JSON.parse — safe for all Unicode / accented chars
const metaPath = resolve(dataDir, `book${bookNumber}.json`)
const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
const metaChapter = meta.chapters.find(c => c.number === chapterNumber)
if (!metaChapter) {
  console.error(`Chapter ${chapterNumber} not found in book ${bookNumber} metadata.`)
  process.exit(1)
}
metaChapter.hasText = true
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')

console.log(`✅  Book ${bookNumber} Ch ${chapterNumber} → text/book${bookNumber}-ch${chapterNumber}.txt (${text.length} chars, hasText=true)`)
