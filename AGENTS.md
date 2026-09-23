# BetterForward Worker 重构约束

本文件适用于整个仓库。开始工作前先阅读本文件和 `PLAN.md`。

## 项目目标与设计原则

- 将 BetterForward 重构为 Cloudflare Workers 上的 TypeScript 项目；默认技术栈为 Wrangler、Hono、grammY、Drizzle ORM 和 Cloudflare D1。
- Telegram 使用 Webhook；不保留 long polling、常驻线程、本地 SQLite、`diskcache` 或运行时本地文件依赖。
- 旧 BetterForward 仅是行为和迁移参考；保留用户可见行为、数据语义和安全边界，而非 Python 类结构。实现前追踪对应入口、调用者、数据库读写和测试；不得修改本地参考副本。
- 不为减少 diff 而保留不适合 Workers 的兼容层或历史抽象，也不得逐文件、逐类机械翻译。
- 引入依赖前说明它替代的自研代码；不为未来假设创建多实现接口、工厂、事件总线或仓储层。
- 同一事实只能有一个权威来源。除非有明确失效策略，不在 D1、KV 与实例内存间复制状态。
- 可以修正已证实的约束缺失、重复查询、竞态、幂等性、错误处理、安全边界和测试耦合问题；用户可见行为变化须在 `PLAN.md` 记录原因、迁移影响和验收方式。

## 模块、数据与安全边界

- 业务代码约 250 行为软限制；按真实业务职责拆分，禁止用仅一层调用的碎片文件或压缩格式规避限制。
- HTTP 路由仅负责认证、解析、调用应用逻辑与响应；grammY 负责 update 分发；复杂 SQL 不散落在 handler 中。
- Drizzle schema 是数据库结构的代码级权威来源，迁移只表达结构变更。Cloudflare bindings 必须经显式类型传递，不读取隐式全局变量。
- Telegram ID 在 JavaScript 边界使用字符串，避免 `number` 丢失 64 位精度。
- Webhook 必须验证 `X-Telegram-Bot-Api-Secret-Token`。
- 不依赖 Worker 实例内存保存会话、验证码、去重状态或设置；处理每一个 update 时考虑 Telegram 重试与重复投递。
- 创建话题、消息映射等关键写入须有数据库唯一约束或等价幂等保护。无界广播必须进入 Cloudflare Queue。
- 转发群首次绑定只接受目标 forum 群主聊天中经验证的管理员命令；不抓取 `t.me` HTML。

## 测试、文档与提交

- 非平凡业务分支至少保留一个可运行测试；优先纯业务逻辑和关键数据库约束，避免大量 mock 第三方内部实现。
- 每阶段结束前运行相应类型检查、单元测试、迁移验证和 Wrangler 本地集成检查；不得以编译通过替代转发、映射、鉴权和幂等验证。
- `PLAN.md` 是重构状态、未完成任务和架构决定的唯一权威计划；`AGENTS.md` 只保存长期跨项目规则。一次性材料放在 `docs/working/`，阶段结束后删掉并把有效结论收回正式文档。
- 新需求：全局规则更新 `AGENTS.md` 并同步计划；单个功能或接口更新 `PLAN.md` 及验收；分类不清且会改变方向时，写明假设后请求确认。
- 每次只推进 `PLAN.md` 中一个明确阶段。发现计划与平台或依赖实际能力冲突时，先修正计划再写代码。
- 提交使用 Conventional Commits：`<type>(<scope>): <description>`，描述用简洁英文祈使语气；一个提交只做一个可验证改动。不得提交 secret、bot token、完整邀请链接、生产群 ID 或 `.dev.vars`。

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Local Explorer (Debugging & Inspection)

When running `npx wrangler dev`, a Local Explorer API is available for inspecting and debugging local Workers, bindings, and storage state. The API base URL is printed in the terminal when the dev server starts.

Key endpoints (relative to the dev server URL):

| Endpoint | Description |
|----------|-------------|
| `GET /cdn-cgi/local/explorer/api/local/workers` | List local Workers and their bindings |
| `GET /cdn-cgi/local/explorer/api/storage/kv/namespaces` | List KV namespaces |
| `GET /cdn-cgi/local/explorer/api/d1/database` | List D1 databases |
| `GET /cdn-cgi/local/explorer/api/r2/buckets` | List R2 buckets |
| `GET /cdn-cgi/local/explorer/api/workers/durable_objects/namespaces` | List Durable Object namespaces |
| `GET /cdn-cgi/local/explorer/api/workflows` | List Workflows |
| `POST /cdn-cgi/local/explorer/api/local/observability/query` | Run a read-only SQL query (SELECT/WITH only) over captured request traces and console logs. Tables: `spans`, `logs` (read attributes via `json(attributes)`). Example: `curl -X POST <base>/cdn-cgi/local/explorer/api/local/observability/query -H 'Content-Type: application/json' -d '{"sql":"SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"}'` |
| `POST /cdn-cgi/local/explorer/api/local/observability/clear` | Clear all captured traces and logs |

If the routes above don't cover what you need, fetch the full OpenAPI schema (large - use only as a last resort): `GET /cdn-cgi/local/explorer/api`

Use the Local Explorer to debug issues by inspecting storage state (KV keys, D1 rows, R2 objects, DO storage), viewing Worker bindings, and querying request traces and logs captured during the dev session.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
