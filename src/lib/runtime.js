const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const { DEFAULTS, PATHS } = require("./constants");
const {
  ensureDir,
  isPortFree,
  isProcessRunning,
  parseJson,
  readFileIfExists,
  resolveProjectPath,
  sleep,
  trim,
} = require("./helpers");
const {
  findInstance,
  getInstanceStatus,
  getPreferredInstancesFile,
  getRuntimePaths,
  removeInstanceRecord,
  readInstances,
} = require("./instances");

function resolveMihomoBin() {
  if (process.env.MIHOMO_BIN) {
    return process.env.MIHOMO_BIN;
  }

  const arch = process.arch === "x64" ? "x86_64" : process.arch;
  const localBinary = path.join(PATHS.binDir, `mihomo-${arch}`);
  const legacyLocalBinary = path.join(PATHS.binDir, "mihomo");

  if (fs.existsSync(localBinary)) {
    return localBinary;
  }
  if (fs.existsSync(legacyLocalBinary)) {
    return legacyLocalBinary;
  }
  return "mihomo";
}

function ensureMihomoBinAvailable() {
  const mihomoBin = resolveMihomoBin();
  if (mihomoBin.includes(path.sep)) {
    if (!fs.existsSync(mihomoBin)) {
      throw new Error(`mihomo binary not found: ${mihomoBin}`);
    }
    return mihomoBin;
  }

  const result = spawnSync("which", [mihomoBin], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`mihomo binary not found: ${mihomoBin}`);
  }
  return mihomoBin;
}

const PORT_REMAP_RANGE = 200;

function rewriteConfigMixedPort(configAbs, newPort) {
  const content = readFileIfExists(configAbs);
  if (!content) {
    return false;
  }
  const patterns = [/^mixed-port:\s*\d+/m, /^port:\s*\d+/m, /^socks-port:\s*\d+/m];
  const labels = ["mixed-port", "port", "socks-port"];
  for (let index = 0; index < patterns.length; index += 1) {
    if (patterns[index].test(content)) {
      const replaced = content.replace(patterns[index], `${labels[index]}: ${newPort}`);
      fs.writeFileSync(configAbs, replaced, "utf8");
      return true;
    }
  }
  return false;
}

function updateManifestPort(name, newPort, instancesFilePath) {
  if (!instancesFilePath) {
    return;
  }
  const abs = resolveProjectPath(instancesFilePath);
  if (path.extname(abs) !== ".json" || !fs.existsSync(abs)) {
    return;
  }
  const parsed = parseJson(readFileIfExists(abs), null);
  if (!parsed || !Array.isArray(parsed.instances)) {
    return;
  }
  let changed = false;
  for (const item of parsed.instances) {
    if (item.name === name && Number(item.localPort) !== newPort) {
      item.localPort = newPort;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(abs, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }
}

async function resolveStartPort(instance, options = {}) {
  const desiredPort = Number(instance.localPort);
  if (!Number.isInteger(desiredPort) || desiredPort <= 0) {
    return { ok: false, message: `Missing local port for ${instance.name}` };
  }

  const reservedPorts = options.reservedPorts || new Set();

  const isReservedBySibling = (port) => port !== desiredPort && reservedPorts.has(port);

  if (!isReservedBySibling(desiredPort) && (await isPortFree(desiredPort))) {
    return { ok: true, instance, remapped: false };
  }

  const ceiling = desiredPort + PORT_REMAP_RANGE;
  for (let candidate = desiredPort + 1; candidate < ceiling; candidate += 1) {
    if (reservedPorts.has(candidate)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (!(await isPortFree(candidate))) {
      continue;
    }

    const rewritten = rewriteConfigMixedPort(instance.configAbs, candidate);
    if (!rewritten) {
      return {
        ok: false,
        message: `Cannot rewrite mixed-port in ${instance.configAbs}`,
      };
    }
    updateManifestPort(instance.name, candidate, options.instancesFile);

    return {
      ok: true,
      instance: { ...instance, localPort: candidate },
      remapped: true,
      previousPort: desiredPort,
    };
  }

  return {
    ok: false,
    message: `No free port for ${instance.name} in [${desiredPort}, ${ceiling})`,
  };
}

function operationResult(instance, status, message, extra = {}) {
  return {
    name: instance?.name || extra.name || "",
    status,
    message,
    instance: instance ? getInstanceStatus(instance) : extra.instance || null,
    ...extra,
  };
}

function summarizeOperationResults(results) {
  const summary = {
    total: results.length,
    started: 0,
    stopped: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    passed: 0,
  };

  for (const result of results) {
    if (result.status === "started") {
      summary.started += 1;
    } else if (result.status === "stopped") {
      summary.stopped += 1;
    } else if (result.status === "deleted") {
      summary.deleted += 1;
    } else if (result.status === "skipped") {
      summary.skipped += 1;
    } else if (result.status === "failed") {
      summary.failed += 1;
    }

    if (result.passed === true) {
      summary.passed += 1;
    }
  }

  return summary;
}

function spawnDetached(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let settled = false;

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    child.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(child);
    });
  });
}

function isGeneratedConfig(instance) {
  const relativePath = path.relative(PATHS.generatedConfigDir, instance.configAbs);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function cleanupInstanceArtifacts(instance) {
  const runtime = getRuntimePaths(instance.name);
  const deleted = {
    deletedLog: false,
    deletedRuntime: false,
    deletedConfig: false,
  };

  if (fs.existsSync(runtime.logFile)) {
    fs.rmSync(runtime.logFile, { force: true });
    deleted.deletedLog = true;
  }

  if (fs.existsSync(runtime.workdir)) {
    fs.rmSync(runtime.workdir, { recursive: true, force: true });
    deleted.deletedRuntime = true;
  }

  if (isGeneratedConfig(instance) && fs.existsSync(instance.configAbs)) {
    fs.rmSync(instance.configAbs, { force: true });
    deleted.deletedConfig = true;
  }

  return deleted;
}

async function startInstance(instance, options = {}) {
  const mihomoBin = ensureMihomoBinAvailable();
  const startDelayMs = Math.max(
    0,
    Number(options.startDelayMs ?? process.env.START_DELAY_MS ?? DEFAULTS.startDelayMs),
  );
  const runtime = getRuntimePaths(instance.name);

  if (!fs.existsSync(instance.configAbs)) {
    return operationResult(
      instance,
      "failed",
      `Missing config for ${instance.name}: ${instance.configAbs}`,
    );
  }

  const existingPid = Number(trim(readFileIfExists(runtime.pidFile))) || null;
  if (isProcessRunning(existingPid)) {
    return operationResult(instance, "skipped", `${instance.name} is already running`);
  }

  const portResult = await resolveStartPort(instance, options);
  if (!portResult.ok) {
    return operationResult(instance, "failed", portResult.message);
  }
  const finalInstance = portResult.instance;
  if (portResult.remapped && options.reservedPorts) {
    options.reservedPorts.delete(portResult.previousPort);
    options.reservedPorts.add(finalInstance.localPort);
  }

  ensureDir(runtime.workdir);
  ensureDir(path.dirname(runtime.logFile));

  const logFd = fs.openSync(runtime.logFile, "a");
  let child;
  try {
    child = await spawnDetached(mihomoBin, ["-d", runtime.workdir, "-f", finalInstance.configAbs], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } catch (error) {
    fs.closeSync(logFd);
    return operationResult(finalInstance, "failed", error.message);
  }
  fs.closeSync(logFd);

  fs.writeFileSync(runtime.pidFile, `${child.pid}\n`, "utf8");
  await sleep(startDelayMs);

  if (!isProcessRunning(child.pid)) {
    return operationResult(
      finalInstance,
      "failed",
      `${finalInstance.name} failed to start. Check ${runtime.logFile}`,
    );
  }

  const message = portResult.remapped
    ? `${finalInstance.name} started (port ${portResult.previousPort} busy, remapped to ${finalInstance.localPort})`
    : `${finalInstance.name} started`;
  return operationResult(finalInstance, "started", message, { remapped: portResult.remapped });
}

async function stopInstance(instance, options = {}) {
  const stopWaitSeconds = Math.max(
    0,
    Number(options.stopWaitSeconds ?? process.env.STOP_WAIT_SECONDS ?? DEFAULTS.stopWaitSeconds),
  );
  const runtime = getRuntimePaths(instance.name);
  const pid = Number(trim(readFileIfExists(runtime.pidFile))) || null;

  if (!pid) {
    return operationResult(instance, "skipped", `${instance.name} has no pid file`);
  }

  if (!isProcessRunning(pid)) {
    fs.rmSync(runtime.pidFile, { force: true });
    return operationResult(instance, "skipped", `${instance.name} is not running`);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    fs.rmSync(runtime.pidFile, { force: true });
    return operationResult(instance, "failed", error.message);
  }

  for (let waited = 0; waited < stopWaitSeconds; waited += 1) {
    if (!isProcessRunning(pid)) {
      fs.rmSync(runtime.pidFile, { force: true });
      return operationResult(instance, "stopped", `${instance.name} stopped`);
    }
    await sleep(1000);
  }

  if (isProcessRunning(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      fs.rmSync(runtime.pidFile, { force: true });
      return operationResult(instance, "failed", error.message);
    }
    await sleep(150);
  }

  fs.rmSync(runtime.pidFile, { force: true });

  return operationResult(instance, "stopped", `${instance.name} stopped`);
}

async function deleteInstance(instance, options = {}) {
  const stopResult = await stopInstance(instance, options);
  if (stopResult.status === "failed") {
    return operationResult(instance, "failed", stopResult.message);
  }

  removeInstanceRecord(instance.name, options.instancesFile);
  const cleanup = cleanupInstanceArtifacts(instance);

  return operationResult(
    instance,
    "deleted",
    `${instance.name} deleted`,
    cleanup,
  );
}

async function runOnInstances(action, name, options = {}) {
  const instancesFile = getPreferredInstancesFile(options.instancesFile);
  const allInstances = readInstances(instancesFile);
  const instances = name
    ? [allInstances.find((item) => item.name === trim(name)) || findInstance(name, instancesFile)]
    : allInstances;
  const results = [];

  const reservedPorts = action === "start"
    ? new Set(
        allInstances
          .map((item) => Number(item.localPort))
          .filter((port) => Number.isInteger(port) && port > 0),
      )
    : null;

  const startOptions = action === "start"
    ? { ...options, instancesFile, reservedPorts }
    : { ...options, instancesFile };

  for (const instance of instances) {
    try {
      if (action === "start") {
        results.push(await startInstance(instance, startOptions));
        continue;
      }
      if (action === "stop") {
        results.push(await stopInstance(instance, options));
        continue;
      }
      if (action === "delete") {
        results.push(await deleteInstance(instance, { ...options, instancesFile }));
        continue;
      }
    } catch (error) {
      results.push(operationResult(instance, "failed", error.message));
      continue;
    }
    throw new Error(`Unsupported action: ${action}`);
  }

  return {
    instancesFile,
    summary: summarizeOperationResults(results),
    results,
  };
}

function parseTraceOutput(traceOutput) {
  const entries = {};
  for (const line of String(traceOutput).split(/\r?\n/)) {
    const [key, value] = line.split("=");
    if (key && value !== undefined) {
      entries[key] = value;
    }
  }
  return entries;
}

function testInstance(instance, options = {}) {
  const traceUrl = options.traceUrl || process.env.TRACE_URL || DEFAULTS.traceUrl;
  const timeoutSeconds = Number(
    options.timeoutSeconds ?? process.env.TIMEOUT_SECONDS ?? DEFAULTS.timeoutSeconds,
  );
  const localProxyHost = options.localProxyHost || process.env.LOCAL_PROXY_HOST || DEFAULTS.localProxyHost;
  const status = getInstanceStatus(instance);

  if (!status.configExists) {
    return {
      passed: false,
      name: instance.name,
      displayName: status.displayName,
      proxyUrl: status.proxyUrl,
      reason: `Missing config: ${instance.configAbs}`,
    };
  }

  if (!status.localPort) {
    return {
      passed: false,
      name: instance.name,
      displayName: status.displayName,
      proxyUrl: status.proxyUrl,
      reason: `Missing local port for ${instance.name}`,
    };
  }

  const proxyUrl = `${status.scheme}://${localProxyHost}:${status.localPort}`;
  const curlResult = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--proxy",
      proxyUrl,
      "--connect-timeout",
      String(timeoutSeconds),
      "--max-time",
      String(timeoutSeconds),
      traceUrl,
    ],
    {
      encoding: "utf8",
    },
  );

  if (curlResult.status !== 0) {
    return {
      passed: false,
      name: instance.name,
      proxyUrl,
      reason: trim(curlResult.stderr) || "Proxy request failed",
    };
  }

  const trace = parseTraceOutput(curlResult.stdout);
  const actualIp = trim(trace.ip);
  const actualLoc = trim(trace.loc);
  const reasons = [];

  if (!actualIp || !actualLoc) {
    return {
      passed: false,
      name: instance.name,
      proxyUrl,
      reason: "Could not parse Cloudflare trace output.",
    };
  }

  if (status.expectedLoc && actualLoc !== status.expectedLoc) {
    reasons.push(`loc=${actualLoc}, expected=${status.expectedLoc}`);
  }

  if (status.expectedIp && actualIp !== status.expectedIp) {
    reasons.push(`ip=${actualIp}, expected=${status.expectedIp}`);
  }

  return {
    passed: reasons.length === 0,
    name: instance.name,
    displayName: status.displayName,
    proxyUrl,
    actualIp,
    actualLoc,
    expectedLoc: status.expectedLoc,
    expectedIp: status.expectedIp,
    reason: reasons.join("; "),
  };
}

function testInstances(name, options = {}) {
  const instancesFile = getPreferredInstancesFile(options.instancesFile);
  const instances = name ? [findInstance(name, instancesFile)] : readInstances(instancesFile);
  const results = [];

  for (const instance of instances) {
    try {
      results.push(testInstance(instance, options));
    } catch (error) {
      const status = getInstanceStatus(instance);
      results.push({
        passed: false,
        name: instance.name,
        displayName: status.displayName,
        proxyUrl: status.proxyUrl,
        reason: error.message,
      });
    }
  }

  return {
    instancesFile,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed).length,
    },
    results,
  };
}

module.exports = {
  ensureMihomoBinAvailable,
  operationResult,
  resolveMihomoBin,
  runOnInstances,
  deleteInstance,
  startInstance,
  stopInstance,
  summarizeOperationResults,
  testInstance,
  testInstances,
};
