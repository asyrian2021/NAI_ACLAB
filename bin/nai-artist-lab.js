#!/usr/bin/env node

const { spawn } = require("child_process");
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

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "NAI Artist Combination Lab");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "NAI Artist Combination Lab");
  }

  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "nai-artist-combination-lab"
  );
}

function printHelp() {
  console.log(`NAI Artist Combination Lab ${packageJson.version}

Usage:
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

function runWithCandidate(candidates, index) {
  if (index >= candidates.length) {
    console.error("Python 3.10+을 찾을 수 없습니다. Python을 설치한 뒤 다시 실행해주세요.");
    process.exit(1);
  }

  const candidate = candidates[index];
  const env = {
    ...process.env,
    NAI_ARTIST_LAB_USER_DIR: userDataDir(),
  };

  fs.mkdirSync(env.NAI_ARTIST_LAB_USER_DIR, { recursive: true });

  const child = spawn(candidate.command, [...candidate.args, launcherPath], {
    cwd: rootDir,
    env,
    stdio: "inherit",
    windowsHide: false,
  });

  let failedToStart = false;
  child.on("error", (error) => {
    failedToStart = true;
    if (error.code === "ENOENT") {
      runWithCandidate(candidates, index + 1);
      return;
    }
    console.error(error.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (failedToStart) {
      return;
    }
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

runWithCandidate(pythonCandidates(), 0);
