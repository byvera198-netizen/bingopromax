CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`actor` text DEFAULT 'Operador local' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`number` text NOT NULL,
	`serial` text DEFAULT '' NOT NULL,
	`grid_json` text NOT NULL,
	`source_file` text DEFAULT 'Manual' NOT NULL,
	`source_page` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_game_number_unique` ON `cards` (`game_id`,`number`);--> statement-breakpoint
CREATE TABLE `draws` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`number` integer NOT NULL,
	`drawn_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draws_game_number_unique` ON `draws` (`game_id`,`number`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`name` text NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer NOT NULL,
	`checksum` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`cards` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_game_checksum_unique` ON `files` (`game_id`,`checksum`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`prize` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active_pattern_id` text DEFAULT 'linea-horizontal' NOT NULL,
	`active_pattern_name` text DEFAULT 'Línea horizontal' NOT NULL,
	`active_pattern_cells` text DEFAULT '[]' NOT NULL,
	`auto_pause` integer DEFAULT true NOT NULL,
	`started_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#d7ff3f' NOT NULL,
	`category` text DEFAULT 'Personalizado' NOT NULL,
	`difficulty` text DEFAULT 'Media' NOT NULL,
	`cells_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `winners` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`card_id` text NOT NULL,
	`card_number` text NOT NULL,
	`pattern_id` text NOT NULL,
	`pattern_name` text NOT NULL,
	`validated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `winners_game_card_pattern_unique` ON `winners` (`game_id`,`card_id`,`pattern_id`);