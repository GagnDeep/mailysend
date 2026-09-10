ALTER TABLE `domain_dns_records` ADD `origin` text DEFAULT 'copy' NOT NULL;--> statement-breakpoint
ALTER TABLE `domain_dns_records` ADD `match_mode` text DEFAULT 'exact' NOT NULL;