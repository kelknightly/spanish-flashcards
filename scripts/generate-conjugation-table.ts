/**
 * scripts/generate-conjugation-table.ts
 *
 * One-time script that uses Gemini to build a static conjugation lookup table
 * for the most common Spanish verbs (Mexican Spanish — no vosotros).
 * Output is written to src/data/es-conjugations.json.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/generate-conjugation-table.ts
 *
 * Required env:
 *   GEMINI_API_KEY
 *
 * The output file is used by src/lib/conjugations.ts to answer conjugation
 * and infinitive-lookup requests without hitting the Gemini API at runtime.
 *
 * Re-running is safe — it overwrites the file completely.
 * Individual verbs that fail are skipped with a warning; re-run to retry them.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Env ────────────────────────────────────────────────────────────────────

const apiKey = process.env.GEMINI_API_KEY?.trim()
if (!apiKey) {
  console.error('❌  GEMINI_API_KEY is not set. Run with: npx tsx --env-file=.env scripts/generate-conjugation-table.ts')
  process.exit(1)
}

// ── Verb list ──────────────────────────────────────────────────────────────
// Prioritises high-frequency irregular verbs that appear in the Narnia books.
// Regular verbs included so that common vocab deck terms are also covered.

const VERBS: string[] = [
  // === Core irregular – highest priority ===
  'ser', 'estar', 'ir', 'haber',
  'tener', 'hacer', 'poder', 'querer', 'saber',
  'venir', 'decir', 'ver', 'dar', 'poner',
  'traer', 'oír', 'caer', 'caber', 'andar',
  'salir', 'valer',

  // === Irregular yo / spelling change ===
  'conocer', 'parecer', 'nacer', 'crecer', 'merecer',
  'producir', 'conducir', 'reducir', 'traducir',
  'construir', 'destruir', 'incluir', 'huir',
  'leer', 'creer',
  'reír', 'sonreír', 'freír',

  // === Stem-changing ===
  'sentir', 'pedir', 'seguir', 'conseguir',
  'dormir', 'morir',
  'jugar',
  'volver', 'devolver', 'resolver',
  'encontrar', 'contar', 'mostrar', 'recordar',
  'costar', 'probar', 'aprobar',
  'perder', 'entender', 'defender',
  'empezar', 'comenzar',
  'pensar', 'despertar',
  'poder',   // already above but ensure stem-change forms included

  // === High-frequency regular -ar ===
  'hablar', 'llamar', 'mirar', 'escuchar',
  'entrar', 'llegar', 'gritar', 'caminar',
  'esperar', 'preguntar', 'responder',
  'terminar', 'ayudar', 'buscar',
  'tomar', 'pasar', 'quedar', 'cruzar',
  'mejorar', 'lanzar', 'trabajar',
  'usar', 'dejar', 'necesitar',
  'levantar', 'bajar', 'girar',
  'alcanzar', 'acercar', 'alejar',
  'intentar', 'lograr', 'tratar',
  'viajar', 'regresar', 'descansar',
  'cuidar', 'preparar', 'cambiar',
  'indicar', 'colocar', 'tocar',
  'sacar', 'pagar', 'jugar',   // jugar listed above too — dedup handled

  // === High-frequency regular -er ===
  'comer', 'correr', 'beber',
  'deber', 'comprender', 'aprender',
  'temer', 'vender', 'leer',   // leer already above

  // === High-frequency regular -ir ===
  'vivir', 'escribir', 'recibir',
  'subir', 'abrir', 'sufrir',
  'dividir', 'unir', 'permitir',
  'añadir', 'existir', 'ocurrir',
  'compartir', 'asistir', 'decidir',
  'discutir', 'admitir', 'repetir',

  // === Reflexive-origin forms (infinitive only — strip se) ===
  'despertar',  // despertar / despertarse — already above
]

// Deduplicate while preserving order
const VERB_LIST = [...new Set(VERBS)]

// ── Gemini setup ───────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(apiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

type VerbFormEntry = { form: string; translation: string }

function buildPrompt(infinitive: string): string {
  return `Return ONLY a JSON array of objects (no markdown, no code fences, no explanation) where each object represents one conjugated surface form of the Spanish verb "${infinitive}".

Each object must have exactly two string fields:
- "form": the conjugated form, lowercase
- "translation": a short English label in the format "Tense: subject + meaning", e.g. "Future: he/she/it will have", "Preterite: I did", "Present subjunctive: you have", "Gerund", "Past participle (feminine plural)", "Infinitive"

Include ALL of these:
- All indicative tenses: present, preterite, imperfect, future, conditional (all persons EXCEPT vosotros)
- All subjunctive tenses: present subjunctive, imperfect subjunctive -ra forms, imperfect subjunctive -se forms (all persons EXCEPT vosotros)
- Imperative (affirmative and negative, all applicable persons EXCEPT vosotros)
- The infinitive itself
- The gerund (present participle)
- The past participle (all gender/number forms if irregular, otherwise just the standard form)

Do not include vosotros forms. Do not include reflexive pronouns. Do not include compound tenses. No duplicate form+translation pairs.

Respond with ONLY the JSON array, nothing else.`
}

async function conjugateVerb(infinitive: string): Promise<VerbFormEntry[] | null> {
  let raw: string
  try {
    const result = await model.generateContent(buildPrompt(infinitive))
    raw = result.response.text().trim()
  } catch (err) {
    console.error(`  ⚠️  Gemini error for "${infinitive}":`, err)
    return null
  }

  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let forms: unknown
  try {
    forms = JSON.parse(raw)
  } catch {
    console.error(`  ⚠️  JSON parse failed for "${infinitive}":`, raw.slice(0, 200))
    return null
  }

  if (
    !Array.isArray(forms) ||
    !forms.every(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Record<string, unknown>).form === 'string' &&
        typeof (f as Record<string, unknown>).translation === 'string'
    )
  ) {
    console.error(`  ⚠️  Unexpected format for "${infinitive}"`)
    return null
  }

  type Entry = { form: string; translation: string }
  const seen = new Set<string>()
  return (forms as Entry[])
    .map((f) => ({ form: f.form.toLowerCase().trim(), translation: f.translation.trim() }))
    .filter((f) => f.form && !seen.has(f.form) && seen.add(f.form))
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔤  Generating conjugation table for ${VERB_LIST.length} verbs…\n`)

  // { infinitive → forms[] }
  const data: Record<string, VerbFormEntry[]> = {}
  const failed: string[] = []
  const DELAY_MS = 300 // Stay well within Gemini rate limits

  for (let i = 0; i < VERB_LIST.length; i++) {
    const verb = VERB_LIST[i]
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${VERB_LIST.length}] ${verb.padEnd(20)}`)

    const forms = await conjugateVerb(verb)
    if (forms) {
      data[verb] = forms
      process.stdout.write(`✓  (${forms.length} forms)\n`)
    } else {
      failed.push(verb)
      process.stdout.write(`✗  FAILED\n`)
    }

    if (i < VERB_LIST.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
  }

  // Write output
  const outPath = resolve(__dirname, '../src/data/es-conjugations.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8')

  const totalForms = Object.values(data).reduce((n, f) => n + f.length, 0)
  console.log(`\n✅  Written to src/data/es-conjugations.json`)
  console.log(`    ${Object.keys(data).length} verbs  ·  ${totalForms} total forms`)

  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} verb(s) failed — re-run to retry:`)
    console.log(`    ${failed.join(', ')}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
