const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildConfigExportPayload } = require("../src/server");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("buildConfigExportPayload exports reusable YAML docs for all existing configs", () => {
  const tempDir = makeTempDir("mihomo-multiport-server-");
  const configPath = path.join(tempDir, "alpha-01.yaml");

  fs.writeFileSync(
    configPath,
    [
      "# Source name: Alpha 01",
      "mixed-port: 9901",
      "mode: rule",
      "proxies:",
      "  - name: \"Alpha 01\"",
      "    type: ss",
      "    server: example.com",
    ].join("\n"),
    "utf8",
  );

  const payload = buildConfigExportPayload([
    {
      name: "alpha-01",
      displayName: "Alpha 01",
      configPath: "configs/generated/alpha-01.yaml",
      configAbs: configPath,
      configExists: true,
    },
    {
      name: "missing-01",
      displayName: "Missing 01",
      configPath: "configs/generated/missing-01.yaml",
      configAbs: path.join(tempDir, "missing-01.yaml"),
      configExists: false,
    },
  ]);

  assert.equal(payload.total, 2);
  assert.equal(payload.exported, 1);
  assert.equal(payload.skipped, 1);
  assert.match(payload.content, /# Exported by mihomo-multiport/);
  assert.match(payload.content, /# Instance: alpha-01/);
  assert.match(payload.content, /# Display Name: Alpha 01/);
  assert.match(payload.content, /mixed-port: 9901/);
  assert.equal(payload.items[0].configPath, "configs/generated/alpha-01.yaml");
  assert.equal(payload.skippedItems[0].name, "missing-01");
});
