const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const { DEFAULTS, PATHS } = require("./lib/constants");
const { readFileIfExists, toProjectRelative, trim } = require("./lib/helpers");
const { importNodes } = require("./lib/importers");
const { ensureRuntimeLayout, listInstanceStatuses, readLogTail, summaryFromStatuses } = require("./lib/instances");
const { ensureMihomoBinAvailable, resolveMihomoBin, runOnInstances, testInstances } = require("./lib/runtime");
const { createHealthMonitor, asBool } = require("./lib/healthMonitor");
const zzc = require("./clients/zzcClient");

const SERVER_START_TIME = Date.now();

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendFile(response, filePath, contentType) {
  try {
    const buffer = fs.readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    response.end(buffer);
  } catch (_error) {
    response.writeHead(404);
    response.end("Not found");
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function getMeta(statuses) {
  let mihomoReady = true;
  let mihomoError = "";
  let mihomoBin = resolveMihomoBin();

  try {
    mihomoBin = ensureMihomoBinAvailable();
  } catch (error) {
    mihomoReady = false;
    mihomoError = error.message;
  }

  return {
    summary: summaryFromStatuses(statuses),
    mihomo: {
      path: mihomoBin.includes(path.sep) ? toProjectRelative(mihomoBin) : mihomoBin,
      ready: mihomoReady,
      error: mihomoError,
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildHealthResponse() {
  let mihomoOk = true;
  let mihomoDetail;
  try {
    ensureMihomoBinAvailable();
  } catch (error) {
    mihomoOk = false;
    mihomoDetail = error.message;
  }

  const checks = {
    mihomo_bin: mihomoDetail ? { ok: mihomoOk, detail: mihomoDetail } : { ok: mihomoOk },
  };

  const allOk = Object.values(checks).every((check) => check.ok);
  return {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || "dev",
    uptime_seconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    checks,
  };
}

function buildNodesResponse() {
  const statuses = listInstanceStatuses();
  return {
    generatedAt: new Date().toISOString(),
    total: statuses.length,
    running: statuses.filter((status) => status.running).length,
    nodes: statuses.map((status) => ({
      name: status.name,
      displayName: status.displayName || null,
      scheme: status.scheme || "http",
      port: status.localPort || null,
      proxyUrl: status.proxyUrl || null,
      dockerProxyUrl: status.dockerProxyUrl || null,
      running: Boolean(status.running),
      pid: status.pid || null,
      configPath: status.configPath || null,
      expectedLoc: status.expectedLoc || null,
      expectedIp: status.expectedIp || null,
    })),
  };
}

function buildConfigExportPayload(statuses = listInstanceStatuses()) {
  const generatedAt = new Date().toISOString();
  const exportedItems = [];
  const skippedItems = [];

  for (const status of statuses) {
    if (!status.configExists) {
      skippedItems.push({
        name: status.name,
        displayName: status.displayName || status.name,
        configPath: status.configPath || null,
        reason: "Config file missing.",
      });
      continue;
    }

    const configText = readFileIfExists(status.configAbs).trim();
    if (!configText) {
      skippedItems.push({
        name: status.name,
        displayName: status.displayName || status.name,
        configPath: status.configPath || null,
        reason: "Config file empty.",
      });
      continue;
    }

    exportedItems.push({
      name: status.name,
      displayName: status.displayName || status.name,
      configPath: status.configPath || null,
      content: configText,
    });
  }

  const bundle = exportedItems.length === 0
    ? ""
    : [
        "# Exported by mihomo-multiport",
        `# Generated at: ${generatedAt}`,
        "# Each YAML document below is one reusable instance config.",
        "",
        exportedItems
          .map((item) =>
            [
              "---",
              `# Instance: ${item.name}`,
              item.displayName && item.displayName !== item.name ? `# Display Name: ${item.displayName}` : "",
              item.configPath ? `# Config Path: ${item.configPath}` : "",
              item.content,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n"),
      ].join("\n");

  return {
    generatedAt,
    total: statuses.length,
    exported: exportedItems.length,
    skipped: skippedItems.length,
    items: exportedItems.map(({ content, ...item }) => item),
    skippedItems,
    content: bundle ? `${bundle}\n` : "",
  };
}

const API_DOCS = {
  service: "mihomo-multiport",
  description:
    "导入订阅节点为多端口本地代理（每节点一端口）+ /health + 节点列表查询 + 定时巡检告警",
  endpoints: [
    {
      method: "GET",
      path: "/health",
      auth: "none",
      description:
        "zzc_center 健康巡检合约：返回 { status, timestamp, version, uptime_seconds, checks }。状态为 ok / degraded / down。",
    },
    {
      method: "GET",
      path: "/api/nodes",
      auth: "none",
      description: "返回当前所有节点的名称、端口、运行状态、proxyUrl、dockerProxyUrl 等。",
      example_response: {
        generatedAt: "2026-04-28T01:00:00.000Z",
        total: 3,
        running: 2,
        nodes: [
          {
            name: "sgp-01",
            scheme: "http",
            port: 7891,
            proxyUrl: "http://127.0.0.1:7891",
            dockerProxyUrl: "http://host.docker.internal:7891",
            running: true,
          },
        ],
      },
    },
    {
      method: "GET",
      path: "/api/status",
      auth: "none",
      description: "控制台用的完整状态（含 meta + summary + 全字段实例信息）。",
    },
    {
      method: "GET",
      path: "/api/configs/export",
      auth: "none",
      description: "导出当前全部实例配置，按 YAML 多文档格式聚合，便于跨实例或其他环境复用。",
    },
    {
      method: "GET",
      path: "/api/logs?name=<instance>",
      auth: "none",
      description: "查看指定实例最近若干行日志。",
    },
    { method: "POST", path: "/api/import", auth: "none", description: "粘贴 YAML/JSON/inline 文本导入节点。" },
    { method: "POST", path: "/api/start", auth: "none", description: "启动单个或全部实例。" },
    { method: "POST", path: "/api/stop", auth: "none", description: "停止单个或全部实例。" },
    { method: "POST", path: "/api/test", auth: "none", description: "走代理打 Cloudflare trace，校验 IP / 地区。" },
    { method: "POST", path: "/api/delete", auth: "none", description: "删除实例（含配置、日志、运行目录）。" },
  ],
  zzc_center: {
    integrated: true,
    notes: [
      "本服务运行时已注册到 zzc_center；zzc_center 每 30 秒巡 /health。",
      "另启动一条 5 分钟周期的节点巡检（仅 running 实例），状态变化时通过 zzc_center 走钉钉告警。",
    ],
  },
};

async function handleApi(request, response, requestUrl) {
  const pathname = requestUrl.pathname;

  if (request.method === "GET" && pathname === "/api/nodes") {
    json(response, 200, buildNodesResponse());
    return true;
  }

  if (request.method === "GET" && pathname === "/api/docs") {
    json(response, 200, API_DOCS);
    return true;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      meta: getMeta(statuses),
      instances: statuses,
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/configs/export") {
    json(response, 200, {
      ok: true,
      ...buildConfigExportPayload(),
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/logs") {
    const name = trim(requestUrl.searchParams.get("name"));
    if (!name) {
      json(response, 400, { ok: false, error: "Missing query parameter: name" });
      return true;
    }

    const lineCount = Number(requestUrl.searchParams.get("lines")) || DEFAULTS.logTailLines;
    json(response, 200, {
      ok: true,
      log: readLogTail(name, lineCount),
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/import") {
    const body = await parseBody(request);

    const importResult = importNodes({
      text: String(body.text ?? ""),
      basePort: Number(body.basePort) || DEFAULTS.basePort,
      format: body.format || "auto",
    });

    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      import: {
        count: importResult.count,
        format: importResult.format,
        outputDir: toProjectRelative(importResult.outputDir),
        instancesFile: toProjectRelative(importResult.instancesFile),
        manifestFile: toProjectRelative(importResult.manifestFile),
        added: (importResult.added || []).map((item) => ({
          name: item.name,
          displayName: item.displayName,
          localPort: item.localPort,
        })),
      },
      meta: getMeta(statuses),
      instances: statuses,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/start") {
    const body = await parseBody(request);
    const result = await runOnInstances("start", trim(body.name), {});
    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      result,
      meta: getMeta(statuses),
      instances: statuses,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/stop") {
    const body = await parseBody(request);
    const result = await runOnInstances("stop", trim(body.name), {});
    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      result,
      meta: getMeta(statuses),
      instances: statuses,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/delete") {
    const body = await parseBody(request);
    const name = trim(body.name);
    if (!name) {
      json(response, 400, { ok: false, error: "Missing instance name." });
      return true;
    }

    const result = await runOnInstances("delete", name, {});
    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      result,
      meta: getMeta(statuses),
      instances: statuses,
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/test") {
    const body = await parseBody(request);
    const result = testInstances(trim(body.name), {});
    json(response, 200, {
      ok: true,
      result,
    });
    return true;
  }

  return false;
}

function createAppServer() {
  ensureRuntimeLayout();

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");

      if (requestUrl.pathname === "/health") {
        json(response, 200, buildHealthResponse());
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        const handled = await handleApi(request, response, requestUrl);
        if (!handled) {
          json(response, 404, { ok: false, error: "API route not found." });
        }
        return;
      }

      if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
        sendFile(response, path.join(PATHS.publicDir, "index.html"), "text/html; charset=utf-8");
        return;
      }

      if (requestUrl.pathname === "/app.js") {
        sendFile(response, path.join(PATHS.publicDir, "app.js"), "application/javascript; charset=utf-8");
        return;
      }

      if (requestUrl.pathname === "/styles.css") {
        sendFile(response, path.join(PATHS.publicDir, "styles.css"), "text/css; charset=utf-8");
        return;
      }

      if (requestUrl.pathname === "/favicon.svg") {
        sendFile(response, path.join(PATHS.publicDir, "favicon.svg"), "image/svg+xml");
        return;
      }

      if (requestUrl.pathname === "/favicon.ico") {
        sendFile(response, path.join(PATHS.publicDir, "favicon.svg"), "image/svg+xml");
        return;
      }

      response.writeHead(404);
      response.end(readFileIfExists(path.join(PATHS.publicDir, "404.txt")) || "Not found");
    } catch (error) {
      json(response, 500, {
        ok: false,
        error: error.message,
      });
    }
  });
}

function loadDotEnvLocal() {
  const envFile = path.join(PATHS.baseDir, ".env.local");
  if (!fs.existsSync(envFile)) {
    return;
  }
  const content = fs.readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

async function bootstrapZzcIntegration() {
  if (!zzc.isConfigured()) {
    console.warn("[zzc] not configured (ZZC_BASE_URL / ZZC_API_KEY missing); skipping ensureChannels");
    return;
  }
  try {
    const result = await zzc.ensureChannels([
      { name: "alerts", clone_from: "default" },
    ]);
    if (result.created.length > 0) {
      console.log(`[zzc] channels created: ${result.created.join(", ")}`);
    }
    if (result.skipped.length > 0) {
      console.log(`[zzc] channels already exist: ${result.skipped.join(", ")}`);
    }

    const channels = await zzc.listChannels();
    const alertsChannel = channels.find((c) => c.name === "alerts");
    if (alertsChannel) {
      const currentMobiles = Array.isArray(alertsChannel.config?.at_mobiles)
        ? alertsChannel.config.at_mobiles
        : [];
      const currentUserIds = Array.isArray(alertsChannel.config?.at_user_ids)
        ? alertsChannel.config.at_user_ids
        : [];
      if (currentMobiles.length > 0 || currentUserIds.length > 0) {
        await zzc.updateChannel(alertsChannel.id, {
          config: { ...(alertsChannel.config || {}), at_mobiles: [], at_user_ids: [] },
        });
        console.log(
          `[zzc] alerts channel: cleared @ mentions (was mobiles=[${currentMobiles.join(",")}] user_ids=[${currentUserIds.join(",")}])`,
        );
      }
    }
  } catch (error) {
    console.error(`[zzc] ensureChannels failed: ${error.message}`);
  }
}

function startNodeHealthMonitor() {
  if (!asBool(process.env.NODE_HEALTH_CHECK_ENABLED, true)) {
    console.log("[health-monitor] disabled via NODE_HEALTH_CHECK_ENABLED=false");
    return null;
  }
  const monitor = createHealthMonitor();
  monitor.start();
  return monitor;
}

async function startServer(options = {}) {
  loadDotEnvLocal();

  const host = options.host || process.env.SUB2API_PROXY_HOST || DEFAULTS.serverHost;
  const port = Number(options.port || process.env.SUB2API_PROXY_PORT || DEFAULTS.serverPort);
  const server = createAppServer();

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  bootstrapZzcIntegration().catch((error) => {
    console.error(`[zzc] bootstrap error: ${error.message}`);
  });
  const monitor = startNodeHealthMonitor();

  return { host, port, server, monitor };
}

module.exports = {
  buildConfigExportPayload,
  createAppServer,
  startServer,
  loadDotEnvLocal,
};
