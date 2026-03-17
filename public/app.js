const state = {
  instances: [],
  filterText: "",
  filterState: "all",
};

const els = {
  basePortInput: document.getElementById("basePortInput"),
  fileInput: document.getElementById("fileInput"),
  formatSelect: document.getElementById("formatSelect"),
  importBtn: document.getElementById("importBtn"),
  importText: document.getElementById("importText"),
  instancesBody: document.getElementById("instancesBody"),
  instancesFile: document.getElementById("instancesFile"),
  logMeta: document.getElementById("logMeta"),
  logOutput: document.getElementById("logOutput"),
  mihomoPath: document.getElementById("mihomoPath"),
  panelHint: document.getElementById("panelHint"),
  refreshBtn: document.getElementById("refreshBtn"),
  reportHint: document.getElementById("reportHint"),
  reportList: document.getElementById("reportList"),
  reportSummary: document.getElementById("reportSummary"),
  runningCount: document.getElementById("runningCount"),
  searchInput: document.getElementById("searchInput"),
  startAllBtn: document.getElementById("startAllBtn"),
  stateFilter: document.getElementById("stateFilter"),
  statusBadge: document.getElementById("statusBadge"),
  stopAllBtn: document.getElementById("stopAllBtn"),
  stoppedCount: document.getElementById("stoppedCount"),
  stopBeforeImport: document.getElementById("stopBeforeImport"),
  template: document.getElementById("instanceRowTemplate"),
  testAllBtn: document.getElementById("testAllBtn"),
  totalCount: document.getElementById("totalCount"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function setLoading(button, loading) {
  if (!button) {
    return;
  }
  button.disabled = loading;
  if (loading) {
    button.dataset.label = button.textContent;
    button.textContent = "处理中...";
    return;
  }
  if (button.dataset.label) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
}

function renderMeta(meta) {
  const summary = meta.summary;
  els.totalCount.textContent = summary.total;
  els.runningCount.textContent = summary.running;
  els.stoppedCount.textContent = summary.stopped;
  els.instancesFile.textContent = summary.instancesFile || "-";
  els.mihomoPath.textContent = meta.mihomo.ready
    ? meta.mihomo.path
    : `${meta.mihomo.path} (${meta.mihomo.error})`;
  els.statusBadge.textContent = meta.mihomo.ready ? "Ready" : "Missing mihomo";
  els.statusBadge.className = `badge ${meta.mihomo.ready ? "badge-ready" : "badge-warn"}`;
}

function rowText(value, fallback = "-") {
  return value || fallback;
}

function showError(error) {
  window.alert(error.message || String(error));
}

function reportCardClass(item) {
  if (item.passed === false || item.status === "failed") {
    return "report-card report-card-failed";
  }
  if (item.passed === true || ["started", "stopped", "ready", "deleted"].includes(item.status)) {
    return "report-card report-card-success";
  }
  return "report-card";
}

function renderReport(title, data) {
  if (!data) {
    return;
  }

  const summary = data.summary || {};
  const summaryText = Object.entries(summary)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");

  els.reportHint.textContent = title;
  els.reportSummary.textContent = summaryText || "操作已完成";
  els.reportList.innerHTML = "";

  for (const item of data.results || []) {
    const card = document.createElement("article");
    card.className = reportCardClass(item);
    const titleText = item.name || item.displayName || item.status || "result";
    const detail = item.reason || item.message || item.proxyUrl || "";
    card.innerHTML = `
      <strong>${titleText}</strong>
      <span>${detail || "-"}</span>
    `;
    els.reportList.appendChild(card);
  }
}

function matchesState(instance, stateValue) {
  if (stateValue === "running") {
    return instance.running;
  }
  if (stateValue === "stopped") {
    return !instance.running && instance.configExists;
  }
  if (stateValue === "missing") {
    return !instance.configExists;
  }
  return true;
}

function filteredInstances(instances) {
  const keyword = state.filterText.trim().toLowerCase();
  return instances.filter((instance) => {
    const haystack = [
      instance.name,
      instance.displayName,
      instance.expectedLoc,
      instance.proxyUrl,
      instance.dockerProxyUrl,
    ]
      .join(" ")
      .toLowerCase();

    return (!keyword || haystack.includes(keyword)) && matchesState(instance, state.filterState);
  });
}

function actionTitle(path, payload) {
  if (path === "/api/start") {
    return payload?.name ? `启动 ${payload.name}` : "批量启动完成";
  }
  if (path === "/api/stop") {
    return payload?.name ? `停止 ${payload.name}` : "批量停止完成";
  }
  if (path === "/api/test") {
    return payload?.name ? `测试 ${payload.name}` : "测试完成";
  }
  if (path === "/api/delete") {
    return payload?.name ? `删除 ${payload.name}` : "删除完成";
  }
  return "操作完成";
}

function renderInstances(instances) {
  state.instances = instances;
  els.instancesBody.innerHTML = "";
  const visibleInstances = filteredInstances(instances);

  if (visibleInstances.length === 0) {
    els.instancesBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">${instances.length === 0 ? "暂无实例，先在上方导入节点。" : "当前筛选条件下没有匹配实例。"}</td>
      </tr>
    `;
    return;
  }

  for (const instance of visibleInstances) {
    const fragment = els.template.content.cloneNode(true);
    const row = fragment.querySelector("tr");
    row.dataset.name = instance.name;

    fragment.querySelector('[data-field="name"]').textContent = instance.name;
    fragment.querySelector('[data-field="displayName"]').textContent = instance.displayName || "";
    fragment.querySelector('[data-field="port"]').textContent = instance.localPort
      ? `${instance.scheme}://127.0.0.1:${instance.localPort}`
      : "-";
    fragment.querySelector('[data-field="location"]').textContent = rowText(instance.expectedLoc);

    const pill = fragment.querySelector('[data-field="state"]');
    if (!instance.configExists) {
      pill.textContent = "配置缺失";
      pill.classList.add("pill-missing");
    } else if (instance.running) {
      pill.textContent = "运行中";
      pill.classList.add("pill-running");
    } else {
      pill.textContent = "已停止";
      pill.classList.add("pill-stopped");
    }

    fragment.querySelector('[data-field="docker"]').textContent = rowText(instance.dockerProxyUrl);
    for (const button of fragment.querySelectorAll("[data-action]")) {
      button.dataset.name = instance.name;
      if (!instance.configExists && !["log", "copy"].includes(button.dataset.action)) {
        button.disabled = true;
      }
      if (!instance.proxyUrl && !instance.dockerProxyUrl && button.dataset.action === "copy") {
        button.disabled = true;
      }
    }

    els.instancesBody.appendChild(fragment);
  }
}

function applyStatusPayload(data) {
  renderMeta(data.meta);
  renderInstances(data.instances);
}

async function refreshStatus() {
  const data = await api("/api/status");
  applyStatusPayload(data);
}

async function postAction(path, payload, button) {
  setLoading(button, true);
  try {
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
    if (data.meta && data.instances) {
      applyStatusPayload(data);
    }
    if (data.result) {
      renderReport(actionTitle(path, payload), data.result);
      if (path === "/api/start" || path === "/api/stop" || path === "/api/delete") {
        const succeeded =
          (data.result.summary.started || 0) +
          (data.result.summary.stopped || 0) +
          (data.result.summary.deleted || 0);
        els.panelHint.textContent = `最近一次操作：成功 ${succeeded}，跳过 ${data.result.summary.skipped || 0}，失败 ${data.result.summary.failed || 0}。`;
      }
    }
    return data;
  } finally {
    setLoading(button, false);
  }
}

async function importNodes() {
  if (!els.importText.value.trim()) {
    window.alert("请先粘贴节点内容，或选择一个导入文件。");
    return;
  }

  const data = await postAction(
    "/api/import",
    {
      text: els.importText.value,
      basePort: Number(els.basePortInput.value) || 7891,
      format: els.formatSelect.value,
      stopBeforeImport: els.stopBeforeImport.checked,
    },
    els.importBtn,
  );

  els.panelHint.textContent = `最近一次导入：${data.import.count} 个节点，格式 ${data.import.format}。`;
  renderReport("导入完成", {
    summary: {
      imported: data.import.count,
      format: data.import.format,
    },
    results: data.instances.map((item) => ({
      name: item.name,
      message: item.proxyUrl || item.dockerProxyUrl || item.configPath,
      status: item.configExists ? "ready" : "failed",
    })),
  });
}

async function showLog(name, button) {
  setLoading(button, true);
  try {
    const data = await api(`/api/logs?name=${encodeURIComponent(name)}&lines=40`);
    els.logMeta.textContent = `${data.log.name} · ${data.log.logFile}${data.log.updatedAt ? ` · ${data.log.updatedAt}` : ""}`;
    els.logOutput.textContent = data.log.content || "日志文件为空";
  } finally {
    setLoading(button, false);
  }
}

async function runTests(name, button) {
  const data = await postAction("/api/test", { name }, button);
  els.panelHint.textContent = `最近一次测试：通过 ${data.result.summary.passed}，失败 ${data.result.summary.failed}。`;
}

async function copyProxy(name, button) {
  const instance = state.instances.find((item) => item.name === name);
  if (!instance || (!instance.proxyUrl && !instance.dockerProxyUrl)) {
    return;
  }
  setLoading(button, true);
  try {
    const targetUrl = instance.proxyUrl || instance.dockerProxyUrl;
    await navigator.clipboard.writeText(targetUrl);
    els.panelHint.textContent = `已复制 ${name} 的代理地址。`;
  } finally {
    setLoading(button, false);
  }
}

async function deleteManagedInstance(name, button) {
  const confirmed = window.confirm(`确认删除实例 ${name} 吗？\n\n如果它是自动生成配置，还会一起清理对应配置和运行文件。`);
  if (!confirmed) {
    return;
  }
  const data = await postAction("/api/delete", { name }, button);
  els.panelHint.textContent = `实例 ${name} 已删除，当前剩余 ${data.meta.summary.total} 个实例。`;
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", () => {
    void refreshStatus().catch(showError);
  });

  els.importBtn.addEventListener("click", () => {
    void importNodes().catch(showError);
  });

  els.startAllBtn.addEventListener("click", () => {
    void postAction("/api/start", {}, els.startAllBtn).catch(showError);
  });

  els.stopAllBtn.addEventListener("click", () => {
    void postAction("/api/stop", {}, els.stopAllBtn).catch(showError);
  });

  els.testAllBtn.addEventListener("click", () => {
    void runTests("", els.testAllBtn).catch(showError);
  });

  els.searchInput.addEventListener("input", (event) => {
    state.filterText = event.target.value;
    renderInstances(state.instances);
  });

  els.stateFilter.addEventListener("change", (event) => {
    state.filterState = event.target.value;
    renderInstances(state.instances);
  });

  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }
    els.importText.value = await file.text();
  });

  els.instancesBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const { action, name } = button.dataset;
    if (action === "start") {
      void postAction("/api/start", { name }, button).catch(showError);
      return;
    }
    if (action === "stop") {
      void postAction("/api/stop", { name }, button).catch(showError);
      return;
    }
    if (action === "test") {
      void runTests(name, button).catch(showError);
      return;
    }
    if (action === "copy") {
      void copyProxy(name, button).catch(showError);
      return;
    }
    if (action === "delete") {
      void deleteManagedInstance(name, button).catch(showError);
      return;
    }
    if (action === "log") {
      void showLog(name, button).catch(showError);
    }
  });
}

async function boot() {
  bindEvents();
  await refreshStatus();
}

void boot().catch((error) => {
  els.instancesBody.innerHTML = `
    <tr>
      <td colspan="6" class="empty">加载失败：${error.message}</td>
    </tr>
  `;
});
