import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { settings } from "./db/schema";

const FORWARD_GROUP_KEY = "forward_group_id";

export async function readForwardGroupId(binding: D1Database) {
	const setting = await createDb(binding).select({ value: settings.value }).from(settings).where(eq(settings.key, FORWARD_GROUP_KEY)).get();
	return typeof setting?.value === "string" && /^-?\d+$/.test(setting.value) ? setting.value : null;
}

export async function initializeForwardGroup(binding: D1Database, groupId: string) {
	await createDb(binding)
		.insert(settings)
		.values({ key: FORWARD_GROUP_KEY, value: groupId, updatedAt: Date.now() })
		.onConflictDoNothing();
	return (await readForwardGroupId(binding)) === groupId;
}
