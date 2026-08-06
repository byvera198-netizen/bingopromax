ALTER TABLE `memberships` ADD `membership_months` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `memberships` ADD `access_code` text;
--> statement-breakpoint
ALTER TABLE `memberships` ADD `activation_verified` integer DEFAULT false NOT NULL;
