#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { DEFAULTS, PATHS } = require("./lib/constants");
const { trim, toProjectRelative } = require("./lib/helpers");
const { importNodes } = require("./lib/importers");
const { listInstanceStatuses, summaryFromStatuses } = require("./lib/instances");
const { runOnInstances, testInstances } = require("./lib/runtime");
const { startServer } = require("./server");

function printUsage() {
  console.log(`Usage:
  node ./src/cli.js import [--input nodes-inline.txt] [--format auto|inline|yaml|json] [--base-port 7891] [--output-dir configs/generated] [--instances-file instances.generated.csv] [--manifest-file instances.generated.json]
  node ./src/cli.js start [instance-name]
  node ./src/cli.js stop [instance-name]
  node ./src/cli.js status
  node ./src/cli.js test [instance-name]
  node ./src/cli.js serve [--host 127.0.0.1] [--port 8799]

Examples:
  node ./src/cli.js import --input nodes-inline.txt
  pbpaste | node ./src/cli.js import --format auto --base-port 9001
  node ./src/cli.js start usa-01
  node ./src/cli.js serve --port 8799
`);
}

function readInput(inputFile) {
  if (!process.stdin.isTTY) {
    const stdinText = fs.readFileSync(0, "utf8");
    if (trim(stdinText)) {
      return stdinText;
    }
  }
  return fs.readFileSync(inputFile, "utf8");
}

function parseFlags(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--stop-first") {
      options.stopFirst = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
      continue;
    }
    positional.push(arg);
  }

  return { options, positional };
}

function printStartStopResults(result) {
  for (const item of result.results) {
    const status = item.status.toUpperCase();
    const instance = item.instance;
    const portInfo = instance && instance.localPort ? ` ${instance.scheme}://127.0.0.1:${instance.localPort}` : "";
    console.log(`[${status}] ${item.message}${portInfo}`);
    if (instance && instance.dockerProxyUrl) {
      console.log(`        Docker access URL: ${instance.dockerProxyUrl}`);
    }
  }
  console.log(
    `Summary: total=${result.summary.total} started=${result.summary.started} stopped=${result.summary.stopped} skipped=${result.summary.skipped} failed=${result.summary.failed}`,
  );
}

function printStatus() {
  const statuses = listInstanceStatuses();
  const summary = summaryFromStatuses(statuses);
  console.log(`Instances file: ${summary.instancesFile}`);
  console.log(`Total: ${summary.total}, Running: ${summary.running}, Stopped: ${summary.stopped}`);
  console.log("");

  for (const item of statuses) {
    const state = !item.configExists ? "MISSING CONFIG" : item.running ? "RUNNING" : "STOPPED";
    const display = item.displayName && item.displayName !== item.name ? ` (${item.displayName})` : "";
    const port = item.localPort ? `${item.scheme}://127.0.0.1:${item.localPort}` : "n/a";
    console.log(`[${state}] ${item.name}${display} -> ${port}`);
    if (item.dockerProxyUrl) {
      console.log(`          Docker: ${item.dockerProxyUrl}`);
    }
  }
}

function printTestResults(result) {
  for (const item of result.results) {
    const label = item.passed ? "PASS" : "FAIL";
    const location = item.actualLoc ? ` loc=${item.actualLoc}` : "";
    const ip = item.actualIp ? ` ip=${item.actualIp}` : "";
    const proxy = item.proxyUrl || "n/a";
    const reason = item.reason ? ` ${item.reason}` : "";
    console.log(`[${label}] ${item.name}${location}${ip} via ${proxy}${reason}`);
  }
  console.log(`Summary: total=${result.summary.total} passed=${result.summary.passed} failed=${result.summary.failed}`);
}

async function commandImport(args) {
  const { options } = parseFlags(args);
  if (options.help) {
    printUsage();
    return;
  }

  if (options.stopFirst) {
    await runOnInstances("stop", "", {});
  }

  const inputFile = path.resolve(options.input || PATHS.defaultInputFile);
  const importResult = importNodes({
    text: readInput(inputFile),
    basePort: Number(options["base-port"] || DEFAULTS.basePort),
    format: options.format || "auto",
    outputDir: options["output-dir"] || PATHS.generatedConfigDir,
    instancesFile: options["instances-file"] || PATHS.generatedInstancesCsv,
    manifestFile: options["manifest-file"] || PATHS.generatedInstancesJson,
  });

  console.log(`Imported ${importResult.count} proxies (${importResult.format}).`);
  console.log(`Configs: ${toProjectRelative(importResult.outputDir)}`);
  console.log(`Instances CSV: ${toProjectRelative(importResult.instancesFile)}`);
  console.log(`Instances JSON: ${toProjectRelative(importResult.manifestFile)}`);
}

async function commandStart(args) {
  const { options, positional } = parseFlags(args);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await runOnInstances("start", positional[0] || "", {});
  printStartStopResults(result);
  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function commandStop(args) {
  const { options, positional } = parseFlags(args);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await runOnInstances("stop", positional[0] || "", {});
  printStartStopResults(result);
  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
}

function commandTest(args) {
  const { options, positional } = parseFlags(args);
  if (options.help) {
    printUsage();
    return;
  }
  const result = testInstances(positional[0] || "", {});
  printTestResults(result);
  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function commandServe(args) {
  const { options } = parseFlags(args);
  if (options.help) {
    printUsage();
    return;
  }
  const started = await startServer({
    host: options.host || DEFAULTS.serverHost,
    port: Number(options.port || DEFAULTS.serverPort),
  });
  console.log(`mihomo-multiport web console: http://${started.host}:${started.port}`);
}

async function run(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "import") {
    await commandImport(args);
    return;
  }
  if (command === "start") {
    await commandStart(args);
    return;
  }
  if (command === "stop") {
    await commandStop(args);
    return;
  }
  if (command === "status") {
    printStatus();
    return;
  }
  if (command === "test") {
    commandTest(args);
    return;
  }
  if (command === "serve") {
    await commandServe(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function runLegacy(command, argv) {
  return run([command, ...argv]);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[ERROR] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  run,
  runLegacy,
};
