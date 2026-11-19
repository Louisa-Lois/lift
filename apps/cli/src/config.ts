import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { User } from "@lift/shared";

export interface LiftConfig {
  apiUrl?: string;
  token?: string;
  user?: User;
}

export interface LiftProjectLink {
  projectId: string;
  serviceId?: string;
}

export function getDefaultConfigDir(): string {
  if (process.env.LIFT_CONFIG_DIR) {
    return process.env.LIFT_CONFIG_DIR;
  }
  return path.join(os.homedir(), ".lift");
}

export function getConfigFilePath(configDir?: string): string {
  const dir = configDir ?? getDefaultConfigDir();
  return path.join(dir, "config.json");
}

export function loadConfig(configDir?: string): LiftConfig {
  const filePath = getConfigFilePath(configDir);
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data) as LiftConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: LiftConfig, configDir?: string): void {
  const dir = configDir ?? getDefaultConfigDir();
  const filePath = path.join(dir, "config.json");

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore permissions failure on platforms that do not support POSIX file modes
  }
}

export function clearAuthConfig(configDir?: string): void {
  const config = loadConfig(configDir);
  delete config.token;
  delete config.user;
  saveConfig(config, configDir);
}

export function loadProjectLink(cwd = process.cwd()): LiftProjectLink | null {
  try {
    const linkPath = path.join(cwd, ".lift", "project.json");
    if (!fs.existsSync(linkPath)) {
      return null;
    }
    const data = fs.readFileSync(linkPath, "utf8");
    return JSON.parse(data) as LiftProjectLink;
  } catch {
    return null;
  }
}
