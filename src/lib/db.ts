import { neon } from '@neondatabase/serverless'

// Lazily initialized to avoid crashing at build time if DATABASE_URL is absent.
let _sql: ReturnType<typeof neon> | null = null

export function getDb(): ReturnType<typeof neon> {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL environment variable is required')
    _sql = neon(url)
  }
  return _sql
}

// Convenience export — use this in all server-side code.
// Tag-template usage:  const rows = await sql`SELECT * FROM decks WHERE id = ${id}`
export const sql: ReturnType<typeof neon> = new Proxy(
  (() => {}) as unknown as ReturnType<typeof neon>,
  {
    apply(_target, _thisArg, args) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (getDb() as any)(...args)
    },
    get(_target, prop) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (getDb() as any)[prop]
    },
  }
)
