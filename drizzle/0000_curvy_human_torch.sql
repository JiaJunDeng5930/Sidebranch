CREATE TABLE `anchors` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`quote` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `answers` (
	`question_id` text NOT NULL,
	`document_id` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_document` ON `answers` (`question_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_key_unique` ON `assets` (`key`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`relation` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `anchors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `anchors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`asset_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_path_unique` ON `documents` (`path`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`redirect_uris` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`state` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`kind` text NOT NULL,
	`family` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tokens_family` ON `oauth_tokens` (`family`);--> statement-breakpoint
CREATE TABLE `owner` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_user_id_unique` ON `owner` (`user_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`anchor_id`) REFERENCES `anchors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`parent_id` text,
	`content` text NOT NULL,
	`format` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_sequence` ON `revisions` (`document_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `revision_document` ON `revisions` (`document_id`);--> statement-breakpoint
CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER anchors_immutable_update BEFORE UPDATE ON anchors BEGIN SELECT RAISE(ABORT,'Immutable anchor'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_parent_guard BEFORE INSERT ON revisions WHEN
 (NEW.sequence=1 AND (NEW.parent_id IS NOT NULL OR EXISTS(SELECT 1 FROM revisions WHERE document_id=NEW.document_id))) OR
 (NEW.sequence>1 AND NOT EXISTS(SELECT 1 FROM revisions WHERE id=NEW.parent_id AND document_id=NEW.document_id AND sequence=NEW.sequence-1)) OR
 NEW.sequence<1 OR length(CAST(NEW.content AS BLOB))>1000000 OR NEW.format NOT IN ('text','markdown')
 BEGIN SELECT RAISE(ABORT,'Invalid revision chain'); END;
--> statement-breakpoint
CREATE TRIGGER owner_singleton BEFORE INSERT ON owner WHEN NEW.singleton<>1 BEGIN SELECT RAISE(ABORT,'Only one owner'); END;
