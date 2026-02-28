#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const defaultVercelEnvs = ["development", "preview", "production"];
const args = process.argv.slice(2);

const vercelEnvs = [];
let target = "both";

for (const arg of args) {
  if (arg === "--dev") {
    target = "dev";
    continue;
  }
  if (arg === "--prod") {
    target = "prod";
    continue;
  }
  if (arg === "--both") {
    target = "both";
    continue;
  }
  vercelEnvs.push(arg);
}

const envs = vercelEnvs.length > 0 ? vercelEnvs : defaultVercelEnvs;

const tempDir = mkdtempSync(join(tmpdir(), "vercel-convex-sync-"));

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseEnvFile(content) {
  const vars = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2] ?? "";

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");

    vars.set(key, value);
  }

  return vars;
}

function pullVercelEnv(environment, filename) {
  try {
    run("npx", [
      "vercel",
      "env",
      "pull",
      filename,
      `--environment=${environment}`,
      "--yes",
    ]);
  } catch (error) {
    const message = String(error?.stderr || error?.message || error);
    throw new Error(`Failed to pull Vercel ${environment} env: ${message.slice(0, 500)}`);
  }
}

function setConvexEnv(key, value, mode) {
  const extra = mode === "prod" ? ["--prod"] : [];
  try {
    run("npx", ["convex", "env", "set", ...extra, key, value]);
  } catch (error) {
    const message = String(error?.stderr || error?.message || error);
    throw new Error(`Failed setting Convex ${mode} env ${key}: ${message.slice(0, 500)}`);
  }
}

try {
  const merged = new Map();

  for (const environment of envs) {
    const file = join(tempDir, `${environment}.env`);
    pullVercelEnv(environment, file);

    const content = readFileSync(file, "utf8");
    const parsed = parseEnvFile(content);

    for (const [key, value] of parsed) {
      merged.set(key, value);
    }

    console.log(`Pulled ${parsed.size} vars from Vercel ${environment}.`);
  }

  if (merged.size === 0) {
    console.log("No Vercel env vars found to sync.");
    process.exit(0);
  }

  const targets =
    target === "both"
      ? ["dev", "prod"]
      : target === "prod"
        ? ["prod"]
        : ["dev"];

  let synced = 0;
  for (const [key, value] of merged) {
    for (const mode of targets) {
      setConvexEnv(key, value, mode);
      synced += 1;
    }
  }

  console.log(
    `Synced ${synced} values to Convex (${targets.join("+")} targets, ${envs.join(" -> ")} Vercel precedence).`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
