#!/usr/bin/env node
/**
 * scripts/patch-chapter-text.mjs
 *
 * Usage:
 *   node scripts/patch-chapter-text.mjs <bookNumber> <chapterNumber> <text>
 *
 * Or pipe text via stdin:
 *   cat chapter.txt | node scripts/patch-chapter-text.mjs <bookNumber> <chapterNumber>
 *
 * This bypasses response-size limits by writing directly to the JSON file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createInterface } from 'readline'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../src/data/books')

const [bookStr, chapterStr, ...rest] = process.argv.slice(2)
const bookNumber = parseInt(bookStr)
const chapterNumber = parseInt(chapterStr)

if (!bookNumber || !chapterNumber) {
  console.error('Usage: node scripts/patch-chapter-text.mjs <bookNumber> <chapterNumber> [text]')
  process.exit(1)
}

async function getText() {
  if (rest.length > 0) return rest.join(' ')
  const rl = createInterface({ input: process.stdin })
  const lines = []
  for await (const line of rl) lines.push(line)
  return lines.join('\n')
}

mkdirSync(resolve(dataDir, 'text'), { recursive: true })

const text = await getText()
if (!text.trim()) {
  console.error('No text provided.')
  process.exit(1)
}

// Write text to the .txt file
const txtPath = resolve(dataDir, 'text', `book${bookNumber}-ch${chapterNumber}.txt`)
writeFileSync(txtPath, text, 'utf8')

// Update hasText flag in the JSON metadata file
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
