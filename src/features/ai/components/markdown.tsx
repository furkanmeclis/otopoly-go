import { Fragment } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { useTheme } from '@/theme/provider';

/** Inline `**bold**`, `*italic*` / `_italic_` and `` `code` ``. */
function Inline({ text }: { text: string }) {
  const t = useTheme();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4)
          return (
            <Txt key={i} style={{ fontWeight: t.fontWeight.bold }}>
              {p.slice(2, -2)}
            </Txt>
          );
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return (
            <Txt key={i} style={{ fontFamily: 'Menlo', backgroundColor: t.colors.surfaceSunken }}>
              {p.slice(1, -1)}
            </Txt>
          );
        if (((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_'))) && p.length > 2)
          return (
            <Txt key={i} style={{ fontStyle: 'italic' }}>
              {p.slice(1, -1)}
            </Txt>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/**
 * Minimal Markdown for assistant answers (the web uses a fuller renderer): paragraphs, `#` headings,
 * `-`/`•`/`1.` lists and inline emphasis. Unknown syntax renders as plain text.
 */
export function Markdown({ text }: { text: string }) {
  const t = useTheme();
  const blocks = text.split(/\n{2,}/);
  return (
    <View style={{ gap: t.spacing.sm }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const heading = /^#{1,4}\s+/.exec(lines[0]);
        if (heading && lines.length === 1)
          return (
            <Txt key={bi} variant="bodyStrong" selectable>
              <Inline text={lines[0].slice(heading[0].length)} />
            </Txt>
          );
        const isList = lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l));
        if (isList)
          return (
            <View key={bi} style={{ gap: t.spacing.xs }}>
              {lines.map((l, li) => {
                const m = /^\s*([-•*]|\d+\.)\s+/.exec(l)!;
                const marker = /\d/.test(m[1]) ? m[1] : '•';
                return (
                  <View key={li} style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                    <Txt tone="secondary" style={{ minWidth: 14 }}>
                      {marker}
                    </Txt>
                    <Txt style={{ flex: 1 }} selectable>
                      <Inline text={l.slice(m[0].length)} />
                    </Txt>
                  </View>
                );
              })}
            </View>
          );
        return (
          <Txt key={bi} selectable style={{ lineHeight: 22 }}>
            <Inline text={block} />
          </Txt>
        );
      })}
    </View>
  );
}
