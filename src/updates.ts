import { and, eq, lt, or } from "drizzle-orm";
import { createDb } from "./db";
import { processedUpdates } from "./db/schema";

const CLAIM_TTL_MS = 5 * 60_000;

export async function claimUpdate(binding: D1Database, updateId: number, requestId: string, now = Date.now()) {
	const db = createDb(binding);
	const before = await db.select().from(processedUpdates).where(eq(processedUpdates.updateId, updateId)).get();
	if (before?.status === "complete") return false;
	if (before?.status === "claimed" && before.claimedAt > now - CLAIM_TTL_MS) return false;
	if (!before) {
		await db
			.insert(processedUpdates)
			.values({ updateId, status: "claimed", attempts: 1, requestId, claimedAt: now })
			.onConflictDoNothing();
		const afterInsert = await db.select().from(processedUpdates).where(eq(processedUpdates.updateId, updateId)).get();
		return afterInsert?.status === "claimed" && afterInsert.requestId === requestId && afterInsert.claimedAt === now;
	}
	await db
		.update(processedUpdates)
		.set({ status: "claimed", attempts: before.attempts + 1, requestId, claimedAt: now, error: null })
		.where(
			and(
				eq(processedUpdates.updateId, updateId),
				or(eq(processedUpdates.status, "failed"), lt(processedUpdates.claimedAt, now - CLAIM_TTL_MS)),
			),
		);
	return true;
}

export async function completeUpdate(binding: D1Database, updateId: number, now = Date.now()) {
	await createDb(binding)
		.update(processedUpdates)
		.set({ status: "complete", completedAt: now, error: null })
		.where(eq(processedUpdates.updateId, updateId));
}

export async function failUpdate(binding: D1Database, updateId: number, error: unknown, now = Date.now()) {
	const message = error instanceof Error ? error.message : "unknown error";
	await createDb(binding)
		.update(processedUpdates)
		.set({ status: "failed", error: message.slice(0, 500), claimedAt: now })
		.where(eq(processedUpdates.updateId, updateId));
}
