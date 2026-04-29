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

// Minimal client-side routing. We intentionally avoid pulling in
// react-router for the bootstrap so the bundle stays under budget;
// it can be swapped in later as routes proliferate.
//
// `/visualize/<view_id>` is intentionally NOT routed here — that path is
// served by the Hono backend as the saved generated HTML, with its own
// embedded fonts/Tailwind. The SPA only owns `/visualizations` (the index).
export function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path.startsWith('/brand')) return <BrandKit />
  if (path.startsWith('/setup/review')) return <SetupReview />
  if (path.startsWith('/today')) return <Today />
  if (path.startsWith('/brain')) return <Brain />
  if (path.startsWith('/keys/connect')) return <KeysConnect />
  if (path.startsWith('/keys')) return <Keys />
  if (path.startsWith('/skills')) return <Skills />
  if (path.startsWith('/visualizations')) return <Visualizations />
  return <Landing />
}
