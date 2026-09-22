import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const topics = sqliteTable(
	"topics",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id").notNull(),
		threadId: text("thread_id").notNull(),
		note: text("note"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("topics_user_id_unique").on(table.userId),
		uniqueIndex("topics_thread_id_unique").on(table.threadId),
	],
);

export const messages = sqliteTable(
	"messages",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
		receivedId: text("received_id").notNull(),
		forwardedId: text("forwarded_id").notNull(),
		inGroup: integer("in_group", { mode: "boolean" }).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("messages_received_unique").on(table.topicId, table.receivedId, table.inGroup),
		uniqueIndex("messages_forwarded_unique").on(table.topicId, table.forwardedId, table.inGroup),
	],
);

export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value"),
	updatedAt: integer("updated_at").notNull(),
});

export const observedInviteLinks = sqliteTable("observed_invite_links", {
	hash: text("hash").primaryKey(),
	chatId: text("chat_id").notNull(),
	observedAt: integer("observed_at").notNull(),
});

export const chatIdResolutionAudits = sqliteTable("chat_id_resolution_audits", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	hash: text("hash").notNull(),
	result: text("result", { enum: ["resolved", "not_observed", "invalid"] }).notNull(),
	requestId: text("request_id").notNull(),
	createdAt: integer("created_at").notNull(),
});

export const autoResponses = sqliteTable("auto_responses", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	trigger: text("trigger").notNull(),
	response: text("response").notNull(),
	responseType: text("response_type", { enum: ["text", "media"] }).notNull(),
	isRegex: integer("is_regex", { mode: "boolean" }).notNull(),
	startTime: text("start_time"),
	endTime: text("end_time"),
	timeZone: text("time_zone").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull(),
});

export const blockedUsers = sqliteTable("blocked_users", {
	userId: text("user_id").primaryKey(),
	username: text("username"),
	firstName: text("first_name"),
	lastName: text("last_name"),
	blockedAt: integer("blocked_at").notNull(),
});

export const verifiedUsers = sqliteTable("verified_users", {
	userId: text("user_id").primaryKey(),
	verifiedAt: integer("verified_at").notNull(),
});

export const userPermissionOverrides = sqliteTable(
	"user_permission_overrides",
	{
		userId: text("user_id").notNull(),
		permissionKey: text("permission_key").notNull(),
		override: text("override", { enum: ["allow", "deny"] }).notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.permissionKey] })],
);

export const captchaChallenges = sqliteTable("captcha_challenges", {
	userId: text("user_id").primaryKey(),
	mode: text("mode", { enum: ["math", "button", "tguard"] }).notNull().default("math"),
	leftOperand: integer("left_operand").notNull(),
	rightOperand: integer("right_operand").notNull(),
	expiresAt: integer("expires_at").notNull(),
	attempts: integer("attempts").notNull(),
	externalToken: text("external_token"),
	externalUrl: text("external_url"),
});

export const spamKeywords = sqliteTable("spam_keywords", {
	keyword: text("keyword").primaryKey(),
	createdAt: integer("created_at").notNull(),
});

export const deliveryEvents = sqliteTable("delivery_events", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	kind: text("kind").notNull(),
	status: text("status").notNull(),
	detail: text("detail"),
	createdAt: integer("created_at").notNull(),
});

export const processedUpdates = sqliteTable("processed_updates", {
	updateId: integer("update_id").primaryKey(),
	status: text("status", { enum: ["claimed", "complete", "failed"] }).notNull(),
	attempts: integer("attempts").notNull(),
	requestId: text("request_id").notNull(),
	claimedAt: integer("claimed_at").notNull(),
	completedAt: integer("completed_at"),
	error: text("error"),
});

export const adminSessions = sqliteTable(
	"admin_sessions",
	{
		adminId: text("admin_id").notNull(),
		scope: text("scope").notNull(),
		state: text("state").notNull(),
		payload: text("payload").notNull(),
		expiresAt: integer("expires_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.adminId, table.scope] })],
);
