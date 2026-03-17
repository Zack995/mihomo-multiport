# mihomo-multiport

中文 | [English](./README.md)

`mihomo-multiport` 是一个把订阅节点展开为多个固定本地代理端口的工具，让每个节点都能作为独立入口运行。

它适合这些场景：

- 导入 Mihomo / Clash 风格节点
- 一个节点对应一个本地端口
- 通过切换端口来切换节点，而不是依赖 GUI 选择器
- 用本地管理后台统一管理导入、启动、停止、测试和删除

![管理后台截图](./docs/console-live.png)

## 功能特性

- 支持导入 Mihomo / Clash YAML、行内节点、JSON
- 支持多段混合导入并自动识别格式
- 为每个节点生成独立的 Mihomo 配置
- 支持单个实例启动、停止、测试、删除
- 支持批量启动 / 停止 / 测试
- 提供本地 Web 管理后台
- 提供发布前审计脚本，避免误传本地产物

## 工作方式

导入 3 个节点后，会得到类似这样的端口：

```text
Node A -> http://127.0.0.1:7891
Node B -> http://127.0.0.1:7892
Node C -> http://127.0.0.1:7893
```

如果需要在 Docker 容器里访问，也可以使用：

```text
http://host.docker.internal:7891
http://host.docker.internal:7892
http://host.docker.internal:7893
```

默认生成的是 `mixed-port`，因此同一个端口可以同时供 HTTP 和 SOCKS5 使用。

## 运行要求

- macOS
- Node.js
- `mihomo`

建议先把 Mihomo 安装到项目目录：

```bash
cd mihomo-multiport
./install-mihomo-local.sh
```

## 快速开始

从文件导入：

```bash
node ./src/cli.js import --input ./examples/sample-proxies.yaml
```

从剪贴板导入：

```bash
./import-from-clipboard.sh
```

启动管理后台：

```bash
npm run web
```

默认地址：

```text
http://127.0.0.1:8787
```

## 支持的导入格式

### YAML

```yaml
proxies:
  - name: "SGP 01"
    type: ss
    server: example.org
    port: 30401
    cipher: aes-128-gcm
    password: secret
```

### 行内节点

```text
- {name: JPN 01, server: example.com, port: 20201, type: ss, cipher: aes-128-gcm, password: secret, udp: true}
- {name: USA 01, server: example.com, port: 20251, type: ss, cipher: aes-128-gcm, password: secret, udp: true}
```

### JSON

```json
[
  {
    "name": "USA 01",
    "type": "ss",
    "server": "example.net",
    "port": 30501,
    "cipher": "aes-128-gcm",
    "password": "secret"
  }
]
```

### 多段混合导入

如果要一次导入多段内容，推荐用 `---` 分隔：

```text
proxies:
  - name: "SGP 01"
    type: ss
    server: example.org
    port: 30401
    cipher: aes-128-gcm
    password: secret
---
- {name: USA 01, server: example.com, port: 20251, type: ss, cipher: aes-128-gcm, password: secret}
```

## 常用命令

```bash
node ./src/cli.js status
node ./src/cli.js start
node ./src/cli.js stop
npm run proxy:test
```

兼容脚本仍然可用：

```bash
./start-mihomo-nodes.sh
./stop-mihomo-nodes.sh
./test-mihomo-proxies.sh
```

## 导入后生成的文件

- `configs/generated/*.yaml`
- `instances.generated.csv`
- `instances.generated.json`

默认从 `7891` 开始分配端口，也可以通过 `--base-port` 调整。

## 开发检查

语法检查：

```bash
npm run check
```

测试：

```bash
npm test
```

发布前审计：

```bash
npm run audit:release
```

## 建议保留的文档

- `README.md`
- `README.zh-CN.md`
- `LICENSE`

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

## 许可证

MIT，见 [`LICENSE`](./LICENSE)。
