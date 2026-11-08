import { createSseParser, type SseMessage } from './parser';

function parse(chunks: string[]) {
  const messages: SseMessage[] = [];
  const comments: string[] = [];
  const parser = createSseParser(
    (message) => messages.push(message),
    (comment) => comments.push(comment),
  );
  chunks.forEach((chunk) => parser.feed(chunk));
  return { messages, comments };
}

describe('createSseParser', () => {
  it('reads id, event and data from a whole frame', () => {
    const { messages } = parse(['id: 7\nevent: agente_inicia\ndata: {"seq":7}\n\n']);

    expect(messages).toEqual([{ id: '7', event: 'agente_inicia', data: '{"seq":7}' }]);
  });

  it('joins frames split anywhere across chunks, including inside CRLF', () => {
    const frame = 'id: 12\r\nevent: corrida_fin\r\ndata: {"a":1}\r\n\r\n';
    const chunks = frame.split('').reduce<string[]>((acc, char, i) => {
      if (i % 3 === 0) acc.push(char);
      else acc[acc.length - 1] += char;
      return acc;
    }, []);

    const { messages } = parse(chunks);

    expect(messages).toEqual([{ id: '12', event: 'corrida_fin', data: '{"a":1}' }]);
  });

  it('reports heartbeats as comments and never as messages', () => {
    const { messages, comments } = parse([': ping\n\n', 'data: x\n\n', ':ping\n']);

    expect(comments).toEqual(['ping', 'ping']);
    expect(messages).toHaveLength(1);
  });

  it('joins multi-line data, defaults the event and ignores unknown fields', () => {
    const { messages } = parse(['retry: 10\ndata: one\ndata:two\nfoo: bar\n\n']);

    expect(messages).toEqual([{ id: undefined, event: 'message', data: 'one\ntwo' }]);
  });

  it('keeps a frame without a final blank line pending', () => {
    const { messages } = parse(['id: 3\ndata: {}\n']);

    expect(messages).toEqual([]);
  });

  it('ignores ids with null characters and frames without data', () => {
    const { messages } = parse(['id: 1\0\nevent: x\n\n', 'id: 2\0\ndata: y\n\n']);

    expect(messages).toEqual([{ id: undefined, event: 'message', data: 'y' }]);
  });

  it('accepts lone carriage returns, holding a final one until the next chunk', () => {
    const { messages } = parse(['data: a\r\rdata: b\r', '\r']);
    const more = parse(['data: a\r\rdata: b\r', '\r', 'data: c']);

    expect(messages.map((m) => m.data)).toEqual(['a']);
    expect(more.messages.map((m) => m.data)).toEqual(['a', 'b']);
  });
});
