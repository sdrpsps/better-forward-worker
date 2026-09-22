import { and, eq } from "drizzle-orm";
import type { Message } from "grammy/types";
import { createDb } from "./db";
import { blockedUsers, messages, topics, verifiedUsers } from "./db/schema";
import type { BotContext } from "./bot";
import { readForwardGroupId } from "./env";
import { isGroupAdmin } from "./admin-flow";

type MessageContext = BotContext & { message: Message };
type Topic = NonNullable<Awaited<ReturnType<typeof findTopic>>>;

const topicName = (message: Message) => {
	const user = message.from;
	return [user?.first_name, user?.last_name].filter(Boolean).join(" ").slice(0, 128) || `User ${message.chat.id}`;
};

async function findTopic(binding: D1Database, where: ReturnType<typeof eq>) {
	return createDb(binding).select().from(topics).where(where).get();
}

async function findMapping(binding: D1Database, topicId: number, forwardedId: string, inGroup: boolean) {
	return createDb(binding)
		.select()
		.from(messages)
		.where(and(eq(messages.topicId, topicId), eq(messages.forwardedId, forwardedId), eq(messages.inGroup, inGroup)))
		.get();
}

async function findReceivedMapping(binding: D1Database, receivedId: string, inGroup: boolean) {
	return createDb(binding)
		.select()
		.from(messages)
		.where(and(eq(messages.receivedId, receivedId), eq(messages.inGroup, inGroup)))
		.get();
}

async function saveMapping(binding: D1Database, topicId: number, receivedId: number, forwardedId: number, inGroup: boolean) {
	await createDb(binding)
		.insert(messages)
		.values({ topicId, receivedId: String(receivedId), forwardedId: String(forwardedId), inGroup, createdAt: Date.now() })
		.onConflictDoNothing();
}

async function ensureTopic(ctx: MessageContext, groupId: string) {
	const existing = await findTopic(ctx.env.DB, eq(topics.userId, String(ctx.message.chat.id)));
	if (existing) return existing;
	const created = await ctx.api.createForumTopic(groupId, topicName(ctx.message));
	try {
		await createDb(ctx.env.DB).insert(topics).values({
			userId: String(ctx.message.chat.id),
			threadId: String(created.message_thread_id),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	} catch {
		// A concurrent update may have won the unique user_id constraint.
	}
	return findTopic(ctx.env.DB, eq(topics.userId, String(ctx.message.chat.id)));
}

function isMissingTopic(error: unknown) {
	const detail = error instanceof Error ? error.message : String(error);
	return /message thread not found|thread not found|TOPIC_ID_INVALID/i.test(detail);
}

async function recreateTopic(ctx: MessageContext, groupId: string, topic: Topic) {
	const created = await ctx.api.createForumTopic(groupId, topicName(ctx.message));
	await createDb(ctx.env.DB).update(topics).set({ threadId: String(created.message_thread_id), updatedAt: Date.now() }).where(eq(topics.id, topic.id));
	return { ...topic, threadId: String(created.message_thread_id) };
}

async function forwardToUser(ctx: MessageContext, groupId: string) {
	if (ctx.message.chat.id.toString() !== groupId || ctx.message.message_thread_id == null) return;
	const topic = await findTopic(ctx.env.DB, eq(topics.threadId, String(ctx.message.message_thread_id)));
	if (!topic) return;
	const reply = ctx.message.reply_to_message
		? await findMapping(ctx.env.DB, topic.id, String(ctx.message.reply_to_message.message_id), false)
		: null;
	const copied = await ctx.api.copyMessage(topic.userId, groupId, ctx.message.message_id, reply ? { reply_parameters: { message_id: Number(reply.receivedId) } } : undefined);
	await saveMapping(ctx.env.DB, topic.id, ctx.message.message_id, Number(copied), true);
}

async function forwardToGroup(ctx: MessageContext, groupId: string) {
	let topic = await ensureTopic(ctx, groupId);
	if (!topic) return;
	const copy = async (current: Topic) => {
		const reply = ctx.message.reply_to_message
			? await findMapping(ctx.env.DB, current.id, String(ctx.message.reply_to_message.message_id), true)
			: null;
		return ctx.api.copyMessage(groupId, String(ctx.message.chat.id), ctx.message.message_id, {
			message_thread_id: Number(current.threadId),
			...(reply ? { reply_parameters: { message_id: Number(reply.forwardedId) } } : {}),
		});
	};
	let copied: number;
	try {
		copied = Number(await copy(topic));
	} catch (error) {
		if (!isMissingTopic(error)) throw error;
		topic = await recreateTopic(ctx, groupId, topic);
		copied = Number(await copy(topic));
	}
	await saveMapping(ctx.env.DB, topic.id, ctx.message.message_id, Number(copied), false);
}

export async function forwardMessage(ctx: MessageContext) {
	const groupId = readForwardGroupId(ctx.env);
	if (!groupId) return;
	if (ctx.message.chat.id.toString() === groupId) return forwardToUser(ctx, groupId);
	if (ctx.message.chat.type === "private") return forwardToGroup(ctx, groupId);
}

export async function handleUserCommand(ctx: MessageContext) {
	const text = ctx.message.text;
	if (!text?.startsWith("/")) return false;
	const command = text.split(/\s+/, 1)[0];
	if (command === "/start" || command === "/help") {
		await ctx.reply("Tell me what you want to forward.");
		return true;
	}
	if (ctx.message.chat.type !== "private") return false;
	const groupId = readForwardGroupId(ctx.env);
	const topic = groupId ? await findTopic(ctx.env.DB, eq(topics.userId, String(ctx.message.chat.id))) : null;
	if (command === "/delete" && topic && groupId) {
		await ctx.api.deleteForumTopic(groupId, Number(topic.threadId));
		await createDb(ctx.env.DB).delete(topics).where(eq(topics.id, topic.id));
		await ctx.reply("Thread deleted.");
		return true;
	}
	if ((command === "/terminate" || command === "/refresh") && topic && groupId) {
		if (command === "/terminate") await ctx.api.closeForumTopic(groupId, Number(topic.threadId));
		else await ctx.api.reopenForumTopic(groupId, Number(topic.threadId));
		return true;
	}
	return false;
}

export async function handleAdminCommand(ctx: MessageContext) {
	const text = ctx.message.text;
	const groupId = readForwardGroupId(ctx.env);
	if (!text?.startsWith("/") || !groupId || ctx.message.chat.id.toString() !== groupId || ctx.message.message_thread_id == null || !ctx.from) return false;
	if (!(await isGroupAdmin(ctx, ctx.from.id, groupId))) return false;
	const [command, ...rest] = text.trim().split(/\s+/);
	const topic = await findTopic(ctx.env.DB, eq(topics.threadId, String(ctx.message.message_thread_id)));
	if (!topic) return false;
	if (command === "/ban") {
		await createDb(ctx.env.DB).insert(blockedUsers).values({ userId: topic.userId, username: null, firstName: null, lastName: null, blockedAt: Date.now() }).onConflictDoNothing();
		await ctx.api.closeForumTopic(groupId, Number(topic.threadId));
		await ctx.reply("User blocked.");
		return true;
	}
	if (command === "/verify") {
		await createDb(ctx.env.DB).insert(verifiedUsers).values({ userId: topic.userId, verifiedAt: Date.now() }).onConflictDoUpdate({ target: verifiedUsers.userId, set: { verifiedAt: Date.now() } });
		await ctx.reply("User verified.");
		return true;
	}
	if (command === "/note") {
		await createDb(ctx.env.DB).update(topics).set({ note: rest.join(" ") || null, updatedAt: Date.now() }).where(eq(topics.id, topic.id));
		await ctx.reply("Note saved.");
		return true;
	}
	if (command === "/delete") {
		await ctx.api.deleteForumTopic(groupId, Number(topic.threadId));
		await createDb(ctx.env.DB).delete(topics).where(eq(topics.id, topic.id));
		return true;
	}
	if (command === "/terminate" || command === "/refresh") {
		if (command === "/terminate") await ctx.api.closeForumTopic(groupId, Number(topic.threadId));
		else await ctx.api.reopenForumTopic(groupId, Number(topic.threadId));
		return true;
	}
	return false;
}

async function editMessage(ctx: BotContext, message: Message) {
	const groupId = readForwardGroupId(ctx.env);
	const text = message.text;
	if (!groupId || !text) return;
	if (message.chat.id.toString() === groupId && message.message_thread_id != null) {
		const topic = await findTopic(ctx.env.DB, eq(topics.threadId, String(message.message_thread_id)));
		const mapping = topic ? await findReceivedMapping(ctx.env.DB, String(message.message_id), true) : null;
		if (topic && mapping) await ctx.api.editMessageText(topic.userId, Number(mapping.forwardedId), text);
		return;
	}
	if (message.chat.type === "private") {
		const mapping = await findReceivedMapping(ctx.env.DB, String(message.message_id), false);
		if (mapping) await ctx.api.editMessageText(groupId, Number(mapping.forwardedId), text);
	}
}

export async function editEditedMessage(ctx: BotContext) {
	if (ctx.editedMessage) await editMessage(ctx, ctx.editedMessage);
}

export async function syncReaction(ctx: BotContext & { messageReaction: { chat: { id: number | string }; message_id: number; new_reaction: unknown[] } }) {
	const groupId = readForwardGroupId(ctx.env);
	if (!groupId) return;
	const fromGroup = ctx.messageReaction.chat.id.toString() === groupId;
	const mapping = await findReceivedMapping(ctx.env.DB, String(ctx.messageReaction.message_id), fromGroup);
	if (!mapping) return;
	const topic = await findTopic(ctx.env.DB, eq(topics.id, mapping.topicId));
	if (!topic) return;
	const targetChat = fromGroup ? topic.userId : groupId;
	await ctx.api.setMessageReaction(targetChat, Number(mapping.forwardedId), ctx.messageReaction.new_reaction);
}
