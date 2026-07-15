import { promises as fs } from "node:fs";
import path from "node:path";
import { BenchPilotError, fail, type Json } from "../../core.js";

export async function initProject(): Promise<Json> {
  const file = path.join(process.cwd(), "benchpilot.toml");
  try {
    await fs.access(file);
    fail(
      "CONFIG_EXISTS",
      3,
      `${file} already exists; refusing to overwrite it.`,
    );
  } catch (error) {
    if (error instanceof BenchPilotError) throw error;
  }
  await fs.writeFile(
    file,
    `version = 1\n\n[project]\nid = "benchpilot-demo"\nname = "BenchPilot Demo"\n\n[devices.demo]\nadapter = "demo"\n\n[systems.demo]\ndevices = ["demo"]\n\n[adapters.demo]\nconnected = true\ndevice_id = "demo-device-01"\noperation_delay_ms = 50\n`,
  );
  await fs.mkdir(path.join(process.cwd(), ".benchpilot"), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), ".benchpilot", ".gitignore"),
    "*\n!.gitignore\n",
  );
  return { created: file, adapter: "demo", simulated: true };
}
