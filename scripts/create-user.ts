/**
 * Create a user in the Neon database.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> <password> [name]
 *
 * Requires DATABASE_URL in environment (or .env.local).
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'

const [, , email, password, name] = process.argv

if (!email || !password) {
  console.error('Usage: npx tsx scripts/create-user.ts <email> <password> [name]')
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = neon(dbUrl)

async function main() {
  const passwordHash = await bcrypt.hash(password, 12)

  const [user] = await sql`
    INSERT INTO users (email, password_hash, name)
    VALUES (${email}, ${passwordHash}, ${name ?? null})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email
  `

  if (!user) {
    console.log(`User ${email} already exists.`)
    return
  }

  await sql`
    INSERT INTO user_profiles (user_id) VALUES (${(user as { id: string }).id})
    ON CONFLICT (user_id) DO NOTHING
  `

  console.log(`Created user: ${email} (id: ${(user as { id: string }).id})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
