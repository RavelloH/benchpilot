import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(repositoryRoot, "dist", "cli", "index.js");

const port = process.env.BENCHPILOT_ESP_PORT;
const project = process.env.BENCHPILOT_ESP_PROJECT;
const allowFlash = process.env.BENCHPILOT_ESP_ALLOW_FLASH === "1";
const allowCapture = process.env.BENCHPILOT_ESP_ALLOW_CAPTURE === "1";
const allowSession = process.env.BENCHPILOT_ESP_ALLOW_SESSION === "1";
const allowSessionWrite =
  allowSession && process.env.BENCHPILOT_ESP_ALLOW_SESSION_WRITE === "1";

if (!port || !project) {
  console.log(
    "SKIP: set BENCHPILOT_ESP_PORT and BENCHPILOT_ESP_PROJECT to run ESP-IDF hardware checks.",
  );
  process.exit(0);
}

const adapterConfig = Object.fromEntries(
  [
    ["idf_path", process.env.BENCHPILOT_ESP_IDF_PATH],
    ["idf_py_path", process.env.BENCHPILOT_ESP_IDF_PY_PATH],
    ["python_path", process.env.BENCHPILOT_ESP_PYTHON_PATH],
    ["export_script", process.env.BENCHPILOT_ESP_EXPORT_SCRIPT],
    ["export_bat_script", process.env.BENCHPILOT_ESP_EXPORT_BAT_SCRIPT],
  ].filter((entry) => entry[1]),
);
const stateRoot = await mkdtemp(path.join(tmpdir(), "benchpilot-esp-idf-"));
const projectConfig = path.join(project, "benchpilot.toml");
let temporaryProjectConfig = false;
try {
  await access(projectConfig);
} catch {
  temporaryProjectConfig = true;
  await writeFile(
    projectConfig,
    [
      "version = 1",
      "",
      "[project]",
      'id = "hardware-esp-idf"',
      'name = "ESP-IDF hardware test"',
      "",
      "[adapters]",
      'enabled = ["esp-idf"]',
      "",
    ].join("\n"),
  );
}
const environment = {
  ...process.env,
  TEMP: path.join(stateRoot, "runtime"),
  BENCHPILOT_DEVICES__ESP32S3: JSON.stringify({
    adapter: "esp-idf",
    port,
    chip: "esp32s3",
  }),
  ...(Object.keys(adapterConfig).length
    ? { BENCHPILOT_ADAPTERS: JSON.stringify({ "esp-idf": adapterConfig }) }
    : {}),
};

const expect = (condition, message) => {
  if (!condition) throw new Error(`Hardware assertion failed: ${message}`);
};

const capabilityOutput = (result) => result.data?.output;

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: project,
      env: environment,
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
  const doctor = await run(["doctor", "--json"]);
  for (const id of [
    "esp-idf-tool-python",
    "esp-idf-tool-idf",
    "esp-idf-environment-idf",
  ])
    expect(
      doctor.data?.checks?.some(
        (check) => check.id === id && check.status === "pass",
      ),
      `Doctor did not pass ${id}`,
    );

  const scan = await run(["device", "scan", "--json"]);
  expect(
    scan.data?.devices?.some(
      (device) => device.adapter === "esp-idf" && device.fields?.port === port,
    ),
    `Passive scan did not find configured port ${port}`,
  );

  const status = await run(["device", "esp32s3", "status", "--json"]);
  expect(
    JSON.stringify(capabilityOutput(status)).includes("ESP32"),
    "status did not identify an ESP target",
  );

  const info = await run(["device", "esp32s3", "info", "--json"]);
  expect(
    JSON.stringify(capabilityOutput(info)).includes("ESP32"),
    "info did not identify an ESP target",
  );

  const build = await run(["device", "esp32s3", "build", "--json"]);
  const expectedArtifacts = [
    "project-description",
    "flasher-args",
    "application-elf",
    "application-bin",
    "bootloader-bin",
    "partition-table-bin",
    "sdkconfig",
  ];
  for (const id of expectedArtifacts)
    expect(
      build.data?.artifacts?.some(
        (artifact) => artifact.metadata?.adapterEntry === id,
      ),
      `build did not register ${id}`,
    );

  const size = await run(["device", "esp32s3", "size", "--json"]);
  expect(
    capabilityOutput(size)?.available === true,
    "size output is unavailable",
  );
  expect(
    Number.isInteger(capabilityOutput(size)?.image_bytes) &&
      capabilityOutput(size).image_bytes > 0,
    "size did not report a positive image size",
  );
  if (allowCapture) {
    const capture = await run([
      "device",
      "esp32s3",
      "capture",
      "--duration_seconds",
      "10",
      "--json",
    ]);
    expect(
      capabilityOutput(capture)?.marker === true,
      "capture did not observe the boot marker",
    );
  }
  if (allowSession) {
    let sessionId;
    try {
      const started = await run(["device", "esp32s3", "run", "--json"]);
      sessionId = capabilityOutput(started)?.sessionId;
      expect(
        typeof sessionId === "string" && sessionId.startsWith("session-"),
        "run did not return a managed session identifier",
      );
      expect(
        capabilityOutput(started)?.status === "running",
        "run did not report a running managed session",
      );
      const logs = await run([
        "device",
        "esp32s3",
        "logs",
        "--session-id",
        sessionId,
        "--tail",
        "32",
        "--json",
      ]);
      expect(
        Array.isArray(capabilityOutput(logs)?.records),
        "logs did not return a bounded record array",
      );
      if (allowSessionWrite) {
        const sent = await run([
          "device",
          "esp32s3",
          "send",
          "--session-id",
          sessionId,
          "--text",
          "benchpilot-hardware-check",
          "--framing",
          "line",
          "--json",
        ]);
        expect(
          capabilityOutput(sent)?.status === "written" &&
            capabilityOutput(sent)?.bytesWritten > 0,
          "send did not return a transport write acknowledgement",
        );
      }
    } finally {
      if (sessionId) {
        const stopped = await run([
          "device",
          "esp32s3",
          "stop",
          "--session-id",
          sessionId,
          "--json",
        ]);
        expect(
          capabilityOutput(stopped)?.status === "stopped",
          "stop did not close the managed session",
        );
      }
    }
  }
  if (allowFlash) {
    console.log(
      "Flash is explicitly enabled by the hardware-test environment.",
    );
    await run(["device", "esp32s3", "flash", "--json"]);
  }
} finally {
  await rm(stateRoot, { recursive: true, force: true });
  if (temporaryProjectConfig) await rm(projectConfig, { force: true });
}
