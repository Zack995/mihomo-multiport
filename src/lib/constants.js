const path = require("path");

const BASE_DIR = path.resolve(__dirname, "..", "..");

const PATHS = {
  baseDir: BASE_DIR,
  defaultInputFile: path.join(BASE_DIR, "nodes-inline.txt"),
  defaultInstancesCsv: path.join(BASE_DIR, "instances.csv"),
  generatedInstancesCsv: path.join(BASE_DIR, "instances.generated.csv"),
  generatedInstancesJson: path.join(BASE_DIR, "instances.generated.json"),
  configsDir: path.join(BASE_DIR, "configs"),
  generatedConfigDir: path.join(BASE_DIR, "configs", "generated"),
  logsDir: path.join(BASE_DIR, "logs"),
  runtimeDir: path.join(BASE_DIR, "runtime"),
  binDir: path.join(BASE_DIR, "bin"),
  publicDir: path.join(BASE_DIR, "public"),
};

const DEFAULTS = {
  basePort: 7891,
  startDelayMs: 1000,
  stopWaitSeconds: 3,
  traceUrl: "https://www.cloudflare.com/cdn-cgi/trace",
  timeoutSeconds: 12,
  localProxyHost: "127.0.0.1",
  serverHost: "127.0.0.1",
  serverPort: 8799,
  logTailLines: 40,
};

const LOCATION_MAP = {
  AUS: "AU",
  CAN: "CA",
  DEU: "DE",
  FRA: "FR",
  GBR: "GB",
  HKG: "HK",
  IND: "IN",
  JPN: "JP",
  KOR: "KR",
  SGP: "SG",
  TWN: "TW",
  USA: "US",
};

module.exports = {
  BASE_DIR,
  DEFAULTS,
  LOCATION_MAP,
  PATHS,
};
