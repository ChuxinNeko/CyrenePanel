import { readFileSync } from "fs";
import { join } from "path";

function readPackageVersion(): string {
  const envVersion = process.env.CYRENE_VERSION?.trim();
  if (envVersion) return envVersion.startsWith("v") ? envVersion : `v${envVersion}`;

  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      const version = pkg.version.trim();
      return version.startsWith("v") ? version : `v${version}`;
    }
  } catch {
    // Fall back to the source package version if package.json is unavailable.
  }

  return "v0.0.0";
}

export const CYRENE_VERSION = readPackageVersion();
