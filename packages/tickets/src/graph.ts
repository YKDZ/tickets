import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { ParsedNode, Scalar } from "yaml";

import type {
  Completion,
  Field,
  Issue,
  IssueDetails,
  JsonValue,
  Ticket,
  TicketSource,
  ValueRange,
} from "./types.ts";

export function inspect(sources: TicketSource[], completion: Completion) {
  const issues: Issue[] = [];
  const tickets = sources.map((source): Ticket => {
    const empty: Ticket = {
      ...source,
      status: null,
      delivery_complete: false,
      blocked_by: null,
      nodes: Object.create(null),
      values: Object.create(null),
    };
    const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source.text);
    if (!opening) {
      issues.push(
        issue(
          source,
          "MISSING_FRONTMATTER",
          "The ticket must start with YAML front matter.",
        ),
      );
      return empty;
    }
    const offset = opening[0].length;
    const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(source.text.slice(offset));
    if (!closing) {
      issues.push(
        issue(
          source,
          "UNCLOSED_FRONTMATTER",
          "The YAML front matter is missing its closing delimiter.",
        ),
      );
      return empty;
    }
    const document = parseDocument(
      source.text.slice(offset, offset + closing.index),
      { keepSourceTokens: true, prettyErrors: false },
    );
    const duplicates = new Set();
    for (const error of document.errors) {
      const field = fieldAt(document.contents, error.pos[0]);
      if (error.code === "DUPLICATE_KEY") {
        duplicates.add(field);
        issues.push(
          issue(source, "DUPLICATE_FIELD", `Duplicate YAML field ${field}.`, {
            ...(field === undefined ? {} : { field }),
            offset: offset + error.pos[0],
          }),
        );
      } else {
        issues.push(
          issue(
            source,
            "INVALID_YAML",
            `Invalid YAML front matter: ${error.code}.`,
            {
              ...(field === undefined ? {} : { field }),
              offset: offset + error.pos[0],
              reason: error.code,
            },
          ),
        );
      }
    }
    if (document.errors.some((error) => error.code !== "DUPLICATE_KEY")) {
      return empty;
    }
    if (!isMap(document.contents)) {
      issues.push(
        issue(
          source,
          "INVALID_FRONTMATTER",
          "YAML front matter must be a mapping.",
        ),
      );
      return empty;
    }
    let status: string | null = null;
    let blocked_by: string[] | null = null;
    const nodes: Ticket["nodes"] = Object.create(null);
    const values: Ticket["values"] = Object.create(null);
    for (const field of ["status", "blocked_by"] as const) {
      if (duplicates.has(field)) continue;
      const node = document.get(field, true) as ParsedNode | undefined;
      if (!node) {
        issues.push(
          issue(source, "MISSING_FIELD", `Missing required field ${field}.`, {
            field,
          }),
        );
        continue;
      }
      if (hasIndirectValue(node)) {
        issues.push(
          issue(
            source,
            "UNSAFE_FIELD",
            `Field ${field} uses an anchor, alias, or tag that prevents a safe isolated edit.`,
            { field },
          ),
        );
        continue;
      }
      if (!canRecordValue(node)) {
        issues.push(
          issue(
            source,
            "UNSAFE_FIELD",
            `The previous value of ${field} cannot be preserved in JSON history.`,
            { field },
          ),
        );
        continue;
      }
      const value = (node.toJSON() ?? null) as JsonValue;
      values[field] = value;
      const range: ValueRange = {
        start: offset + node.range[0],
        end: offset + node.range[1],
      };
      nodes[field] = range;
      if (
        node.range[0] === node.range[1] &&
        source.text[offset + node.range[0] - 1] === ":"
      )
        range.prefix = " ";
      if (node.srcToken?.type === "block-scalar") {
        range.suffix = node.srcToken.props
          .slice(1)
          .filter((token) => token.type !== "newline")
          .map((token) => ("source" in token ? token.source : ""))
          .join("");
      }
      if (node.srcToken?.type === "block-seq") {
        range.end = offset + blockValueEnd(node)!;
        range.prefix = node.srcToken.indent === 0 ? "  " : "";
      }
      if (node.srcToken?.type === "block-map")
        range.end = offset + blockValueEnd(node)!;
      if (
        node.srcToken &&
        ["block-scalar", "block-seq", "block-map"].includes(node.srcToken.type)
      ) {
        const trailing = /(?:\r?\n)+$/.exec(
          source.text.slice(range.start, range.end),
        );
        if (trailing) range.end -= trailing[0].length;
      }
      if (field === "status") {
        if (
          isScalar(node) &&
          typeof node.value === "string" &&
          node.value.trim()
        )
          status = node.value;
        else
          issues.push(
            issue(
              source,
              "INVALID_FIELD",
              `Field ${field} must be a nonblank string.`,
              {
                field,
              },
            ),
          );
      } else if (
        isSeq(node) &&
        node.items.every(
          (item) =>
            isScalar(item) &&
            typeof item.value === "string" &&
            /^\d+$/.test(item.value),
        )
      ) {
        blocked_by = node.items.map((item) => (item as Scalar<string>).value);
      } else {
        issues.push(
          issue(
            source,
            "INVALID_FIELD",
            `Field ${field} must be an array of ticket ID strings.`,
            { field },
          ),
        );
      }
    }
    return {
      ...source,
      status,
      delivery_complete: status !== null && completion.values.includes(status),
      blocked_by,
      nodes,
      values,
    };
  });
  const byId = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (!byId.has(ticket.id)) byId.set(ticket.id, []);
    byId.get(ticket.id)!.push(ticket);
  }
  for (const matches of byId.values()) {
    if (matches.length > 1) {
      for (const ticket of matches)
        issues.push(
          issue(
            ticket,
            "DUPLICATE_ID",
            `Ticket ID ${ticket.id} appears in multiple files.`,
          ),
        );
    }
  }
  for (const ticket of tickets) {
    if (ticket.blocked_by === null) continue;
    for (const target of new Set(ticket.blocked_by)) {
      if (target === ticket.id) {
        issues.push(
          issue(
            ticket,
            "SELF_DEPENDENCY",
            `Ticket ${ticket.id} depends on itself.`,
            {
              field: "blocked_by",
              target,
            },
          ),
        );
      } else if (!byId.has(target)) {
        issues.push(
          issue(
            ticket,
            "MISSING_REFERENCE",
            `Ticket ${ticket.id} refers to missing prerequisite ${target}.`,
            { field: "blocked_by", target },
          ),
        );
      }
    }
  }
  const adjacency = new Map<string, string[]>();
  for (const ticket of tickets) {
    if (byId.get(ticket.id)!.length !== 1 || ticket.blocked_by === null)
      continue;
    adjacency.set(
      ticket.id,
      [...new Set(ticket.blocked_by)].filter(
        (target) => byId.get(target)?.length === 1,
      ),
    );
  }
  const cyclicEdges = new Set<string>();
  for (const component of strongComponents(adjacency)) {
    const members = new Set(component);
    for (const source of component) {
      for (const target of adjacency.get(source) ?? []) {
        if (members.has(target))
          cyclicEdges.add(JSON.stringify([source, target]));
      }
    }
    if (component.length < 2) continue;
    const path = cyclePath(component, adjacency);
    const source = byId.get(path[0]!)![0]!;
    const problem = issue(
      source,
      "CYCLE",
      `Dependency cycle: ${path.join(" → ")}.`,
      { field: "blocked_by", path },
    );
    problem.key = JSON.stringify(["CYCLE", component]);
    issues.push(problem);
  }
  return { tickets, issues, cyclicEdges };
}

function blockValueEnd(
  node: ParsedNode | null | undefined,
): number | undefined {
  if (isSeq(node) && node.srcToken?.type === "block-seq")
    return blockValueEnd(node.items.at(-1)) ?? node.range?.[1];
  if (isMap(node) && node.srcToken?.type === "block-map") {
    const pair = node.items.at(-1);
    if (pair?.value) return blockValueEnd(pair.value) ?? node.range?.[1];
  }
  return node?.range?.[1];
}

function canRecordValue(node: ParsedNode | null): boolean {
  if (node === null) return true;
  if (isSeq(node)) return node.items.every(canRecordValue);
  if (isMap(node))
    return node.items.every(
      (pair) =>
        isScalar(pair.key) &&
        typeof pair.key.value === "string" &&
        canRecordValue(pair.value),
    );
  if (!isScalar(node)) return false;
  const value = node.value ?? null;
  if (typeof value === "number")
    return (
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    );
  return (
    value === null || typeof value === "string" || typeof value === "boolean"
  );
}

function hasIndirectValue(node: ParsedNode | null): boolean {
  if (!node) return false;
  if (isAlias(node) || node.anchor || node.tag) return true;
  if (isSeq(node)) return node.items.some(hasIndirectValue);
  if (isMap(node))
    return node.items.some(
      (pair) => hasIndirectValue(pair.key) || hasIndirectValue(pair.value),
    );
  return false;
}

function strongComponents(adjacency: Map<string, string[]>) {
  const indices = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  function visit(source: string) {
    indices.set(source, nextIndex);
    lows.set(source, nextIndex++);
    stack.push(source);
    active.add(source);
    for (const target of adjacency.get(source) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lows.set(source, Math.min(lows.get(source)!, lows.get(target)!));
      } else if (active.has(target)) {
        lows.set(source, Math.min(lows.get(source)!, indices.get(target)!));
      }
    }
    if (lows.get(source) !== indices.get(source)) return;
    const component = [];
    let member;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== source);
    components.push(component.sort());
  }
  for (const source of adjacency.keys())
    if (!indices.has(source)) visit(source);
  return components;
}

function cyclePath(
  component: string[],
  adjacency: Map<string, string[]>,
): string[] {
  const start = component[0]!;
  const members = new Set(component);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]!;
    for (const target of adjacency.get(source) ?? []) {
      if (!members.has(target) || target === source) continue;
      if (target === start) {
        const path = [source];
        let current = source;
        while (previous.get(current) !== null) {
          current = previous.get(current)!;
          path.push(current);
        }
        return [...path.reverse(), start];
      }
      if (!previous.has(target)) {
        previous.set(target, source);
        queue.push(target);
      }
    }
  }
  throw new Error(
    "Could not find a dependency cycle in the strongly connected component.",
  );
}

function fieldAt(
  node: ParsedNode | null,
  offset: number,
  path: (string | number)[] = [],
): string | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const nextPath = [
        ...path,
        String(
          isScalar<string | number | boolean | null>(pair.key)
            ? (pair.key.value ?? "?")
            : "?",
        ),
      ];
      if (
        pair.key?.range &&
        offset >= pair.key.range[0] &&
        offset < pair.key.range[1]
      )
        return nextPath.join(".");
      if (
        pair.value?.range &&
        offset >= pair.value.range[0] &&
        offset < pair.value.range[2]
      )
        return fieldAt(pair.value, offset, nextPath) ?? nextPath.join(".");
    }
  } else if (isSeq(node)) {
    for (const [index, item] of node.items.entries()) {
      if (item?.range && offset >= item.range[0] && offset < item.range[2])
        return fieldAt(item, offset, [...path, index]);
    }
  }
  return path.length ? path.join(".") : undefined;
}

function issue(
  source: TicketSource,
  code: string,
  message: string,
  details: IssueDetails = {},
): Issue {
  return {
    code,
    message,
    ticket: source.id,
    file: source.file,
    ...details,
    key: JSON.stringify([
      code,
      source.file,
      source.id,
      details.field ?? null,
      details.target ?? null,
      details.reason ?? null,
    ]),
  };
}

export function replaceValue(ticket: Ticket, field: Field, value: JsonValue) {
  const node = ticket.nodes[field];
  if (
    !node ||
    !Number.isInteger(node.start) ||
    !Number.isInteger(node.end) ||
    node.start < 0 ||
    node.end < node.start ||
    node.end > ticket.text.length
  ) {
    throw Object.assign(new Error(`Could not safely update field ${field}.`), {
      code: "UNEDITABLE_FIELD",
      ticket: ticket.id,
      file: ticket.file,
      field,
    });
  }
  return (
    ticket.text.slice(0, node.start) +
    (node.prefix ?? "") +
    JSON.stringify(value) +
    (node.suffix ?? "") +
    ticket.text.slice(node.end)
  );
}
