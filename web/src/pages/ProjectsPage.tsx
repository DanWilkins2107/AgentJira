import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { SUPABASE_URL, supabase } from '../lib/supabase'
import type { Project } from '../lib/types'

export function ProjectsPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [repoOwner, setRepoOwner] = useState('')
  const [repoName, setRepoName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: true })
    if (err) setError(err.message)
    else setProjects((data ?? []) as Project[])
  }, [])

  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  async function createProject(e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setBusy(true)
    setError(null)
    // A DB trigger auto-creates the vision node + owner membership.
    const { data, error: err } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        repo_owner: repoOwner.trim() || null,
        repo_name: repoName.trim() || null,
        created_by: session.user.id,
      })
      .select()
      .single()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/p/${(data as Project).id}`)
  }

  const active = projects.filter((p) => !p.archived_at)
  const archived = projects.filter((p) => p.archived_at)

  return (
    <div className="page projects-page">
      <h1>Projects</h1>
      {error ? <div className="form-error">{error}</div> : null}
      <ul className="project-list">
        {active.map((p) => (
          <ProjectCard key={p.id} project={p} onChanged={load} />
        ))}
        {active.length === 0 ? <li className="muted">No projects yet — create one below.</li> : null}
      </ul>

      {archived.length > 0 ? <ArchivedProjects projects={archived} onChanged={load} /> : null}

      <form className="card create-project" onSubmit={createProject}>
        <h2>Create project</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        <div className="form-row">
          <label>
            Repo owner <span className="muted">(optional)</span>
            <input value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="octocat" />
          </label>
          <label>
            Repo name <span className="muted">(optional)</span>
            <input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="hello-world" />
          </label>
        </div>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </div>
  )
}

function ProjectCard({ project, onChanged }: { project: Project; onChanged: () => Promise<void> }) {
  const [showSettings, setShowSettings] = useState(false)
  return (
    <li className="card project-card">
      <div className="project-card-head">
        <Link to={`/p/${project.id}`} className="project-link">
          {project.name}
        </Link>
        <span className="muted">
          {project.repo_owner && project.repo_name
            ? `${project.repo_owner}/${project.repo_name}`
            : 'no repo linked'}
        </span>
        <button className="btn-small" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? 'Hide settings' : 'Settings'}
        </button>
      </div>
      {showSettings ? <ProjectSettings project={project} onChanged={onChanged} /> : null}
    </li>
  )
}

function ProjectSettings({ project, onChanged }: { project: Project; onChanged: () => Promise<void> }) {
  const { session } = useAuth()
  const [repoOwner, setRepoOwner] = useState(project.repo_owner ?? '')
  const [repoName, setRepoName] = useState(project.repo_name ?? '')
  const [memberId, setMemberId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const syncUrl = `${SUPABASE_URL}/functions/v1/github-sync`
  const isOwner = session?.user.id === project.created_by

  async function archive() {
    if (
      !window.confirm(
        `Archive "${project.name}"? It disappears from your projects list, but all nodes and history are kept — you can unarchive it later.`,
      )
    )
      return
    setErr(null)
    setMsg(null)
    const { error } = await supabase
      .from('projects')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', project.id)
    if (error) setErr(error.message)
    else await onChanged()
  }

  async function saveRepo(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const { error } = await supabase
      .from('projects')
      .update({ repo_owner: repoOwner.trim() || null, repo_name: repoName.trim() || null })
      .eq('id', project.id)
    if (error) setErr(error.message)
    else {
      setMsg('Repo saved.')
      await onChanged()
    }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(project.webhook_secret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function addMember(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const { error } = await supabase
      .from('project_members')
      .insert({ project_id: project.id, user_id: memberId.trim(), role: 'agent' })
    if (error) setErr(error.message)
    else {
      setMsg('Member added.')
      setMemberId('')
    }
  }

  return (
    <div className="project-settings">
      {err ? <div className="form-error">{err}</div> : null}
      {msg ? <div className="form-ok">{msg}</div> : null}

      <form onSubmit={saveRepo} className="settings-section">
        <h3>Repository</h3>
        <div className="form-row">
          <label>
            Repo owner
            <input value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} />
          </label>
          <label>
            Repo name
            <input value={repoName} onChange={(e) => setRepoName(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="btn-small">
          Save repo
        </button>
      </form>

      <div className="settings-section">
        <h3>Webhook secret</h3>
        <div className="secret-row">
          <code className="secret-value">{project.webhook_secret}</code>
          <button className="btn-small" onClick={copySecret}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>GitHub Action install</h3>
        <ol className="gha-steps">
          <li>
            Copy <code>gha/agentjira.yml</code> from the AgentJira repo into your project repo at{' '}
            <code>.github/workflows/agentjira.yml</code>.
          </li>
          <li>
            Add repo secret <code>AGENTJIRA_SYNC_URL</code> = <code>{syncUrl}</code>
          </li>
          <li>
            Add repo secret <code>AGENTJIRA_SECRET</code> = the webhook secret above.
          </li>
        </ol>
      </div>

      <form onSubmit={addMember} className="settings-section">
        <h3>Add member</h3>
        <p className="muted">Add the agent user to this project by user id (uuid); role will be “agent”.</p>
        <div className="form-row">
          <label>
            User id (uuid)
            <input
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              required
            />
          </label>
        </div>
        <button type="submit" className="btn-small" disabled={!memberId.trim()}>
          Add as agent
        </button>
      </form>

      {isOwner ? (
        <div className="settings-section">
          <h3>Archive project</h3>
          <p className="muted">
            Hide this project from your list. Nothing is deleted — nodes and history are kept, and you can
            unarchive it later.
          </p>
          <button type="button" className="btn-small btn-danger" onClick={archive}>
            Archive project
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ArchivedProjects({
  projects,
  onChanged,
}: {
  projects: Project[]
  onChanged: () => Promise<void>
}) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function unarchive(project: Project) {
    setErr(null)
    const { error } = await supabase
      .from('projects')
      .update({ archived_at: null })
      .eq('id', project.id)
    if (error) setErr(error.message)
    else await onChanged()
  }

  return (
    <div className="archived-projects">
      <button className="btn-small" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} archived ({projects.length})
      </button>
      {err ? <div className="form-error">{err}</div> : null}
      {open ? (
        <ul className="project-list archived-list">
          {projects.map((p) => (
            <li key={p.id} className="card project-card archived">
              <div className="project-card-head">
                <Link to={`/p/${p.id}`} className="project-link muted">
                  {p.name}
                </Link>
                {session?.user.id === p.created_by ? (
                  <button className="btn-small" onClick={() => void unarchive(p)}>
                    Unarchive
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
