import { BrowserRouter, Link, Route, Routes, useSearchParams } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthProvider, RequireAuth, useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import { LoginPage } from './pages/LoginPage'
import { NodePage } from './pages/NodePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { QueuePage } from './pages/QueuePage'

/**
 * The graph is the heaviest thing in the app after tldraw: React Flow plus its
 * stylesheet, and it is the ONLY thing that pulls them in. Split it out so a
 * phone — which renders the queue instead (see ProjectView) — never downloads
 * it at all, let alone lays it out.
 */
const GraphPage = lazy(() => import('./pages/GraphPage').then((m) => ({ default: m.GraphPage })))

/** Below this width the graph is not worth rendering: cards are unreadable at a
 * zoom that fits, and the board relayouts cost more than the phone has. */
const NARROW = '(max-width: 820px)'

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/**
 * One project, two views of the same board. Narrow viewport gets the swipeable
 * queue; anything wider gets the graph. `?view=graph` forces the graph anyway —
 * the only path on which a phone loads React Flow, and only ever because
 * someone asked for it.
 */
function ProjectView() {
  const narrow = useNarrowViewport()
  const [params] = useSearchParams()
  if (narrow && params.get('view') !== 'graph') return <QueuePage />
  return (
    <Suspense fallback={<div className="page-loading">Loading graph…</div>}>
      <GraphPage />
    </Suspense>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          AgentJira
        </Link>
        <span className="topbar-spacer" />
        <span className="muted">{session?.user.email}</span>
        <button className="btn-small" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <main className="main">{children}</main>
    </div>
  )
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Shell>
                  <ProjectsPage />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/p/:projectId"
            element={
              <RequireAuth>
                <Shell>
                  <ProjectView />
                </Shell>
              </RequireAuth>
            }
          />
          <Route
            path="/n/:nodeId"
            element={
              <RequireAuth>
                <Shell>
                  <NodePage />
                </Shell>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
