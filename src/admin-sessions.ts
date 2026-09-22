import { and, eq } from "drizzle-orm";
import { createDb } from "./db";
import { adminSessions } from "./db/schema";

export type AdminSession = {
	adminId: string;
	scope: string;
	state: string;
	payload: Record<string, unknown>;
	expiresAt: number;
};

export async function saveAdminSession(binding: D1Database, session: AdminSession) {
	const now = Date.now();
	await createDb(binding)
		.insert(adminSessions)
		.values({ ...session, payload: JSON.stringify(session.payload), updatedAt: now })
		.onConflictDoUpdate({
			target: [adminSessions.adminId, adminSessions.scope],
			set: {
				state: session.state,
				payload: JSON.stringify(session.payload),
				expiresAt: session.expiresAt,
				updatedAt: now,
			},
		});
}

export async function loadAdminSession(binding: D1Database, adminId: string, scope: string) {
	const db = createDb(binding);
	const where = and(eq(adminSessions.adminId, adminId), eq(adminSessions.scope, scope));
	const session = await db.select().from(adminSessions).where(where).get();
	if (!session) return null;
	if (session.expiresAt <= Date.now()) {
		await db.delete(adminSessions).where(where);
		return null;
	}
	return { ...session, payload: JSON.parse(session.payload) as Record<string, unknown> };
}

export async function cancelAdminSession(binding: D1Database, adminId: string, scope: string) {
	await createDb(binding)
		.delete(adminSessions)
		.where(and(eq(adminSessions.adminId, adminId), eq(adminSessions.scope, scope)));
}
