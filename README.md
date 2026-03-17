# mihomo-multiport

`mihomo-multiport` 是一个通用的多端口代理管理器。

它的目标不是服务某个上层系统，而是把订阅里的多个节点拆成多个独立本地端口，让每个端口固定走一个节点，方便用户在浏览器、命令行工具、桌面客户端或容器里自由切换。

![Console preview](./docs/console-live.png)

## 适用场景

- 你有一份 Mihomo / Clash 风格订阅或节点列表
- 你希望每个节点映射成一个固定的本地代理端口
- 你不想在 GUI 客户端里手动切换节点
- 你希望项目本身适合直接公开到 GitHub

## 核心能力

- 支持导入 Mihomo/Clash YAML、行内节点文本、JSON
- 自动为每个节点生成一份独立的 `mihomo` 配置
- 自动分配本地端口，例如 `7891`、`7892`、`7893`
- 一键启动、停止、测试全部节点
- 提供本地 Web 管理台
- 支持查看日志、筛选实例、复制代理地址、删除实例
- 支持发布前审计本地文件

## 工作方式

例如导入三个节点后，会得到：

```text
Node A -> http://127.0.0.1:7891
Node B -> http://127.0.0.1:7892
Node C -> http://127.0.0.1:7893
```

如果你在 Docker 容器里访问，也可以使用：

```text
http://host.docker.internal:7891
http://host.docker.internal:7892
http://host.docker.internal:7893
```

默认生成的是 `mixed-port`，因此同一个端口可以同时用于 HTTP 和 SOCKS5。

## 前置条件

- macOS
- `Node.js`
- `mihomo`

推荐直接把 `mihomo` 安装到当前项目目录：

```bash
cd mihomo-multiport
./install-mihomo-local.sh
```

安装后会生成：

```text
bin/mihomo-arm64
```

或：

```text
bin/mihomo-x86_64
```

## 目录结构

- `src/`
  核心逻辑、CLI、Web 服务
- `public/`
  本地管理台页面
- `examples/`
  可直接公开的示例导入文件
- `tests/`
  自动化测试
- `configs/`
  示例配置和自动生成配置目录
- `scripts/release-audit.js`
  开源发布前的本地文件检查脚本

## 支持的导入格式

### 1. Mihomo / Clash YAML

```yaml
proxies:
  - name: "SGP 01"
    type: ss
    server: example.org
    port: 30401
    cipher: aes-128-gcm
    password: secret
```

### 2. Clash 行内节点

```text
- {name: JPN 01, server: example.com, port: 20201, type: ss, cipher: aes-128-gcm, password: secret, udp: true}
- {name: USA 01, server: example.com, port: 20251, type: ss, cipher: aes-128-gcm, password: secret, udp: true}
```

### 3. JSON

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

### 4. 多段混合导入

如果你想一次粘贴多段内容，可以直接把多段 YAML / JSON / 行内节点放在同一个输入框中。

推荐在不同段之间加一行：

```text
---
```

例如：

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

导入时会自动识别并合并多个节点。

## 快速开始

### 1. 导入节点

从剪贴板导入：

```bash
cd mihomo-multiport
./import-from-clipboard.sh
```

从文件导入：

```bash
node ./src/cli.js import --input ./examples/sample-proxies.yaml
```

自定义起始端口：

```bash
node ./src/cli.js import --input ./examples/sample-inline-nodes.txt --base-port 9001
```

### 2. 启动管理台

```bash
cd mihomo-multiport
npm run web
```

默认地址：

```text
http://127.0.0.1:8787
```

管理台支持：

- 粘贴或上传节点文件
- 自动识别导入格式
- 手动启动/停止单个实例
- 删除单个实例
- 一键启动/停止/测试全部实例
- 搜索与状态筛选
- 复制本地代理地址
- 查看日志尾部

### 3. 命令行管理

```bash
node ./src/cli.js status
node ./src/cli.js start
node ./src/cli.js stop
npm run proxy:test
```

兼容脚本入口仍然可以继续使用：

```bash
./start-mihomo-nodes.sh
./stop-mihomo-nodes.sh
./test-mihomo-proxies.sh
```

## 导入后会生成什么

导入完成后会生成：

- `configs/generated/*.yaml`
- `instances.generated.csv`
- `instances.generated.json`

端口默认从 `7891` 开始递增，也可以通过 `--base-port` 或管理台输入框修改。

如果节点名里包含地区缩写，系统会自动推断预期地区：

- `JPN` -> `JP`
- `USA` -> `US`
- `HKG` -> `HK`
- `SGP` -> `SG`

这些信息会用于测试脚本校验出口地区。

## 开发检查

语法检查：

```bash
npm run check
```

自动化测试：

```bash
npm test
```

发布前审计：

```bash
npm run audit:release
```

## 哪些文件建议删除或不要发布

运行 `npm run audit:release` 后，通常需要重点关注这些内容：

- `.DS_Store`
- `dist/`
- `logs/`
- `runtime/`
- `nodes-inline.txt`
- `instances.generated.csv`
- `instances.generated.json`
- `configs/generated/`

说明：

- `dist/`、`logs/`、`runtime/` 属于本地构建和运行产物，建议删除
- `nodes-inline.txt`、`configs/generated/`、`instances.generated.*` 可能包含真实节点信息，建议不要公开
- `examples/` 目录里的文件是可以公开的示例
- `configs/hkg01.yaml` 和 `configs/sgp01.yaml` 当前是脱敏示例，可以保留

## 打包到另一台电脑

```bash
cd mihomo-multiport
./package-portable.sh
```

会生成：

```text
dist/mihomo-multiport-portable-YYYYMMDD-HHMMSS.tar.gz
```

## 后续建议

当前仓库已经包含：

- 示例截图
- GitHub Actions CI 工作流
- `CHANGELOG.md`

如果你准备继续完善 GitHub 开源仓库，下一步建议补：

- 一张真实运行截图或 GIF 演示
- GitHub Releases 发布说明
- 一个简短的使用视频或 GIF

## CI

- GitHub Actions workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

## Changelog

- 变更记录：[`CHANGELOG.md`](./CHANGELOG.md)

## License

This project is released under the MIT License. See [`LICENSE`](./LICENSE).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
