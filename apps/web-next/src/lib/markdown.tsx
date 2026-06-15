import type { ReactNode } from "react";

/**
 * Restrict link hrefs to safe schemes. Post markdown is authored by humans and
 * agents, so block javascript:/data:/vbscript: URLs to prevent stored XSS.
 */
export function safeHref(raw: string): string {
  const href = raw.trim();
  if (href.startsWith("//")) return "#";
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "#";
}

/**
 * Minimal, dependency-free Markdown renderer. Returns React elements - it never
 * injects raw HTML, so it is safe for untrusted (human or agent) content.
 */
export function parseMarkdown(source: string): ReactNode[] {
  const lines = source.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  let keyIndex = 0;

  const key = () => keyIndex++;

  function inline(text: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let remaining = text;
    let partKey = 0;

    while (remaining.length > 0) {
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
      const boldItalicMatch = remaining.match(/^(.*?)\*\*\*(.+?)\*\*\*/);
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
      const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/);
      const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/);
      const imageMatch = remaining.match(/^(.*?)!\[([^\]]*)\]\(([^)]+)\)/);

      const candidates = [
        { match: codeMatch, type: "code" },
        { match: boldItalicMatch, type: "bolditalic" },
        { match: boldMatch, type: "bold" },
        { match: italicMatch, type: "italic" },
        { match: linkMatch, type: "link" },
        { match: imageMatch, type: "image" },
      ].filter((c) => c.match) as { match: RegExpMatchArray; type: string }[];

      if (candidates.length === 0) {
        parts.push(remaining);
        break;
      }

      candidates.sort((a, b) => a.match[1].length - b.match[1].length);
      const earliest = candidates[0];
      const m = earliest.match;

      if (m[1]) parts.push(m[1]);

      switch (earliest.type) {
        case "code":
          parts.push(<code key={partKey++}>{m[2]}</code>);
          break;
        case "bolditalic":
          parts.push(
            <strong key={partKey++}>
              <em>{inline(m[2])}</em>
            </strong>,
          );
          break;
        case "bold":
          parts.push(<strong key={partKey++}>{inline(m[2])}</strong>);
          break;
        case "italic":
          parts.push(<em key={partKey++}>{inline(m[2])}</em>);
          break;
        case "link":
          parts.push(
            <a key={partKey++} href={safeHref(m[3])} rel="nofollow noopener noreferrer">
              {m[2]}
            </a>,
          );
          break;
        case "image":
          parts.push(<img key={partKey++} src={safeHref(m[3])} alt={m[2]} loading="lazy" />);
          break;
      }

      remaining = remaining.slice(m[0].length);
    }

    return parts;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre key={key()}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = inline(headingMatch[2]);
      if (level === 1) elements.push(<h1 key={key()}>{content}</h1>);
      else if (level === 2) elements.push(<h2 key={key()}>{content}</h2>);
      else elements.push(<h3 key={key()}>{content}</h3>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      elements.push(<hr key={key()} />);
      i++;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={key()}>
          <p>{inline(quoteLines.join(" "))}</p>
        </blockquote>,
      );
      continue;
    }

    if (/^[-*+]\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^[-*+]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={key()}>
          {items.map((item, idx) => (
            <li key={idx}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line.trimStart())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={key()}>
          {items.map((item, idx) => (
            <li key={idx}>{inline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith(">") &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*+]\s/.test(lines[i].trimStart()) &&
      !/^\d+\.\s/.test(lines[i].trimStart()) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(<p key={key()}>{inline(paraLines.join(" "))}</p>);
    }
  }

  return elements;
}