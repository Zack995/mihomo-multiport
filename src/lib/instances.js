const fs = require("fs");
const path = require("path");

const { DEFAULTS, PATHS } = require("./constants");
const {
  ensureDir,
  fileMTime,
  isProcessRunning,
  parseJson,
  readFileIfExists,
  resolveProjectPath,
  tailLines,
  toProjectRelative,
  trim,
} = require("./helpers");

function getPreferredInstancesFile(explicitPath) {
  if (explicitPath) {
    return resolveProjectPath(explicitPath);
  }

  if (process.env.INSTANCES_FILE) {
    return resolveProjectPath(process.env.INSTANCES_FILE);
  }

  if (fs.existsSync(PATHS.generatedInstancesJson)) {
    return PATHS.generatedInstancesJson;
  }

  if (fs.existsSync(PATHS.generatedInstancesCsv)) {
    return PATHS.generatedInstancesCsv;
  }

  return PATHS.defaultInstancesCsv;
}

function readCsvInstances(filePath) {
  const content = readFileIfExists(filePath);
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [name, configPath, expectedLoc, expectedIp] = line.split(",");
      return {
        name: trim(name),
        configPath: trim(configPath),
        expectedLoc: trim(expectedLoc),
        expectedIp: trim(expectedIp),
      };
    })
    .filter((instance) => instance.name && instance.configPath);
}

function readJsonInstances(filePath) {
  const content = readFileIfExists(filePath);
  const parsed = parseJson(content, {});
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.instances) ? parsed.instances : [];
  return list
    .map((instance) => ({
      name: trim(instance.name),
      displayName: trim(instance.displayName),
      configPath: trim(instance.configPath),
      expectedLoc: trim(instance.expectedLoc),
      expectedIp: trim(instance.expectedIp),
      localPort: Number(instance.localPort) || null,
      scheme: trim(instance.scheme) || "http",
      format: trim(instance.format),
    }))
    .filter((instance) => instance.name && instance.configPath);
}

function toPersistedInstance(instance) {
  const configAbs = resolveProjectPath(instance.configAbs || instance.configPath);
  return {
    name: trim(instance.name),
    displayName: trim(instance.displayName),
    configPath: toProjectRelative(configAbs),
    expectedLoc: trim(instance.expectedLoc),
    expectedIp: trim(instance.expectedIp),
    localPort: Number(instance.localPort) || null,
    scheme: trim(instance.scheme) || "http",
    format: trim(instance.format),
  };
}

function writeCsvInstances(filePath, instances) {
  const lines = ["# name,config_path,expected_loc,expected_ip"];
  for (const instance of instances.map(toPersistedInstance)) {
    lines.push(
      [
        instance.name,
        instance.configPath,
        instance.expectedLoc,
        instance.expectedIp,
      ].join(","),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeJsonInstances(filePath, instances) {
  const normalizedInstances = instances.map(toPersistedInstance);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), instances: normalizedInstances }, null, 2)}\n`,
    "utf8",
  );
}

function writeInstancesFile(filePath, instances) {
  const resolvedPath = resolveProjectPath(filePath);
  ensureDir(path.dirname(resolvedPath));
  if (path.extname(resolvedPath) === ".json") {
    writeJsonInstances(resolvedPath, instances);
    return;
  }
  writeCsvInstances(resolvedPath, instances);
}

function getMirroredInstancesFiles(filePath) {
  const resolvedPath = resolveProjectPath(filePath);
  const mirroredPaths = [resolvedPath];

  if (resolvedPath === PATHS.generatedInstancesJson) {
    mirroredPaths.push(PATHS.generatedInstancesCsv);
  } else if (resolvedPath === PATHS.generatedInstancesCsv) {
    mirroredPaths.push(PATHS.generatedInstancesJson);
  }

  return [...new Set(mirroredPaths)];
}

function readInstances(filePath = getPreferredInstancesFile()) {
  const instancesFile = resolveProjectPath(filePath);
  const parsedInstances = path.extname(instancesFile) === ".json"
    ? readJsonInstances(instancesFile)
    : readCsvInstances(instancesFile);

  return parsedInstances.map((instance) => enrichInstance(instance));
}

function enrichInstance(instance) {
  const configAbs = resolveProjectPath(instance.configPath);
  const metadata = readConfigMetadata(configAbs);
  return {
    ...instance,
    configPath: toProjectRelative(configAbs),
    configAbs,
    displayName: instance.displayName || metadata.displayName || instance.name,
    localPort: instance.localPort || metadata.localPort || null,
    scheme: instance.scheme || metadata.scheme || "http",
  };
}

function readConfigMetadata(configPath) {
  const content = readFileIfExists(configPath);
  const sourceName = content.match(/^# Source name:\s*(.+)$/m);
  const mixedPort = content.match(/^mixed-port:\s*(.+)$/m);
  const port = content.match(/^port:\s*(.+)$/m);
  const socksPort = content.match(/^socks-port:\s*(.+)$/m);

  if (mixedPort) {
    return {
      displayName: sourceName ? trim(sourceName[1]) : "",
      localPort: Number(trim(mixedPort[1].replace(/"/g, ""))) || null,
      scheme: "http",
    };
  }

  if (port) {
    return {
      displayName: sourceName ? trim(sourceName[1]) : "",
      localPort: Number(trim(port[1].replace(/"/g, ""))) || null,
      scheme: "http",
    };
  }

  if (socksPort) {
    return {
      displayName: sourceName ? trim(sourceName[1]) : "",
      localPort: Number(trim(socksPort[1].replace(/"/g, ""))) || null,
      scheme: "socks5h",
    };
  }

  return {
    displayName: sourceName ? trim(sourceName[1]) : "",
    localPort: null,
    scheme: "http",
  };
}

function getRuntimePaths(name) {
  const workdir = path.join(PATHS.runtimeDir, name);
  return {
    workdir,
    pidFile: path.join(workdir, "mihomo.pid"),
    logFile: path.join(PATHS.logsDir, `${name}.log`),
  };
}

function getInstanceStatus(instance) {
  const runtime = getRuntimePaths(instance.name);
  const pid = Number(trim(readFileIfExists(runtime.pidFile))) || null;
  const running = isProcessRunning(pid);

  return {
    ...instance,
    configExists: fs.existsSync(instance.configAbs),
    logFile: toProjectRelative(runtime.logFile),
    logUpdatedAt: fileMTime(runtime.logFile),
    pidFile: toProjectRelative(runtime.pidFile),
    pid,
    running,
    proxyUrl: instance.localPort
      ? `${instance.scheme}://127.0.0.1:${instance.localPort}`
      : null,
    dockerProxyUrl: instance.localPort
      ? `${instance.scheme}://host.docker.internal:${instance.localPort}`
      : null,
  };
}

function listInstanceStatuses(filePath = getPreferredInstancesFile()) {
  const instances = readInstances(filePath);
  return instances.map((instance) => getInstanceStatus(instance));
}

function findInstance(name, filePath = getPreferredInstancesFile()) {
  const targetName = trim(name);
  const instances = readInstances(filePath);
  const matched = instances.find((instance) => instance.name === targetName);
  if (!matched) {
    throw new Error(`Instance not found: ${targetName}`);
  }
  return matched;
}

function summaryFromStatuses(statuses, instancesFile = getPreferredInstancesFile()) {
  const runningCount = statuses.filter((status) => status.running).length;
  return {
    instancesFile: toProjectRelative(resolveProjectPath(instancesFile)),
    total: statuses.length,
    running: runningCount,
    stopped: statuses.length - runningCount,
  };
}

function readLogTail(name, lineCount = DEFAULTS.logTailLines) {
  const runtime = getRuntimePaths(name);
  const content = readFileIfExists(runtime.logFile);
  return {
    name,
    logFile: toProjectRelative(runtime.logFile),
    updatedAt: fileMTime(runtime.logFile),
    content: tailLines(content, lineCount),
  };
}

function removeInstanceRecord(name, filePath = getPreferredInstancesFile()) {
  const targetName = trim(name);
  const instancesFile = resolveProjectPath(filePath);
  const instances = readInstances(instancesFile);
  const removed = instances.find((instance) => instance.name === targetName);

  if (!removed) {
    throw new Error(`Instance not found: ${targetName}`);
  }

  const remaining = instances.filter((instance) => instance.name !== targetName);
  for (const mirroredFile of getMirroredInstancesFiles(instancesFile)) {
    writeInstancesFile(mirroredFile, remaining);
  }

  return {
    removed,
    remaining,
    instancesFile,
  };
}

function ensureRuntimeLayout() {
  ensureDir(PATHS.logsDir);
  ensureDir(PATHS.runtimeDir);
}

module.exports = {
  ensureRuntimeLayout,
  findInstance,
  getInstanceStatus,
  getPreferredInstancesFile,
  getRuntimePaths,
  listInstanceStatuses,
  readConfigMetadata,
  readInstances,
  readLogTail,
  removeInstanceRecord,
  summaryFromStatuses,
  writeInstancesFile,
};
