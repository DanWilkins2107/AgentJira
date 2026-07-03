import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, RequireAuth, useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import { GraphPage } from './pages/GraphPage'
import { LoginPage } from './pages/LoginPage'
import { NodePage } from './pages/NodePage'
import { ProjectsPage } from './pages/ProjectsPage'

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
                  <GraphPage />
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
