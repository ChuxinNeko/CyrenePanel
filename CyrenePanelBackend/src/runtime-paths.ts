import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

function getConfiguredDirectory(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isCompiledExecutable(): boolean {
  return resolve(Bun.main) === resolve(process.execPath);
}

function resolveRuntimeDirectory(environmentName: string, directoryName: string): string {
  const configuredDirectory = getConfiguredDirectory(environmentName);
  if (configuredDirectory) return configuredDirectory;

  const executableDirectory = dirname(process.execPath);
  const bundledDirectory = join(executableDirectory, directoryName);
  if (isCompiledExecutable() || existsSync(bundledDirectory)) {
    return bundledDirectory;
  }

  return join(process.cwd(), directoryName);
}

export const DATA_DIR = resolveRuntimeDirectory("CYRENE_DATA_DIR", "data");
export const LOG_DIR = resolveRuntimeDirectory("CYRENE_LOG_DIR", "logs");