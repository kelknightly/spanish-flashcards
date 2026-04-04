import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = process.env.GEMINI_API_KEY ?? ''

if (!apiKey && typeof window === 'undefined') {
  // Server-side warning only — not thrown so build doesn't fail without key
  console.warn('[gemini] GEMINI_API_KEY is not set.')
}

export const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export function getModel(modelName = 'gemini-2.0-flash') {
  if (!genAI) throw new Error('Gemini API key not configured.')
  return genAI.getGenerativeModel({ model: modelName })
}

export interface EvaluationResult {
  qualityScore: number   // 0–5
  isCorrect: boolean     // qualityScore >= 3
  feedback: string       // AI explanation
}

export interface SourceSentence {
  es: string
  en: string
}
