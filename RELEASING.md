# 发布

正式入口为 `.github/workflows/release.yml`。修改公开包版本和 `packages/tickets/CHANGELOG.md`，通过审查后合入受保护的默认分支，再手动运行该工作流。它执行 `check:full`、验证实际安装包、保存候选制品，随后通过 npm OIDC 发布同一份制品，并创建对应的 GitHub Release。

发布前本地复验：

```sh
pnpm run publication:readiness --require-ready
pnpm run check:full
```

需要保留候选包时，先创建一个空目录，再执行：

```sh
pnpm run publication:artifact --output-directory /absolute/path/to/empty-directory
```

该目录包含已经验证的 `.tgz`、`SHA512SUMS` 和 `verified-publication-artifact.json`。首次发布使用这份经过校验的包，避免人工重新打包。

首次发布需要维护者完成 npm 登录、`@ykdz` 作用域权限确认及包的创建。本项目正式首发为 `1.0.0`，可直接在维护者已认证的环境中发布已验证的 `ykdz-tickets-1.0.0.tgz`：

```sh
pnpm exec npm publish /absolute/path/to/ykdz-tickets-1.0.0.tgz --access public --tag latest --registry https://registry.npmjs.org/
```

这一步会正式发布 `1.0.0`，无需再发布占位版本。首次包创建后，在 npm 的包设置中配置 Trusted Publisher：GitHub 用户或组织 `YKDZ`，仓库 `tickets`，工作流文件 `release.yml`，不指定 Environment。确认仓库默认分支保护及 GitHub Release 所需设置后，后续版本复用正式工作流。[npm Trusted Publisher 官方说明](https://docs.npmjs.com/trusted-publishers/)

正式工作流按“已存在稳定 latest，当前版本尚未发布”的条件发布新版本；手工首次发布后，下一次发布应先提升版本号。若维护者选择其他引导方式，须明确其版本及 tag，保留正式 `1.0.0` 的发布计划；npm 的同名同版本不能重复使用。[npm publish 官方说明](https://docs.npmjs.com/cli/commands/npm-publish/)

发布后，在独立临时目录中通过 `pnpm dlx @ykdz/tickets@latest` 验证初始化、检查、修改和历史，再获取配置 `$schema` 中的固定版本公开地址，使用独立 JSON Schema 校验器验证配置。公开访问的核验只在发布后进行。

若发布在外部写入后中断，保留 npm、tag、Release 和候选包的实际结果；仅在失败作业重跑仍使用已接受制品时重跑，不重新打包或覆盖远程状态。首次 OIDC 发布成功后，可按 npm 账户政策完成发布权限与旧令牌清理。
