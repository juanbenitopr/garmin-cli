import type { AssertionResult, ForgeEvent } from "./types.js";

const EVENT_PREFIX = "CIQ_FORGE_EVENT|";

export function parseForgeEvents(output: string): ForgeEvent[] {
  const events: ForgeEvent[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const start = raw.indexOf(EVENT_PREFIX);
    if (start < 0) continue;
    const eventLine = raw.slice(start);
    const parts = eventLine.split("|");
    if (parts.length < 5) continue;
    const version = Number(parts[1]);
    if (!Number.isInteger(version)) continue;
    events.push({
      version,
      runId: parts[2] ?? "",
      name: parts[3] ?? "",
      payload: parts.slice(4).join("|"),
      raw: eventLine
    });
  }
  return events;
}

export function assertLifecycle(
  events: ForgeEvent[],
  required = ["app.initialize", "app.start", "view.created", "view.update", "render.complete"]
): AssertionResult[] {
  const seen = new Set(events.map((event) => event.name));
  const results = required.map((name): AssertionResult => seen.has(name)
    ? { name, status: "passed" }
    : { name, status: "failed", message: `Missing event: ${name}` });
  for (const event of events.filter((item) => item.name === "assert")) {
    const [name = "runtime", status = "failed", ...message] = event.payload.split(";");
    results.push({
      name,
      status: status === "passed" ? "passed" : "failed",
      ...(message.length ? { message: message.join(";") } : {})
    });
  }
  return results;
}

interface LayoutBox {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  allowOverlap: boolean;
}

function parseLayoutBox(event: ForgeEvent): LayoutBox | undefined {
  const values = Object.fromEntries(event.payload.split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
  const box = {
    id: values.id ?? "unknown",
    kind: values.kind ?? "element",
    x: Number(values.x),
    y: Number(values.y),
    width: Number(values.width),
    height: Number(values.height),
    allowOverlap: values.allowOverlap === "true"
  };
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) ? box : undefined;
}

export function assertLayoutBounds(input: {
  events: ForgeEvent[];
  width: number;
  height: number;
  shape: "round" | "rectangle";
  edgeMargin?: number;
}): AssertionResult[] {
  const boxes = input.events
    .filter((event) => event.name === "layout.element")
    .map(parseLayoutBox)
    .filter((box): box is LayoutBox => box !== undefined);
  const results: AssertionResult[] = [];
  const edgeMargin = input.edgeMargin ?? 2;
  const centerX = input.width / 2;
  const centerY = input.height / 2;
  const radius = Math.min(input.width, input.height) / 2;

  for (const box of boxes) {
    const outside = box.x < 0 || box.y < 0 || box.x + box.width > input.width || box.y + box.height > input.height;
    results.push(outside
      ? { name: `layout.bounds.${box.id}`, status: "failed", message: "Element exceeds the display bounds." }
      : { name: `layout.bounds.${box.id}`, status: "passed" });
    if (box.kind === "text") {
      const close = box.x < edgeMargin || box.y < edgeMargin || input.width - box.x - box.width < edgeMargin || input.height - box.y - box.height < edgeMargin;
      results.push(close
        ? { name: `layout.edge.${box.id}`, status: "failed", message: `Text is within ${edgeMargin}px of an edge.` }
        : { name: `layout.edge.${box.id}`, status: "passed" });
    }
    if (input.shape === "round") {
      const corners = [
        [box.x, box.y], [box.x + box.width, box.y],
        [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]
      ];
      const outsideCircle = corners.some(([x = 0, y = 0]) => Math.hypot(x - centerX, y - centerY) > radius);
      results.push(outsideCircle
        ? { name: `layout.circle.${box.id}`, status: "failed", message: "Element extends outside the circular safe area." }
        : { name: `layout.circle.${box.id}`, status: "passed" });
    }
  }

  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left] as LayoutBox;
      const b = boxes[right] as LayoutBox;
      if (a.allowOverlap || b.allowOverlap) continue;
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlaps) results.push({
        name: `layout.overlap.${a.id}.${b.id}`,
        status: "failed",
        message: `${a.id} overlaps ${b.id}.`
      });
    }
  }
  return results;
}
