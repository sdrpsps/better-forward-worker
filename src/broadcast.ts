import { Bot } from "grammy";
import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { deliveryEvents, topics } from "./db/schema";
import type { WorkerEnv } from "./app";

export type BroadcastJob = { sourceChatId: string; sourceMessageId: number };

export const retryDelay = (attempt: number) => Math.min(60, 2 ** attempt);

export async function enqueueBroadcast(queue: Queue<BroadcastJob> | undefined, job: BroadcastJob) {
	if (!queue) throw new Error("broadcast_queue_not_configured");
	return queue.send(job, { contentType: "json" });
}

export async function recordDeliveryEvent(binding: D1Database, status: "delivered" | "failed", detail: string | null = null) {
	await createDb(binding).insert(deliveryEvents).values({ kind: "broadcast", status, detail, createdAt: Date.now() });
}

export async function consumeBroadcast(batch: MessageBatch<BroadcastJob>, env: WorkerEnv) {
	const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO_JSON) });
	const users = await createDb(env.DB).select({ userId: topics.userId }).from(topics).all();
	for (const message of batch.messages) {
		let retry = false;
		for (const user of users) {
			try {
				await bot.api.copyMessage(user.userId, message.body.sourceChatId, message.body.sourceMessageId);
				await recordDeliveryEvent(env.DB, "delivered");
			} catch (error) {
				const detail = error instanceof Error ? error.message : "unknown";
				const failureKind = detail.includes("429") && message.attempts < 5 ? "retrying" : "telegram_error";
				await recordDeliveryEvent(env.DB, "failed", failureKind);
				console.error(JSON.stringify({ event: "broadcast_delivery_failed", queue_message_id: message.id, user_id: user.userId, attempt: message.attempts, error: detail.includes("429") ? "telegram_rate_limited" : "telegram_error" }));
				if (detail.includes("429") && message.attempts < 5) retry = true;
			}
		}
		if (retry) message.retry({ delaySeconds: retryDelay(message.attempts) });
		else message.ack();
	}
}
