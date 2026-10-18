# tickets

简单的 Markdown 票图命令行工具

```sh
pnpm dlx @ykdz/tickets@latest --help
```

票文件名以数字标识开头，以 `.md` 结尾，如 `01-first.md`；前导零是标识的一部分。文件头固定使用 `status` 和 `blocked_by`，正文自由编辑：

```markdown
---
status: open
blocked_by: ["02"]
---
```
