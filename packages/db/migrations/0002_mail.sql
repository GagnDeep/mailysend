CREATE TABLE `mail_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_id` text,
	`inline` integer DEFAULT false NOT NULL,
	`blob_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_attachments_message` ON `mail_attachments` (`workspace_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `mail_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`thread_id` text,
	`mode` text DEFAULT 'new' NOT NULL,
	`environment` text DEFAULT 'live' NOT NULL,
	`from_address` text,
	`to_addresses` text,
	`cc_addresses` text,
	`bcc_addresses` text,
	`subject` text,
	`html` text,
	`text` text,
	`in_reply_to` text,
	`references_json` text,
	`attachments` text,
	`scheduled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_drafts_ws` ON `mail_drafts` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `mail_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'neutral' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_labels_name` ON `mail_labels` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`environment` text DEFAULT 'live' NOT NULL,
	`mailbox_id` text,
	`source_id` text,
	`message_id_header` text,
	`in_reply_to` text,
	`references_json` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text,
	`bcc_addresses` text,
	`reply_to` text,
	`subject` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`unread` integer DEFAULT false NOT NULL,
	`size_bytes` integer,
	`body_key` text,
	`raw_key` text,
	`spf` text,
	`dkim` text,
	`dmarc` text,
	`spam_score` integer,
	`parse_status` text DEFAULT 'parsed' NOT NULL,
	`matched_by` text,
	`status` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_messages_thread` ON `mail_messages` (`workspace_id`,`thread_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_header` ON `mail_messages` (`workspace_id`,`message_id_header`);--> statement-breakpoint
CREATE INDEX `mail_messages_source` ON `mail_messages` (`workspace_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`mailbox_id` text,
	`environment` text DEFAULT 'live' NOT NULL,
	`subject` text NOT NULL,
	`subject_normalized` text NOT NULL,
	`participants` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`folder` text DEFAULT 'inbox' NOT NULL,
	`labels` text,
	`snoozed_until` text,
	`last_message_at` text NOT NULL,
	`last_direction` text DEFAULT 'in' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_threads_folder` ON `mail_threads` (`workspace_id`,`environment`,`folder`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `mail_threads_subject` ON `mail_threads` (`workspace_id`,`subject_normalized`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `mail_threads_snoozed` ON `mail_threads` (`snoozed_until`);--> statement-breakpoint
CREATE VIRTUAL TABLE `mail_search` USING fts5(`message_id` UNINDEXED, `thread_id` UNINDEXED, `workspace_id` UNINDEXED, `environment` UNINDEXED, `subject`, `snippet`, `from_address`, `to_addresses`, tokenize='porter unicode61');
