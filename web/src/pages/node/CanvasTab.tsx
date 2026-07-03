import { Tldraw, getSnapshot } from 'tldraw'
import type { Editor, TLEditorSnapshot, TLStoreSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import type { TaskNode } from '../../lib/types'

/**
 * tldraw canvas persisted to the node's tldraw_doc jsonb. Save persists the
 * snapshot AND exports a PNG (editor.toImage — the v3 export API; exportToBlob
 * is deprecated in the installed tldraw 3.15), uploads it to the `canvases`
 * bucket at {project_id}/{node_id}/{ISO-timestamp}.png and updates
 * canvas_png_path, logging a canvas.snapshot event.
 */
export function CanvasTab({ node, reload }: { node: TaskNode; reload: () => Promise<void> }) {
  const { session } = useAuth()
  const editorRef = useRef<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  async function save() {
    const editor = editorRef.current
    if (!editor) return
    setBusy(true)
    setErr(null)
    try {
      const snapshot = getSnapshot(editor.store)
      let pngPath = node.canvas_png_path

      const shapeIds = [...editor.getCurrentPageShapeIds()]
      if (shapeIds.length > 0) {
        const { blob } = await editor.toImage(shapeIds, { format: 'png', background: true })
        // Storage object keys reject ':' — use the ISO timestamp with ':' → '-'.
        const stamp = new Date().toISOString().replace(/:/g, '-')
        const path = `${node.project_id}/${node.id}/${stamp}.png`
        const { error: upErr } = await supabase.storage
          .from('canvases')
          .upload(path, blob, { contentType: 'image/png' })
        if (upErr) throw new Error(`PNG upload failed: ${upErr.message}`)
        pngPath = path
      }

      const { error: updErr } = await supabase
        .from('nodes')
        .update({ tldraw_doc: snapshot, canvas_png_path: pngPath })
        .eq('id', node.id)
      if (updErr) throw new Error(updErr.message)

      const { error: evErr } = await supabase.from('events').insert({
        project_id: node.project_id,
        node_id: node.id,
        actor_id: session?.user.id ?? null,
        actor_role: 'human',
        type: 'canvas.snapshot',
        data: { path: pngPath },
      })
      if (evErr) throw new Error(evErr.message)

      setSavedAt(new Date().toLocaleTimeString())
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="canvas-tab">
      <div className="canvas-toolbar">
        <button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save canvas'}
        </button>
        {savedAt ? <span className="form-ok">Saved {savedAt}</span> : null}
        {err ? <span className="form-error">{err}</span> : null}
      </div>
      <div className="canvas-wrap">
        <Tldraw
          snapshot={
            node.tldraw_doc ? (node.tldraw_doc as TLEditorSnapshot | TLStoreSnapshot) : undefined
          }
          onMount={(editor) => {
            editorRef.current = editor
          }}
        />
      </div>
    </div>
  )
}
