import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { GRAPH_NODE_COLUMNS } from './types'
import type { GraphNode, NodeEdge, Project } from './types'

/** Floor between refetches. `focus` fires every time the browser is
 * foregrounded — constantly on a phone — and each refetch relayouts the whole
 * board, so an unthrottled listener is pure churn on the device least able to
 * absorb it. Doubles as an in-flight guard: the stamp is taken on entry. */
const REFETCH_MIN_MS = 10_000

/**
 * A project's whole node/edge set — the shared feed behind BOTH project views
 * (the desktop graph and the mobile queue). Same fetch, same throttled
 * refetch-on-focus, so the two views can never drift on what "the board" is.
 */
export function useProjectGraph(projectId: string | undefined) {
  const [project, setProject] = useState<Project | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<NodeEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const lastLoadAt = useRef(0)
  const load = useCallback(async () => {
    if (!projectId) return
    lastLoadAt.current = Date.now()
    const [projRes, nodesRes, edgesRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      // Only the columns the board reads — never `*`, which drags every node's
      // tldraw_doc, body and spec across the wire for a view that shows none
      // of them (see GRAPH_NODE_COLUMNS).
      supabase.from('nodes').select(GRAPH_NODE_COLUMNS).eq('project_id', projectId),
      supabase.from('edges').select('*').eq('project_id', projectId).is('removed_at', null),
    ])
    const err = projRes.error ?? nodesRes.error ?? edgesRes.error
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setProject(projRes.data as Project)
    setNodes((nodesRes.data ?? []) as GraphNode[])
    setEdges((edgesRes.data ?? []) as NodeEdge[])
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    void load()
    const onFocus = () => {
      if (document.hidden || Date.now() - lastLoadAt.current < REFETCH_MIN_MS) return
      void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  return { project, nodes, edges, error, loaded, reload: load }
}
