ALTER TABLE `games` ADD COLUMN `owner_email` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `games` SET `owner_email` = 'byvera198@gmail.com' WHERE `owner_email` = '';
