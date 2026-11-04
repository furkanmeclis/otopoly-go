/**
 * Read-only renderer for contract `content_html` (web: sanitized `dangerouslySetInnerHTML` inside `prose`).
 * The editor (Lexical) only produces a small tag set — headings, paragraphs, lists, bold/italic/underline,
 * links, line breaks — so a tiny parser is enough and avoids a WebView dependency. Unknown tags render
 * their text content; scripts/styles are dropped.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { Image, Platform, Text, View, type TextStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { useTheme } from '@/theme/provider';

type Node = { type: 'text'; text: string } | { type: 'el'; tag: string; attrs: Record<string, string>; children: Node[] };

const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input']);
const DROP = new Set(['script', 'style', 'head', 'title']);
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'section', 'article', 'table', 'tr', 'hr', 'img']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string) {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

export function parseHtml(html: string): Node[] {
  const root: Extract<Node, { type: 'el' }> = { type: 'el', tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let dropDepth = 0;
  for (const m of html.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[3] !== undefined) {
      if (!dropDepth) top.children.push({ type: 'text', text: decode(m[3]) });
      continue;
    }
    if (!m[1]) continue; // comment
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (DROP.has(tag)) {
      dropDepth += closing ? -1 : 1;
      dropDepth = Math.max(0, dropDepth);
      continue;
    }
    if (dropDepth) continue;
    if (closing) {
      const idx = stack.map((n) => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const el: Extract<Node, { type: 'el' }> = { type: 'el', tag, attrs: parseAttrs(m[2] ?? ''), children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !m[2]?.trim().endsWith('/')) stack.push(el);
  }
  return root.children;
}

function hasBlock(nodes: Node[]): boolean {
  return nodes.some((n) => n.type === 'el' && (BLOCK.has(n.tag) || hasBlock(n.children)));
}

export function ContractHtml({ html }: { html: string }) {
  const t = useTheme();
  const nodes = useMemo(() => parseHtml(html || ''), [html]);

  const inlineStyle = (tag: string): TextStyle | undefined => {
    switch (tag) {
      case 'strong':
      case 'b':
        return { fontWeight: '700', color: t.colors.text };
      case 'em':
      case 'i':
        return { fontStyle: 'italic' };
      case 'u':
        return { textDecorationLine: 'underline' };
      case 's':
      case 'del':
        return { textDecorationLine: 'line-through' };
      case 'a':
        return { color: t.colors.primary, textDecorationLine: 'underline' };
      case 'code':
        return { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: t.fontSize.sm };
      default:
        return undefined;
    }
  };

  const renderInline = (list: Node[], keyPrefix: string): ReactNode[] =>
    list.map((n, i) => {
      const key = `${keyPrefix}-${i}`;
      if (n.type === 'text') return n.text.replace(/\s+/g, ' ');
      if (n.tag === 'br') return '\n';
      return (
        <Text key={key} style={inlineStyle(n.tag)}>
          {renderInline(n.children, key)}
        </Text>
      );
    });

  const paragraph = (children: Node[], key: string, style?: TextStyle) => {
    const content = renderInline(children, key);
    const text = content.filter((c) => typeof c === 'string').join('');
    if (!content.length || (content.every((c) => typeof c === 'string') && !text.trim())) return <View key={key} style={{ height: t.spacing.sm }} />;
    return (
      <Txt key={key} style={[{ lineHeight: 22 }, style]} selectable>
        {content}
      </Txt>
    );
  };

  const renderBlocks = (list: Node[], keyPrefix: string, listCtx?: { ordered: boolean }): ReactNode[] => {
    const out: ReactNode[] = [];
    let inlineRun: Node[] = [];
    let liIndex = 0;
    const flush = (i: number) => {
      if (inlineRun.length && inlineRun.some((n) => n.type === 'el' || n.text.trim())) out.push(paragraph(inlineRun, `${keyPrefix}-run-${i}`));
      inlineRun = [];
    };
    list.forEach((n, i) => {
      const key = `${keyPrefix}-${i}`;
      if (n.type === 'text' || (!BLOCK.has(n.tag) && !hasBlock(n.children))) {
        inlineRun.push(n);
        return;
      }
      flush(i);
      switch (n.tag) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
          const size = { h1: t.fontSize.xl, h2: t.fontSize.lg, h3: t.fontSize.md + 1 }[n.tag as 'h1' | 'h2' | 'h3'] ?? t.fontSize.md;
          out.push(paragraph(n.children, key, { fontSize: size, fontWeight: '800', color: t.colors.primary, marginTop: t.spacing.sm }));
          break;
        }
        case 'ul':
        case 'ol':
          out.push(
            <View key={key} style={{ gap: 4 }}>
              {renderBlocks(n.children, key, { ordered: n.tag === 'ol' })}
            </View>,
          );
          break;
        case 'li': {
          liIndex += 1;
          const marker = listCtx?.ordered ? `${liIndex}.` : '•';
          out.push(
            <View key={key} style={{ flexDirection: 'row', gap: t.spacing.sm, paddingStart: t.spacing.sm }}>
              <Txt style={{ lineHeight: 22, minWidth: 16 }}>{marker}</Txt>
              <View style={{ flex: 1, gap: 4 }}>{renderBlocks(n.children, key)}</View>
            </View>,
          );
          break;
        }
        case 'blockquote':
          out.push(
            <View key={key} style={{ borderStartWidth: 3, borderStartColor: t.colors.border, paddingStart: t.spacing.md, gap: 4 }}>
              {renderBlocks(n.children, key)}
            </View>,
          );
          break;
        case 'hr':
          out.push(<View key={key} style={{ height: 1, backgroundColor: t.colors.border, marginVertical: t.spacing.sm }} />);
          break;
        case 'img':
          if (n.attrs.src?.startsWith('data:image') || n.attrs.src?.startsWith('http'))
            out.push(<Image key={key} source={{ uri: n.attrs.src }} style={{ width: 180, height: 70 }} resizeMode="contain" accessibilityLabel={n.attrs.alt} />);
          break;
        default:
          out.push(<Fragment key={key}>{hasBlock(n.children) ? renderBlocks(n.children, key) : paragraph(n.children, key)}</Fragment>);
      }
    });
    flush(list.length);
    return out;
  };

  return <View style={{ gap: t.spacing.sm }}>{renderBlocks(nodes, 'h')}</View>;
}
