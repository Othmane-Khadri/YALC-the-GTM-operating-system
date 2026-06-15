/**
 * Per-thread session store + manager.
 *
 * The store is a thin wrapper around `Map<string, unknown>`. The manager
 * memoises one store per `threadTs` so the dispatcher hands the same
 * instance to every handler invocation on that thread until the thread is
 * explicitly dropped.
 *
 * State lives in memory only. It does not survive a Slack listener
 * restart by design; long-running runs persist their own state to SQLite.
 */

import type { SessionStore } from './agent-router-types.js'

export function makeThreadSessionStore(_threadTs: string): SessionStore {
  const data = new Map<string, unknown>()
  return {
    get<T = unknown>(key: string): T | undefined {
      return data.get(key) as T | undefined
    },
    set(key, value) {
      data.set(key, value)
    },
    delete(key) {
      data.delete(key)
    },
    keys() {
      return Array.from(data.keys())
    },
  }
}

export interface SessionManager {
  for: (threadTs: string) => SessionStore
  drop: (threadTs: string) => void
}

export function makeSessionManager(): SessionManager {
  const sessions = new Map<string, SessionStore>()
  return {
    for(threadTs) {
      let s = sessions.get(threadTs)
      if (!s) {
        s = makeThreadSessionStore(threadTs)
        sessions.set(threadTs, s)
      }
      return s
    },
    drop(threadTs) {
      sessions.delete(threadTs)
    },
  }
}
