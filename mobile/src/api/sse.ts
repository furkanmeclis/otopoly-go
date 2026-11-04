/**
 * Server-sent events (text/event-stream) reader shared by the live transport and the mock.
 * Same framing rules as the web client (`frontend/src/features/ai/services/ai-stream.ts`): frames are
 * separated by a blank line, `event:` names the event, `data:` lines are joined and parsed as JSON,
 * comment lines (`: ping`) are ignored. No React Native imports, so the smoke/contract tests use it too.
 */

export type SseEvent = { event: string; data: unknown };

const FRAME_SEPARATOR = /\r?\n\r?\n/;

/** Parses one SSE frame; comments and frames without data return null. */
export function parseSseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/** Serializes one event the way the Go handler does (`event: x\ndata: {json}\n\n`). */
export function formatSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Incremental parser: feed decoded text chunks, get complete events. */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  return {
    push(text: string) {
      buffer += text;
      for (let match = FRAME_SEPARATOR.exec(buffer); match; match = FRAME_SEPARATOR.exec(buffer)) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const parsed = parseSseFrame(frame);
        if (parsed) onEvent(parsed);
      }
    },
    end() {
      const tail = parseSseFrame(buffer);
      buffer = '';
      if (tail) onEvent(tail);
    },
  };
}

/**
 * Reads a byte stream to the end and dispatches its events. UTF-8 is decoded in streaming mode, so a
 * multi-byte character split across chunks (Turkish ı, ş, ğ…) is kept intact.
 */
export async function readSse(body: AsyncIterable<Uint8Array>, onEvent: (event: SseEvent) => void) {
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  for await (const chunk of body) parser.push(decoder.decode(chunk, { stream: true }));
  parser.push(decoder.decode());
  parser.end();
}

type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(reason?: unknown): Promise<void>; releaseLock?(): void };

/** Adapts a WHATWG `ReadableStream` (expo/fetch, browsers, Node) to an async iterable. */
export async function* iterateStream(stream: { getReader(): Reader }): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      if (value) yield value;
    }
  } finally {
    // Consumer stopped early (abort, error): release the connection.
    if (!finished) await reader.cancel?.().catch(() => undefined);
  }
}
