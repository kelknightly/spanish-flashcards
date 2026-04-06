import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { createClient } from '@supabase/supabase-js'
import type { Part } from '@google/generative-ai'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

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

IMPORTANT — composite clitic forms: When a verb appears in the text with one or more clitic pronouns attached (e.g. "pásamelo", "dámelo", "cuéntame", "llévatelo", "díjomelo"), ALWAYS card the full composite form exactly as written. Do NOT split the pronouns off or card just the bare verb form. The "spanish" field must be ONLY the composite verb form itself (e.g. "dímelo"), never a full sentence. The "english" field should translate both the verb and the pronouns (e.g. "pásamelo" → "pass it to me").

Keep explanations friendly, concise, and encouraging. Use examples from the Narnia text when visible.`

export async function POST(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
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
          if (url && anonKey && sessionId) {
            const authHeader = request.headers.get('authorization')
            const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
            if (token) {
              const sb = createClient(url, anonKey, {
                global: { headers: { Authorization: `Bearer ${token}` } },
              })
              const newMessages = [
                ...history,
                { role: 'user', content: message?.trim() || `[${images.length} screenshot${images.length > 1 ? 's' : ''}]`, timestamp: new Date().toISOString() },
                { role: 'assistant', content: fullText, timestamp: new Date().toISOString() },
              ]
              await sb
                .from('chat_sessions')
                .update({ messages: newMessages })
                .eq('id', sessionId)
                .eq('user_id', user.id)
            }
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
export async function PUT(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data, error } = await sb
    .from('chat_sessions')
    .insert({ user_id: user.id, title: 'New conversation', messages: [] })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessionId: data.id })
}
