ALTER TABLE `games` ADD `owner_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `games_owner_created_idx` ON `games` (`owner_email`,`created_at`);
