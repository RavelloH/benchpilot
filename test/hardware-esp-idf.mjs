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
      doctor.checks.some((check) => check.id === id && check.status === "pass"),
      `Doctor did not pass ${id}`,
    );

  const scan = await run(["device", "scan", "--json"]);
  expect(
    scan.devices.some(
      (device) => device.adapter === "esp-idf" && device.fields?.port === port,
    ),
    `Passive scan did not find configured port ${port}`,
  );

  const status = await run([
    "device",
    "esp32s3",
    "status",
    "--dangerously-status",
    "--json",
  ]);
  expect(
    status.lockFinalStatus === "released",
    "status did not release its lock",
  );
  expect(
    JSON.stringify(status.data).includes("ESP32"),
    "status did not identify an ESP target",
  );

  const info = await run([
    "device",
    "esp32s3",
    "info",
    "--dangerously-info",
    "--json",
  ]);
  expect(info.lockFinalStatus === "released", "info did not release its lock");
  expect(
    JSON.stringify(info.data).includes("ESP32"),
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
      build.artifacts.some(
        (artifact) => artifact.metadata?.adapterEntry === id,
      ),
      `build did not register ${id}`,
    );

  const size = await run(["device", "esp32s3", "size", "--json"]);
  expect(size.data.available === true, "size output is unavailable");
  expect(
    Number.isInteger(size.data.image_bytes) && size.data.image_bytes > 0,
    "size did not report a positive image size",
  );
  if (allowCapture) {
    const capture = await run([
      "device",
      "esp32s3",
      "capture",
      "--dangerously-capture",
      "--duration_seconds",
      "10",
      "--json",
    ]);
    expect(
      capture.lockFinalStatus === "released",
      "capture did not release its lock",
    );
    expect(
      capture.data.marker === true,
      "capture did not observe the boot marker",
    );
  }
  if (allowFlash) {
    console.log(
      "Flash is explicitly enabled. The next command supplies the Agent-only safety confirmation option.",
    );
    await run(["device", "esp32s3", "flash", "--approve-flash", "--json"]);
  }
} finally {
  await rm(stateRoot, { recursive: true, force: true });
  if (temporaryProjectConfig) await rm(projectConfig, { force: true });
}
