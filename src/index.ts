import { createApp, type WorkerEnv } from "./app";
import { consumeBroadcast, type BroadcastJob } from "./broadcast";

export default {
	async fetch(request, env, executionContext) {
		return createApp().fetch(request, env, executionContext);
	},
	async queue(batch: MessageBatch, env: WorkerEnv) {
		await consumeBroadcast(batch as MessageBatch<BroadcastJob>, env);
	},
} satisfies ExportedHandler<WorkerEnv>;
