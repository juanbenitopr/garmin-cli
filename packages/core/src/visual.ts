import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

export interface VisualDiffResult {
  status: "passed" | "failed";
  differencePercent: number;
  differentPixels: number;
  totalPixels: number;
  diffPath?: string;
  message?: string;
}

export async function comparePngs(input: {
  actualPath: string;
  baselinePath: string;
  diffPath: string;
  pixelThreshold: number;
  differenceThreshold: number;
}): Promise<VisualDiffResult> {
  const [actual, baseline] = await Promise.all([
    readFile(input.actualPath).then((data) => PNG.sync.read(data)),
    readFile(input.baselinePath).then((data) => PNG.sync.read(data))
  ]);
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return {
      status: "failed",
      differencePercent: 1,
      differentPixels: actual.width * actual.height,
      totalPixels: actual.width * actual.height,
      message: `Image size differs: ${actual.width}x${actual.height} vs ${baseline.width}x${baseline.height}`
    };
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  let differentPixels = 0;
  for (let index = 0; index < actual.data.length; index += 4) {
    const delta = Math.max(
      Math.abs((actual.data[index] ?? 0) - (baseline.data[index] ?? 0)),
      Math.abs((actual.data[index + 1] ?? 0) - (baseline.data[index + 1] ?? 0)),
      Math.abs((actual.data[index + 2] ?? 0) - (baseline.data[index + 2] ?? 0)),
      Math.abs((actual.data[index + 3] ?? 0) - (baseline.data[index + 3] ?? 0))
    );
    const changed = delta > input.pixelThreshold;
    if (changed) differentPixels += 1;
    diff.data[index] = changed ? 255 : Math.floor((actual.data[index] ?? 0) * 0.25);
    diff.data[index + 1] = changed ? 0 : Math.floor((actual.data[index + 1] ?? 0) * 0.25);
    diff.data[index + 2] = changed ? 64 : Math.floor((actual.data[index + 2] ?? 0) * 0.25);
    diff.data[index + 3] = 255;
  }
  const totalPixels = actual.width * actual.height;
  const differencePercent = totalPixels ? differentPixels / totalPixels : 1;
  await mkdir(path.dirname(input.diffPath), { recursive: true });
  await writeFile(input.diffPath, PNG.sync.write(diff));
  return {
    status: differencePercent <= input.differenceThreshold ? "passed" : "failed",
    differencePercent,
    differentPixels,
    totalPixels,
    diffPath: input.diffPath
  };
}

export async function approveBaseline(actualPath: string, baselinePath: string): Promise<void> {
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await copyFile(actualPath, baselinePath);
}

export async function inspectPng(imagePath: string): Promise<{ empty: boolean; width: number; height: number }> {
  const png = PNG.sync.read(await readFile(imagePath));
  if (png.width === 0 || png.height === 0) return { empty: true, width: png.width, height: png.height };
  let min = 255;
  let max = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const luminance = Math.round(
      (png.data[index] ?? 0) * 0.2126 +
      (png.data[index + 1] ?? 0) * 0.7152 +
      (png.data[index + 2] ?? 0) * 0.0722
    );
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  return { empty: max - min < 3, width: png.width, height: png.height };
}

export async function normalizeScreenshot(input: {
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
  shape: "round" | "rectangle";
  crop?: { x: number; y: number; width: number; height: number };
}): Promise<void> {
  const source = PNG.sync.read(await readFile(input.sourcePath));
  const size = Math.min(source.width, source.height);
  let crop = input.crop ?? {
    x: Math.floor((source.width - size) / 2),
    y: Math.floor((source.height - size) / 2),
    width: size,
    height: size
  };

  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    const scaleX = source.width / Math.max(1, crop.x + crop.width);
    const scaleY = source.height / Math.max(1, crop.y + crop.height);
    const scale = Math.min(scaleX, scaleY, 1);
    crop = {
      x: Math.max(0, Math.min(source.width - 1, Math.floor(crop.x * scale))),
      y: Math.max(0, Math.min(source.height - 1, Math.floor(crop.y * scale))),
      width: Math.max(1, Math.min(source.width, Math.floor(crop.width * scale))),
      height: Math.max(1, Math.min(source.height, Math.floor(crop.height * scale)))
    };
  }
  const output = new PNG({ width: input.width, height: input.height });
  const centerX = (input.width - 1) / 2;
  const centerY = (input.height - 1) / 2;
  const radius = Math.min(input.width, input.height) / 2;
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const target = (y * input.width + x) * 4;
      const outsideRound = input.shape === "round" && Math.hypot(x - centerX, y - centerY) > radius;
      if (outsideRound) {
        output.data[target] = 0;
        output.data[target + 1] = 0;
        output.data[target + 2] = 0;
        output.data[target + 3] = 255;
        continue;
      }
      const sourceX = crop.x + Math.min(crop.width - 1, Math.floor((x / input.width) * crop.width));
      const sourceY = crop.y + Math.min(crop.height - 1, Math.floor((y / input.height) * crop.height));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      output.data[target] = source.data[sourceIndex] ?? 0;
      output.data[target + 1] = source.data[sourceIndex + 1] ?? 0;
      output.data[target + 2] = source.data[sourceIndex + 2] ?? 0;
      output.data[target + 3] = source.data[sourceIndex + 3] ?? 255;
    }
  }
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, PNG.sync.write(output));
}
