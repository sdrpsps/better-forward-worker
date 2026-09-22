import { and, eq } from "drizzle-orm";
import { createDb } from "./db";
import { autoResponses, blockedUsers, captchaChallenges, settings, spamKeywords, userPermissionOverrides, verifiedUsers } from "./db/schema";
import type { BotContext } from "./bot";

export const translations = {
	en: { blocked: "You cannot send messages.", captcha: "What is {left} + {right}?", saved: "Saved." },
	zh: { blocked: "你暂时不能发送消息。", captcha: "请计算 {left} + {right}。", saved: "已保存。" },
	ja: { blocked: "現在メッセージを送信できません。", captcha: "{left} + {right} は？", saved: "保存しました。" },
} as const;

export function t(locale: keyof typeof translations, key: keyof typeof translations.en, values: Record<string, string | number> = {}) {
	const template = translations[locale]?.[key] ?? translations.en[key];
	return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function missingTranslationKeys(locale: keyof typeof translations, keys: string[]) {
	return keys.filter((key) => !(key in translations[locale]));
}

export function validateRegex(source: string) {
	if (source.length > 256 || /\\\d|\(\?[=!<]|\([^)]*[+*][^)]*\)[+*]/.test(source)) return false;
	try {
		new RegExp(source);
		return true;
	} catch {
		return false;
	}
}

export function matchesTrigger(input: string, trigger: string, isRegex: boolean) {
	if (!isRegex) return input.includes(trigger);
	if (!validateRegex(trigger)) return false;
	return new RegExp(trigger).test(input);
}

export function isWithinTimeWindow(date: Date, start: string | null, end: string | null, timeZone: string) {
	if (!start || !end) return true;
	try {
		const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
		const now = Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
		const parse = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
		const from = parse(start); const to = parse(end);
		return from <= to ? now >= from && now <= to : now >= from || now <= to;
	} catch {
		return false;
	}
}

export async function isBlocked(binding: D1Database, userId: string) {
	return Boolean(await createDb(binding).select({ userId: blockedUsers.userId }).from(blockedUsers).where(eq(blockedUsers.userId, userId)).get());
}

export async function isVerified(binding: D1Database, userId: string) {
	return Boolean(await createDb(binding).select({ userId: verifiedUsers.userId }).from(verifiedUsers).where(eq(verifiedUsers.userId, userId)).get());
}

export async function permission(binding: D1Database, userId: string, key: string, defaultValue: boolean) {
	const row = await createDb(binding).select().from(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.permissionKey, key))).get();
	return row ? row.override === "allow" : defaultValue;
}

export async function answerCaptcha(binding: D1Database, userId: string, answer: number, now = Date.now()) {
	const db = createDb(binding);
	const challenge = await db.select().from(captchaChallenges).where(eq(captchaChallenges.userId, userId)).get();
	if (!challenge || challenge.expiresAt <= now) {
		if (challenge) await db.delete(captchaChallenges).where(eq(captchaChallenges.userId, userId));
		return false;
	}
	if (challenge.leftOperand + challenge.rightOperand !== answer) return false;
	await db.delete(captchaChallenges).where(eq(captchaChallenges.userId, userId));
	await db.insert(verifiedUsers).values({ userId, verifiedAt: now }).onConflictDoUpdate({ target: verifiedUsers.userId, set: { verifiedAt: now } });
	return true;
}

async function sendAutoResponse(ctx: BotContext, response: string) {
	const [kind, fileId] = response.split(":", 2);
	if (!fileId) return ctx.reply(response);
	if (kind === "photo") return ctx.api.sendPhoto(ctx.chat!.id, fileId);
	if (kind === "video") return ctx.api.sendVideo(ctx.chat!.id, fileId);
	if (kind === "document") return ctx.api.sendDocument(ctx.chat!.id, fileId);
	if (kind === "audio") return ctx.api.sendAudio(ctx.chat!.id, fileId);
	if (kind === "voice") return ctx.api.sendVoice(ctx.chat!.id, fileId);
	if (kind === "animation") return ctx.api.sendAnimation(ctx.chat!.id, fileId);
	return ctx.reply(response);
}

export async function handleIncomingPolicy(ctx: BotContext & { message: { chat: { type: string }; from?: { id: number }; text?: string }; reply: (text: string) => Promise<unknown> }) {
	if (ctx.message.chat.type !== "private" || !ctx.message.from) return false;
	const userId = String(ctx.message.from.id);
	if (await isBlocked(ctx.env.DB, userId)) {
		await ctx.reply(t("en", "blocked"));
		return true;
	}
	if (ctx.message.text) {
		const keywords = await createDb(ctx.env.DB).select({ keyword: spamKeywords.keyword }).from(spamKeywords).all();
		if (keywords.some(({ keyword }) => ctx.message.text!.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) {
			await ctx.reply(t("en", "blocked"));
			return true;
		}
	}
	const captchaSetting = await createDb(ctx.env.DB).select().from(settings).where(eq(settings.key, "captcha")).get();
	if (captchaSetting?.value === "enable" && !(await isVerified(ctx.env.DB, userId))) {
		const existing = await createDb(ctx.env.DB).select().from(captchaChallenges).where(eq(captchaChallenges.userId, userId)).get();
		if (existing && ctx.message.text && /^\d+$/.test(ctx.message.text)) {
			if (await answerCaptcha(ctx.env.DB, userId, Number(ctx.message.text))) await ctx.reply(t("en", "saved"));
			else await ctx.reply(t("en", "captcha", existing));
			return true;
		}
		const random = new Uint32Array(2);
		crypto.getRandomValues(random);
		const left = 1 + (random[0] % 9);
		const right = 1 + (random[1] % 9);
		await createDb(ctx.env.DB).insert(captchaChallenges).values({ userId, leftOperand: left, rightOperand: right, expiresAt: Date.now() + 10 * 60_000, attempts: 0 }).onConflictDoUpdate({ target: captchaChallenges.userId, set: { leftOperand: left, rightOperand: right, expiresAt: Date.now() + 10 * 60_000, attempts: 0 } });
		await ctx.reply(t("en", "captcha", { left, right }));
		return true;
	}
	if (!ctx.message.text) return false;
	const rules = await createDb(ctx.env.DB).select().from(autoResponses).where(eq(autoResponses.enabled, true)).all();
	for (const rule of rules) {
		if (matchesTrigger(ctx.message.text, rule.trigger, rule.isRegex) && isWithinTimeWindow(new Date(), rule.startTime, rule.endTime, rule.timeZone)) {
			if (rule.responseType === "text") await ctx.reply(rule.response);
			else await sendAutoResponse(ctx, rule.response);
			break;
		}
	}
	return false;
}
