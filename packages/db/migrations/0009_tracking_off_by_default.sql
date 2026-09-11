-- Tracking defaults to off, for new domains only.
--
-- Open tracking inserts a 1x1 pixel the recipient's mail client fetches from
-- us; click tracking rewrites every link so the URL a recipient sees on hover
-- is ours, not the sender's. Both are visible to the recipient, neither is
-- required to send, and both were on the moment a domain was added — a change
-- to somebody's mail that nobody had been asked about.
--
-- SQLite cannot alter a column default in place, so this is the table rebuild
-- Drizzle generates for it. The INSERT ... SELECT copies `open_tracking` and
-- `click_tracking` across verbatim: every existing domain keeps exactly the
-- setting it has, and only rows created after this migration take the new
-- default.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`region` text DEFAULT 'global' NOT NULL,
	`provider` text,
	`dkim_selector` text DEFAULT 'ms1' NOT NULL,
	`dkim_private_key` text,
	`dkim_public_key` text,
	`custom_return_path` text DEFAULT 'cf-bounce' NOT NULL,
	`open_tracking` integer DEFAULT false NOT NULL,
	`click_tracking` integer DEFAULT false NOT NULL,
	`tls` text DEFAULT 'opportunistic' NOT NULL,
	`dmarc_policy` text,
	`receiving_mx_status` text,
	`receiving_mx_found` text,
	`receiving_checked_at` text,
	`learned_daily_quota` integer,
	`last_verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_domains`("id", "workspace_id", "name", "status", "region", "provider", "dkim_selector", "dkim_private_key", "dkim_public_key", "custom_return_path", "open_tracking", "click_tracking", "tls", "dmarc_policy", "receiving_mx_status", "receiving_mx_found", "receiving_checked_at", "learned_daily_quota", "last_verified_at", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "status", "region", "provider", "dkim_selector", "dkim_private_key", "dkim_public_key", "custom_return_path", "open_tracking", "click_tracking", "tls", "dmarc_policy", "receiving_mx_status", "receiving_mx_found", "receiving_checked_at", "learned_daily_quota", "last_verified_at", "created_at", "updated_at" FROM `domains`;--> statement-breakpoint
DROP TABLE `domains`;--> statement-breakpoint
ALTER TABLE `__new_domains` RENAME TO `domains`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `domains_ws_name` ON `domains` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `domains_ws` ON `domains` (`workspace_id`,`created_at`);