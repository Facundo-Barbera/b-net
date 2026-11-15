/** Minimal incremental SSE parser (WHATWG event-stream rules, enough for metering). */
export interface SseEvent {
  event: string | null;
  data: string;
}

export class SseParser {
  private buf = "";
  private event: string | null = null;
  private data: string[] = [];
  private readonly onEvent: (e: SseEvent) => void;

  constructor(onEvent: (e: SseEvent) => void) {
    this.onEvent = onEvent;
  }

  push(text: string) {
    this.buf += text;
    let idx: number;
    // process complete lines (\n, \r\n or \r)
    while ((idx = this.buf.search(/\r\n|\n|\r/)) !== -1) {
      // a lone trailing \r could be the first half of \r\n: wait for more input
      if (this.buf[idx] === "\r" && idx === this.buf.length - 1) break;
      const line = this.buf.slice(0, idx);
      const nl = this.buf[idx] === "\r" && this.buf[idx + 1] === "\n" ? 2 : 1;
      this.buf = this.buf.slice(idx + nl);
      this.line(line);
    }
  }

  end() {
    if (this.buf.length > 0) {
      this.line(this.buf);
      this.buf = "";
    }
    this.dispatch();
  }

  private line(line: string) {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }

  private dispatch() {
    if (this.data.length > 0) this.onEvent({ event: this.event, data: this.data.join("\n") });
    this.event = null;
    this.data = [];
  }
}
