import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { sql } from '@/lib/db'
import type { Part } from '@google/generative-ai'

const SYSTEM_PROMPT = `You are a Spanish language tutor specializing in vocabulary from C.S. Lewis's Chronicles of Narnia. 
The user will share screenshots of Narnia chapters (in Spanish or English) and you will help them:
1. Identify interesting Spanish vocabulary worth learning as flashcards
2. Explain word meanings, etymology, and usage in context
3. Answer questions about grammar or phrasing
4. Extract a structured deck of flashcards when asked

When extracting flashcards, respond with a JSON block wrapped in triple backticks labeled "json", with this structure:
{
  "deckName": "Chapter N — Topic",
  "bookNumber": 1,
  "chapterNumber": 1,
  "cards": [
    {
      "spanish": "el fauno",
      "english": "the faun / satyr",
      "sourceSentences": [
        { "es": "El fauno llevaba un paraguas.", "en": "The faun carried an umbrella." }
      ]
    }
  ]
}

IMPORTANT — source sentences: Each "es" sentence MUST contain the exact "spanish" term verbatim — same spelling, same accents. Never use a sentence that only contains a related form (different conjugation, different tense, etc.). If no sentence in the visible text contains the exact term, omit sourceSentences for that card entirely.

IMPORTANT — composite clitic forms: When a verb appears in the text with one or more clitic pronouns attached (e.g. "pásamelo", "dámelo", "cuéntame", "llévatelo", "díjomelo"), ALWAYS card the full composite form exactly as written. Do NOT split the pronouns off or card just the bare verb form. The "spanish" field must be ONLY the composite verb form itself (e.g. "dímelo"), never a full sentence. The "english" field should translate both the verb and the pronouns (e.g. "pásamelo" → "pass it to me").

Keep explanations friendly, concise, and encouraging. Use examples from the Narnia text when visible.`

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    message: string
    images?: Array<{ base64: string; mimeType: string }>
    sessionId?: string
    history?: Array<{ role: string; content: string }>
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { message, images = [], sessionId, history = [] } = body

  if (!message?.trim() && !images.length) {
    return NextResponse.json({ error: 'Message or image required' }, { status: 400 })
  }

  try {
    const model = getModel('gemini-2.5-flash')

    // Wrap system prompt as a model-level instruction by prepending to history
    // (systemInstruction must be on getGenerativeModel, not startChat in v1beta)
    const systemTurn = {
      role: 'user' as const,
      parts: [{ text: `[SYSTEM] ${SYSTEM_PROMPT}` }],
    }
    const systemAck = {
      role: 'model' as const,
      parts: [{ text: 'Understood. I am ready to help you learn Spanish vocabulary from the Chronicles of Narnia.' }],
    }

    // Build the parts for this turn — images first, then text
    const parts: Part[] = [
      ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } } as Part)),
      ...(message?.trim() ? [{ text: message.trim() } as Part] : []),
    ]

    // Build chat history for multi-turn context (last 10 turns to stay within limits)
    const recentHistory = history.slice(-10)
    const chatHistory = recentHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }))

    const chat = model.startChat({
      history: [systemTurn, systemAck, ...chatHistory],
    })

    const result = await chat.sendMessageStream(parts)

    // Stream the response back as SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let fullText = ''
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text()
            fullText += text
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          }

          // Persist to chat_sessions after full response
          if (sessionId) {
            const newMessages = [
              ...history,
              { role: 'user', content: message?.trim() || `[${images.length} screenshot${images.length > 1 ? 's' : ''}]`, timestamp: new Date().toISOString() },
              { role: 'assistant', content: fullText, timestamp: new Date().toISOString() },
            ]
            await sql`
              UPDATE chat_sessions SET messages = ${JSON.stringify(newMessages)}
              WHERE id = ${sessionId} AND user_id = ${user.id}
            `
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('[api/chat]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini error' },
      { status: 500 }
    )
  }
}

// Create a new chat session
export async function PUT() {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = (await sql`
    INSERT INTO chat_sessions (user_id, title, messages)
    VALUES (${user.id}, 'New conversation', '[]')
    RETURNING id
  `) as Record<string, unknown>[]

  return NextResponse.json({ sessionId: (rows as { id: string }[])[0].id })
}
