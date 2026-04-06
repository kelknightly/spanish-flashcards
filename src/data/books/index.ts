import book1Data from './book1.json'
import book2Data from './book2.json'
import book3Data from './book3.json'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChapterMeta {
  number: number
  title: string    // English title
  titleEs: string  // Spanish title
  hasText: boolean // true once text/bookN-chN.txt has been populated
}

/** Full chapter shape — text is only available server-side via getChapterText() */
export interface Chapter extends ChapterMeta {
  text?: string
}

export interface Book {
  bookNumber: number
  title: string    // English title
  titleEs: string  // Spanish title
  chapters: ChapterMeta[]
}

// ── Static metadata (client-safe — no fs / Node APIs) ─────────────────────

export const books: Book[] = [
  book1Data as Book,
  book2Data as Book,
  book3Data as Book,
]

export const DECK_TYPES = [
  { subcategory: 'nouns',               label: 'Frequent Nouns',              category: 'nouns'      },
  { subcategory: 'nouns-a1',            label: 'A1 Nouns',                    category: 'nouns'      },
  { subcategory: 'nouns-a2',            label: 'A2 Nouns',                    category: 'nouns'      },
  { subcategory: 'nouns-b1',            label: 'B1 Nouns',                    category: 'nouns'      },
  { subcategory: 'nouns-b2',            label: 'B2 Nouns',                    category: 'nouns'      },
  { subcategory: 'verbs-present',       label: 'Present Tense Verbs',         category: 'verbs'      },
  { subcategory: 'verbs-preterite',     label: 'Past Tense Verbs (Preterite)', category: 'verbs'     },
  { subcategory: 'verbs-imperfect',     label: 'Past Tense Verbs (Imperfect)', category: 'verbs'     },
  { subcategory: 'verbs-future',        label: 'Future Tense Verbs',           category: 'verbs'     },
  { subcategory: 'verbs-conditional',   label: 'Conditional Verbs',            category: 'verbs'     },
  { subcategory: 'verbs-imperative',    label: 'Imperative Verbs',             category: 'verbs'     },
  { subcategory: 'verbs-subjunctive',   label: 'Subjunctive Verbs',            category: 'verbs'     },
  { subcategory: 'adjectives',          label: 'Adjectives',                   category: 'adjectives' },
  { subcategory: 'pronoun-composites',  label: 'Composite Pronoun Usage',      category: 'grammar'   },
  { subcategory: 'general',             label: 'General',                      category: 'general'   },
] as const

/** CEFR noun level progression: subcategory → next subcategory */
export const CEFR_NOUN_NEXT: Record<string, string> = {
  'nouns-a1': 'nouns-a2',
  'nouns-a2': 'nouns-b1',
  'nouns-b1': 'nouns-b2',
}

/** Label to show in "Continue to …" prompts for the next CEFR level */
export const CEFR_NOUN_NEXT_LABEL: Record<string, string> = {
  'nouns-a1': 'A2 Nouns',
  'nouns-a2': 'B1 Nouns',
  'nouns-b1': 'B2 Nouns',
}

export type DeckSubcategory = (typeof DECK_TYPES)[number]['subcategory']

export function getBooks(): Book[] {
  return books
}

export function getBook(bookNumber: number): Book | undefined {
  return books.find((b) => b.bookNumber === bookNumber)
}

export function getChapterMeta(bookNumber: number, chapterNumber: number): ChapterMeta | undefined {
  return getBook(bookNumber)?.chapters.find((c) => c.number === chapterNumber)
}

/** Alias kept for compatibility */
export const getChapter = getChapterMeta

export function getDeckLabel(subcategory: string): string {
  return DECK_TYPES.find((t) => t.subcategory === subcategory)?.label ?? subcategory
}

export function buildDeckName(
  bookNumber: number,
  chapterNumber: number,
  subcategory: string,
  version = 1,
): string {
  const base = `Bk ${bookNumber} - Ch ${chapterNumber} - ${subcategory}`
  return version > 1 ? `${base} (v${version})` : base
}
