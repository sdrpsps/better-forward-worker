import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
