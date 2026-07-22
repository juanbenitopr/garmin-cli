import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "./types.js";

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(value: string): string {
  return xml(value);
}

export async function writeRunReports(results: RunResult[], outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "results.json"), JSON.stringify(results, null, 2), "utf8");
  const failures = results.filter((result) => result.status === "failed").length;
  const junit = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="CIQ Forge" tests="${results.length}" failures="${failures}">\n` +
    results.map((result) => {
      const failure = result.status === "failed"
        ? `<failure message="CIQ Forge job failed">${xml(JSON.stringify(result.stages))}</failure>`
        : "";
      return `  <testcase classname="${xml(result.device)}" name="${xml(result.scenario)}">${failure}</testcase>`;
    }).join("\n") + `\n</testsuite>\n`;
  await writeFile(path.join(outputDirectory, "junit.xml"), junit, "utf8");

  const rows = results.map((result) => {
    const relative = (value: string | undefined) => value ? path.relative(outputDirectory, value).replace(/\\/g, "/") : "";
    const image = (label: string, value: string | undefined) => value
      ? `<figure><figcaption>${label}</figcaption><img src="${html(relative(value))}" alt="${label}" /></figure>`
      : "";
    return `<article class="${result.status}"><h2>${html(result.id)} - ${result.status}</h2>` +
      `<h3>Profile</h3><pre>${html(JSON.stringify(result.metrics, null, 2))}</pre>` +
      `<h3>Stages</h3><pre>${html(JSON.stringify(result.stages, null, 2))}</pre><div class="images">` +
      image("Actual", result.artifacts.current) + image("Baseline", result.artifacts.baseline) + image("Diff", result.artifacts.diff) +
      `</div></article>`;
  }).join("\n");
  const report = `<!doctype html><html><head><meta charset="utf-8"><title>CIQ Forge report</title>` +
    `<style>body{font:14px system-ui;margin:24px;background:#111827;color:#e5e7eb}article{border:1px solid #374151;padding:16px;margin:16px 0;border-radius:8px}.failed{border-color:#ef4444}.passed{border-color:#22c55e}.images{display:flex;gap:16px;flex-wrap:wrap}img{max-width:320px;background:#000}pre{overflow:auto}</style>` +
    `</head><body><h1>CIQ Forge</h1><p>${results.length} jobs, ${failures} failed.</p>${rows}</body></html>`;
  await writeFile(path.join(outputDirectory, "report.html"), report, "utf8");
}
