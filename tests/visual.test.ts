import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { approveBaseline, comparePngs, inspectPng } from "@ciq-forge/core";

function image(color: [number, number, number, number]): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = color[3];
  }
  return PNG.sync.write(png);
}

describe("visual regression", () => {
  it("creates explicit baselines and highlighted diffs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-visual-"));
    const actual = path.join(root, "actual.png");
    const baseline = path.join(root, "baselines", "baseline.png");
    const diff = path.join(root, "diff.png");
    await writeFile(actual, image([0, 0, 0, 255]));
    await approveBaseline(actual, baseline);
    await writeFile(actual, image([255, 255, 255, 255]));
    const result = await comparePngs({
      actualPath: actual,
      baselinePath: baseline,
      diffPath: diff,
      pixelThreshold: 16,
      differenceThreshold: 0
    });
    expect(result.status).toBe("failed");
    expect(result.differencePercent).toBe(1);
    expect((await readFile(diff)).length).toBeGreaterThan(0);
  });

  it("detects visually empty captures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-empty-"));
    const file = path.join(root, "empty.png");
    await writeFile(file, image([0, 0, 0, 255]));
    expect((await inspectPng(file)).empty).toBe(true);
  });
});
