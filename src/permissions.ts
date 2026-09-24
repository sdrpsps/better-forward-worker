import { and, eq, inArray } from "drizzle-orm";
import type { Message } from "grammy/types";
import { createDb } from "./db";
import { settings, userPermissionOverrides } from "./db/schema";

export const permissionKeys = ["photo", "sticker", "video", "voice", "file", "link", "username"] as const;
export type PermissionKey = (typeof permissionKeys)[number];

const rawLink = /https?:\/\/[^\s<>()]+/i;
const rawUsername = /(?<![\w@])@[A-Za-z0-9][A-Za-z0-9_]{0,31}\b/;

export function parsePermissionKeys(value: string) {
	const unknown: string[] = [];
	const keys = new Set<PermissionKey>();
	for (const part of value.toLowerCase().split(/[\s,，]+/)) {
		if (!part) continue;
		if (part === "all") permissionKeys.forEach((key) => keys.add(key));
		else if ((permissionKeys as readonly string[]).includes(part)) keys.add(part as PermissionKey);
		else unknown.push(part);
	}
	return { keys: [...keys], unknown };
}

export function messagePermissions(message: Message): PermissionKey[] {
	const permissions = new Set<PermissionKey>();
	if (message.photo) permissions.add("photo");
	if (message.sticker || message.animation) permissions.add("sticker");
	if (message.video) permissions.add("video");
	if (message.voice) permissions.add("voice");
	if (message.audio || message.document) permissions.add("file");
	for (const [text, entities] of [[message.text, message.entities], [message.caption, message.caption_entities]] as const) {
		if (text && (rawLink.test(text) || entities?.some((entity) => entity.type === "url" || entity.type === "text_link"))) permissions.add("link");
		if (text && (rawUsername.test(text) || entities?.some((entity) => entity.type === "mention"))) permissions.add("username");
	}
	return [...permissions];
}

export async function deniedPermissions(binding: D1Database, userId: string, keys: PermissionKey[]) {
	if (!keys.length) return [];
	const db = createDb(binding);
	const [defaults, overrides] = await Promise.all([
		db.select({ key: settings.key, value: settings.value }).from(settings).where(inArray(settings.key, keys.map((key) => `permission:${key}`))).all(),
		db.select({ key: userPermissionOverrides.permissionKey, value: userPermissionOverrides.override }).from(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, userId), inArray(userPermissionOverrides.permissionKey, keys))).all(),
	]);
	const defaultValues = new Map(defaults.map(({ key, value }) => [key.slice("permission:".length), value]));
	const overrideValues = new Map(overrides.map(({ key, value }) => [key, value]));
	return keys.filter((key) => (overrideValues.get(key) ?? defaultValues.get(key)) === "deny");
}
