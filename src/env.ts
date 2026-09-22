import { z } from "zod";
import type { UserFromGetMe } from "grammy/types";
import type { WorkerEnv } from "./app";

const webhookConfigSchema = z.object({
	BOT_INFO_JSON: z.string().min(1),
	BOT_TOKEN: z.string().min(1),
	TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
});

const botInfoSchema = z.object({
	id: z.number().int().positive(),
	is_bot: z.literal(true),
	first_name: z.string().min(1),
	username: z.string().min(1),
	can_join_groups: z.boolean(),
	can_read_all_group_messages: z.boolean(),
	supports_inline_queries: z.boolean(),
});

export function readWebhookConfig(env: WorkerEnv) {
	const result = webhookConfigSchema.safeParse(env);
	if (!result.success) return null;
	try {
		const botInfo = botInfoSchema.parse(JSON.parse(result.data.BOT_INFO_JSON));
		return {
			secret: result.data.TELEGRAM_WEBHOOK_SECRET,
			token: result.data.BOT_TOKEN,
			botInfo: botInfo as UserFromGetMe,
		};
	} catch {
		return null;
	}
}
