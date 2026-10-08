import { DIAGNOSTICS } from "../shared/strings.js";

/** How many entries the log keeps by default. */
export const DEFAULT_LOG_LIMIT = 200;

/** One line of the diagnostic log. */
export interface LogEntry {
  /** The Editor's local clock to the second, `HH:MM:SS`. */
  time: string;
  /** A short tag: `config`, `open`, `values`, `save`, `why`. */
  channel: string;
  text: string;
  /** Optional, multi-line; rendered indented beneath the entry. */
  detail?: string;
}

/** The diagnostic log: what each step of the Editor's work actually did, kept in the panel itself. */
export interface Log {
  add(channel: string, text: string, detail?: string): void;
  clear(): void;
  /** The entries in arrival order. */
  entries(): readonly LogEntry[];
  /** The whole log as preformatted text, or the invitation sentence while it is empty. */
  text(): string;
  /** Notified after every addition and after a clear. Returns how to unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** What {@link createLog} is built from. */
export interface LogOptions {
  /** The size of the ring. The panel outlives many saves, so an unbounded log is a leak. */
  limit?: number;
  /** The clock. Local time is used on purpose: the log exists to line a failure up with what the Editor just did. */
  now?: () => Date;
}

const two = (value: number) => String(value).padStart(2, "0");

/** Formats one entry: time, two spaces, channel, two spaces, text; each detail line indented four spaces. */
export function formatEntry(entry: LogEntry): string {
  const head = `${entry.time}  ${entry.channel}  ${entry.text}`;
  if (entry.detail === undefined) return head;
  return [head, ...entry.detail.split("\n").map((line) => `    ${line}`)].join("\n");
}

/** Creates a log: a bounded ring whose oldest entries are dropped first. */
export function createLog(options: LogOptions = {}): Log {
  const limit = options.limit ?? DEFAULT_LOG_LIMIT;
  const now = options.now ?? (() => new Date());
  const ring: LogEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    add(channel, text, detail) {
      const date = now();
      const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
      ring.push({ time, channel, text, ...(detail === undefined ? {} : { detail }) });
      while (ring.length > limit) ring.shift();
      notify();
    },
    clear() {
      ring.length = 0;
      notify();
    },
    entries: () => ring,
    text: () => (ring.length === 0 ? DIAGNOSTICS.empty : ring.map(formatEntry).join("\n")),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
