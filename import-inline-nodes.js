#!/usr/bin/env node

const { runLegacy } = require("./src/cli");

runLegacy("import", process.argv.slice(2)).catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});
