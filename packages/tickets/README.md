# tickets

通过本地 Markdown 文件管理票图，检查依赖、查询直接前置、修改状态和追溯历史。需要 Node.js 24.21.0 或更新的 24.x 版本及 pnpm；项目无需添加依赖。

统一入口：

```sh
pnpm dlx @ykdz/tickets@latest --help
pnpm dlx @ykdz/tickets@latest --version
pnpm dlx @ykdz/tickets@latest schema
```

初始化配置，不覆盖已有文件；票目录需要自行创建：

```sh
pnpm dlx @ykdz/tickets@latest init --config ticket-graph.json --tickets issues --completion-value resolved
```

`--completion-value` 可以重复提供；完成值保留空白、大小写和重复项，按原值精确匹配。票目录相对于配置文件解析，也可以使用绝对路径。配置中的 `$schema` 指向生成配置时工具版本对应的公开 JSON Schema；命令始终使用包内规则校验，无需读取远程定义，也不会改写旧引用。

票文件名以数字标识开头，以 `.md` 结尾，如 `01-first.md`；前导零是标识的一部分。文件头固定使用 `status` 和 `blocked_by`，正文自由编辑：

```markdown
---
status: open
blocked_by: ["02"]
---

# 实施需求

这里记录交付内容。
```

```sh
pnpm dlx @ykdz/tickets@latest check --config ticket-graph.json
pnpm dlx @ykdz/tickets@latest list --config ticket-graph.json --filter unblocked
pnpm dlx @ykdz/tickets@latest set-status --config ticket-graph.json 01 02 --status resolved
pnpm dlx @ykdz/tickets@latest set-deps --config ticket-graph.json 01 02 03
pnpm dlx @ykdz/tickets@latest set-deps --config ticket-graph.json 01 --clear
pnpm dlx @ykdz/tickets@latest history --config ticket-graph.json --ticket 01
```

`list` 支持 `all`（默认）、`unblocked`、`blocked`；只描述已声明的直接前置，不决定实施顺序，也不验证交付是否属实。`history` 的 `--ticket` 可省略。

默认输出结构化 JSON；退出码 `0` 表示成功，`2` 表示用法错误，`1` 表示执行失败。失败通过标准错误返回原因及 `effects` 中的实际保存情况。批量修改先整批预检，再逐票保存；发生故障后停止后续写入，不提供跨文件事务或自动回滚。票已保存而历史失败、写入后输出失败也会返回失败，重试前应核对实际效果。

允许逐步修复已有结构错误，但不得引入新错误；无实际变化时不写票或追加历史。同一票集的修改使用锁保护。历史位于配置文件旁的 `<配置文件名>.history.jsonl`，仅用于追溯；当前状态始终以票文件为准。

源码及问题反馈：[YKDZ/tickets](https://github.com/YKDZ/tickets)。本工具采用 MIT 许可证。
