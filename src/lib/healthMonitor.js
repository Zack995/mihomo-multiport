const { listInstanceStatuses } = require("./instances");
const { testInstance } = require("./runtime");
const zzc = require("../clients/zzcClient");

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_GRACE_MS = 30_000;
const MIN_INTERVAL_MS = 30_000;

const STATE_PASS = "pass";
const STATE_FAIL = "fail";

function asBool(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(String(value));
}

function asPositiveInt(value, fallback, min = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) {
    return fallback;
  }
  return num;
}

function buildAlertMessage(failures, totalRunning) {
  const lines = failures.map((failure) => {
    const reason = failure.reason || "unknown";
    const port = failure.proxyUrl || "";
    return `- **${failure.displayName || failure.name}** (${port})\n  原因：${reason}`;
  });
  return [
    `节点健康巡检发现 ${failures.length}/${totalRunning} 个节点异常：`,
    "",
    ...lines,
    "",
    `检测时刻：${new Date().toISOString()}`,
  ].join("\n");
}

function buildRecoveryMessage(recovered) {
  const lines = recovered.map((item) => {
    return `- **${item.displayName || item.name}** (${item.proxyUrl || ""}) 已恢复`;
  });
  return [
    `${recovered.length} 个节点恢复正常：`,
    "",
    ...lines,
    "",
    `检测时刻：${new Date().toISOString()}`,
  ].join("\n");
}

function createHealthMonitor(options = {}) {
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    asPositiveInt(options.intervalMs ?? process.env.NODE_HEALTH_CHECK_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  );
  const graceMs = asPositiveInt(
    options.coldStartGraceMs ?? process.env.NODE_HEALTH_CHECK_COLD_START_GRACE_MS,
    DEFAULT_GRACE_MS,
  );
  const channel = options.channel || process.env.NODE_HEALTH_CHECK_CHANNEL || "alerts";
  const logger = options.logger || console;

  const lastState = new Map();
  const firstRunningSeen = new Map();
  let timer = null;
  let running = false;

  async function safeNotify(payload) {
    if (!zzc.isConfigured()) {
      logger.warn("[health-monitor] zzc client not configured, skipping notify");
      return;
    }
    try {
      await zzc.notify(payload);
    } catch (error) {
      logger.error(`[health-monitor] notify failed: ${error.message}`);
    }
  }

  async function runOnce() {
    if (running) {
      return;
    }
    running = true;
    try {
      const statuses = listInstanceStatuses();
      const runningInstances = statuses.filter((status) => status.running);
      const now = Date.now();

      for (const status of runningInstances) {
        if (!firstRunningSeen.has(status.name)) {
          firstRunningSeen.set(status.name, now);
        }
      }
      for (const name of Array.from(firstRunningSeen.keys())) {
        if (!runningInstances.some((status) => status.name === name)) {
          firstRunningSeen.delete(name);
          lastState.delete(name);
        }
      }

      const eligibleInstances = runningInstances.filter((status) => {
        const seenAt = firstRunningSeen.get(status.name) || now;
        return now - seenAt >= graceMs;
      });

      if (eligibleInstances.length === 0) {
        return;
      }

      const failures = [];
      const recovered = [];

      for (const status of eligibleInstances) {
        let result;
        try {
          result = testInstance(status);
        } catch (error) {
          result = {
            passed: false,
            name: status.name,
            displayName: status.displayName,
            proxyUrl: status.proxyUrl,
            reason: error.message,
          };
        }
        const previous = lastState.get(status.name);
        const current = result.passed ? STATE_PASS : STATE_FAIL;
        lastState.set(status.name, current);

        if (current === STATE_FAIL && previous !== STATE_FAIL) {
          failures.push(result);
        } else if (current === STATE_PASS && previous === STATE_FAIL) {
          recovered.push({
            name: status.name,
            displayName: status.displayName,
            proxyUrl: status.proxyUrl,
          });
        }
      }

      if (failures.length > 0) {
        const totalRunning = eligibleInstances.length;
        const allFailed = failures.length === totalRunning;
        await safeNotify({
          level: allFailed ? "error" : "warn",
          title: allFailed
            ? `[mihomo-multiport] 全部 ${totalRunning} 个运行节点异常`
            : `[mihomo-multiport] ${failures.length}/${totalRunning} 个节点异常`,
          message: buildAlertMessage(failures, totalRunning),
          channel,
          idempotency_key: `node-fail:${failures.map((f) => f.name).sort().join(",")}:${Math.floor(now / 60000)}`,
        });
      }

      if (recovered.length > 0) {
        await safeNotify({
          level: "info",
          title: `[mihomo-multiport] ${recovered.length} 个节点恢复`,
          message: buildRecoveryMessage(recovered),
          channel,
          idempotency_key: `node-recover:${recovered.map((r) => r.name).sort().join(",")}:${Math.floor(now / 60000)}`,
        });
      }
    } catch (error) {
      logger.error(`[health-monitor] tick failed: ${error.message}`);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) {
      return;
    }
    logger.log(`[health-monitor] started: interval=${intervalMs}ms, grace=${graceMs}ms, channel=${channel}`);
    timer = setInterval(() => {
      runOnce().catch((error) => logger.error(`[health-monitor] runOnce: ${error.message}`));
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    runOnce,
    getStateSnapshot() {
      return {
        intervalMs,
        graceMs,
        channel,
        lastState: Object.fromEntries(lastState),
        firstRunningSeen: Object.fromEntries(firstRunningSeen),
      };
    },
  };
}

module.exports = {
  createHealthMonitor,
  asBool,
};
