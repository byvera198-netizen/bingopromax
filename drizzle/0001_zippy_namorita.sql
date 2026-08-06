CREATE TABLE `game_patterns` (
	`game_id` text NOT NULL,
	`pattern_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`custom` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_patterns_game_pattern_unique` ON `game_patterns` (`game_id`,`pattern_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`plan` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_id` text,
	`requested_at` text NOT NULL,
	`approved_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_email_unique` ON `memberships` (`email`);