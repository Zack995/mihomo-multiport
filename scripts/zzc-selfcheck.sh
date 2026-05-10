#!/usr/bin/env bash
# zzc_center 接入自检：4 项必须全部 OK。
# 用法：
#   PORT=8799 ./scripts/zzc-selfcheck.sh
# 或在已运行 web console 的情况下直接：
#   ./scripts/zzc-selfcheck.sh
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

# 1) 加载 .env.local（仅在子 shell 内）
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

PORT="${PORT:-8799}"
HEALTH_PATH="${HEALTH_PATH:-/health}"

pass()  { printf "[ok]   %s\n" "$*"; }
fail()  { printf "[FAIL] %s\n" "$*" >&2; exit 1; }

echo "=== 1) /health 合约校验 ==="
HEALTH_BODY="$(curl -fsS "http://127.0.0.1:${PORT}${HEALTH_PATH}")" \
  || fail "请求 /health 失败 (PORT=$PORT)"
echo "$HEALTH_BODY" | node -e '
  let buf="";
  process.stdin.on("data",c=>buf+=c);
  process.stdin.on("end",()=>{
    const j=JSON.parse(buf);
    if(!["ok","degraded","down"].includes(j.status)) throw new Error("bad status: "+j.status);
    if(!j.timestamp) throw new Error("missing timestamp");
    const skew=Math.abs(Date.now()-Date.parse(j.timestamp))/1000;
    if(skew>300) throw new Error("timestamp drift "+skew+"s > 300");
    if(j.status==="ok" && j.checks){
      for(const [k,v] of Object.entries(j.checks)){
        if(v && v.ok===false) throw new Error("status=ok but check "+k+" is false");
      }
    }
    process.stdout.write("status="+j.status+" uptime="+j.uptime_seconds+"s\n");
  });
' && pass "/health"

echo "=== 2) PG 凭证（本项目未申请 PG，跳过）==="
if [[ -n "${DATABASE_URL:-}" ]]; then
  psql "$DATABASE_URL" -At -c "SELECT 1" | grep -q "^1$" && pass "PG SELECT 1" || fail "PG SELECT 1"
else
  pass "skipped (no DATABASE_URL)"
fi

echo "=== 3) Redis 凭证（本项目未申请 Redis，跳过）==="
if [[ -n "${REDIS_URL:-}" ]]; then
  redis-cli -u "$REDIS_URL" SET "${ZZC_REDIS_KEY_PREFIX}selfcheck" 1 >/dev/null \
    && [[ "$(redis-cli -u "$REDIS_URL" GET "${ZZC_REDIS_KEY_PREFIX}selfcheck")" == "1" ]] \
    && pass "Redis SET/GET" || fail "Redis SET/GET"
else
  pass "skipped (no REDIS_URL)"
fi

echo "=== 4) zzc /notify 通路 ==="
if [[ -z "${ZZC_API_KEY:-}" || -z "${ZZC_BASE_URL:-}" ]]; then
  fail "缺少 ZZC_API_KEY / ZZC_BASE_URL"
fi
node -e '
  const { notify } = require("./src/clients/zzcClient");
  notify({
    level: "info",
    title: "selfcheck from " + require("os").hostname(),
    message: "mihomo-multiport zzc-selfcheck at " + new Date().toISOString(),
    channel: process.env.ZZC_SELFCHECK_CHANNEL || "alerts",
    idempotency_key: "selfcheck-mihomo-" + Date.now(),
  })
  .then((r) => {
    const dispatched = r && r.dispatched_to;
    if (!Array.isArray(dispatched) || dispatched.length === 0) {
      console.error("notify response missing dispatched_to: " + JSON.stringify(r));
      process.exit(1);
    }
    const allSent = dispatched.every((d) => d.status === "sent" || d.status === "queued");
    if (!allSent) {
      console.error("some dispatch failed: " + JSON.stringify(dispatched));
      process.exit(1);
    }
    console.log("dispatched_to=" + dispatched.map((d) => d.channel + "/" + d.status).join(", "));
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
' && pass "zzc /notify"

echo
echo "ALL CHECKS PASSED"
