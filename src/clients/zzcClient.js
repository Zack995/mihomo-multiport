const { createHmac } = require("node:crypto");

const NOTIFY_TIMEOUT_MS = 5000;

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  return value;
}

function isConfigured() {
  return Boolean(getEnv("ZZC_BASE_URL") && getEnv("ZZC_API_KEY"));
}

function sign(secret, ts, rawBody) {
  return createHmac("sha256", secret).update(`${ts}\n${rawBody}`).digest("hex");
}

async function request(method, path, body, options = {}) {
  const base = getEnv("ZZC_BASE_URL");
  const key = getEnv("ZZC_API_KEY");
  if (!base || !key) {
    throw new Error("zzc client not configured (missing ZZC_BASE_URL or ZZC_API_KEY)");
  }
  const dotIndex = key.indexOf(".");
  if (dotIndex < 1 || dotIndex === key.length - 1) {
    throw new Error("ZZC_API_KEY format invalid (expected <prefix>.<random>)");
  }
  const secret = key.slice(dotIndex + 1);

  const raw = body == null ? "" : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = sign(secret, ts, raw);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? NOTIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-ZZC-Key": key,
        "X-ZZC-Timestamp": ts,
        "X-ZZC-Signature": sig,
      },
      body: raw || undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (_error) {
        parsed = { raw: text };
      }
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function notify(payload) {
  const result = await request("POST", "/notify", payload);
  if (!result.ok) {
    throw new Error(`zzc /notify ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function listChannels() {
  const result = await request("GET", "/me/channels", null);
  if (!result.ok) {
    throw new Error(`zzc list channels ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return Array.isArray(result.body) ? result.body : [];
}

async function createChannel(input) {
  const result = await request("POST", "/me/channels", input);
  if (!result.ok) {
    throw new Error(`zzc create channel ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function updateChannel(id, input) {
  const result = await request("PATCH", `/me/channels/${id}`, input);
  if (!result.ok) {
    throw new Error(`zzc update channel ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function ensureChannels(desired) {
  const existing = await listChannels();
  const existingNames = new Set(existing.map((channel) => channel.name));
  const created = [];
  const skipped = [];
  for (const desire of desired) {
    if (existingNames.has(desire.name)) {
      skipped.push(desire.name);
      continue;
    }
    await createChannel({ ...desire, enabled: desire.enabled ?? true });
    created.push(desire.name);
  }
  return { created, skipped };
}

module.exports = {
  isConfigured,
  notify,
  listChannels,
  createChannel,
  updateChannel,
  ensureChannels,
};
