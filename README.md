# tickets

本地 Markdown 票图命令行工具，统一通过以下命令使用：

```sh
pnpm dlx @ykdz/tickets@latest --help
```

完整命令、票文件格式和失败处理见[使用说明](packages/tickets/README.md)，版本变化见[更新日志](packages/tickets/CHANGELOG.md)，发布流程见[发布说明](RELEASING.md)。

开发使用工作区指定的 Node.js 和 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:full
```

采用 MIT 许可证。
