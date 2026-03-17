# Contributing

感谢你愿意改进 `mihomo-multiport`。

## 开始之前

- 先阅读 [`README.md`](./README.md)
- 确认不要提交真实节点、密码、日志或运行缓存
- 大改动前建议先开一个 Issue 说明目标

## 本地开发

```bash
npm run check
npm test
```

如果你要验证完整流程，可以使用 [`examples/`](./examples) 中的示例文件，而不是提交真实订阅内容。

## 提交内容建议

- 保持改动聚焦，一个 PR 解决一类问题
- 更新相关文档和示例
- 如果改动影响导入、启动、停止或测试逻辑，请补或更新测试
- 如果改动影响 UI，请附一张截图或简短说明

## 不要提交的内容

- `nodes-inline.txt`
- `configs/generated/`
- `instances.generated.csv`
- `instances.generated.json`
- `logs/`
- `runtime/`
- `dist/`

发布或提交前可以运行：

```bash
npm run audit:release
```
