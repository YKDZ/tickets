# 更新日志

## 2.0.0

### 不兼容变更

- 升级到 Node.js 26.13.1 及以上的 26.x 版本，采用新版 CLI 契约和发布流程。

  - 使用 `tickets --schema` 查看命令目录，再用 `tickets check --schema=input` 查询指定契约。移除旧的 `tickets schema`。
  - 结构化结果的 `schemaVersion` 为 `"3"`，业务结果带有 `outputMode`。六个业务命令默认返回结构化结果，也可通过 `--output text` 阅读英文结果。
  - 例如，检查通过时返回 `{"schemaVersion":"3","command":"check","outputMode":"structured","kind":"data","variant":"checked","data":{"scope":{"config":"/project/ticket-graph.json","tickets":"/project/issues"},"valid":true,"total":2}}`。
  - 现有票集配置、票文件与历史可继续使用。随包提供与版本对应的票集配置 Schema。

## [Unreleased]

## [1.0.1] - 2026-10-18

- 统一维护包内 README，简化说明并调整包首页链接。
- 移除文档存在性、占位内容与固定构建文件清单检查，保留实际安装包和票图行为验收。
- 适配锁定 npm 版本的查询结果格式，修复 OIDC 发布前检查。
- 发布后等待 npm 索引可见，再核对制品与版本；工作流重跑可继续尚未开始的 GitHub Release。

## [1.0.0] - 2026-10-18

- 将票图工具迁移为独立 npm 命令行产品 `@ykdz/tickets`，命令名为 `tickets`。
- 保留初始化、校验、前置查询、批量状态修改、依赖修改、历史与故障效果报告。
- 使用 Valibot 统一运行时校验与公开配置 JSON Schema，配置引用固定到实际工具版本。
