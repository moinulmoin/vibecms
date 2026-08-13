import { getCollection, type CollectionEntry } from "astro:content";
import { loader, type StaticSource } from "fumadocs-core/source";

type DocsPageData = CollectionEntry<"docs">["data"] & {
  _raw: CollectionEntry<"docs">;
};

type DocsMetaData = CollectionEntry<"meta">["data"];

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
      path: `${page.id}.mdx`,
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
    const metaPath = meta.id === "meta" ? "meta.json" : `${meta.id.replace(/\/meta$/, "")}/meta.json`;
    files.push({
      type: "meta",
      path: metaPath,
      data: meta.data,
    });
  }

  return { files };
}

export const docsSource = loader({
  source: await createDocsSource(),
  baseUrl: "/docs",
});
