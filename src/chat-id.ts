import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { chatIdResolutionAudits, observedInviteLinks } from "./db/schema";

export function normalizeInviteLink(value: string) {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "t.me" || url.search || url.hash) return null;
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length !== 1 && parts.length !== 2) return null;
		if (parts.length === 2 && parts[0] !== "joinchat") return null;
		const token = parts.at(-1);
		if (!token || !/^\+?[A-Za-z0-9_-]{5,}$/.test(token)) return null;
		return parts.length === 1 ? `https://t.me/+${token.replace(/^\+/, "")}` : `https://t.me/joinchat/${token}`;
	} catch {
		return null;
	}
}

export async function hashInviteLink(value: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function observeInviteLink(binding: D1Database, value: string, chatId: string) {
	const normalized = normalizeInviteLink(value);
	if (!normalized) return false;
	await createDb(binding)
		.insert(observedInviteLinks)
		.values({ hash: await hashInviteLink(normalized), chatId, observedAt: Date.now() })
		.onConflictDoUpdate({ target: observedInviteLinks.hash, set: { chatId, observedAt: Date.now() } });
	return true;
}

export async function resolveInviteLink(binding: D1Database, value: string, requestId: string) {
	const normalized = normalizeInviteLink(value);
	const hash = await hashInviteLink(normalized ?? value.trim());
	const db = createDb(binding);
	if (!normalized) {
		await db.insert(chatIdResolutionAudits).values({ hash, result: "invalid", requestId, createdAt: Date.now() });
		return { status: 400 as const, error: "invalid_invite_link" };
	}
	const observed = await db.select().from(observedInviteLinks).where(eq(observedInviteLinks.hash, hash)).get();
	if (!observed) {
		await db.insert(chatIdResolutionAudits).values({ hash, result: "not_observed", requestId, createdAt: Date.now() });
		return { status: 422 as const, error: "invite_link_not_observed" };
	}
	await db.insert(chatIdResolutionAudits).values({ hash, result: "resolved", requestId, createdAt: Date.now() });
	return { status: 200 as const, chatId: observed.chatId };
}
