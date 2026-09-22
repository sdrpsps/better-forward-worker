import { createApp, type WorkerEnv } from "./app";

export default {
	async fetch(request, env, executionContext) {
		return createApp().fetch(request, env, executionContext);
	},
} satisfies ExportedHandler<WorkerEnv>;
