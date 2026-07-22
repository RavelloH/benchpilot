import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(repositoryRoot, "dist", "cli", "index.js");
const dslitePath = process.env.BENCHPILOT_TI_UNIFLASH_DSLITE;
const targetConfig = process.env.BENCHPILOT_TI_UNIFLASH_TARGET_CONFIG;
const image = process.env.BENCHPILOT_TI_UNIFLASH_IMAGE;
const probeId = process.env.BENCHPILOT_TI_UNIFLASH_PROBE_ID;
const monitorPort = process.env.BENCHPILOT_TI_UNIFLASH_MONITOR_PORT;
const allowFlash = process.env.BENCHPILOT_TI_UNIFLASH_ALLOW_FLASH === "1";

if (!dslitePath || !targetConfig || !image || !probeId) {
  console.log(
    "SKIP: set BENCHPILOT_TI_UNIFLASH_DSLITE, BENCHPILOT_TI_UNIFLASH_TARGET_CONFIG, BENCHPILOT_TI_UNIFLASH_IMAGE, and BENCHPILOT_TI_UNIFLASH_PROBE_ID to run TI UniFlash hardware checks.",
  );
  process.exit(0);
}

const temp = await mkdtemp(path.join(tmpdir(), "benchpilot-ti-uniflash-"));
const project = path.join(temp, "project");
const stateRoot = path.join(temp, "state");
const expect = (condition, message) => {
  assert.ok(condition, `Hardware assertion failed: ${message}`);
};
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: project,
      env: {
        ...process.env,
        TEMP: stateRoot,
        TMP: stateRoot,
        BENCHPILOT_ADAPTERS: JSON.stringify({
          "ti-uniflash": { dslite_path: dslitePath },
        }),
        BENCHPILOT_DEVICES__TARGET: JSON.stringify({
          adapter: "ti-uniflash",
          target_config: targetConfig,
          probe_id: probeId,
          target_name: "MSPM0G3507",
          reset_index: 1,
          inventory: {
            model: "MSPM0G3507",
            revision: "unknown",
            hardware_id: "hardware-ti-uniflash-target",
            flash: {
              manufacturer: "Texas Instruments",
              device: "MSPM0G3507 internal flash",
              size: "128 KiB",
            },
          },
          ...(monitorPort ? { monitor_port: monitorPort } : {}),
        }),
      },
      stdio: ["ignore", "pipe", "inherit"],
      shell: false,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`benchpilot ${args.join(" ")} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `benchpilot ${args.join(" ")} did not produce one JSON result: ${error.message}`,
          ),
        );
      }
    });
  });

try {
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, "benchpilot.toml"),
    [
      "version = 1",
      "",
      "[project]",
      'id = "hardware-ti-uniflash"',
      'name = "TI UniFlash hardware test"',
      "",
      "[adapters]",
      'enabled = ["ti-uniflash"]',
      "",
    ].join("\n"),
  );

  const doctor = await run(["adapter", "ti-uniflash", "doctor", "--json"]);
  expect(doctor.ok === true, "adapter doctor did not succeed");
  expect(
    doctor.data?.checks?.some(
      (check) =>
        check.id === "ti-uniflash-tool-dslite" && check.status === "pass",
    ),
    "doctor did not validate DSLite.exe",
  );

  const status = await run(["device", "target", "status", "--json"]);
  expect(status.ok === true, "status capability did not succeed");
  expect(
    status.data?.output?.target?.model === "MSPM0G3507",
    "status did not report the configured target model",
  );

  const info = await run(["device", "target", "info", "--json"]);
  expect(info.ok === true, "info capability did not succeed");
  expect(
    info.data?.output?.identity?.model === "MSPM0G3507" &&
      info.data?.output?.hardware?.flash?.size === "128 KiB",
    "info did not project the configured target inventory",
  );

  if (monitorPort) {
    const captured = await run([
      "device",
      "target",
      "capture",
      "--duration_seconds",
      "1",
      "--baud",
      "115200",
      "--json",
    ]);
    expect(captured.ok === true, "capture capability did not succeed");
    expect(
      typeof captured.data?.output?.lines === "number" &&
        typeof captured.data?.output?.bytes === "number",
      "capture did not return bounded serial metadata",
    );

    let sessionId;
    try {
      const started = await run(["device", "target", "run", "--json"]);
      sessionId = started.data?.output?.sessionId;
      expect(
        typeof sessionId === "string" && sessionId.startsWith("session-"),
        "run did not return a managed session identifier",
      );
      const logs = await run([
        "device",
        "target",
        "logs",
        "--session-id",
        sessionId,
        "--tail",
        "16",
        "--json",
      ]);
      expect(
        Array.isArray(logs.data?.output?.records),
        "logs did not return records",
      );
    } finally {
      if (sessionId) {
        const stopped = await run([
          "device",
          "target",
          "stop",
          "--session-id",
          sessionId,
          "--json",
        ]);
        expect(
          stopped.data?.output?.status === "stopped",
          "stop did not close the session",
        );
      }
    }
  }

  const reset = await run(["device", "target", "reset", "--json"]);
  expect(reset.ok === true, "reset capability did not succeed");

  const planned = await run([
    "device",
    "target",
    "flash",
    "--image",
    image,
    "--verify",
    "true",
    "--run-after-flash",
    "false",
    "--dry-run",
    "--json",
  ]);
  expect(planned.ok === true, "flash dry-run did not succeed");

  if (!allowFlash) {
    console.log(
      "SKIP: set BENCHPILOT_TI_UNIFLASH_ALLOW_FLASH=1 to authorize destructive hardware flash validation.",
    );
    process.exitCode = 0;
  } else {
    const flashed = await run([
      "device",
      "target",
      "flash",
      "--image",
      image,
      "--verify",
      "true",
      "--run-after-flash",
      "false",
      "--json",
    ]);
    expect(flashed.ok === true, "flash capability did not succeed");
    expect(
      typeof flashed.data?.execution?.runId === "string" &&
        flashed.data.execution.runId.length > 0,
      "flash did not record a Capability Run",
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
