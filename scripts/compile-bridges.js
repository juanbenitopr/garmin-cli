import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appData = process.env.APPDATA || (process.platform === "darwin" ? `${process.env.HOME}/Library/Application Support` : `${process.env.HOME}/.config`);
const cfgPath = path.join(appData, "Garmin", "ConnectIQ", "current-sdk.cfg");

if (!existsSync(cfgPath)) {
  console.warn("CIQ Forge: current-sdk.cfg not found, skipping Java bridge compilation.");
  process.exit(0);
}

const sdkPath = readFileSync(cfgPath, "utf8").trim();
const jarPath = path.join(sdkPath, "bin", "monkeybrains.jar");

if (!existsSync(jarPath)) {
  console.warn(`CIQ Forge: monkeybrains.jar not found at ${jarPath}`);
  process.exit(0);
}

const javaFiles = ["IqPackagerBridge.java", "PortMonkeyDo.java"];
for (const file of javaFiles) {
  const fullPath = path.join(scriptsDir, file);
  if (existsSync(fullPath)) {
    try {
      execSync(`javac -cp "${jarPath}" -d "${scriptsDir}" "${fullPath}"`, { stdio: "inherit" });
      console.log(`CIQ Forge: Compiled ${file}`);
    } catch {
      console.warn(`CIQ Forge: Could not compile ${file}`);
    }
  }
}