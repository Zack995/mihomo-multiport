const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { runOnInstances, testInstances } = require("../src/lib/runtime");

function listenOnRandomPort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.listen(0, host);
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("runOnInstances reports missing config as failed without throwing", async () => {
  const tempDir = makeTempDir("mihomo-multiport-runtime-");
  const instancesFile = path.join(tempDir, "instances.json");

  fs.writeFileSync(
    instancesFile,
    JSON.stringify({
      instances: [
        {
          name: "missing-01",
          displayName: "Missing 01",
          configPath: path.join(tempDir, "missing.yaml"),
          localPort: 9301,
          scheme: "http",
        },
      ],
    }),
    "utf8",
  );

  const result = await runOnInstances("start", "", { instancesFile });

  assert.equal(result.summary.failed, 1);
  assert.equal(result.results[0].status, "failed");
  assert.match(result.results[0].message, /Missing config/);
});

test("testInstances reports config or port problems as failures", () => {
  const tempDir = makeTempDir("mihomo-multiport-test-");
  const instancesFile = path.join(tempDir, "instances.json");

  fs.writeFileSync(
    instancesFile,
    JSON.stringify({
      instances: [
        {
          name: "missing-01",
          displayName: "Missing 01",
          configPath: path.join(tempDir, "missing.yaml"),
          localPort: 9401,
          scheme: "http",
        },
        {
          name: "no-port-01",
          displayName: "No Port 01",
          configPath: path.join(tempDir, "no-port.yaml"),
          scheme: "http",
        },
      ],
    }),
    "utf8",
  );

  fs.writeFileSync(path.join(tempDir, "no-port.yaml"), "# Source name: No Port 01\nmode: rule\n", "utf8");

  const result = testInstances("", { instancesFile });

  assert.equal(result.summary.failed, 2);
  assert.equal(result.results.every((item) => item.passed === false), true);
});

test("startInstance remaps to next free port when the target port is occupied", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mihomo-multiport-portskip-"));
  const instancesFile = path.join(tempDir, "instances.json");
  const configPath = path.join(tempDir, "blocked.yaml");
  const runtimeDir = path.join(tempDir, "runtime");
  const logsDir = path.join(tempDir, "logs");

  const { server: blocker, port: blockedPort } = await listenOnRandomPort();
  const fakeMihomoBin = path.join(tempDir, "fake-mihomo");
  fs.writeFileSync(fakeMihomoBin, "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
  process.env.MIHOMO_BIN = fakeMihomoBin;
  process.env.MIHOMO_RUNTIME_DIR = runtimeDir;
  process.env.MIHOMO_LOGS_DIR = logsDir;

  try {
    fs.writeFileSync(
      configPath,
      `# Source name: Blocked\nmixed-port: ${blockedPort}\nmode: rule\n`,
      "utf8",
    );
    fs.writeFileSync(
      instancesFile,
      JSON.stringify({
        instances: [
          {
            name: "blocked-01",
            displayName: "Blocked 01",
            configPath,
            localPort: blockedPort,
            scheme: "http",
          },
        ],
      }),
      "utf8",
    );

    await runOnInstances("start", "", { instancesFile });

    const updated = JSON.parse(fs.readFileSync(instancesFile, "utf8"));
    assert.notEqual(updated.instances[0].localPort, blockedPort);

    const rewritten = fs.readFileSync(configPath, "utf8");
    assert.match(rewritten, new RegExp(`mixed-port: ${updated.instances[0].localPort}`));
    assert.doesNotMatch(rewritten, new RegExp(`mixed-port: ${blockedPort}\\b`));

    assert.ok(fs.existsSync(path.join(runtimeDir, "blocked-01")), "test runtime dir must be inside tempDir");
  } finally {
    blocker.close();
    delete process.env.MIHOMO_BIN;
    delete process.env.MIHOMO_RUNTIME_DIR;
    delete process.env.MIHOMO_LOGS_DIR;
  }
});

test("runOnInstances delete removes an instance from the instances file", async () => {
  const tempDir = makeTempDir("mihomo-multiport-delete-");
  const instancesFile = path.join(tempDir, "instances.json");
  const configPath = path.join(tempDir, "manual.yaml");

  fs.writeFileSync(configPath, "# Source name: Manual 01\nmixed-port: 9501\nmode: rule\n", "utf8");
  fs.writeFileSync(
    instancesFile,
    JSON.stringify({
      instances: [
        {
          name: "manual-01",
          displayName: "Manual 01",
          configPath,
          localPort: 9501,
          scheme: "http",
        },
      ],
    }),
    "utf8",
  );

  const result = await runOnInstances("delete", "manual-01", { instancesFile });
  const updated = JSON.parse(fs.readFileSync(instancesFile, "utf8"));

  assert.equal(result.summary.deleted, 1);
  assert.equal(result.results[0].status, "deleted");
  assert.equal(updated.instances.length, 0);
  assert.equal(fs.existsSync(configPath), true);
});
