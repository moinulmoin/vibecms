'use client'

import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote, type DefaultReactSuggestionItem } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import '@blocknote/shadcn/style.css'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
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
  const initialSourceRef = useRef(source)
  const lastSourceRef = useRef(source)
  const initializedRef = useRef(false)
  const editor = useCreateBlockNote(
    {
      schema: editorSchema,
      uploadFile,
      tables: { headers: true, cellBackgroundColor: false, cellTextColor: false },
      trailingBlock: true,
    },
    [uploadFile],
  )

  useEffect(() => {
    canvasRef.current?.querySelector('.ProseMirror')?.setAttribute('aria-label', 'Post content')
  }, [])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    lastSourceRef.current = initialSourceRef.current
    const result = visualMarkdownSafety(initialSourceRef.current, editor)
    onUnsafeSyntax?.(!result.safe)
    if (result.safe) editor.replaceBlocks(editor.document, result.blocks)
  }, [editor, onUnsafeSyntax])

  useEffect(() => {
    if (!initializedRef.current || source === lastSourceRef.current) return
    lastSourceRef.current = source
    const result = visualMarkdownSafety(source, editor)
    onUnsafeSyntax?.(!result.safe)
    if (result.safe) editor.replaceBlocks(editor.document, result.blocks)
  }, [editor, onUnsafeSyntax, source])

  useEffect(() => {
    const sync = () => {
      const markdown = blocksToMarkdown(editor.document, editor)
      if (markdown === lastSourceRef.current) return
      const result = visualMarkdownSafety(markdown, editor)
      if (!result.safe) {
        onUnsafeSyntax?.(true)
        return
      }
      lastSourceRef.current = markdown
      onUnsafeSyntax?.(false)
      onChange(markdown)
    }
    return editor.onChange(sync)
  }, [editor, onChange, onUnsafeSyntax])

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData('text/plain')
    if (!text || !isMarkdownPaste(text)) return
    event.preventDefault()
    const cursor = editor.getTextCursorPosition()
    editor.insertBlocks(markdownToBlocks(text, editor), cursor.block.id, 'after')
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const files = [...event.dataTransfer.files]
    if (files.length > 0 && files.every((file) => !file.type.startsWith('image/'))) {
      event.preventDefault()
      setDropNotice('Only images can be added to a post.')
      window.setTimeout(() => setDropNotice(null), 3000)
    }
  }

  const theme = siteTheme ? resolveSiteTheme(siteTheme) : undefined
  return (
    <div
      ref={canvasRef}
      className={className}
      data-rich-content
      data-vc-theme={presetId}
      data-vc-mode={theme?.mode ?? 'dark'}
      style={theme?.style}
      onPaste={handlePaste}
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
