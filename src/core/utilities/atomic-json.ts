import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function atomicJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2));
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
