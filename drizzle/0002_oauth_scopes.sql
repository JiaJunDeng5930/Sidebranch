ALTER TABLE `oauth_requests` ADD COLUMN `scope` text NOT NULL DEFAULT 'documents:read documents:write';
--> statement-breakpoint
ALTER TABLE `oauth_codes` ADD COLUMN `scope` text NOT NULL DEFAULT 'documents:read documents:write';
--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD COLUMN `scope` text NOT NULL DEFAULT 'documents:read documents:write';
