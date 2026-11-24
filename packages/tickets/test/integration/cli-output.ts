import type {
  JsonValue,
  Effects,
  Issue,
  ChangeResult,
} from "../../src/types.ts";

// Tests assert command-specific results after decoding the output.
export interface TicketView {
  id: string;
  file: string;
  status: string;
  delivery_complete: boolean;
  blocked_by: string[];
  blocked_by_unfinished: string[];
}

export interface HistoryEvent {
  ticket: string;
  field: string;
  time: string;
  before: JsonValue;
  after: JsonValue;
}

export interface Success {
  ok: true;
  command: string;
  scope: Record<string, string | null>;
  tickets: TicketView[];
  events: HistoryEvent[];
  total: number;
  changed: boolean;
  valid: boolean;
  issues: Issue[];
  ticket: string;
  field: string;
  before: JsonValue;
  after: JsonValue;
  history: string;
  created: boolean;
  results: ChangeResult[];
}

export interface ErrorOutput {
  kind?: string;
  ok: false;
  error: {
    code: string;
    file: string;
    message: string;
    line: number;
    issues: (Omit<Partial<Issue>, "path"> & {
      path?: string | string[];
      keyword?: string;
    })[];
  };
  effects: Effects;
}

export function success(text: string): Success {
  const wire = JSON.parse(text);
  return { ...wire.data, command: wire.command } as Success;
}

export function failure(text: string): ErrorOutput {
  const wire = JSON.parse(text);
  return (wire.data ?? wire) as ErrorOutput;
}
