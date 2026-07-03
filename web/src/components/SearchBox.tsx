import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { SearchResult } from '../lib/types'

/** Project-level search calling the search_all RPC, results dropdown linking to nodes. */
export function SearchBox({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setError(null)
      return
    }
    const t = window.setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('search_all', {
        p_project: projectId,
        p_query: q,
      })
      if (err) {
        setError(err.message)
        setResults(null)
      } else {
        setError(null)
        setResults((data ?? []) as SearchResult[])
      }
      setOpen(true)
    }, 300)
    return () => window.clearTimeout(t)
  }, [query, projectId])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="search-box" ref={boxRef}>
      <input
        type="search"
        placeholder="Search nodes & messages…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && (error || results) ? (
        <div className="search-results">
          {error ? <div className="search-empty">Search failed: {error}</div> : null}
          {results && results.length === 0 ? <div className="search-empty">No results</div> : null}
          {(results ?? []).map((r, i) => (
            <Link
              key={`${r.kind}-${r.node_id}-${i}`}
              to={`/n/${r.node_id}`}
              className="search-result"
              onClick={() => setOpen(false)}
            >
              <span className={`search-kind search-kind-${r.kind}`}>{r.kind}</span>
              <span className="search-result-title">{r.title}</span>
              <span className="search-result-snippet">{r.snippet}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
