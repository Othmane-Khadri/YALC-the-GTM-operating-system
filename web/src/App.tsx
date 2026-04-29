import { useEffect, useState } from 'react'
import { BrandKit } from './pages/BrandKit'
import { Landing } from './pages/Landing'
import { SetupReview } from './pages/SetupReview'

// Minimal client-side routing. We intentionally avoid pulling in
// react-router for the bootstrap so the bundle stays under budget;
// it can be swapped in later as routes proliferate.
export function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path.startsWith('/brand')) return <BrandKit />
  if (path.startsWith('/setup/review')) return <SetupReview />
  return <Landing />
}
