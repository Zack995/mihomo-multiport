const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { importNodes } = require("../src/lib/importers");

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
