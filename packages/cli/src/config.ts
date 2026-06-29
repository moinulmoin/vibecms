import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API_URL = "https://dev.vibecms.dev";

const CONFIG_DIR = join(homedir(), ".vibecms");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export type StoredConfig = { apiUrl?: string; token?: string };
export type ResolvedConfig = { apiUrl: string; token?: string };

export function loadConfigFile(): StoredConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveConfigFile(config: StoredConfig): string {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return CONFIG_PATH;
}

// Precedence: explicit flag > env var > config file > built-in default.
export function resolveConfig(flags: { apiUrl?: string; token?: string }): ResolvedConfig {
  const file = loadConfigFile();
  const apiUrl = flags.apiUrl ?? process.env.VIBECMS_API_URL ?? file.apiUrl ?? DEFAULT_API_URL;
  const token = flags.token ?? process.env.VIBECMS_TOKEN ?? file.token;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), token };
}
