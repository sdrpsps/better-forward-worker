#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const has = (name) => args.includes(name);
const source = value("--source");
const output = value("--output") ?? "d1-migration.sql";
const reportPath = value("--report") ?? `${output}.json`;
const rollbackPath = value("--rollback");

if (rollbackPath) {
	const report = JSON.parse(readFileSync(resolve(rollbackPath), "utf8"));
	writeFileSync(resolve(output), report.rollbackSql);
	console.log(`wrote rollback SQL to ${resolve(output)}`);
	process.exit(0);
}
if (!source || !existsSync(resolve(source))) {
	console.error("usage: migrate-sqlite.mjs --source old.db [--output up.sql] [--report report.json] [--dry-run]");
	process.exit(2);
}

const quote = (input) => input == null ? "NULL" : `'${String(input).replaceAll("'", "''")}'`;
const now = Date.now();
const db = new DatabaseSync(resolve(source), { readOnly: true });
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
const rows = (table) => tables.has(table) ? db.prepare(`SELECT * FROM "${table}"`).all() : [];
const report = { source: resolve(source), generatedAt: new Date(now).toISOString(), dryRun: has("--dry-run"), counts: {}, skipped: [], backup: null };
const up = ["BEGIN;"];
const rollback = ["BEGIN;"];

const topics = rows("topics");
report.counts.topics = topics.length;
for (const row of topics) {
	if (row.user_id == null || row.thread_id == null) { report.skipped.push({ table: "topics", reason: "missing identifiers" }); continue; }
	up.push(`INSERT OR IGNORE INTO topics (id, user_id, thread_id, note, created_at, updated_at) VALUES (${Number(row.id) || "NULL"}, ${quote(row.user_id)}, ${quote(row.thread_id)}, ${quote(row.note)}, ${now}, ${now});`);
	rollback.push(`DELETE FROM topics WHERE id = ${Number(row.id) || "NULL"} AND created_at = ${now} AND updated_at = ${now};`);
}

const messages = rows("messages");
report.counts.messages = messages.length;
for (const row of messages) {
	if (row.topic_id == null || row.received_id == null || row.forwarded_id == null) { report.skipped.push({ table: "messages", reason: "missing identifiers" }); continue; }
	up.push(`INSERT OR IGNORE INTO messages (topic_id, received_id, forwarded_id, in_group, created_at) VALUES (${Number(row.topic_id)}, ${quote(row.received_id)}, ${quote(row.forwarded_id)}, ${row.in_group ? 1 : 0}, ${now});`);
	rollback.push(`DELETE FROM messages WHERE topic_id = ${Number(row.topic_id)} AND received_id = ${quote(row.received_id)} AND forwarded_id = ${quote(row.forwarded_id)} AND created_at = ${now};`);
}

const settings = rows("settings");
report.counts.settings = settings.length;
for (const row of settings) {
	if (row.key == null) continue;
	up.push(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (${quote(row.key)}, ${quote(row.value)}, ${now});`);
	rollback.push(`DELETE FROM settings WHERE key = ${quote(row.key)} AND value = ${quote(row.value)} AND updated_at = ${now};`);
}

const copyRows = (table, columns, transform = (row) => row) => {
	const sourceRows = rows(table);
	report.counts[table] = sourceRows.length;
	for (const original of sourceRows) {
		const row = transform(original);
		if (!row) continue;
		up.push(`INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => quote(row[column])).join(", ")});`);
		const key = table === "user_permission_overrides" ? `user_id = ${quote(row.user_id)} AND permission_key = ${quote(row.permission_key)}` : table === "auto_responses" ? `trigger = ${quote(row.trigger)}` : `user_id = ${quote(row.user_id)}`;
		const timestampColumn = table === "verified_users" ? "verified_at" : table === "blocked_users" ? "blocked_at" : table === "user_permission_overrides" ? "updated_at" : null;
		rollback.push(`DELETE FROM ${table} WHERE ${key}${timestampColumn ? ` AND ${timestampColumn} = ${now}` : ` AND 1 = 1`};`);
	}
};
copyRows("verified_users", ["user_id", "verified_at"], (row) => ({ user_id: String(row.user_id), verified_at: now }));
copyRows("blocked_users", ["user_id", "username", "first_name", "last_name", "blocked_at"], (row) => ({ user_id: String(row.user_id), username: row.username, first_name: row.first_name, last_name: row.last_name, blocked_at: now }));
copyRows("user_permission_overrides", ["user_id", "permission_key", "override", "updated_at"], (row) => ({ user_id: String(row.user_id), permission_key: row.permission_key, override: row.override, updated_at: now }));
const autoResponses = rows("auto_responses");
report.counts.auto_responses = autoResponses.length;
for (const original of autoResponses) {
	const row = { trigger: original.key, response: original.value, response_type: original.type ?? "text", is_regex: original.is_regex ? 1 : 0, start_time: original.start_time, end_time: original.end_time, time_zone: "UTC", enabled: 1 };
	up.push(`INSERT INTO auto_responses (trigger, response, response_type, is_regex, start_time, end_time, time_zone, enabled) SELECT ${quote(row.trigger)}, ${quote(row.response)}, ${quote(row.response_type)}, ${quote(row.is_regex)}, ${quote(row.start_time)}, ${quote(row.end_time)}, ${quote(row.time_zone)}, ${quote(row.enabled)} WHERE NOT EXISTS (SELECT 1 FROM auto_responses WHERE trigger = ${quote(row.trigger)});`);
	rollback.push(`DELETE FROM auto_responses WHERE trigger = ${quote(row.trigger)} AND response = ${quote(row.response)};`);
}

up.push("COMMIT;");
rollback.push("COMMIT;");
report.rollbackSql = rollback.join("\n") + "\n";
if (!has("--dry-run")) {
	const backupPath = value("--backup");
	if (backupPath) { copyFileSync(resolve(source), resolve(backupPath)); report.backup = resolve(backupPath); }
	writeFileSync(resolve(output), up.join("\n") + "\n");
	writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ dryRun: report.dryRun, counts: report.counts, skipped: report.skipped.length, output: has("--dry-run") ? null : resolve(output) }));
