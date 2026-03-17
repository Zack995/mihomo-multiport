const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { runOnInstances, testInstances } = require("../src/lib/runtime");

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
