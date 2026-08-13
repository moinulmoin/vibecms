import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";
import { BRAND } from "@vc/config";
import { DocsSearchDialog } from "./docs-search";

export function DocsShell({
  tree,
  children,
  pathname,
  params,
  title,
  description,
  toc,
  appUrl,
}: {
  tree: Root;
  children: ReactNode;
  pathname: string;
  params: AstroProviderProps["params"];
  title: string;
  description?: string;
  toc?: { title: string; url: string; depth: number }[];
  appUrl: string;
}) {
  const appOrigin = appUrl.replace(/\/$/, "");

  return (
    <RootProvider
      pathname={pathname}
      params={params}
      theme={{ enabled: false }}
      search={{ SearchDialog: DocsSearchDialog }}
    >
      <DocsLayout
        tree={tree}
        githubUrl={BRAND.repoUrl}
        nav={{
          title: (
            <span className="vc-docs-brand">
              <img src="/brand/icon.svg" alt="" aria-hidden="true" />
              <span>
                vibecms<span>.</span>
              </span>
              <small>docs</small>
            </span>
          ),
          url: "/docs",
          transparentMode: "none",
        }}
        links={[
          { text: "Home", url: "/" },
          { text: "API explorer", url: `${appOrigin}/api/v1/docs`, external: true },
          { type: "button", text: "Open app", url: `${appOrigin}/login`, external: true },
        ]}
        themeSwitch={{ enabled: false }}
      >
        <DocsPage toc={toc} footer={{ enabled: false }}>
          <DocsTitle>{title}</DocsTitle>
          <DocsDescription>{description}</DocsDescription>
          <DocsBody>{children}</DocsBody>
        </DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
