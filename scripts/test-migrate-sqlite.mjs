#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "better-forward-migration-"));
const source = join(directory, "old.db");
const output = join(directory, "up.sql");
const reportPath = join(directory, "report.json");
const backup = join(directory, "old.db.bak");
const oldDb = new DatabaseSync(source);
oldDb.exec(`
CREATE TABLE topics (id INTEGER PRIMARY KEY, user_id TEXT, thread_id TEXT, note TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, topic_id INTEGER, received_id TEXT, forwarded_id TEXT, in_group INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE verified_users (user_id TEXT PRIMARY KEY);
CREATE TABLE blocked_users (user_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE user_permission_overrides (user_id TEXT, permission_key TEXT, override TEXT, PRIMARY KEY (user_id, permission_key));
CREATE TABLE auto_responses (key TEXT, value TEXT, type TEXT, is_regex INTEGER, start_time TEXT, end_time TEXT);
INSERT INTO topics VALUES (1, '42', '99', 'note');
INSERT INTO messages VALUES (1, 1, '10', '20', 0);
INSERT INTO settings VALUES ('default_message', 'Welcome');
INSERT INTO verified_users VALUES ('42');
INSERT INTO blocked_users VALUES ('43', 'blocked', 'Blocked', NULL);
INSERT INTO user_permission_overrides VALUES ('42', 'forward', 'allow');
INSERT INTO auto_responses VALUES ('hello', 'Hi', 'text', 0, NULL, NULL);
`);
oldDb.close();

const result = execFileSync(process.execPath, ["scripts/migrate-sqlite.mjs", "--source", source, "--output", output, "--report", reportPath, "--backup", backup], { encoding: "utf8" });
const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (report.counts.topics !== 1 || report.counts.messages !== 1 || report.counts.settings !== 1 || report.counts.auto_responses !== 1) throw new Error(`unexpected report: ${result}`);

const target = new DatabaseSync(join(directory, "target.db"));
for (const file of ["migrations/0001_phase_0.sql", "migrations/0002_phase_1.sql", "migrations/0003_phase_3.sql", "migrations/0004_phase_4.sql", "migrations/0005_phase_5.sql", "migrations/0006_tguard_captcha.sql", "migrations/0007_remove_internal_api.sql"]) target.exec(readFileSync(file, "utf8"));
target.exec(readFileSync(output, "utf8"));
target.exec(readFileSync(output, "utf8"));
const count = (table) => target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
if (count("topics") !== 1 || count("messages") !== 1 || count("settings") !== 1 || count("verified_users") !== 1 || count("blocked_users") !== 1 || count("user_permission_overrides") !== 1 || count("auto_responses") !== 1) throw new Error("migration counts do not match");
target.exec(report.rollbackSql);
if (count("topics") !== 0 || count("messages") !== 0 || count("settings") !== 0) throw new Error("rollback did not remove migrated rows");
target.close();
console.log("sqlite migration fixture passed");
