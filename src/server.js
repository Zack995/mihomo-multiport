const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const { DEFAULTS, PATHS } = require("./lib/constants");
const { readFileIfExists, toProjectRelative, trim } = require("./lib/helpers");
const { importNodes } = require("./lib/importers");
const { ensureRuntimeLayout, listInstanceStatuses, readLogTail, summaryFromStatuses } = require("./lib/instances");
const { ensureMihomoBinAvailable, resolveMihomoBin, runOnInstances, testInstances } = require("./lib/runtime");

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

async function handleApi(request, response, requestUrl) {
  const pathname = requestUrl.pathname;

  if (request.method === "GET" && pathname === "/api/status") {
    const statuses = listInstanceStatuses();
    json(response, 200, {
      ok: true,
      meta: getMeta(statuses),
      instances: statuses,
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
    const stopBeforeImport = Boolean(body.stopBeforeImport);
    const currentStatuses = listInstanceStatuses();
    const runningStatuses = currentStatuses.filter((item) => item.running);

    if (runningStatuses.length > 0 && !stopBeforeImport) {
      json(response, 409, {
        ok: false,
        error: "Current instances are still running. Stop them first or enable stop-before-import.",
      });
      return true;
    }

    if (runningStatuses.length > 0 && stopBeforeImport) {
      await runOnInstances("stop", "", {});
    }

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

      if (requestUrl.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
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

function startServer(options = {}) {
  const host = options.host || process.env.SUB2API_PROXY_HOST || DEFAULTS.serverHost;
  const port = Number(options.port || process.env.SUB2API_PROXY_PORT || DEFAULTS.serverPort);
  const server = createAppServer();

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        host,
        port,
        server,
      });
    });
  });
}

module.exports = {
  createAppServer,
  startServer,
};
