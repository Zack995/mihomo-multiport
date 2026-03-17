const fs = require("fs");
const path = require("path");

const { LOCATION_MAP, PATHS, DEFAULTS } = require("./constants");
const {
  asciiName,
  countIndent,
  ensureDir,
  parseJson,
  removeFilesByExtension,
  resolveProjectPath,
  toProjectRelative,
  trim,
  uniqueSlug,
  yamlScalar,
} = require("./helpers");

function splitTopLevel(input, separator) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of input) {
    if (char === "{") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseInlineValue(value) {
  const normalized = trim(value);
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    return parseInlineMap(normalized.slice(1, -1));
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }
  return normalized.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function parseInlineMap(body) {
  const entries = {};

  for (const pair of splitTopLevel(body, ",")) {
    let separatorIndex = -1;
    let depth = 0;

    for (let index = 0; index < pair.length; index += 1) {
      const char = pair[index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      } else if (char === ":" && depth === 0) {
        separatorIndex = index;
        break;
      }
    }

    if (separatorIndex === -1) {
      continue;
    }

    const key = trim(pair.slice(0, separatorIndex));
    const value = trim(pair.slice(separatorIndex + 1));
    entries[key] = parseInlineValue(value);
  }

  return entries;
}

function parseInlineNodes(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- {") && line.endsWith("}"));

  return lines.map((line) => {
    const proxy = parseInlineValue(line.replace(/^- /, ""));
    return {
      name: trim(proxy.name),
      proxy,
      format: "inline",
    };
  });
}

function extractDisplayNameFromYamlBlock(blockLines) {
  const joined = blockLines.join("\n");
  const inlineLine = blockLines.find((line) => /^\s*-\s*\{/.test(line));
  if (inlineLine) {
    const parsed = parseInlineValue(trim(inlineLine).replace(/^- /, ""));
    return trim(parsed.name);
  }

  const firstLine = blockLines[0] || "";
  const itemIndent = countIndent(firstLine);
  const topLevelIndent = itemIndent + 2;
  const topLevelNamePattern = new RegExp(`^\\s{${topLevelIndent}}name\\s*:\\s*(.+)$`);
  const firstLineName = firstLine.match(/^\s*-\s*name\s*:\s*(.+)$/);
  if (firstLineName) {
    return parseYamlScalar(firstLineName[1]);
  }

  for (const line of blockLines.slice(1)) {
    const match = line.match(topLevelNamePattern);
    if (match) {
      return parseYamlScalar(match[1]);
    }
  }

  const fallback = joined.match(/\bname\s*:\s*(.+)$/m);
  return fallback ? parseYamlScalar(fallback[1]) : "";
}

function parseYamlScalar(raw) {
  const value = trim(raw).replace(/ #.*$/, "");
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function collectYamlBlocks(lines, listIndent) {
  const blocks = [];
  let currentBlock = [];

  function flushCurrentBlock() {
    const normalized = currentBlock
      .map((line) => line.replace(/\s+$/, ""))
      .filter((line, index, source) => !(index === source.length - 1 && trim(line) === ""));

    if (normalized.length > 0) {
      blocks.push(normalized);
    }
    currentBlock = [];
  }

  for (const line of lines) {
    const trimmedLine = trim(line);
    if (!trimmedLine) {
      if (currentBlock.length > 0) {
        currentBlock.push(line);
      }
      continue;
    }

    const indent = countIndent(line);
    if (indent === listIndent && trimmedLine.startsWith("- ")) {
      flushCurrentBlock();
      currentBlock.push(line);
      continue;
    }

    if (indent < listIndent) {
      flushCurrentBlock();
      break;
    }

    if (currentBlock.length === 0 && trimmedLine.startsWith("#")) {
      continue;
    }

    if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  flushCurrentBlock();
  return blocks;
}

function parseYamlNodes(text) {
  const lines = String(text).replace(/\t/g, "  ").split(/\r?\n/);
  let blocks = [];

  const proxiesIndex = lines.findIndex((line) => /^\s*proxies\s*:\s*$/.test(line));
  if (proxiesIndex >= 0) {
    const proxiesIndent = countIndent(lines[proxiesIndex]);
    blocks = collectYamlBlocks(lines.slice(proxiesIndex + 1), proxiesIndent + 2);
  } else {
    const firstListItem = lines.find((line) => /^\s*-\s+/.test(line));
    if (!firstListItem) {
      return [];
    }
    blocks = collectYamlBlocks(lines, countIndent(firstListItem));
  }

  return blocks
    .map((blockLines) => {
      const inlineCandidate = blockLines.find((line) => /^\s*-\s*\{/.test(line));
      if (inlineCandidate) {
        const proxy = parseInlineValue(trim(inlineCandidate).replace(/^- /, ""));
        return {
          name: trim(proxy.name),
          proxy,
          format: "yaml-inline",
        };
      }

      const name = extractDisplayNameFromYamlBlock(blockLines);
      return {
        name,
        proxyBlock: blockLines.join("\n"),
        format: "yaml",
      };
    })
    .filter((node) => node.name);
}

function parseJsonNodes(text) {
  const parsed = parseJson(text);
  if (!parsed) {
    return [];
  }

  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.nodes)
      ? parsed.nodes
      : Array.isArray(parsed.instances)
        ? parsed.instances
        : [];

  return candidates
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      if (item.proxy && typeof item.proxy === "object") {
        return {
          name: trim(item.name || item.displayName || item.proxy.name),
          proxy: item.proxy,
          format: "json",
        };
      }

      if (item.proxyBlock && typeof item.proxyBlock === "string") {
        return {
          name: trim(item.name || item.displayName),
          proxyBlock: item.proxyBlock,
          format: "json-block",
        };
      }

      if (item.server && item.port) {
        return {
          name: trim(item.name || item.displayName),
          proxy: item,
          format: "json",
        };
      }

      return null;
    })
    .filter(Boolean);
}

function splitImportSections(text) {
  return String(text)
    .split(/^\s*---\s*$/m)
    .map((section) => section.trim())
    .filter(Boolean);
}

function detectFormat(text, preferredFormat = "auto") {
  if (preferredFormat !== "auto") {
    return preferredFormat;
  }

  const normalized = trim(text);
  if (!normalized) {
    throw new Error("Import text is empty.");
  }

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return "json";
  }

  if (/^\s*proxies\s*:\s*$/m.test(normalized) || /^\s*-\s+name\s*:/m.test(normalized)) {
    return "yaml";
  }

  if (/^\s*-\s*\{.+\}\s*$/m.test(normalized)) {
    return "inline";
  }

  return "yaml";
}

function nodeSignature(node) {
  if (node.proxy && node.proxy.server && node.proxy.port) {
    return [
      asciiName(node.name).toLowerCase(),
      String(node.proxy.server).toLowerCase(),
      String(node.proxy.port),
      String(node.proxy.type || ""),
    ].join("|");
  }

  if (node.proxyBlock) {
    return [
      asciiName(node.name).toLowerCase(),
      String(node.proxyBlock).replace(/\s+/g, " ").trim().toLowerCase(),
    ].join("|");
  }

  return asciiName(node.name).toLowerCase();
}

function dedupeNodes(nodes) {
  const seen = new Set();
  return nodes.filter((node) => {
    const signature = nodeSignature(node);
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function inferLocation(name) {
  const normalized = asciiName(name).toUpperCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (LOCATION_MAP[token]) {
      return LOCATION_MAP[token];
    }
    if (/^[A-Z]{2}$/.test(token)) {
      return token;
    }
  }
  return "";
}

function validateNode(node) {
  if (!node.name) {
    throw new Error("Each imported proxy must have a name field.");
  }

  if (node.proxy) {
    if (!node.proxy.server) {
      throw new Error(`Proxy "${node.name}" is missing server.`);
    }
    if (!node.proxy.port) {
      throw new Error(`Proxy "${node.name}" is missing port.`);
    }
  }
}

function serializeYamlValue(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${" ".repeat(indent)}[]`];
    }

    return value.flatMap((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const [firstLine, ...restLines] = serializeObject(entry, indent + 2);
        const normalizedFirstLine = firstLine.replace(/^\s+/, "");
        return [
          `${" ".repeat(indent)}- ${normalizedFirstLine}`,
          ...restLines,
        ];
      }
      return [`${" ".repeat(indent)}- ${yamlScalar(entry)}`];
    });
  }

  if (value && typeof value === "object") {
    return serializeObject(value, indent);
  }

  return [`${" ".repeat(indent)}${yamlScalar(value)}`];
}

function serializeObject(objectValue, indent) {
  const lines = [];
  for (const [key, value] of Object.entries(objectValue)) {
    if (value === undefined || value === null || key === "name") {
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${" ".repeat(indent)}${key}:`);
      lines.push(...serializeYamlValue(value, indent + 2));
      continue;
    }

    if (value && typeof value === "object") {
      lines.push(`${" ".repeat(indent)}${key}:`);
      lines.push(...serializeYamlValue(value, indent + 2));
      continue;
    }

    lines.push(`${" ".repeat(indent)}${key}: ${yamlScalar(value)}`);
  }
  return lines;
}

function createProxyBlockFromObject(proxy, proxyName) {
  const proxyCopy = { ...proxy, name: proxyName };
  return [
    `  - name: ${yamlScalar(proxyCopy.name)}`,
    ...serializeObject(proxyCopy, 4),
  ].join("\n");
}

function createProxyBlockFromYaml(proxyBlock, proxyName) {
  const lines = proxyBlock.split("\n");
  const firstLine = lines[0] || "";
  const itemIndent = countIndent(firstLine);
  const topLevelIndent = itemIndent + 2;
  const normalized = [];
  let insertedName = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0) {
      const firstName = line.match(/^(\s*)-\s*name\s*:\s*(.+)$/);
      if (firstName) {
        normalized.push(`${" ".repeat(itemIndent)}- name: ${yamlScalar(proxyName)}`);
        insertedName = true;
        continue;
      }

      const listItem = line.match(/^(\s*)-\s*(.+)$/);
      if (listItem) {
        normalized.push(`${" ".repeat(itemIndent)}- name: ${yamlScalar(proxyName)}`);
        insertedName = true;
        if (trim(listItem[2])) {
          normalized.push(`${" ".repeat(topLevelIndent)}${listItem[2]}`);
        }
        continue;
      }
    }

    if (insertedName && countIndent(line) === topLevelIndent && /^\s*name\s*:/.test(line)) {
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function createConfigContent(node, localPort, proxyName) {
  const sourceName = asciiName(node.name || proxyName) || proxyName;
  const proxyBlock = node.proxy
    ? createProxyBlockFromObject(node.proxy, proxyName)
    : createProxyBlockFromYaml(node.proxyBlock, proxyName);

  return [
    `# Source name: ${sourceName}`,
    `# Managed by mihomo-multiport (${node.format})`,
    `mixed-port: ${localPort}`,
    "mode: rule",
    "log-level: info",
    "allow-lan: false",
    "",
    "proxies:",
    proxyBlock,
    "",
    "proxy-groups:",
    '  - name: "PROXY"',
    "    type: select",
    "    proxies:",
    `      - ${yamlScalar(proxyName)}`,
    "",
    "rules:",
    "  - MATCH,PROXY",
    "",
  ].join("\n");
}

function parseSectionNodes(text, format) {
  if (format === "inline") {
    return parseInlineNodes(text);
  }

  if (format === "json") {
    return parseJsonNodes(text);
  }

  return parseYamlNodes(text);
}

function parseNodes(text, format = "auto") {
  if (format !== "auto") {
    const resolvedFormat = detectFormat(text, format);
    return parseSectionNodes(text, resolvedFormat);
  }

  const sections = splitImportSections(text);
  const nodes = [];

  for (const section of sections) {
    const trimmedSection = trim(section);
    if (!trimmedSection) {
      continue;
    }

    if (trimmedSection.startsWith("{") || trimmedSection.startsWith("[")) {
      nodes.push(...parseJsonNodes(trimmedSection));
      continue;
    }

    nodes.push(...parseYamlNodes(trimmedSection));
    nodes.push(...parseInlineNodes(trimmedSection));
  }

  return dedupeNodes(nodes);
}

function importNodes({
  text,
  basePort = DEFAULTS.basePort,
  format = "auto",
  outputDir = PATHS.generatedConfigDir,
  instancesFile = PATHS.generatedInstancesCsv,
  manifestFile = PATHS.generatedInstancesJson,
}) {
  if (!Number.isInteger(basePort) || basePort <= 0) {
    throw new Error(`Invalid base port: ${basePort}`);
  }

  const nodes = parseNodes(text, format);
  if (nodes.length === 0) {
    throw new Error("No supported proxies found. Use inline nodes or a Mihomo/Clash YAML proxies list.");
  }

  const outputDirAbs = resolveProjectPath(outputDir);
  const instancesFileAbs = resolveProjectPath(instancesFile);
  const manifestFileAbs = resolveProjectPath(manifestFile);

  ensureDir(outputDirAbs);
  ensureDir(path.dirname(instancesFileAbs));
  ensureDir(path.dirname(manifestFileAbs));
  removeFilesByExtension(outputDirAbs, ".yaml");

  const usedSlugs = new Set();
  const manifest = [];
  const csvLines = ["# name,config_path,expected_loc,expected_ip"];

  nodes.forEach((node, index) => {
    validateNode(node);

    const slug = uniqueSlug(node.name, usedSlugs, index);
    const localPort = basePort + index;
    const configPathAbs = path.join(outputDirAbs, `${slug}.yaml`);
    const configRelative = toProjectRelative(configPathAbs);
    const proxyName = slug.replace(/-/g, "_");
    const expectedLoc = inferLocation(node.name);
    const configContent = createConfigContent(node, localPort, proxyName);

    fs.writeFileSync(configPathAbs, configContent, "utf8");

    manifest.push({
      name: slug,
      displayName: asciiName(node.name) || node.name,
      configPath: configRelative,
      expectedLoc,
      expectedIp: "",
      localPort,
      scheme: "http",
      format: node.format,
    });
    csvLines.push(`${slug},${configRelative},${expectedLoc},`);
  });

  fs.writeFileSync(instancesFileAbs, `${csvLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    manifestFileAbs,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), instances: manifest }, null, 2)}\n`,
    "utf8",
  );

  return {
    count: manifest.length,
    format: detectFormat(text, format),
    outputDir: outputDirAbs,
    instancesFile: instancesFileAbs,
    manifestFile: manifestFileAbs,
    instances: manifest,
  };
}

module.exports = {
  createConfigContent,
  importNodes,
  inferLocation,
  parseNodes,
};
