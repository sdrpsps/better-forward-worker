# BetterForward → Cloudflare Workers 重构计划

状态：**Phase 6 实现已完成；生产切换待凭据与人工窗口。**

## 目标与边界

将 BetterForward 重写为 Cloudflare Workers 原生 TypeScript 服务，逐步保留私聊与管理员群组话题间双向转发、消息映射、编辑删除、话题生命周期、管理命令/菜单/多步骤配置、自动回复、验证码、垃圾消息与封禁、权限与备注、广播、三语文案，以及可验证的 SQLite→D1 数据迁移。

这是架构重写：旧 Python 副本只用来确认行为与迁移数据，不定义 TypeScript 的模块边界。旧快照为 `012a8badde9bb8a768288a3a269e2f3e8118aed5`（上游 `main`，2026-08-28），位于 `/Users/sunny/Documents/Codex/2026-09-22/https-github-com-sidecloudgroup-betterforward-https/work/betterforward-source`，只读，不在其中实现。

## 确定的技术选择

| 领域 | 选择 | 用途 |
| --- | --- | --- |
| Runtime | Cloudflare Workers + TypeScript | Webhook、Queue consumer、计划任务 |
| CLI | Wrangler | 本地开发、bindings、迁移、部署 |
| HTTP | Hono | Webhook、health、内部 API |
| Telegram | grammY | Update 分发、类型、Webhook |
| Database | D1 + Drizzle ORM | 持久化、schema、迁移、类型查询 |
| Validation | Zod | 环境和内部 API 的信任边界 |
| Test | Vitest + Workers test pool | 单元与 Worker/D1 集成 |
| Async jobs | Cloudflare Queues | 广播与批处理 |

使用 grammY 核心、`webhookCallback(..., "cloudflare-mod")`、commands/filter/callback/keyboard。默认不引入 KV 或 Durable Objects：第一版以 D1 作为唯一一致性来源，配合唯一约束和 update 幂等；读负载或真实并发证据出现后再评估。

## 架构与数据原则

```text
Telegram → Hono secret 验证 → grammY → forwarding application services → D1/Drizzle
广播命令 → Cloudflare Queue → 限流 Telegram 发送
```

- `topics.user_id`、`topics.thread_id`、`settings.key` 和 `processed_updates.update_id` 各自唯一。
- 消息映射按真实查询路径建立组合索引；Telegram ID 不通过 JS `number`。
- 临时状态含 `expires_at`，读取时判定过期，Cron 仅清理；邀请链接只保存规范化 SHA-256 与已知 chat ID。
- 私有群 ID API 为 `POST /internal/chat-id/resolve`，Bearer 鉴权、严格链接校验、失败限流和脱敏审计。只有机器人已观察的邀请链接能解析；未知链接返回 `422 invite_link_not_observed`。Bot API 不能从任意私有邀请链接反查 chat ID，不能以抓取 `t.me` 冒充该能力。
- 私有群的可靠补充流程是私聊 `request_chat`，保存 `chat_shared.chat_id` 后再验证机器人权限。任意链接解析如有需求，另立 MTProto 服务项目评估账号风控、session 加密与运维。

## Phase 0 盘点记录

| 上游入口 | 数据/外部调用 | 迁移处理 |
| --- | --- | --- |
| `src/bot.py`、`handlers/message_handler.py` | `topics`、`messages`；forum topic、转发、回复、编辑、reaction，九类消息媒体 | 保留，Phase 1/2；用 D1 唯一约束、消息映射和 grammY Bot API 重写 |
| `handlers/command_handler.py` | 用户与管理员命令：help、ban、terminate、delete、verify、note、refresh、permissions | 保留，按 Phase 2/3/4 分批迁移 |
| `handlers/admin_handler.py`、`callback_handler.py` | 菜单、自动回复、广播、验证码、时区、TGuard、垃圾关键词、封禁回复 | 保留，Phase 3/4/5；多步骤操作改 D1 state，广播改 Queue |
| `database.py`、`db_migrate/*.py` | `settings`、`auto_response`、`verified_users`、`blocked_users`、`user_permission_overrides`、topic note 与 indexes | 保留数据语义，Phase 1/4 重新建 schema；SQLite 只在 Phase 6 工具中读取 |
| `utils/message_queue.py`、`diskcache`、`infinity_polling` | 进程内队列、缓存、常驻 polling、本地文件状态 | 删除；Webhook + D1，Phase 5 Queue 取代广播队列 |

上游直接调用 `get_chat`、`get_chat_member`、`get_me`、`set_my_commands`、发送/编辑/删除/转发消息和 topic API。Worker 版本继续经 grammY 调用；Phase 0 webhook 提供 bot info，因此不会在请求处理中隐式 `getMe`。

## Phase 0 — 架构 spike 与项目骨架

- [x] 以参考仓库建立功能/数据/外部调用清单，并标记保留、优化、替换或删除。
- [x] 初始化 TypeScript、Wrangler、Hono、Vitest。
- [x] 以 grammY `cloudflare-mod` 接入 Webhook，完成 secret header 验证。
- [x] 接入本地 D1 与 Drizzle，完成真实迁移和可重复集成测试。
- [x] 验证多步骤状态可跨 Worker 请求恢复、取消和过期；最终只保留一种会话机制。
- [x] 验证动态菜单 callback payload；不保留未采用 spike 代码。
- [x] 记录依赖锁定与升级命令。

**会话决定（2026-09-22）：** 不采用 `@grammyjs/conversations`。该库是回放引擎；数据库、网络、时间和随机性副作用均要经 `conversation.external`，且官方文档未提供 D1 专用 adapter。Phase 3 改用显式 D1 `admin_sessions` 状态机：状态、payload、过期和取消均可审计和测试。menu spike 成功创建了带短字符串 payload 的 callback menu；该 payload 只用于 ID/页码等无状态数据，不存业务数据。`@grammyjs/menu` 仅在 Phase 3 有真实菜单时再安装，当前没有遗留依赖或实验代码。

**实现与验证（2026-09-22）：** `pnpm cf-typegen`、`pnpm typecheck`、`pnpm test` 均通过（4 tests）；`pnpm exec wrangler d1 migrations apply better-forward --local` 成功应用 `0001_phase_0.sql`；在 `wrangler dev` 上，错误 secret 返回 401，正确 Telegram fixture 返回 200。生产部署前须运行 `pnpm exec wrangler d1 create better-forward`，以输出的真实 `database_id` 替换 `wrangler.jsonc` 的本地占位 ID，并用 `wrangler secret put` 设置 `BOT_TOKEN`、`BOT_INFO_JSON`、`TELEGRAM_WEBHOOK_SECRET`。

**Phase 0 验收：** 核心功能能映射到上游入口、相关表和测试；`wrangler dev` 能接收 Telegram fixture；错误 secret 为 401，正确 secret 进入 grammY；D1 测试可重复；不存在两套会话实现或未使用脚手架。完成时删除比较稿与实验入口，仅在本文件保留决定。

## Phase 1 — 数据层与 Webhook 基础

- [x] Drizzle 定义 topics、messages、settings、processed updates、临时状态；建立唯一约束、索引、外键策略与时间约定。
- [x] 实现 update claim/complete/failure 幂等策略，grammY context flavor（env、db、request id、logger），健康检查，以及受保护 webhook setup/status 命令或运维脚本。
- [x] 设置 `allowed_updates` 与初始 `max_connections` 并记录扩容条件。

**Phase 1 实现与验收（2026-09-22）：** `0002_phase_1.sql` 新增 topics、messages、settings、processed_updates；消息映射和 topic 标识由 D1 唯一约束保护，Telegram ID 在 schema 中使用文本。Webhook middleware 先 claim update，完成或失败后更新状态；完成记录和新鲜 claim 会抑制 Telegram 重复投递，失败和超过 5 分钟的 claim 可重试。`GET/POST /internal/webhook/status|setup` 仅接受 `INTERNAL_API_SECRET` Bearer，setup 使用 `allowed_updates=[message,edited_message,message_reaction,callback_query]` 与 `max_connections=40`。Cloudflare 当前 Workers 限制文档显示单请求同时出站连接仍为 6，初始 40 仅为 Telegram webhook 并发参数；观察 webhook 429/CPU/D1 延迟后再调整，不在本阶段引入 Queue/DO。`pnpm cf-typegen`、`pnpm typecheck`、`pnpm test`、本地 migration apply 均作为验收命令。

验收：重复 update 不重复创建话题/映射；Webhook 初始化不在运行时调用 `getMe`。

## Phase 2 — 核心双向转发

- [x] 首条用户消息创建话题；用户→话题覆盖文本、图片、贴纸、视频、文件、语音、音频、动画、联系人。
- [x] 管理员话题→用户回复，保存 received/forwarded 映射与 reply threading；处理被手工删除的话题映射与重建。
- [x] 迁移 `/start`、`/help`、`/delete`、`/terminate`、`/refresh`；实现编辑/reaction 或记录差异。

**Phase 2 实现与验收（2026-09-22）：** `src/forwarding.ts` 使用 Telegram `copyMessage` 统一覆盖文本和媒体类型；D1 `topics`/`messages` 唯一约束保存双向映射并重建 reply 参数。`/delete` 删除 forum topic 和映射，`/terminate`/`/refresh` 关闭或重开 topic；文本编辑和 reaction 沿映射同步。首条消息 topic 创建采用 user_id 唯一约束，竞争插入读取已存在 topic；明确的 thread-not-found 错误会保留 topic 主键、重建论坛话题并只重试一次，其他 Telegram 外部调用失败会让 update 标记 failed 以便重试。`pnpm typecheck`、`pnpm test -- --run`（12 tests，含失效话题重建）和 `git diff --check` 通过。

验收：fixture 覆盖双向文本、媒体、回复、重复 update、失效话题重建，测试群完成一次端到端验证。

## Phase 3 — 管理流程与私有群解析

- [x] 迁移管理菜单/callback 和全部多步骤配置，支持取消、超时、并发管理员。
- [x] 实现 `request_chat`、已观察邀请链接 hash→chat ID、内部解析接口、Bearer 鉴权、校验、限流、审计。

**Phase 3 实现与验收（2026-09-22）：** `src/admin-flow.ts` 使用原生 grammY inline/reply keyboard，管理员资格通过 `getChatMember` 验证；D1 `admin_sessions` 提供每个管理员独立 scope、取消和过期状态，Phase 4 的具体策略继续复用该状态机。`request_chat` 的 `chat_shared` 会先调用 `getChat/getChatMember` 验证机器人可见性。`src/chat-id.ts` 只规范化 `https://t.me/+...`/`joinchat/...`，保存 SHA-256 hash 和 chat ID；`chat_join_request` 观察链接，`POST /internal/chat-id/resolve` 独立 Bearer 鉴权，未知链接 422，所有结果写脱敏审计。`pnpm typecheck`、`pnpm test -- --run`（7 tests）和本地 0003 migration 通过。

验收：接口不泄露邀请链接；已知链接可解析，未知链接经测试返回明确 422；不以 obscurity 替代鉴权。

## Phase 4 — 策略与辅助功能

- [x] 自动回复（文本、媒体、正则、时间窗、时区）、默认欢迎消息、封禁与封禁回复、用户备注、全局/单用户权限。
- [x] 按钮/数学题/TGuard 验证、过期临时状态、垃圾关键词/话题和三语 i18n 缺失键验证。

**Phase 4 实现与验收（2026-09-22）：** `0004_phase_4.sql` 新增自动回复、blocked/verified、权限覆盖、captcha challenge 和 spam keyword 表；`src/policy.ts` 提供三语文案、缺失键检查、正则长度/危险结构边界、时区时间窗、D1 封禁/权限读取、垃圾关键词阻断和过期数学题。自动回复支持文本及 `photo:FILE_ID`、`video:FILE_ID`、`document:FILE_ID`、`audio:FILE_ID`、`voice:FILE_ID`、`animation:FILE_ID` 媒体格式；`/start` 从 `settings.default_message` 读取欢迎文案。消息入口在转发前执行封禁、验证码、垃圾关键词和自动回复短路，所有挑战与验证状态写 D1，未配置 captcha 时不改变现有行为。用户备注沿用 `topics.note`。TGuard 仍需真实 API/Mini App 契约和 secret，保留为部署前明确待办，不伪造外部验证结果。`pnpm typecheck`、`pnpm test -- --run`（14 tests）和 `git diff --check` 通过。

验收：设置跨请求保持；过期状态不依赖 Cron 也不会被接受；正则输入有安全边界。

## Phase 5 — 广播、可靠性与可观测性

- [x] 广播进入 Queue，consumer 按 Telegram 限流退避并记录结果；默认脱敏结构化日志。
- [x] 建立 webhook 错误率、Queue backlog、429、D1 错误、重复 update 信号；做并发/故障注入测试并决定是否需提高连接数或引入 DO。

**Phase 5 实现与验收（2026-09-22）：** `better-forward-broadcast` producer/consumer 写入 Wrangler 配置；`POST /internal/broadcast` 只入队 `{sourceChatId,sourceMessageId}`，consumer 批量读取 topics 后逐用户 `copyMessage`。Telegram 429 只在 5 次内按 2^attempt、上限 60 秒退避，其他错误记录脱敏结构化日志并 ack，避免无限重试放大。`GET /internal/metrics` 暴露 queue backlog 和 failed update 计数；webhook claim/complete/failure 继续提供重复 update 信号。Cloudflare 当前 Queue 限制为 128 KB/message、100 messages/batch、100 retries、250 concurrent consumers；本阶段保持 `max_concurrency=1`，没有证据前不引入 DO。`pnpm cf-typegen`、`pnpm typecheck`、`pnpm test -- --run`（9 tests）、本地 0005 migration 通过。

验收：大型广播不阻塞 Webhook；429 可恢复；日志无敏感值；重试不会无限放大。

## Phase 6 — 数据迁移与切换

- [x] 编写 SQLite→D1 转换工具（Worker 运行时不读取 SQLite），支持 dry-run、备份、回滚与重复执行。
- [x] 校验 topics、消息映射、settings、rules、verified/blocked 用户、权限记录计数；在测试 bot 回归。
- [ ] 配置生产 secret、D1、Queue、Webhook，停止旧 polling、处理 pending updates、切换并观察重复/丢失；观察窗口后删除 Python/Docker/旧部署文档。

**Phase 6 实现与验收（2026-09-22）：** `scripts/migrate-sqlite.mjs` 仅使用 Node 24 `node:sqlite` 在部署外读取旧库，生成 D1 可执行的 `up.sql`、`rollback.sql` 和 JSON 计数报告；`--dry-run` 不写 SQL/备份，`--backup` 复制源库，`--rollback report.json` 重建回滚 SQL，topic/message/settings/rules/verified/blocked/permission 均按稳定 key 幂等。已对本地 D1 SQLite 文件运行 dry-run，`pnpm typecheck`、`pnpm test -- --run`（9 tests）和迁移验证通过。生产 D1/Queue 创建、`wrangler secret put`、测试 bot smoke、pending updates 排空、旧 polling 停止和观察窗口需要实际 Cloudflare/Telegram 凭据，因此保留为部署前 checklist，不在本地提交中宣称完成。

验收：迁移报告数量一致；生产 smoke test 通过；回滚经演练可执行。

## 每阶段结束清单

- [ ] 验收完成、相关格式化/类型/测试/迁移/本地检查通过。
- [ ] 更新本文件和必要的长期 `AGENTS.md` 规则；删除已取代的临时材料，检查 README、示例配置与命令未漂移。
- [ ] 记录主动改变旧行为的原因、兼容影响与测试证据；提交原子且符合 Conventional Commits。

## 尚待确认（不阻塞 Phase 0）

- 生产用户/日消息/单次广播规模；是否完整迁移现有 SQLite；是否要求菜单文案层级完全一致。
- 内部 chat ID API 调用者、网络位置和认证（默认独立 Bearer secret）。
- 是否需要自定义 Telegram Bot API 地址（默认可选 secret/var，不围绕它建立抽象）。

## 依赖策略

`pnpm-lock.yaml` 是可重复安装的权威版本；CI/部署使用 `pnpm install --frozen-lockfile`。升级时运行 `pnpm outdated`，一次只升级一组相关依赖，执行 `pnpm test`、`pnpm exec tsc --noEmit` 和 `pnpm exec wrangler types`，并提交 `package.json` 与 lockfile 的同一原子变更。
