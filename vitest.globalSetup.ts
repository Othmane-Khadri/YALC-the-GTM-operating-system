import { createClient } from '@libsql/client'
import { spawnSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export default async function setup(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const testDb = resolve(here, 'gtm-os.test.db')

  for (const suffix of ['', '-shm', '-wal']) {
    const p = testDb + suffix
    if (existsSync(p)) unlinkSync(p)
  }

  process.env.DATABASE_URL = `file:${testDb}`

  const push = spawnSync('pnpm', ['exec', 'drizzle-kit', 'push'], {
    cwd: here,
    stdio: 'inherit',
    env: process.env,
  })
  if (push.status !== 0) {
    throw new Error(`drizzle-kit push failed with exit code ${push.status}`)
  }

  const migrationsDir = resolve(here, 'src/lib/db/migrations')
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const client = createClient({ url: process.env.DATABASE_URL })
  for (const f of files) {
    const sql = await readFile(resolve(migrationsDir, f), 'utf-8')
    const stmts = sql
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of stmts) {
      try {
        await client.execute(stmt)
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? '')
        if (!/(already exists|duplicate column)/i.test(msg)) throw err
      }
    }
  }
  client.close()
}
