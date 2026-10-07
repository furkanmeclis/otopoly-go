import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal Markdown renderer for assistant answers and admin-edited documents
 * (legal pages). Produces React elements only (never raw HTML), supporting:
 * paragraphs, headings, bullet/numbered lists, tables, fenced code, bold,
 * italic, inline code and links. Raw HTML in the text is shown as text
 * (React escapes it) and only safe link targets become anchors.
 *
 * - `chat` (default): compact styling, absolute http(s) links only.
 * - `document`: real heading elements and reading typography; also allows
 *   `mailto:` and same-site paths (`/privacy`).
 */
export type MarkdownVariant = "chat" | "document";

/**
 * Returns a normalized absolute http(s) URL, or null. Assistant text can echo
 * stored records, so anything else (javascript:, data:, relative or
 * protocol-relative URLs, credentials in the URL) is rendered as plain text.
 */
export function safeHref(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

type SafeLink = { href: string; external: boolean };

/** Link target for the document variant: http(s), mailto: or a site path. */
export function safeDocumentHref(raw: string): SafeLink | null {
  const value = raw.trim();
  if (/^\/(?![/\\])/.test(value)) return { href: value, external: false };
  if (/^mailto:[^\s/?#]+@[^\s/?#]+$/i.test(value)) {
    return { href: value, external: false };
  }
  const href = safeHref(value);
  return href ? { href, external: true } : null;
}

const INLINE_RE =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(([^\s)]+)\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function resolveLink(raw: string, variant: MarkdownVariant): SafeLink | null {
  if (variant === "document") return safeDocumentHref(raw);
  const href = safeHref(raw);
  return href ? { href, external: true } : null;
}

function renderInline(
  text: string,
  keyPrefix: string,
  variant: MarkdownVariant,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(token.slice(2, -2), key, variant)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      const link = resolveLink(match[2] ?? "", variant);
      out.push(
        link ? (
          <a
            key={key}
            href={link.href}
            {...(link.external
              ? {
                  target: "_blank",
                  rel: "noopener noreferrer nofollow",
                  referrerPolicy: "no-referrer" as const,
                }
              : {})}
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), key, variant)}
        </em>,
      );
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (trimmed.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "h",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_RE.test(lines[i + 1])
    ) {
      const head = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|[-*•]\s|\d+[.)]\s)/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length === 0) {
      para.push(line);
      i++;
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}

const styles = {
  chat: {
    root: "space-y-2 text-sm leading-relaxed",
    list: "space-y-1 pl-5",
    table: "text-xs",
  },
  document: {
    root: "space-y-4 text-[0.95rem] leading-7 sm:text-base",
    list: "space-y-1.5 pl-6",
    table: "text-sm",
  },
} as const;

function DocumentHeading({
  level,
  children,
}: {
  level: number;
  children: ReactNode;
}) {
  if (level <= 2) {
    return (
      <h2 className="font-display pt-4 text-xl font-semibold tracking-tight first:pt-0 sm:text-2xl">
        {children}
      </h2>
    );
  }
  if (level === 3) {
    return <h3 className="pt-2 text-lg font-semibold">{children}</h3>;
  }
  return <h4 className="text-base font-semibold">{children}</h4>;
}

export function Markdown({
  text,
  className,
  variant = "chat",
}: {
  text: string;
  className?: string;
  variant?: MarkdownVariant;
}) {
  const blocks = parseBlocks(text);
  const s = styles[variant];
  return (
    <div className={cn(s.root, className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "h":
            return variant === "document" ? (
              <DocumentHeading key={key} level={block.level}>
                {renderInline(block.text, key, variant)}
              </DocumentHeading>
            ) : (
              <p
                key={key}
                className={cn(
                  "font-semibold",
                  block.level <= 2 ? "text-base" : "text-sm",
                )}
              >
                {renderInline(block.text, key, variant)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.kind === "ul" ? "ul" : "ol";
            return (
              <List
                key={key}
                className={cn(
                  s.list,
                  block.kind === "ul" ? "list-disc" : "list-decimal",
                )}
              >
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>
                    {renderInline(item, `${key}-${j}`, variant)}
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre
                key={key}
                className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs"
              >
                {block.text}
              </pre>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-md border">
                <table className={cn("w-full", s.table)}>
                  <thead className="bg-muted/60">
                    <tr>
                      {block.head.map((cell, j) => (
                        <th
                          key={`${key}-h${j}`}
                          className="px-2 py-1.5 text-left font-medium"
                        >
                          {renderInline(cell, `${key}-h${j}`, variant)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r${r}`} className="border-t">
                        {row.map((cell, j) => (
                          <td
                            key={`${key}-r${r}-${j}`}
                            className="px-2 py-1.5 tabular-nums"
                          >
                            {renderInline(cell, `${key}-r${r}-${j}`, variant)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="border-border" />;
          default:
            // Documents wrap like regular Markdown (soft line breaks become
            // spaces); chat keeps the author's line breaks.
            return (
              <p key={key} className="break-words">
                {variant === "document"
                  ? renderInline(block.lines.join(" "), key, variant)
                  : block.lines.map((l, j) => (
                      <Fragment key={`${key}-${j}`}>
                        {j > 0 ? <br /> : null}
                        {renderInline(l, `${key}-${j}`, variant)}
                      </Fragment>
                    ))}
              </p>
            );
        }
      })}
    </div>
  );
}
