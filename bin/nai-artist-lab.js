#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const launcherPath = path.join(rootDir, "launcher.py");
const packageJson = require(path.join(rootDir, "package.json"));

function userDataDir() {
  if (process.env.NAI_ARTIST_LAB_USER_DIR) {
    return process.env.NAI_ARTIST_LAB_USER_DIR;
  }

  return path.join(os.homedir(), "nai_aclab");
}

function printHelp() {
  console.log(`NAI Artist Combination Lab ${packageJson.version}

Usage:
  nai-aclab
  nai-artist-lab
  npm start

Requirements:
  Node.js 18+
  Python 3.10+

Data folder:
  ${userDataDir()}
`);
}

function pythonCandidates() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push({ command: process.env.PYTHON, args: [] });
  }
  if (process.platform === "win32") {
    candidates.push({ command: "py", args: ["-3"] });
  }
  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });
  return candidates;
}

function versionParts(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return match.slice(1).map((part) => Number(part));
}

function supportsPython(candidate) {
  const probe = spawnSync(
    candidate.command,
    [
      ...candidate.args,
      "-c",
      "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  if (probe.error || probe.status !== 0) {
    return false;
  }

  const parts = versionParts(probe.stdout);
  if (!parts) {
    return false;
  }

  const [major, minor] = parts;
  return major > 3 || (major === 3 && minor >= 10);
}

function choosePython() {
  return pythonCandidates().find((candidate) => supportsPython(candidate));
}

function runWithCandidate(candidate) {
  if (!candidate) {
    console.error("Python 3.10 or newer was not found.");
    console.error("Install Python from https://www.python.org/downloads/ and run npx nai-aclab again.");
    process.exit(1);
  }

  const env = {
    ...process.env,
    NAI_ARTIST_LAB_USER_DIR: userDataDir(),
  };

  fs.mkdirSync(env.NAI_ARTIST_LAB_USER_DIR, { recursive: true });
  console.log(`Starting NAI Artist Combination Lab ${packageJson.version}...`);

  const child = spawn(candidate.command, [...candidate.args, launcherPath], {
    cwd: rootDir,
    env,
    stdio: "inherit",
    windowsHide: false,
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(packageJson.version);
  process.exit(0);
}

runWithCandidate(choosePython());
