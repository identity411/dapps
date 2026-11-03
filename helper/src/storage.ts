import fs from "node:fs";
import path from "node:path";

export function ensureStateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on platforms with partial POSIX support.
  }
}

export function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text) as T;
}

export function writeJsonFileSecure(file: string, value: unknown): void {
  ensureStateDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    // Best effort.
  }
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
}

export function writeTextFileSecure(file: string, text: string): void {
  ensureStateDir(path.dirname(file));
  fs.writeFileSync(file, text, { mode: 0o600 });
}

export function deleteFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Best effort.
  }
}
