import { describe, expect, it, vi } from "vitest";
import { GarminCompilerAdapter, type ProcessRunner } from "@ciq-forge/garmin-compiler";

describe("Garmin compiler adapter", () => {
  it("constructs the official compiler arguments without logging secrets", async () => {
    const runner = vi.fn<ProcessRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false
    });
    const adapter = new GarminCompilerAdapter(runner);
    const result = await adapter.compile({
      compilerPath: "monkeyc",
      junglePath: "project/monkey.jungle",
      developerKey: "secret/developer_key",
      deviceId: "venu3",
      outputPath: ".ciq-forge/test/app.prg",
      timeoutMs: 1000
    });
    expect(runner).toHaveBeenCalledWith(
      "monkeyc",
      ["-d", "venu3", "-f", "project/monkey.jungle", "-o", ".ciq-forge/test/app.prg", "-y", "secret/developer_key"],
      1000
    );
    expect(result.status).toBe("passed");
    expect(JSON.stringify(result)).not.toContain("developer_key");
  });

  it("reports timeouts distinctly", async () => {
    const runner: ProcessRunner = async () => ({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true
    });
    const result = await new GarminCompilerAdapter(runner).compile({
      compilerPath: "monkeyc",
      junglePath: "monkey.jungle",
      developerKey: "key",
      deviceId: "fenix7",
      outputPath: ".ciq-forge/test-timeout/app.prg",
      timeoutMs: 1
    });
    expect(result.status).toBe("timed-out");
  });

  it("can request compiler build statistics", async () => {
    const runner = vi.fn<ProcessRunner>().mockResolvedValue({
      exitCode: 0, stdout: "build stats", stderr: "", timedOut: false
    });
    await new GarminCompilerAdapter(runner).compile({
      compilerPath: "monkeyc", junglePath: "monkey.jungle", developerKey: "key",
      deviceId: "venu3", outputPath: "app.prg", timeoutMs: 1000, buildStats: true
    });
    expect(runner).toHaveBeenCalledWith(
      "monkeyc",
      expect.arrayContaining(["--build-stats", "0"]),
      1000
    );
  });
});
