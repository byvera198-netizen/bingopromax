CREATE TABLE IF NOT EXISTS `admins` (
  `email` text PRIMARY KEY NOT NULL,
  `added_by` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `blocked_users` (
  `email` text PRIMARY KEY NOT NULL,
  `blocked_by` text NOT NULL,
  `created_at` text NOT NULL
);
