"use client";

import { parseMarkdown } from "@/lib/markdown";
import { Button, FieldDescription, Select, Textarea } from "@vc/ui";
import { Eye, ImagePlus, PenLine } from "lucide-react";
import { useMemo, useRef, useState } from "react";

type MarkdownAsset = {
  id: string;
  filename: string;
};

type MarkdownEditorProps = {
  assets: MarkdownAsset[];
  defaultValue: string;
};

type EditorMode = "write" | "preview";

export function MarkdownEditor({ assets, defaultValue }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: defaultValue.length, end: defaultValue.length });
  const [mode, setMode] = useState<EditorMode>("write");
  const [previewSource, setPreviewSource] = useState(defaultValue);
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? "");

  const preview = useMemo(() => parseMarkdown(previewSource), [previewSource]);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];

  function showWrite() {
    setMode("write");
  }

  function showPreview() {
    setPreviewSource(textareaRef.current?.value ?? "");
    setMode("preview");
  }

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  }

  function insertImage() {
    const textarea = textareaRef.current;
    if (!textarea || !selectedAsset) return;

    const imageMarkdown = `![${altTextFor(selectedAsset.filename)}](/media-assets/${selectedAsset.id})`;
    const value = textarea.value;
    const { start, end } = selectionRef.current;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before.length === 0 || before.endsWith("\n") ? "" : "\n";
    const suffix = after.length === 0 || after.startsWith("\n") ? "" : "\n";
    const nextValue = `${before}${prefix}${imageMarkdown}${suffix}${after}`;
    const nextCaret = before.length + prefix.length + imageMarkdown.length;

    textarea.value = nextValue;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(nextCaret, nextCaret);
    selectionRef.current = { start: nextCaret, end: nextCaret };
    if (mode === "preview") setPreviewSource(nextValue);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-md bg-muted p-1">
          <Button
            type="button"
            variant={mode === "write" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-sm"
            aria-pressed={mode === "write"}
            onClick={showWrite}
          >
            <PenLine className="size-4" aria-hidden="true" />
            Write
          </Button>
          <Button
            type="button"
            variant={mode === "preview" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-sm"
            aria-pressed={mode === "preview"}
            onClick={showPreview}
          >
            <Eye className="size-4" aria-hidden="true" />
            Preview
          </Button>
        </div>
        {assets.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              aria-label="Image to insert"
              className="h-9 min-w-0 sm:w-56"
              value={selectedAssetId}
              onChange={(event) => setSelectedAssetId(event.currentTarget.value)}
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.filename}</option>
              ))}
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={insertImage}>
              <ImagePlus className="size-4" aria-hidden="true" />
              Insert image
            </Button>
          </div>
        ) : (
          <FieldDescription>
            No image assets yet. <a className="font-medium text-primary underline underline-offset-4" href="/app/media">Upload images</a> to insert them here.
          </FieldDescription>
        )}
      </div>

      <FieldDescription>
        Supports headings, bold, italic, links, lists, code, and quotes.
      </FieldDescription>

      <div className={mode === "write" ? "block" : "hidden"}>
        <Textarea
          ref={textareaRef}
          id="post-markdown"
          name="contentMarkdown"
          className="min-h-[32rem] font-mono leading-6"
          maxLength={500000}
          defaultValue={defaultValue}
          onChange={rememberSelection}
          onClick={rememberSelection}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
        />
      </div>

      {mode === "preview" ? (
        <div className="min-h-[32rem] rounded-lg border border-border bg-card p-5 text-sm leading-7 text-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:text-xl [&_h3]:font-semibold [&_hr]:border-border [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_ul]:list-disc">
          {preview.length > 0 ? preview : <p className="text-muted-foreground">Nothing to preview yet.</p>}
        </div>
      ) : null}
    </div>
  );
}

function altTextFor(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim() || "image";
}
