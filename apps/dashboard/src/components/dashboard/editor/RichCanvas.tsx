import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote, type DefaultReactSuggestionItem } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import '@blocknote/shadcn/style.css'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { ListTree, MessageSquareQuote } from 'lucide-react'
import type { Asset } from '@vc/core'
import { resolveSiteTheme, type SiteThemeInput } from '@vc/content/presented-post'
import {
  blocksToMarkdown,
  CALLOUT_KINDS,
  editorSchema,
  isMarkdownPaste,
  markdownToBlocks,
  visualMarkdownSafety,
  type AnyBlockNoteEditor,
  type EditorPartialBlock,
} from './md-adapter'
import { altFromFileName } from './image-alt'

type UploadedImage = { fileName: string; alt: string }

function findImageBlocks(blocks: readonly { id: string; type: string; props?: unknown; children?: readonly unknown[] }[], out: Array<{ id: string; url: string; name: string }> = []) {
  for (const block of blocks) {
    if (block.type === 'image') {
      const props = block.props as { url?: string; name?: string }
      out.push({ id: block.id, url: props.url ?? '', name: props.name ?? '' })
    }
    if (block.children?.length) findImageBlocks(block.children as typeof blocks, out)
  }
  return out
}

export type RichCanvasProps = {
  source: string
  assets?: Asset[]
  presetId?: string
  siteTheme?: SiteThemeInput
  uploadFile?: (file: File) => Promise<string>
  onChange: (markdown: string) => void
  onUnsafeSyntax?: (unsafe: boolean) => void
  className?: string
}

/** Callout (GFM `> [!KIND]`) and [[toc]] blocks, insertable from the slash menu. */
function vcSlashItems(editor: AnyBlockNoteEditor): DefaultReactSuggestionItem[] {
  const insertAfterCursor = (block: EditorPartialBlock) => {
    void editor.insertBlocks([block], editor.getTextCursorPosition().block, 'after')
  }
  return [
    ...CALLOUT_KINDS.map((kind): DefaultReactSuggestionItem => ({
      title: `Callout: ${kind.charAt(0)}${kind.slice(1).toLowerCase()}`,
      subtext: 'Highlighted aside',
      aliases: ['callout', 'aside', kind.toLowerCase()],
      group: 'Callouts',
      icon: <MessageSquareQuote className="size-4" />,
      onItemClick: () => insertAfterCursor({ type: 'vcCallout', props: { kind } } as EditorPartialBlock),
    })),
    {
      title: 'Table of contents',
      subtext: 'Auto-generated post outline',
      aliases: ['toc', 'contents', 'outline'],
      group: 'Advanced blocks',
      icon: <ListTree className="size-4" />,
      onItemClick: () => insertAfterCursor({ type: 'vcToc' } as EditorPartialBlock),
    },
  ]
}

/**
 * BlockNote's editor surface. Markdown remains canonical: each content change
 * serializes the complete document, never an incremental patch.
 */
export function RichCanvas({ source, presetId = 'minimal', siteTheme, uploadFile, onChange, onUnsafeSyntax, className }: RichCanvasProps) {
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const lastSourceRef = useRef(source)
  const initializedEditorRef = useRef<unknown>(null)
  const uploadFileRef = useRef(uploadFile)
  uploadFileRef.current = uploadFile
  const uploadedRef = useRef(new Map<string, UploadedImage>())
  // Stable identity: a changing upload callback must never recreate the editor
  // (a fresh editor starts empty and its first change would clobber the post).
  const stableUpload = useCallback(async (file: File) => {
    const upload = uploadFileRef.current
    if (!upload) throw new Error('Image uploads are not available here.')
    const url = await upload(file)
    uploadedRef.current.set(url, { fileName: file.name, alt: altFromFileName(file.name) })
    return url
  }, [])
  const editor = useCreateBlockNote(
    {
      schema: editorSchema,
      uploadFile: stableUpload,
      tables: { headers: true, cellBackgroundColor: false, cellTextColor: false },
      trailingBlock: true,
      // Handle Markdown paste inside BlockNote's own paste hook: a React onPaste
      // on the wrapper runs after ProseMirror already pasted, doubling content.
      pasteHandler: ({ event, editor: target, defaultPasteHandler }) => {
        const types = Array.from(event.clipboardData?.types ?? [])
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const cursorBlock = target.getTextCursorPosition().block
        if (cursorBlock.type === 'codeBlock' || types.includes('blocknote/html') || types.includes('Files') || !text || !isMarkdownPaste(text)) {
          return defaultPasteHandler()
        }
        target.insertBlocks(markdownToBlocks(text, target as AnyBlockNoteEditor) as never, cursorBlock, 'after')
        return true
      },
    },
    [],
  )

  useEffect(() => {
    canvasRef.current?.querySelector('.ProseMirror')?.setAttribute('aria-label', 'Post content')
  }, [])

  // Load the current source into this editor instance exactly once, then only
  // when the source changes from outside (restore, conflict reload, Source mode).
  useEffect(() => {
    if (initializedEditorRef.current === editor && sourceRef.current === lastSourceRef.current) return
    initializedEditorRef.current = editor
    const next = sourceRef.current
    lastSourceRef.current = next
    const result = visualMarkdownSafety(next, editor)
    onUnsafeSyntax?.(!result.safe)
    if (result.safe) editor.replaceBlocks(editor.document, result.blocks)
  }, [editor, onUnsafeSyntax, source])

  useEffect(() => {
    const sync = () => {
      // Uploaded images arrive named after the file; swap in readable alt text.
      if (uploadedRef.current.size > 0) {
        for (const image of findImageBlocks(editor.document)) {
          const uploaded = uploadedRef.current.get(image.url)
          if (!uploaded) continue
          uploadedRef.current.delete(image.url)
          if (image.name === uploaded.fileName) {
            queueMicrotask(() => editor.updateBlock(image.id, { props: { name: uploaded.alt } } as never))
            return
          }
        }
      }
      const markdown = blocksToMarkdown(editor.document, editor)
      if (markdown === lastSourceRef.current) return
      // Never drop a keystroke: the parent always receives what was typed. When
      // it cannot round-trip exactly, the parent moves the writer to Markdown.
      lastSourceRef.current = markdown
      onChange(markdown)
      onUnsafeSyntax?.(!visualMarkdownSafety(markdown, editor).safe)
    }
    return editor.onChange(sync)
  }, [editor, onChange, onUnsafeSyntax])

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const files = [...event.dataTransfer.files]
    if (files.length > 0 && files.every((file) => !file.type.startsWith('image/'))) {
      event.preventDefault()
      setDropNotice('Only images can be added to a post.')
      window.setTimeout(() => setDropNotice(null), 3000)
    }
  }

  const theme = siteTheme ? resolveSiteTheme(siteTheme, presetId) : undefined
  return (
    <div
      ref={canvasRef}
      className={className}
      data-rich-content
      data-vc-theme={presetId}
      data-vc-mode={theme?.mode ?? 'dark'}
      style={theme?.style}
      onDrop={handleDrop}
      data-testid="rich-canvas"
    >
      <BlockNoteView editor={editor} slashMenu={false} theme={theme?.mode === 'light' ? 'light' : 'dark'} className="vc-rich-canvas">
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async () => [...getDefaultReactSlashMenuItems(editor), ...vcSlashItems(editor)]}
        />
      </BlockNoteView>
      {dropNotice ? <p role="status" className="mt-2 font-mono text-xs text-muted-foreground">{dropNotice}</p> : null}
    </div>
  )
}
