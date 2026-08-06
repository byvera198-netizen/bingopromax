CREATE TABLE IF NOT EXISTS `removed_patterns` (
  `game_id` text NOT NULL,
  `pattern_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `removed_patterns_game_pattern_unique` ON `removed_patterns` (`game_id`,`pattern_id`);
