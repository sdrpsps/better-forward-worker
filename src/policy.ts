import { eq } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { createDb } from "./db";
import { autoResponses, blockedUsers, captchaChallenges, settings, spamKeywords, verifiedUsers } from "./db/schema";
import type { BotContext } from "./bot";
import { t } from "./i18n";
import { deniedPermissions, messagePermissions } from "./permissions";

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

function captchaKeyboard(userId: string, answer: number) {
	const answers = [...new Set([answer, Math.max(0, answer - 1), answer + 1, answer + 2])];
	return new InlineKeyboard().text(String(answers[0]), `captcha:${userId}:${answers[0]}`).text(String(answers[1]), `captcha:${userId}:${answers[1]}`).row()
		.text(String(answers[2]), `captcha:${userId}:${answers[2]}`).text(String(answers[3]), `captcha:${userId}:${answers[3]}`);
}

export async function handleCaptchaCallback(ctx: BotContext & { callbackQuery: { data?: string } }) {
	const match = /^captcha:(\d+):(\d+)$/.exec(ctx.callbackQuery.data ?? "");
	if (!match || !ctx.from) return false;
	if (String(ctx.from.id) !== match[1]) {
		await ctx.answerCallbackQuery({ text: t(ctx, "notYourChallenge") });
		return true;
	}
	const passed = await answerCaptcha(ctx.env.DB, match[1], Number(match[2]));
	await ctx.answerCallbackQuery({ text: passed ? t(ctx, "saved") : t(ctx, "incorrect") });
	if (passed) await ctx.editMessageText(t(ctx, "saved"));
	return true;
}

async function createTGuardChallenge(ctx: BotContext, userId: string) {
	const baseUrl = ctx.env.TGUARD_API_URL;
	const apiKey = ctx.env.TGUARD_API_KEY;
	if (!baseUrl || !apiKey) return null;
	try {
		const endpoint = new URL("/api/verification/create", baseUrl);
		const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ user_id: userId }) });
		if (!response.ok) return null;
		const result = await response.json() as { token?: unknown; verification_url?: unknown; expires_at?: unknown };
		if (typeof result.token !== "string" || typeof result.verification_url !== "string") return null;
		const parsedExpiry = typeof result.expires_at === "string" ? Date.parse(result.expires_at) : NaN;
		return { token: result.token, url: result.verification_url, expiresAt: Number.isFinite(parsedExpiry) && parsedExpiry > Date.now() ? parsedExpiry : Date.now() + 10 * 60_000 };
	} catch {
		return null;
	}
}

async function isTGuardVerified(ctx: BotContext, challenge: { externalToken: string; expiresAt: number }) {
	const baseUrl = ctx.env.TGUARD_API_URL;
	const apiKey = ctx.env.TGUARD_API_KEY;
	if (!baseUrl || !apiKey || challenge.expiresAt <= Date.now()) return false;
	try {
		const endpoint = new URL(`/api/verification-status/${encodeURIComponent(challenge.externalToken)}`, baseUrl);
		const response = await fetch(endpoint, { headers: { "x-api-key": apiKey } });
		if (!response.ok) return false;
		const result = await response.json() as { completed?: unknown; expired?: unknown };
		return result.completed === true && result.expired !== true;
	} catch {
		return false;
	}
}

async function sendAutoResponse(ctx: BotContext, response: string) {
	const [kind, fileId] = response.split(":", 2);
	if (!fileId) return ctx.reply(response);
	if (kind === "photo") return ctx.api.sendPhoto(ctx.chat!.id, fileId);
	if (kind === "sticker") return ctx.api.sendSticker(ctx.chat!.id, fileId);
	if (kind === "video") return ctx.api.sendVideo(ctx.chat!.id, fileId);
	if (kind === "document") return ctx.api.sendDocument(ctx.chat!.id, fileId);
	if (kind === "audio") return ctx.api.sendAudio(ctx.chat!.id, fileId);
	if (kind === "voice") return ctx.api.sendVoice(ctx.chat!.id, fileId);
	if (kind === "animation") return ctx.api.sendAnimation(ctx.chat!.id, fileId);
	return ctx.reply(response);
}

export async function handleIncomingPolicy(ctx: BotContext & { message: { chat: { type: string }; from?: { id: number }; text?: string }; reply: BotContext["reply"] }) {
	if (ctx.message.chat.type !== "private" || !ctx.message.from) return false;
	const userId = String(ctx.message.from.id);
	if (await isBlocked(ctx.env.DB, userId)) {
		await ctx.reply(t(ctx, "blocked"));
		return true;
	}
	const denied = await deniedPermissions(ctx.env.DB, userId, messagePermissions(ctx.message as never));
	if (denied.length) {
		await ctx.reply(t(ctx, "restricted", { permissions: denied.map((key) => t(ctx, key)).join(", ") }));
		return true;
	}
	if (ctx.message.text) {
		const keywords = await createDb(ctx.env.DB).select({ keyword: spamKeywords.keyword }).from(spamKeywords).all();
		if (keywords.some(({ keyword }) => ctx.message.text!.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))) {
			await ctx.reply(t(ctx, "blocked"));
			return true;
		}
	}
	const captchaMode = (await createDb(ctx.env.DB).select().from(settings).where(eq(settings.key, "captcha")).get())?.value;
	if ((captchaMode === "enable" || captchaMode === "math" || captchaMode === "button" || captchaMode === "tguard") && !(await isVerified(ctx.env.DB, userId))) {
		let challenge = await createDb(ctx.env.DB).select().from(captchaChallenges).where(eq(captchaChallenges.userId, userId)).get();
		if (captchaMode === "tguard") {
			if (challenge?.mode === "tguard" && challenge.externalToken && challenge.externalUrl) {
				if (await isTGuardVerified(ctx, { externalToken: challenge.externalToken, expiresAt: challenge.expiresAt })) {
					const db = createDb(ctx.env.DB);
					await db.delete(captchaChallenges).where(eq(captchaChallenges.userId, userId));
					await db.insert(verifiedUsers).values({ userId, verifiedAt: Date.now() }).onConflictDoUpdate({ target: verifiedUsers.userId, set: { verifiedAt: Date.now() } });
					return false;
				}
				await ctx.reply(t(ctx, "tguard", { url: challenge.externalUrl }));
				return true;
			}
			const created = await createTGuardChallenge(ctx, userId);
			if (!created) {
				await ctx.reply(t(ctx, "blocked"));
				return true;
			}
			await createDb(ctx.env.DB).insert(captchaChallenges).values({ userId, mode: "tguard", leftOperand: 0, rightOperand: 0, expiresAt: created.expiresAt, externalToken: created.token, externalUrl: created.url }).onConflictDoUpdate({ target: captchaChallenges.userId, set: { mode: "tguard", leftOperand: 0, rightOperand: 0, expiresAt: created.expiresAt, externalToken: created.token, externalUrl: created.url } });
			await ctx.reply(t(ctx, "tguard", { url: created.url }));
			return true;
		}
		if (captchaMode !== "button" && challenge && ctx.message.text && /^\d+$/.test(ctx.message.text)) {
			if (await answerCaptcha(ctx.env.DB, userId, Number(ctx.message.text))) await ctx.reply(t(ctx, "saved"));
			else await ctx.reply(t(ctx, "captcha", { left: challenge.leftOperand, right: challenge.rightOperand }));
			return true;
		}
		if (!challenge || challenge.expiresAt <= Date.now()) {
			const random = new Uint32Array(2);
			crypto.getRandomValues(random);
			const left = 1 + (random[0] % 9);
			const right = 1 + (random[1] % 9);
		challenge = { userId, mode: captchaMode === "button" ? "button" : "math", leftOperand: left, rightOperand: right, expiresAt: Date.now() + 10 * 60_000, externalToken: null, externalUrl: null };
			await createDb(ctx.env.DB).insert(captchaChallenges).values(challenge).onConflictDoUpdate({ target: captchaChallenges.userId, set: { mode: challenge.mode, leftOperand: left, rightOperand: right, expiresAt: challenge.expiresAt, externalToken: null, externalUrl: null } });
		}
		await ctx.reply(t(ctx, "captcha", { left: challenge.leftOperand, right: challenge.rightOperand }), captchaMode === "button" ? { reply_markup: captchaKeyboard(userId, challenge.leftOperand + challenge.rightOperand) } : undefined);
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
