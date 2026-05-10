const fs = require("fs");
const net = require("net");
const path = require("path");

const { PATHS } = require("./constants");

function trim(value) {
  return String(value ?? "").trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFileIfExists(filePath, encoding = "utf8") {
  try {
    return fs.readFileSync(filePath, encoding);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function resolveProjectPath(targetPath) {
  if (!targetPath) {
    return PATHS.baseDir;
  }
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.join(PATHS.baseDir, targetPath);
}

function toProjectRelative(targetPath) {
  const relativePath = path.relative(PATHS.baseDir, targetPath).replace(/\\/g, "/");
  if (!relativePath) {
    return ".";
  }
  if (relativePath.startsWith("..")) {
    return targetPath;
  }
  return relativePath;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const tester = net.createServer();
    let settled = false;
    const finish = (free) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(free);
    };
    tester.once("error", () => finish(false));
    tester.once("listening", () => {
      tester.close(() => finish(true));
    });
    tester.listen(port, host);
  });
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function asciiName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSlug(input, usedSlugs, fallbackIndex) {
  const base = asciiName(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `node-${fallbackIndex + 1}`;

  let candidate = base;
  let suffix = 2;
  while (usedSlugs.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(candidate);
  return candidate;
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function yamlScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '""';
  }
  return JSON.stringify(String(value));
}

function countIndent(line) {
  const match = String(line).match(/^ */);
  return match ? match[0].length : 0;
}

function tailLines(text, lineCount) {
  return String(text ?? "")
    .split(/\r?\n/)
    .slice(-lineCount)
    .join("\n")
    .trim();
}

function fileMTime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_error) {
    return null;
  }
}

module.exports = {
  asciiName,
  countIndent,
  ensureDir,
  fileMTime,
  isPortFree,
  isProcessRunning,
  parseJson,
  readFileIfExists,
  resolveProjectPath,
  sleep,
  tailLines,
  toProjectRelative,
  trim,
  uniqueSlug,
  yamlScalar,
};
