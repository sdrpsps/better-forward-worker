import { createInterface } from "node:readline/promises";

function requireTerminal() {
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("This command must be run in an interactive terminal");
}

export async function prompt(label) {
	requireTerminal();
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return (await readline.question(label)).trim();
	} finally {
		readline.close();
	}
}
