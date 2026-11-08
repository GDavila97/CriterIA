export interface SseMessage {
  id: string | undefined;
  event: string;
  data: string;
}

export interface SseParser {
  /** Feeds a decoded chunk; a message may be split across any number of chunks. */
  feed(chunk: string): void;
}

/**
 * Incremental parser for the text/event-stream format, used because EventSource cannot send
 * an Authorization header. Comment lines (": ping") are reported separately as heartbeats.
 */
export function createSseParser(
  onMessage: (message: SseMessage) => void,
  onComment: (text: string) => void = () => {},
): SseParser {
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let id: string | undefined;

  const dispatch = () => {
    if (data.length > 0) {
      onMessage({ id, event: event || 'message', data: data.join('\n') });
    }
    data = [];
    event = '';
    id = undefined;
  };

  const line = (text: string) => {
    if (text === '') {
      dispatch();
      return;
    }
    if (text.startsWith(':')) {
      onComment(text.slice(1).trim());
      return;
    }
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
  };

  return {
    feed(chunk) {
      buffer += chunk;
      let match = /\r\n|\r|\n/.exec(buffer);
      // A lone "\r" at the end may be the first half of "\r\n" still in flight.
      while (match && !(match[0] === '\r' && match.index === buffer.length - 1)) {
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r\n|\r|\n/.exec(buffer);
      }
    },
  };
}
