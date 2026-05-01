import { useEffect, useState } from 'react'
import { BrandKit } from './pages/BrandKit'
import { Landing } from './pages/Landing'
import { SetupReview } from './pages/SetupReview'
import { Today } from './pages/Today'
import { Brain } from './pages/Brain'
import { Keys } from './pages/Keys'
import { KeysConnect } from './pages/KeysConnect'
import { Skills } from './pages/Skills'
import { Visualizations } from './pages/Visualizations'
import { Dashboard } from './pages/Dashboard'
import { resolveTodayRedirect } from './lib/dashboard-redirect'

// Minimal client-side routing. We intentionally avoid pulling in
// react-router for the bootstrap so the bundle stays under budget;
// it can be swapped in later as routes proliferate.
//
// `/visualize/<view_id>` is intentionally NOT routed here — that path is
// served by the Hono backend as the saved generated HTML, with its own
// embedded fonts/Tailwind. The SPA only owns `/visualizations` (the index).
//
// `/today` redirect: when an archetype is pinned in `~/.gtm-os/config.yaml`
// we bounce to the matching `/dashboard/<archetype>` instead of rendering
// the shared feed. The check fires from a useEffect so it doesn't block
// the initial render — the user sees the Today shell briefly while the
// /api/dashboard/active probe resolves, then the router pivots.
export function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // /today archetype redirect — best-effort, fails open to /today.
  useEffect(() => {
    if (!path.startsWith('/today')) return
    let cancelled = false
    resolveTodayRedirect()
      .then((target) => {
        if (cancelled || !target) return
        window.history.replaceState(null, '', target)
        setPath(target)
      })
      .catch(() => {
        // Best-effort — stay on /today.
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (path.startsWith('/brand')) return <BrandKit />
  if (path.startsWith('/setup/review')) return <SetupReview />
  if (path.startsWith('/dashboard/')) {
    const id = path.split('/')[2]?.toLowerCase()
    if (id === 'a' || id === 'b' || id === 'c' || id === 'd') {
      return <Dashboard archetypeId={id} />
    }
  }
  if (path.startsWith('/today')) return <Today />
  if (path.startsWith('/brain')) return <Brain />
  if (path.startsWith('/keys/connect')) return <KeysConnect />
  if (path.startsWith('/keys')) return <Keys />
  if (path.startsWith('/skills')) return <Skills />
  if (path.startsWith('/visualizations')) return <Visualizations />
  return <Landing />
}
