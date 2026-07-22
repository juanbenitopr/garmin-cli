import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type ScaffoldType = "watchface" | "app";

export interface ScaffoldOptions {
  directory: string;
  name: string;
  type: ScaffoldType;
  devices: string[];
  minApiLevel: string;
}

export interface ScaffoldResult {
  directory: string;
  name: string;
  type: ScaffoldType;
  className: string;
  applicationId: string;
  devices: string[];
}

interface DeviceTemplate {
  id: string;
  productId: string;
  family: string;
  width: number;
  height: number;
  technology: "amoled" | "mip";
  touch: boolean;
}

export const scaffoldDevices: readonly DeviceTemplate[] = [
  { id: "fenix7", productId: "fenix7", family: "fenix7", width: 260, height: 260, technology: "mip", touch: false },
  { id: "forerunner965", productId: "fr965", family: "forerunner965", width: 454, height: 454, technology: "amoled", touch: true },
  { id: "venu3", productId: "venu3", family: "venu3", width: 454, height: 454, technology: "amoled", touch: true }
] as const;

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function classNameFrom(value: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join("");
  if (!joined) return "ConnectIq";
  return /^[A-Za-z_]/.test(joined) ? joined : `App${joined}`;
}

export function parseDeviceList(value: string | string[]): string[] {
  const values = (Array.isArray(value) ? value : value.split(","))
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function validateOptions(options: ScaffoldOptions): DeviceTemplate[] {
  if (!options.name.trim()) throw new Error("Project name cannot be empty.");
  if (!/^(?:\d+\.){2}\d+$/.test(options.minApiLevel)) {
    throw new Error(`Invalid minimum API level: ${options.minApiLevel}`);
  }
  if (!options.devices.length) throw new Error("Select at least one device.");
  const selected = options.devices.map((id) => scaffoldDevices.find((device) => device.id === id));
  const unknown = options.devices.filter((_, index) => !selected[index]);
  if (unknown.length) {
    throw new Error(`Unknown devices: ${unknown.join(", ")}. Available: ${scaffoldDevices.map((device) => device.id).join(", ")}.`);
  }
  return selected as DeviceTemplate[];
}

async function ensureEmptyDirectory(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length) throw new Error(`Destination is not empty: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function findBundledBarrel(): Promise<string> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(current, "barrels", "ciq-forge");
    try {
      await access(path.join(candidate, "CiqForge.jungle"));
      return candidate;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error("The bundled CIQ Forge barrel could not be found.");
      current = parent;
    }
  }
}

function manifest(options: ScaffoldOptions, devices: DeviceTemplate[], className: string, applicationId: string): string {
  const applicationType = options.type === "watchface" ? "watchface" : "watch-app";
  const products = devices.map((device) => `            <iq:product id="${device.productId}" />`).join("\n");
  return `<?xml version="1.0"?>
<iq:manifest xmlns:iq="http://www.garmin.com/xml/connectiq" version="3">
    <iq:application id="${applicationId}" type="${applicationType}" name="@Strings.AppName" entry="${className}App" launcherIcon="@Drawables.LauncherIcon" minApiLevel="${options.minApiLevel}">
        <iq:products>
${products}
        </iq:products>
        <iq:permissions />
        <iq:languages>
            <iq:language>eng</iq:language>
        </iq:languages>
        <iq:barrels>
            <iq:depends name="CiqForge" version="0.2.0" />
        </iq:barrels>
    </iq:application>
</iq:manifest>
`;
}

function appSource(className: string): string {
  return `using Toybox.Application;
using Toybox.WatchUi;

class ${className}App extends Application.AppBase {
    private var _forge;

    function initialize() {
        AppBase.initialize();
        _forge = ForgeBootstrap.context();
        _forge.diagnostics.record("app.initialize", "ok");
    }

    function onStart(state) {
        _forge.diagnostics.record("app.start", "ok");
    }

    function getInitialView() {
        _forge.diagnostics.record("view.created", "ok");
        return [new ${className}View(_forge)];
    }
}
`;
}

function viewSource(options: ScaffoldOptions, className: string): string {
  const baseClass = options.type === "watchface" ? "WatchUi.WatchFace" : "WatchUi.View";
  const initializer = options.type === "watchface" ? "WatchFace.initialize();" : "View.initialize();";
  const textExpression = options.type === "watchface"
    ? `var clock = _forge.clock.getClockTime();\n        var text = clock.hour.format("%02d") + ":" + clock.min.format("%02d");`
    : `var text = ${JSON.stringify(options.name)};`;
  const sleepHandlers = options.type === "watchface"
    ? `
    function onEnterSleep() {
        _forge.diagnostics.record("sleep.enter", "ok");
    }

    function onExitSleep() {
        _forge.diagnostics.record("sleep.exit", "ok");
    }
`
    : "";
  return `using Toybox.Graphics;
using Toybox.WatchUi;

class ${className}View extends ${baseClass} {
    private var _forge;

    function initialize(forgeContext) {
        ${initializer}
        _forge = forgeContext;
    }

    function onLayout(dc) {
        _forge.diagnostics.record("view.layout", dc.getWidth() + "x" + dc.getHeight());
    }

    function onShow() {
        _forge.diagnostics.record("view.show", "ok");
    }

    function onUpdate(dc) {
        _forge.diagnostics.beginRender();
        ${textExpression}
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(
            dc.getWidth() / 2,
            dc.getHeight() / 2,
            Graphics.FONT_LARGE,
            text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
        _forge.diagnostics.record("view.update", text);
        _forge.diagnostics.endRender();
        _forge.diagnostics.assertResult("rendered", dc.getWidth() > 0 && dc.getHeight() > 0, "display-size");
    }
${sleepHandlers}}
`;
}

function deviceYaml(device: DeviceTemplate): string {
  return `id: ${device.id}
garminProductId: ${device.productId}
family: ${device.family}
display:
  width: ${device.width}
  height: ${device.height}
  technology: ${device.technology}
  shape: round
capabilities:
  weather: true
  touch: ${device.touch}
`;
}

function projectReadme(options: ScaffoldOptions): string {
  return `# ${options.name}

Generated by CIQ Forge.

\`\`\`powershell
ciq-forge inspect
ciq-forge doctor
ciq-forge build --developer-key C:\\path\\to\\developer_key
ciq-forge run --device ${options.devices[0]} --scenario normal --developer-key C:\\path\\to\\developer_key
\`\`\`
`;
}

export async function createScaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const directory = path.resolve(options.directory);
  const normalized = { ...options, directory, name: options.name.trim(), devices: [...options.devices] };
  const devices = validateOptions(normalized);
  await ensureEmptyDirectory(directory);

  const className = classNameFrom(normalized.name);
  const applicationId = randomUUID().replaceAll("-", "");
  const files = new Map<string, string>([
    ["manifest.xml", manifest(normalized, devices, className, applicationId)],
    ["monkey.jungle", "project.manifest = manifest.xml\nbase.sourcePath = source\nbase.resourcePath = resources\nbase.barrelPath = vendor/ciq-forge/CiqForge.jungle\n"],
    ["forge.yml", `project:\n  root: .\n  jungle: monkey.jungle\n  manifest: manifest.xml\n\ninputs:\n  devicesDir: devices\n  scenariosDir: scenarios\n\nexecution:\n  workers: 4\n  timeoutMs: 30000\n  output: .ciq-forge/results\n\ncompiler:\n  maxConcurrency: 1\n\nsimulator:\n  startupTimeoutMs: 15000\n  captureDelayMs: 2000\n  windowTitle: Connect IQ Device Simulator\n  window:\n    x: 0\n    y: 0\n    width: 1200\n    height: 1000\n\nvisual:\n  baselinesDir: baselines\n  differenceThreshold: 0.001\n  pixelThreshold: 16\n`],
    [path.join("source", `${className}App.mc`), appSource(className)],
    [path.join("source", `${className}View.mc`), viewSource(normalized, className)],
    [path.join("source", "ForgeBootstrap.mc"), `(:forgeProduction)\nmodule ForgeBootstrap {\n    function context() {\n        return CiqForge.productionContext();\n    }\n}\n`],
    [path.join("resources", "strings", "strings.xml"), `<strings>\n    <string id="AppName">${xml(normalized.name)}</string>\n</strings>\n`],
    [path.join("resources", "drawables", "drawables.xml"), `<drawables>\n    <bitmap id="LauncherIcon" filename="launcher_icon.svg" />\n</drawables>\n`],
    [path.join("resources", "drawables", "launcher_icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">\n  <rect width="40" height="40" rx="8" fill="#111827" />\n  <path d="M12 12h16v5H17v6h11v5H12z" fill="#38bdf8" />\n</svg>\n`],
    [path.join("scenarios", "normal.yml"), `name: normal\ntime: "2026-01-01T09:42:30+00:00"\nsystem:\n  battery: 82\n  notifications: 0\nactivity:\n  steps: 8432\n  stepGoal: 10000\n  bodyBattery: 67\n  recoveryHours: 12\n  intensityMinutes: 86\n  weeklyDistanceMeters: 28400\n  heartRate: 72\nweather:\n  temperatureCelsius: 24\n  condition: sunny\nsettings:\n  theme: dark\n  showSeconds: true\nbudgets:\n  compileWarnings: 0\n`],
    [".gitignore", ".ciq-forge/\n*.prg\n*.iq\n"],
    ["README.md", projectReadme(normalized)]
  ]);
  for (const device of devices) files.set(path.join("devices", `${device.id}.yml`), deviceYaml(device));

  await mkdir(directory, { recursive: true });
  for (const [relativePath, contents] of files) {
    const target = path.join(directory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  await cp(await findBundledBarrel(), path.join(directory, "vendor", "ciq-forge"), { recursive: true });

  return { directory, name: normalized.name, type: normalized.type, className, applicationId, devices: normalized.devices };
}
