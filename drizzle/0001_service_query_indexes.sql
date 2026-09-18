CREATE INDEX `anchors_revision` ON `anchors` (`revision_id`);--> statement-breakpoint
CREATE INDEX `connections_from_created` ON `connections` (`from_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `connections_to_created` ON `connections` (`to_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `documents_archived_path` ON `documents` (`archived`,`path`,`id`);--> statement-breakpoint
CREATE INDEX `questions_anchor_created` ON `questions` (`anchor_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `questions_created` ON `questions` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `revision_document_created` ON `revisions` (`document_id`,`created_at`,`id`);
