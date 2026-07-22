import { describe, expect, it } from "vitest";
import { assertLayoutBounds, assertLifecycle, parseForgeEvents } from "@ciq-forge/core";

describe("instrumentation events", () => {
  it("parses only versioned Forge events from mixed simulator output", () => {
    const output = [
      "Garmin simulator ready",
      "CIQ_FORGE_EVENT|1|venu3__normal|app.initialize|ok",
      "CIQ_FORGE_EVENT|1|venu3__normal|view.update|09:42",
      "random line"
    ].join("\n");
    const events = parseForgeEvents(output);
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toBe("09:42");
  });

  it("reports missing lifecycle events and explicit assertions", () => {
    const events = parseForgeEvents([
      "CIQ_FORGE_EVENT|1|run|app.initialize|ok",
      "CIQ_FORGE_EVENT|1|run|assert|bounds;failed;outside display"
    ].join("\n"));
    const assertions = assertLifecycle(events);
    expect(assertions.find((item) => item.name === "app.initialize")?.status).toBe("passed");
    expect(assertions.find((item) => item.name === "view.update")?.status).toBe("failed");
    expect(assertions.find((item) => item.name === "bounds")?.status).toBe("failed");
  });

  it("detects clipping, edge proximity and overlap from renderer bounds", () => {
    const events = parseForgeEvents([
      "CIQ_FORGE_EVENT|1|run|layout.element|id=time;kind=text;x=-1;y=40;width=50;height=20",
      "CIQ_FORGE_EVENT|1|run|layout.element|id=steps;kind=text;x=20;y=45;width=50;height=20"
    ].join("\n"));
    const assertions = assertLayoutBounds({ events, width: 100, height: 100, shape: "rectangle" });
    expect(assertions.find((item) => item.name === "layout.bounds.time")?.status).toBe("failed");
    expect(assertions.find((item) => item.name === "layout.overlap.time.steps")?.status).toBe("failed");
  });
});
