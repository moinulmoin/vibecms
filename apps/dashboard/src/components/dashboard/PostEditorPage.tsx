import type { Post } from '@vc/core'
import { Outlet, useMatch } from '@tanstack/react-router'
import { PostEditorShell, editorLiveState, shouldShowPublishAction, type EditorLiveState } from './editor/PostEditorShell'

export { editorLiveState, shouldShowPublishAction }
export type { EditorLiveState }

/**
 * Rendered by the persistent /dashboard/posts parent route. The editor lives here,
 * not in the child Outlet, so swapping /new for /$postId/edit after the first save
 * keeps the same mounted shell (and the writer's focus and in-flight typing).
 * Resetting for a different existing post is the shell's job, keyed on postId.
 */
export function PostEditorPage() {
  const isNew = useMatch({ from: '/dashboard/posts/new', shouldThrow: false, select: () => true })
  const editPostId = useMatch({ from: '/dashboard/posts/$postId/edit', shouldThrow: false, select: (match) => match.params.postId })
  if (editPostId !== undefined) return <PostEditorShell postId={editPostId} />
  if (isNew) return <PostEditorShell postId={undefined} />
  return <Outlet />
}

export function editorStateSignal(state: EditorLiveState) {
  const label = state === 'unpublished' ? 'Unpublished' : state === 'live' ? 'Live' : state === 'draft' ? 'Draft' : state === 'archived' ? 'Archived' : 'New'
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] font-medium text-muted-foreground">
      <span className={`size-2 rounded-full ${state === 'live' ? 'bg-brand-bright' : state === 'unpublished' ? 'bg-warning' : 'bg-muted-foreground/40'}`} />
      {label}
    </span>
  )
}

export type EditorPostState = Pick<Post, 'status' | 'publishedVersionNumber'>
