const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfigContent, importNodes } = require("../src/lib/importers");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("importNodes imports inline nodes and writes csv/json manifests", () => {
  const tempDir = makeTempDir("mihomo-multiport-inline-");
  const outputDir = path.join(tempDir, "configs");
  const instancesFile = path.join(tempDir, "instances.csv");
  const manifestFile = path.join(tempDir, "instances.json");

  const result = importNodes({
    text: [
      "- {name: JPN 01, server: example.com, port: 20201, type: ss, cipher: aes-128-gcm, password: secret}",
      "- {name: USA 01, server: example.com, port: 20202, type: ss, cipher: aes-128-gcm, password: secret}",
    ].join("\n"),
    basePort: 9001,
    outputDir,
    instancesFile,
    manifestFile,
  });

  assert.equal(result.count, 2);
  assert.equal(result.format, "inline");
  assert.ok(fs.existsSync(path.join(outputDir, "jpn-01.yaml")));
  assert.ok(fs.readFileSync(instancesFile, "utf8").includes("jpn-01"));

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.equal(manifest.instances[0].localPort, 9001);
  assert.equal(manifest.instances[1].expectedLoc, "US");
});

test("importNodes imports yaml proxies and preserves display names", () => {
  const tempDir = makeTempDir("mihomo-multiport-yaml-");
  const outputDir = path.join(tempDir, "configs");
  const instancesFile = path.join(tempDir, "instances.csv");
  const manifestFile = path.join(tempDir, "instances.json");

  const result = importNodes({
    text: [
      "proxies:",
      "  - name: \"SGP 01\"",
      "    type: ss",
      "    server: example.org",
      "    port: 30401",
      "    cipher: aes-128-gcm",
      "    password: secret",
    ].join("\n"),
    format: "yaml",
    outputDir,
    instancesFile,
    manifestFile,
  });

  assert.equal(result.count, 1);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.equal(manifest.instances[0].displayName, "SGP 01");
  assert.equal(manifest.instances[0].expectedLoc, "SG");
});

test("importNodes is additive: existing instances and ports are preserved across imports", () => {
  const tempDir = makeTempDir("mihomo-multiport-additive-");
  const outputDir = path.join(tempDir, "configs");
  const instancesFile = path.join(tempDir, "instances.csv");
  const manifestFile = path.join(tempDir, "instances.json");

  importNodes({
    text: [
      "- {name: JPN 01, server: example.com, port: 20201, type: ss, cipher: aes-128-gcm, password: secret}",
      "- {name: JPN 02, server: example.com, port: 20202, type: ss, cipher: aes-128-gcm, password: secret}",
    ].join("\n"),
    basePort: 9001,
    outputDir,
    instancesFile,
    manifestFile,
  });

  const second = importNodes({
    text: "- {name: USA 01, server: example.com, port: 30501, type: ss, cipher: aes-128-gcm, password: secret}",
    basePort: 9001,
    outputDir,
    instancesFile,
    manifestFile,
  });

  assert.equal(second.count, 1);
  assert.equal(second.instances.length, 3);
  assert.deepEqual(
    second.instances.map((item) => item.name),
    ["jpn-01", "jpn-02", "usa-01"],
  );
  assert.deepEqual(
    second.instances.map((item) => item.localPort),
    [9001, 9002, 9003],
  );
  assert.ok(fs.existsSync(path.join(outputDir, "jpn-01.yaml")));
  assert.ok(fs.existsSync(path.join(outputDir, "usa-01.yaml")));
});

test("importNodes auto-detects and merges multiple sections in one import", () => {
  const tempDir = makeTempDir("mihomo-multiport-mixed-");
  const outputDir = path.join(tempDir, "configs");
  const instancesFile = path.join(tempDir, "instances.csv");
  const manifestFile = path.join(tempDir, "instances.json");

  const result = importNodes({
    text: [
      "proxies:",
      "  - name: \"SGP 01\"",
      "    type: ss",
      "    server: example.org",
      "    port: 30401",
      "    cipher: aes-128-gcm",
      "    password: secret",
      "---",
      "- {name: USA 01, server: example.com, port: 20251, type: ss, cipher: aes-128-gcm, password: secret}",
    ].join("\n"),
    outputDir,
    instancesFile,
    manifestFile,
  });

  assert.equal(result.count, 2);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.deepEqual(
    manifest.instances.map((item) => item.displayName),
    ["SGP 01", "USA 01"],
  );
});

test("importNodes re-imports exported managed configs and preserves display names", () => {
  const tempDir = makeTempDir("mihomo-multiport-managed-");
  const outputDir = path.join(tempDir, "configs");
  const instancesFile = path.join(tempDir, "instances.csv");
  const manifestFile = path.join(tempDir, "instances.json");

  const exportedText = [
    "# Exported by mihomo-multiport",
    "# Generated at: 2026-05-10T06:00:00.000Z",
    "# Each YAML document below is one reusable instance config.",
    "",
    "---",
    "# Instance: jpn-01",
    "# Display Name: JPN 01",
    "# Config Path: configs/generated/jpn-01.yaml",
    createConfigContent(
      {
        name: "JPN 01",
        format: "yaml-inline",
        proxy: {
          name: "jpn_01",
          type: "ss",
          server: "example.com",
          port: 20201,
          cipher: "aes-128-gcm",
          password: "secret",
        },
      },
      7891,
      "jpn_01",
    ).trim(),
    "",
    "---",
    "# Instance: usa-01",
    "# Display Name: USA 01",
    "# Config Path: configs/generated/usa-01.yaml",
    createConfigContent(
      {
        name: "USA 01",
        format: "yaml-inline",
        proxy: {
          name: "usa_01",
          type: "ss",
          server: "example.net",
          port: 20202,
          cipher: "aes-128-gcm",
          password: "secret",
        },
      },
      7892,
      "usa_01",
    ).trim(),
    "",
  ].join("\n");

  const result = importNodes({
    text: exportedText,
    outputDir,
    instancesFile,
    manifestFile,
  });

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.added.map((item) => item.displayName),
    ["JPN 01", "USA 01"],
  );
  assert.deepEqual(
    result.added.map((item) => item.expectedLoc),
    ["JP", "US"],
  );
});
