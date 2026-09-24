# BetterForward → Cloudflare Workers 重构计划

状态：**Phase 6 实现已完成；生产切换待凭据与人工窗口。**

## 目标与边界

将 BetterForward 重写为 Cloudflare Workers 原生 TypeScript 服务，逐步保留私聊与管理员群组话题间双向转发、消息映射、编辑删除、话题生命周期、管理命令/菜单/多步骤配置、自动回复、验证码、垃圾消息与封禁、权限与备注、三语文案，以及可验证的 D1 schema migration。

这是架构重写：旧 Python 副本只用来确认行为与数据语义，不定义 TypeScript 的模块边界。旧快照为 `012a8badde9bb8a768288a3a269e2f3e8118aed5`（上游 `main`，2026-08-28），位于 `/Users/sunny/Documents/Codex/2026-09-22/https-github-com-sidecloudgroup-betterforward-https/work/betterforward-source`，只读，不在其中实现。

## 确定的技术选择

| 领域 | 选择 | 用途 |
| --- | --- | --- |
| Runtime | Cloudflare Workers + TypeScript | Webhook |
| CLI | Wrangler | 本地开发、bindings、迁移、部署 |
| HTTP | Hono | Webhook、health |
| Telegram | grammY | Update 分发、类型、Webhook |
| Database | D1 + Drizzle ORM | 持久化、schema、迁移、类型查询 |
| Validation | Zod | 环境变量信任边界 |
| Test | Vitest + Workers test pool | 单元与 Worker/D1 集成 |

使用 grammY 核心、`webhookCallback(..., "cloudflare-mod")`、commands/filter/callback/keyboard。默认不引入 KV 或 Durable Objects：第一版以 D1 作为唯一一致性来源，配合唯一约束和 update 幂等；读负载或真实并发证据出现后再评估。

## 架构与数据原则

```text
Telegram → Hono secret 验证 → grammY → forwarding application services → D1/Drizzle
```

- `topics.user_id`、`topics.thread_id`、`settings.key` 和 `processed_updates.update_id` 各自唯一。
- 消息映射按真实查询路径建立组合索引；Telegram ID 不通过 JS `number`。
- 临时状态含 `expires_at`，读取时判定过期，Cron 仅清理；转发群首次绑定由目标 forum 群主聊天中的管理员命令完成并验证机器人权限。

## Phase 0 盘点记录

| 上游入口 | 数据/外部调用 | 迁移处理 |
| --- | --- | --- |
| `src/bot.py`、`handlers/message_handler.py` | `topics`、`messages`；forum topic、转发、回复、编辑、reaction，九类消息媒体 | 保留，Phase 1/2；用 D1 唯一约束、消息映射和 grammY Bot API 重写 |
| `handlers/command_handler.py` | 用户与管理员命令：help、ban、terminate、delete、verify、note、refresh、permissions | 保留，按 Phase 2/3/4 分批迁移 |
| `handlers/admin_handler.py`、`callback_handler.py` | 菜单、自动回复、验证码、时区、TGuard、垃圾关键词、封禁回复 | 保留，Phase 3/4；多步骤操作改 D1 state |
| `database.py`、`db_migrate/*.py` | `settings`、`auto_response`、`verified_users`、`blocked_users`、`user_permission_overrides`、topic note 与 indexes | 保留数据语义，Phase 1/4 重新建 schema |
| `utils/message_queue.py`、`diskcache`、`infinity_polling` | 进程内队列、缓存、常驻 polling、本地文件状态 | 删除；Webhook + D1 |

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
- [x] 实现 update claim/complete/failure 幂等策略，grammY context flavor（env、db、request id、logger）、健康检查与本地 webhook 运维脚本。
- [x] 设置 `allowed_updates` 与初始 `max_connections` 并记录扩容条件。

**Phase 1 实现与验收（2026-09-22；2026-09-23 更新）：** `0002_phase_1.sql` 新增 topics、messages、settings、processed_updates；消息映射和 topic 标识由 D1 唯一约束保护，Telegram ID 在 schema 中使用文本。Webhook middleware 先 claim update，完成或失败后更新状态；完成记录和新鲜 claim 会抑制 Telegram 重复投递，失败和超过 5 分钟的 claim 可重试。Webhook 配置仅由 `pnpm webhook:set` 完成，使用 `allowed_updates=[message,edited_message,message_reaction,callback_query]` 与 `max_connections=40`；Worker 不再暴露内部运维 HTTP API。Cloudflare 当前 Workers 限制文档显示单请求同时出站连接仍为 6，初始 40 仅为 Telegram webhook 并发参数。`pnpm cf-typegen`、`pnpm typecheck`、`pnpm test`、本地 migration apply 均作为验收命令。

验收：重复 update 不重复创建话题/映射；Webhook 初始化不在运行时调用 `getMe`。

## Phase 2 — 核心双向转发

- [x] 首条用户消息创建话题；用户→话题覆盖文本、图片、贴纸、视频、文件、语音、音频、动画、联系人。
- [x] 管理员话题→用户回复，保存 received/forwarded 映射与 reply threading；处理被手工删除的话题映射与重建。
- [x] 迁移 `/start`、`/help`、`/delete`、`/terminate`、`/refresh`；实现编辑/reaction 或记录差异。

**Phase 2 实现与验收（2026-09-22）：** `src/forwarding.ts` 使用 Telegram `copyMessage` 统一覆盖文本和媒体类型；D1 `topics`/`messages` 唯一约束保存双向映射并重建 reply 参数。`/delete` 删除 forum topic 和映射，`/terminate`/`/refresh` 关闭或重开 topic；文本编辑和 reaction 沿映射同步。首条消息 topic 创建采用 user_id 唯一约束，竞争插入读取已存在 topic；明确的 thread-not-found 错误会保留 topic 主键、重建论坛话题并只重试一次，其他 Telegram 外部调用失败会让 update 标记 failed 以便重试。`pnpm typecheck`、`pnpm test -- --run`（12 tests，含失效话题重建）和 `git diff --check` 通过。

验收：fixture 覆盖双向文本、媒体、回复、重复 update、失效话题重建，测试群完成一次端到端验证。

## Phase 3 — 管理流程与群组选择

- [x] 迁移管理菜单/callback 和全部多步骤配置，支持取消、超时、并发管理员。
- [x] 以目标 forum 群主聊天的管理员命令完成首次绑定与权限校验。
- [x] 修正首次转发群初始化：在目标 forum 群主聊天由管理员执行 `/setup`、`/start`、`/help` 或 `/admin`，验证群、操作者与 Bot 权限后原子写入 D1。

**Phase 3 实现与验收（2026-09-22；2026-09-24 更新）：** `src/admin-flow.ts` 使用原生 grammY inline/reply keyboard，管理员资格通过 `getChatMember` 验证；D1 `admin_sessions` 提供每个管理员独立 scope、取消和过期状态，设置菜单会把 `default_message`/`captcha` 写入 D1，Phase 4 的具体策略继续复用该状态机。首次初始化不能信任私聊群组选择的任意发送者，也不能把配置只留在临时 session；改为在目标 forum 群主聊天验证管理员和 Bot 权限后原子持久化 `settings.forward_group_id`。管理员可用明确的 `/setup`，或 `/start`、`/help`、`/admin` 打开流程，私聊 `/start` 保持欢迎文案。这与原版从转发群主聊天打开管理菜单的行为一致，且不解析邀请链接或 `t.me` 页面。`pnpm typecheck`、`pnpm test -- --run`（19 tests）、本地 D1 migration 和 Wrangler 本地 `/health` 200 / 无 secret webhook 401 均通过；测试覆盖 forum 初始化、Bot 缺少 Manage Topics 权限拒绝和初始化后的首条私聊转发。

验收：群组选择验证不会泄露群组凭据。

## Phase 4 — 策略与辅助功能

- [x] 自动回复（文本、媒体、正则、时间窗、时区）的管理员创建、查看和删除；垃圾关键词的管理员创建、查看和删除。
- [x] 恢复旧系统实际使用的七类消息权限（photo、sticker、video、voice、file、link、username）及全局/单用户 allow/deny；拒绝未定义权限键，不再接受无效配置。
- [x] 按 Telegram `language_code` 分发英语、简体中文、日语文案，并以测试验证所有已声明键都有三语翻译。
- [x] 删除无读取方的 Worker context 字段、已废弃 callback payload、完成态 admin session 写入和 captcha attempts 列；新结构 migration 由 Drizzle Kit 生成，Wrangler 只负责应用。

**Phase 4 实现与验收（2026-09-22）：** `0004_phase_4.sql` 新增自动回复、blocked/verified、权限覆盖、captcha challenge 和 spam keyword 表；`0006_tguard_captcha.sql` 为外部 TGuard token/URL 增加持久化字段。`src/policy.ts` 提供三语文案、缺失键检查、正则长度/危险结构边界、时区时间窗、D1 封禁/权限读取、垃圾关键词阻断和过期数学题。自动回复支持文本及 `photo:FILE_ID`、`video:FILE_ID`、`document:FILE_ID`、`audio:FILE_ID`、`voice:FILE_ID`、`animation:FILE_ID` 媒体格式；`/start` 从 `settings.default_message` 读取欢迎文案。验证码支持数学文本、InlineKeyboard 按钮和真实 TGuard external API（`/api/verification/create`、`/api/verification-status/{token}`）；TGuard API key 只从 Worker secret 读取，D1 只保存短期 token/URL，callback/外部状态均校验用户和过期时间。消息入口在转发前执行封禁、验证码、垃圾关键词、有效权限和自动回复短路，管理员支持全局 `/permission key allow|deny` 及话题内 `/allow key`、`/deny key`，所有挑战与验证状态写 D1，未配置 captcha 时不改变现有行为。用户备注沿用 `topics.note`。`pnpm typecheck`、`pnpm test -- --run`（22 tests）和 `git diff --check` 通过。

**Phase 4 补全与清理（2026-09-24）：** 管理员菜单现以 D1 `admin_sessions` 可靠地完成自动回复的 trigger、literal/regex、文本或全部支持的 Telegram 媒体、全天或起止时间和 IANA 时区配置，并可分页查看、启用/停用和删除规则；垃圾关键词也可新增、查看和删除。权限注册表只接受旧系统真实使用的七个键，`all` 展开为这七项，消息分类覆盖 photo、sticker/animation、video、voice、audio/document、link 和 username；不再把任意字符串静默保存为无效权限。单用户权限覆盖按 `user_id + permission_key` 查询，绝不影响其他用户。`src/i18n.ts` 根据 Telegram `language_code` 选择英文、简体中文或日文，并测试全部声明 key。`/note` 无参数时读取当前备注。删除未读取的 bot context `db`/`logger`/`requestId`、已废弃的 `admin:set` payload fallback、重复的 `start` script、未使用的 TypeScript JSX/JavaScript compatibility options、配置完成后无消费者的 session 写入，以及没有读取者的 blocked-user profile 列。`drizzle.config.ts` 与 `migrations/meta/` 以 `0007` 的已部署最终 schema 建立 Drizzle Kit 基线；`pnpm db:generate` 生成 `0008_remove_captcha_attempts.sql` 与 `0009_remove_blocked_user_profile.sql`，Wrangler 继续应用它们。`0008` 同时清除从未有消费者的 `permission:forward` 及对应 override；这是有意的兼容移除，生产切换前不迁移任何有效旧系统权限。`pnpm typecheck`、`pnpm test -- --run`（24 tests）、`pnpm db:generate`（无待生成变更）、`pnpm db:check`、本地 D1 migrations 和 Wrangler 本地 `/health` 200 / 无效 webhook secret 401 均通过。

验收：设置跨请求保持；过期状态不依赖 Cron 也不会被接受；正则输入有安全边界。

## Phase 5 — 未公开运维 API 清理

- [x] 删除仅经 `/internal/*` 调用的广播、指标、Webhook 配置和私有邀请链接解析功能。

**Phase 5 实现与验收（2026-09-23）：** 删除所有 `/internal/*` 路由、`INTERNAL_API_SECRET`、广播 Queue binding/consumer、邀请链接解析和 API 指标。`0007_remove_internal_api.sql` 删除只供这些功能使用的邀请链接与投递事件表；已部署数据库在下次迁移时会清除这些历史记录。`/health` 和 Telegram secret-validated webhook 保留，路由测试确认内部路径返回 `404`。

验收：未公开路径不存在；Webhook 与健康检查继续可用。

## Phase 6 — D1 schema migration 与切换

- [x] D1 schema migration 统一使用 Wrangler，分别验证本地与远端目标。
- [x] 不保留 SQLite 数据转换工具：没有需要导入的既有数据库。
- [ ] 配置生产 secret、D1、Webhook，停止旧 polling、处理 pending updates、切换并观察重复/丢失；观察窗口后删除 Python/Docker/旧部署文档。

**Phase 6 实现与验收（2026-09-23 更新）：** D1 结构迁移统一使用 `wrangler d1 migrations apply DB`：`pnpm migrate:d1:local` 作用于本机状态，`pnpm migrate:d1:remote` 作用于远端 D1；两者始终应用同一组 `migrations/*.sql`，仅目标不同。没有既有 SQLite 数据库，因此删除 SQLite→D1 导入、计数校验与回滚脚本，不保留无数据源的转换链路。`pnpm bot:info` 交互式读取 bot token，调用 Telegram `getMe`，且仅向标准输出写入可直接作为 `BOT_INFO_JSON` 的 `result` JSON。`pnpm webhook:set` 交互式读取 bot token、webhook secret 和 webhook URL，调用 Telegram `setWebhook`，使用脚本配置的 allowed updates、40 个连接并保留 pending updates；不会读取环境变量或写入 Cloudflare。生产转发群由 Phase 3 的群内 `/start`、`/help` 或 `/admin` 初始化写入 D1；部署期 `FORWARD_GROUP_ID` 不再是运行时配置来源。生产 secrets、Worker 部署、测试 bot smoke、pending updates 排空、旧 polling 停止和观察窗口仍需要实际凭据与人工切换，因此保留为部署前 checklist，不在本地提交中宣称完成。

**迁移重置（2026-09-24）：** 用户确认线上 D1 没有需要保留的业务数据后，删除原 `better-forward` D1 并创建同名的新数据库，`wrangler.jsonc` 更新为新 UUID。历史手写 `0001`–`0007`、Drizzle 过渡期 `0008`–`0009` 和过渡 snapshot 全部删除；不再维护基线或兼容清理链。`src/db/schema.ts` 是唯一结构权威，Drizzle Kit 从它生成唯一初始迁移 `0000_initial_schema.sql` 和对应 metadata；测试也只应用这一个文件。新的远端数据库已应用 `0000_initial_schema.sql`，11 张业务表的总行数为 0，随后所有结构更改都由 `pnpm db:generate` 增量生成。此前段落提及的 `0001`–`0009` 仅记录当时的阶段历史，并非当前仓库或远端数据库状态。重置前的 Worker 部署仍绑定已删除的旧 UUID；必须以更新后的 `wrangler.jsonc` 部署 Worker，才会切换到新 D1。

验收：本地 D1 schema migration 可重复执行；生产 smoke test 通过。

## 每阶段结束清单

- [ ] 验收完成、相关格式化/类型/测试/迁移/本地检查通过。
- [ ] 更新本文件和必要的长期 `AGENTS.md` 规则；删除已取代的临时材料，检查 README、示例配置与命令未漂移。
- [ ] 记录主动改变旧行为的原因、兼容影响与测试证据；提交原子且符合 Conventional Commits。

## 尚待确认（不阻塞 Phase 0）

- 生产用户/日消息规模；是否要求菜单文案层级完全一致。
- 是否需要自定义 Telegram Bot API 地址（默认可选 secret/var，不围绕它建立抽象）。

## 依赖策略

`pnpm-lock.yaml` 是可重复安装的权威版本；CI/部署使用 `pnpm install --frozen-lockfile`。升级时运行 `pnpm outdated`，一次只升级一组相关依赖，执行 `pnpm test`、`pnpm exec tsc --noEmit` 和 `pnpm exec wrangler types`，并提交 `package.json` 与 lockfile 的同一原子变更。
