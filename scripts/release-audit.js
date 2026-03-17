#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const checks = [
  {
    path: ".DS_Store",
    type: "delete",
    reason: "macOS metadata file, should never be published.",
  },
  {
    path: "dist",
    type: "delete",
    reason: "Portable build output, can always be regenerated.",
  },
  {
    path: "logs",
    type: "delete",
    reason: "Local runtime logs, not source code.",
  },
  {
    path: "runtime",
    type: "delete",
    reason: "Local mihomo cache/runtime data.",
  },
  {
    path: "nodes-inline.txt",
    type: "review",
    reason: "May contain real subscription nodes or secrets.",
  },
  {
    path: "instances.generated.csv",
    type: "delete",
    reason: "Generated instance list, can be recreated from imports.",
  },
  {
    path: "instances.generated.json",
    type: "delete",
    reason: "Generated manifest, can be recreated from imports.",
  },
  {
    path: "configs/generated",
    type: "review",
    reason: "Generated configs may contain real server addresses or passwords.",
  },
];

function statSummary(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const childCount = fs.readdirSync(targetPath).length;
      return `directory, ${childCount} entries`;
    }
    return `file, ${stat.size} bytes`;
  } catch (_error) {
    return "";
  }
}

function main() {
  const found = [];

  for (const check of checks) {
    const absolutePath = path.join(ROOT, check.path);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    if (check.path === "configs/generated" && fs.statSync(absolutePath).isDirectory()) {
      if (fs.readdirSync(absolutePath).length === 0) {
        continue;
      }
    }

    found.push({
      ...check,
      absolutePath,
      summary: statSummary(absolutePath),
    });
  }

  console.log("Release audit for mihomo-multiport");
  console.log("");

  if (found.length === 0) {
    console.log("No publish blockers found.");
    return;
  }

  const deleteItems = found.filter((item) => item.type === "delete");
  const reviewItems = found.filter((item) => item.type === "review");

  if (deleteItems.length > 0) {
    console.log("Delete before publishing:");
    for (const item of deleteItems) {
      console.log(`- ${item.path} (${item.summary})`);
      console.log(`  ${item.reason}`);
    }
    console.log("");
  }

  if (reviewItems.length > 0) {
    console.log("Review before publishing:");
    for (const item of reviewItems) {
      console.log(`- ${item.path} (${item.summary})`);
      console.log(`  ${item.reason}`);
    }
    console.log("");
  }
}

main();
