CREATE TABLE `admin_sessions` (
	`admin_id` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`admin_id`, `scope`)
);
--> statement-breakpoint
CREATE TABLE `auto_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`response` text NOT NULL,
	`response_type` text NOT NULL,
	`is_regex` integer NOT NULL,
	`start_time` text,
	`end_time` text,
	`time_zone` text NOT NULL,
	`enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocked_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`blocked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `captcha_challenges` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'math' NOT NULL,
	`left_operand` integer NOT NULL,
	`right_operand` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`external_token` text,
	`external_url` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`received_id` text NOT NULL,
	`forwarded_id` text NOT NULL,
	`in_group` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_received_unique` ON `messages` (`topic_id`,`received_id`,`in_group`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_forwarded_unique` ON `messages` (`topic_id`,`forwarded_id`,`in_group`);--> statement-breakpoint
CREATE TABLE `processed_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`request_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	`completed_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spam_keywords` (
	`keyword` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_user_id_unique` ON `topics` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `topics_thread_id_unique` ON `topics` (`thread_id`);--> statement-breakpoint
CREATE TABLE `user_permission_overrides` (
	`user_id` text NOT NULL,
	`permission_key` text NOT NULL,
	`override` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `permission_key`)
);
--> statement-breakpoint
CREATE TABLE `verified_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`verified_at` integer NOT NULL
);
