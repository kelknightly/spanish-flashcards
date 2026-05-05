'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface VerbFormEntry {
  form: string
  translation: string
}

interface CacheEntry {
  infinitive: string
  forms: VerbFormEntry[]
}

// Module-level cache — persists for the browser session, shared across all instances
const conjugationCache = new Map<string, CacheEntry>()

// Vosotros is not used in Mexican Spanish — filter these out
const VOSOTROS_RE = /\bvosotros\b/i
function isVosotros(translation: string): boolean {
  return VOSOTROS_RE.test(translation)
}

// Maps a deck subcategory to the tense name used in Gemini's translation labels
const SUBCATEGORY_TO_TENSE: Record<string, string> = {
  'verbs-present': 'Present',
  'verbs-preterite': 'Preterite',
  'verbs-imperfect': 'Imperfect',
  'verbs-future': 'Future',
  'verbs-conditional': 'Conditional',
  'verbs-subjunctive': 'Present subjunctive',
  'verbs-perfect': 'Present',
  'verbs-imperative': 'Imperative',
  'verb-search': 'Present',
}

// Preferred display order for tense columns
const TENSE_PRIORITY: Record<string, number> = {
  'Present': 1,
  'Preterite': 2,
  'Imperfect': 3,
  'Future': 4,
  'Conditional': 5,
  'Present subjunctive': 6,
  'Imperfect subjunctive -ra': 7,
  'Imperfect subjunctive -se': 8,
  'Imperative': 9,
  'Negative imperative': 10,
}

// Spanish display names shown in table column headers
const TENSE_DISPLAY_NAME: Record<string, string> = {
  'Present': 'Presente',
  'Preterite': 'Pretérito Perfecto',
  'Imperfect': 'Pretérito Imperfecto',
  'Conditional': 'Condicional',
  'Future': 'Futuro',
  'Present subjunctive': 'Subjuntivo Presente',
  'Imperfect subjunctive -ra': 'Subjuntivo Imp. (-ra)',
  'Imperfect subjunctive -se': 'Subjuntivo Imp. (-se)',
  'Imperative': 'Imperativo',
  'Negative imperative': 'Imperativo Negativo',
}

// Grouped tense pills shown in the "Add tense" footer
const TENSE_GROUPS: { label: string; tenses: string[] }[] = [
  { label: 'Presente', tenses: ['Present'] },
  { label: 'Pretérito Perfecto', tenses: ['Preterite'] },
  { label: 'Pretérito Imperfecto', tenses: ['Imperfect'] },
  { label: 'Condicional', tenses: ['Conditional'] },
  { label: 'Futuro', tenses: ['Future'] },
  { label: 'Subjunctive', tenses: ['Present subjunctive', 'Imperfect subjunctive -ra', 'Imperfect subjunctive -se'] },
  { label: 'Imperative', tenses: ['Imperative', 'Negative imperative'] },
]

function getTenseName(translation: string): string {
  const colon = translation.indexOf(':')
  // Non-conjugated forms (Gerund, Past participle, Infinitive) have no colon
  return colon >= 0 ? translation.slice(0, colon).trim() : 'Other'
}

function deriveTenses(forms: VerbFormEntry[]): string[] {
  const seen = new Set<string>()
  for (const f of forms) {
    const t = getTenseName(f.translation)
    if (t !== 'Other') seen.add(t)
  }
  return Array.from(seen).sort(
    (a, b) => (TENSE_PRIORITY[a] ?? 99) - (TENSE_PRIORITY[b] ?? 99)
  )
}

function findBestTense(tenses: string[], preferred: string): string {
  if (tenses.includes(preferred)) return preferred
  // Fuzzy: find tense whose name overlaps with the preferred one
  const loose = tenses.find(
    (t) =>
      t.toLowerCase().startsWith(preferred.toLowerCase()) ||
      preferred.toLowerCase().startsWith(t.toLowerCase())
  )
  return loose ?? tenses[0] ?? preferred
}

interface Props {
  surfaceForm: string
  subcategory: string
  onClose: () => void
}

export function ConjugationPanel({ surfaceForm, subcategory, onClose }: Props) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infinitive, setInfinitive] = useState<string | null>(null)
  const [forms, setForms] = useState<VerbFormEntry[]>([])
  const [activeTenses, setActiveTenses] = useState<string[]>([
    SUBCATEGORY_TO_TENSE[subcategory] ?? 'Present',
  ])

  useEffect(() => {
    const preferredTense = SUBCATEGORY_TO_TENSE[subcategory] ?? 'Present'
    const cached = conjugationCache.get(surfaceForm.toLowerCase())

    if (cached) {
      setInfinitive(cached.infinitive)
      setForms(cached.forms)
      setActiveTenses([findBestTense(deriveTenses(cached.forms), preferredTense)])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setInfinitive(null)
    setForms([])
    setActiveTenses([preferredTense])
    let cancelled = false

    ;(async () => {
      try {
        const r1 = await fetch('/api/infinitive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: surfaceForm.toLowerCase() }),
        })
        const d1: { infinitive?: string; error?: string } = await r1.json()
        if (!d1.infinitive) throw new Error(d1.error ?? 'Could not resolve infinitive')

        const r2 = await fetch('/api/conjugate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ infinitive: d1.infinitive }),
        })
        const d2: { forms?: VerbFormEntry[]; infinitive?: string; error?: string } =
          await r2.json()
        if (!d2.forms) throw new Error(d2.error ?? 'Could not fetch conjugations')

        if (!cancelled) {
          const entry: CacheEntry = { infinitive: d1.infinitive, forms: d2.forms }
          conjugationCache.set(surfaceForm.toLowerCase(), entry)
          setInfinitive(d1.infinitive)
          setForms(d2.forms)
          setActiveTenses([findBestTense(deriveTenses(d2.forms), preferredTense)])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load conjugations')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [surfaceForm, subcategory, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const tenseMap = useMemo(() => {
    const map = new Map<string, VerbFormEntry[]>()
    for (const f of forms) {
      if (isVosotros(f.translation)) continue
      const tense = getTenseName(f.translation)
      if (tense === 'Other') continue
      if (!map.has(tense)) map.set(tense, [])
      map.get(tense)!.push(f)
    }
    return map
  }, [forms])

  const allTenses = useMemo(() => deriveTenses(forms), [forms])

  // Groups that have at least one addable tense (i.e. not all tenses are already active)
  const addableGroups = TENSE_GROUPS.filter((g) =>
    g.tenses.some((t) => allTenses.includes(t) && !activeTenses.includes(t))
  )

  const maxRows =
    activeTenses.length > 0
      ? Math.max(...activeTenses.map((t) => tenseMap.get(t)?.length ?? 0))
      : 0

  const surfaceLower = surfaceForm.toLowerCase()

  return (
    <>
      {/* Backdrop – clicking it closes the panel */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Slide-up panel */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass rounded-t-2xl border-t border-white/10 shadow-2xl max-h-[70vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-white/40 text-xs uppercase tracking-wider">Conjugations</span>
            {infinitive && (
              <span className="text-lg font-bold text-white">{infinitive}</span>
            )}
            {loading && (
              <span className="text-white/40 text-sm animate-pulse">looking up…</span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close conjugation panel"
            className="text-white/40 hover:text-white text-2xl leading-none transition-colors px-1"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="px-5 py-4 text-sm text-red-400">{error}</p>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="flex-1 px-5 py-4 space-y-2.5">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="h-7 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {/* Conjugation table */}
        {!loading && forms.length > 0 && (
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-[rgba(26,21,48,0.92)] backdrop-blur-sm">
                <tr className="border-b border-white/10">
                  {activeTenses.map((tense) => (
                    <th
                      key={tense}
                      className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-white/40 whitespace-nowrap"
                    >
                      {TENSE_DISPLAY_NAME[tense] ?? tense}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-white/5 hover:bg-white/[0.03]">
                    {activeTenses.map((tense) => {
                      const entry = tenseMap.get(tense)?.[rowIdx]
                      const isHighlighted = entry?.form === surfaceLower
                      return (
                        <td key={tense} className="px-5 py-2.5 whitespace-nowrap">
                          {entry && (
                            <div className="flex items-baseline gap-2">
                              <span
                                className={
                                  isHighlighted
                                    ? 'text-neon-purple font-bold text-sm'
                                    : 'text-white/85 text-sm'
                                }
                              >
                                {entry.form}
                              </span>
                              <span className="text-white/30 text-xs">
                                {entry.translation.includes(':')
                                  ? entry.translation
                                      .slice(entry.translation.indexOf(':') + 1)
                                      .trim()
                                  : entry.translation}
                              </span>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add tense pills */}
        {!loading && addableGroups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-white/10 shrink-0">
            <span className="text-xs text-white/30 shrink-0">Add tense:</span>
            {addableGroups.map((group) => (
              <button
                key={group.label}
                onClick={() =>
                  setActiveTenses((prev) => [
                    ...prev,
                    ...group.tenses.filter((t) => allTenses.includes(t) && !prev.includes(t)),
                  ])
                }
                className="text-xs rounded-full px-3 py-1 border border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-colors"
              >
                + {group.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
