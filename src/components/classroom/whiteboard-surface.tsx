'use client'

// Thin tldraw v5 wrapper that exposes a ref-based API for the parent panel.
// Lives in its own file so the parent can `lazy()`-load it (tldraw is ~1.5MB).
//
// We deliberately use the unmanaged tldraw editor (no `Tldraw` provider's
// built-in sync) and instead drive snapshots ourselves via the parent's
// data-channel + REST flow. tldraw's `<Tldraw />` component still gives us
// the toolbar / shape pickers / accessibility plumbing for free.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import {
  Tldraw,
  type Editor,
  type StoreSnapshot,
  type TLEditorSnapshot,
  type TLRecord,
  loadSnapshot,
  getSnapshot,
} from 'tldraw'
import 'tldraw/tldraw.css'

// `getSnapshot()` (tldraw v3+) returns the `TLEditorSnapshot` envelope
// `{ document, session }`, not the lower-level `StoreSnapshot<TLRecord>`.
// `loadSnapshot()` accepts either — it dispatches on shape internally — so
// we type the imperative handle in terms of the value `getSnapshot()`
// actually returns and cast at the `loadSnapshot` callsite (we accept
// `unknown` from the network for incoming snapshots).
interface SurfaceHandle {
  getSnapshot: () => TLEditorSnapshot | null
  loadSnapshot: (snapshot: unknown) => void
}

interface SurfaceProps {
  onMount: (handle: SurfaceHandle) => void
  onChange: () => void
  readOnly?: boolean
}

const TldrawSurface = forwardRef<SurfaceHandle, SurfaceProps>(function TldrawSurface(
  { onMount, onChange, readOnly },
  ref
) {
  const editorRef = useRef<Editor | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Build the imperative handle once via useRef so both useImperativeHandle
  // and the onMount callback can reference the same object without ESLint
  // complaining about render-time deps. The closures inside read editorRef
  // lazily so they always see the latest editor instance.
  const handleRef = useRef<SurfaceHandle>({
    getSnapshot: () => {
      const editor = editorRef.current
      if (!editor) return null
      return getSnapshot(editor.store)
    },
    loadSnapshot: (snapshot: unknown) => {
      const editor = editorRef.current
      if (!editor || !snapshot) return
      try {
        loadSnapshot(editor.store, snapshot as StoreSnapshot<TLRecord>)
      } catch (err) {
        // A malformed snapshot shouldn't take down the whole canvas. Log
        // and continue with whatever's already on the editor.
        console.warn('[whiteboard] loadSnapshot failed:', err)
      }
    },
  })

  useImperativeHandle(ref, () => handleRef.current, [])

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      // Apply initial readOnly state immediately after mount.
      editor.updateInstanceState({ isReadonly: !!readOnly })
      // Subscribe to store changes for the parent's debounced save.
      // tldraw v5 exposes store.listen() which fires for every commit.
      editor.store.listen(
        () => {
          onChangeRef.current()
        },
        { source: 'user', scope: 'document' }
      )
      onMount(handleRef.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMount]
  )

  // Toggle readOnly imperatively so we never remount tldraw (which causes a
  // visible blank-canvas flicker). Changing the `key` prop would unmount+remount
  // the whole editor — expensive and jarring for the user.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateInstanceState({ isReadonly: !!readOnly })
  }, [readOnly])

  return (
    // Absolute positioning inside the panel's `relative` container ensures
    // tldraw's ResizeObserver always sees a stable pixel height regardless of
    // flexbox / framer-motion animation state at mount time. The previous
    // h-full!/w-full! Tailwind v4 syntax had no effect in v3, leaving tldraw
    // with height:0 during the sidebar slide-in animation.
    <div style={{ position: 'absolute', inset: 0 }}>
      <Tldraw onMount={handleMount} hideUi={false} />
    </div>
  )
})

export default TldrawSurface
