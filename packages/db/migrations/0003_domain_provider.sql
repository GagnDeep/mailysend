ALTER TABLE `domain_dns_records` ADD `found` text;--> statement-breakpoint
ALTER TABLE `domain_dns_records` ADD `zone_id` text;--> statement-breakpoint
ALTER TABLE `domain_dns_records` ADD `managed_at` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `provider` text;