import type { Post } from '@vc/core'
import { PostEditorShell, editorLiveState, shouldShowPublishAction, type EditorLiveState } from './editor/PostEditorShell'

export { editorLiveState, shouldShowPublishAction }
export type { EditorLiveState }

export function NewPostEditorPage() {
  return <PostEditorShell />
}

export function EditPostEditorPage({ postId }: { postId: string }) {
  return <PostEditorShell postId={postId} />
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
