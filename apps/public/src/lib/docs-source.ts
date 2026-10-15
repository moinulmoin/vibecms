import { getCollection, type CollectionEntry } from "astro:content";
import { loader, type StaticSource } from "fumadocs-core/source";

type DocsPageData = CollectionEntry<"docs">["data"] & {
  _raw: CollectionEntry<"docs">;
};

type DocsMetaData = CollectionEntry<"meta">["data"];

const DOCS_ROOT = "src/content/docs/";

// Astro's glob loader collapses `cli/index.mdx` to the id `cli`, which turns a
// folder index into an orphan root page and empties the folder in the sidebar.
// Fumadocs needs the real path relative to the docs root.
function docsRelativePath(entry: { id: string; filePath?: string }): string {
  if (!entry.filePath?.startsWith(DOCS_ROOT)) {
    throw new Error(`Docs entry "${entry.id}" is outside ${DOCS_ROOT}`);
  }
  return entry.filePath.slice(DOCS_ROOT.length);
}

async function createDocsSource(): Promise<
  StaticSource<{
    pageData: DocsPageData;
    metaData: DocsMetaData;
  }>
> {
  const files: StaticSource<{
    pageData: DocsPageData;
    metaData: DocsMetaData;
  }>["files"] = [];

  for (const page of await getCollection("docs")) {
    files.push({
      type: "page",
      path: docsRelativePath(page),
      data: {
        ...page.data,
        structuredData: {
          headings: [],
          contents: [
            {
              heading: undefined,
              content: page.body ?? "",
            },
          ],
        },
        _raw: page,
      },
    });
  }

  for (const meta of await getCollection("meta")) {
    files.push({
      type: "meta",
      path: docsRelativePath(meta),
      data: meta.data,
    });
  }

  return { files };
}

export const docsSource = loader({
  source: await createDocsSource(),
  baseUrl: "/docs",
});
