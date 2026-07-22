import { readFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { LoadedProject } from "./types.js";

function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function collectJunglePaths(text: string, property: "sourcePath" | "resourcePath"): string[] {
  const results = new Set<string>();
  const expression = new RegExp(`^[^#\\r\\n]*\\.${property}\\s*=\\s*(.+)$`, "gm");

  for (const match of text.matchAll(expression)) {
    for (const item of (match[1] ?? "").split(";")) {
      const clean = item.trim().replace(/^"|"$/g, "");
      if (clean && !clean.includes("$(")) results.add(clean);
    }
  }

  return [...results].sort();
}

export async function loadProject(input: {
  root: string;
  junglePath: string;
  manifestPath: string;
}): Promise<LoadedProject> {
  const [manifestText, jungleText] = await Promise.all([
    readFile(input.manifestPath, "utf8"),
    readFile(input.junglePath, "utf8")
  ]);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const document = parser.parse(manifestText) as Record<string, any>;
  const manifest = document["iq:manifest"] ?? document.manifest ?? {};
  const app = manifest["iq:application"] ?? manifest.application ?? {};
  const products = app["iq:products"]?.["iq:product"] ?? app.products?.product;
  const projectRoot = path.resolve(input.root);

  return {
    root: projectRoot,
    junglePath: path.resolve(input.junglePath),
    manifestPath: path.resolve(input.manifestPath),
    ...(app.id ? { applicationId: String(app.id) } : {}),
    ...(app.type ? { applicationType: String(app.type) } : {}),
    products: list(products)
      .map((product: any) => String(product?.id ?? product))
      .filter(Boolean)
      .sort(),
    sourcePaths: collectJunglePaths(jungleText, "sourcePath").map((value) => path.resolve(projectRoot, value)),
    resourcePaths: collectJunglePaths(jungleText, "resourcePath").map((value) => path.resolve(projectRoot, value))
  };
}
