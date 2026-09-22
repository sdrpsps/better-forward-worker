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
