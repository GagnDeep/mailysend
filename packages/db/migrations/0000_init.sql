CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_preview` text NOT NULL,
	`environment` text DEFAULT 'live' NOT NULL,
	`permission` text DEFAULT 'full_access' NOT NULL,
	`domain_id` text,
	`created_by` text,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_ws` ON `api_keys` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`metadata` text,
	`ip` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_ws` ON `audit_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_body` text,
	`status` text DEFAULT 'in_flight' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_pk` ON `idempotency_keys` (`workspace_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_expiry` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invites_ws` ON `invites` (`workspace_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `login_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_codes_email` ON `login_codes` (`email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_pk` ON `memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`weight` integer DEFAULT 100 NOT NULL,
	`credentials` text,
	`config` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configs_ws` ON `provider_configs` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_configs_order` ON `provider_configs` (`workspace_id`,`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_pk` ON `settings` (`workspace_id`,`key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`password_hash` text,
	`email_verified_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan` text DEFAULT 'self_hosted' NOT NULL,
	`flags` text,
	`stripe_customer_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE TABLE `alert_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`observed_value` real NOT NULL,
	`sample_size` integer NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`notified_at` text
);
--> statement-breakpoint
CREATE INDEX `alert_incidents_ws` ON `alert_incidents` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`metric` text NOT NULL,
	`comparator` text NOT NULL,
	`threshold` real NOT NULL,
	`window_minutes` integer DEFAULT 60 NOT NULL,
	`min_sample` integer DEFAULT 50 NOT NULL,
	`channel` text NOT NULL,
	`target` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_ws` ON `alerts` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `dmarc_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`domain` text NOT NULL,
	`org_name` text NOT NULL,
	`report_id` text NOT NULL,
	`date_begin` text NOT NULL,
	`date_end` text NOT NULL,
	`policy_p` text,
	`total_messages` integer DEFAULT 0 NOT NULL,
	`pass_count` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`raw_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dmarc_reports_unique` ON `dmarc_reports` (`workspace_id`,`org_name`,`report_id`);--> statement-breakpoint
CREATE INDEX `dmarc_reports_domain` ON `dmarc_reports` (`workspace_id`,`domain`,`date_begin`);--> statement-breakpoint
CREATE TABLE `dmarc_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`report_id` text NOT NULL,
	`source_ip` text NOT NULL,
	`count` integer NOT NULL,
	`disposition` text,
	`dkim_result` text,
	`spf_result` text,
	`header_from` text,
	`dkim_domain` text,
	`spf_domain` text,
	`source_label` text
);
--> statement-breakpoint
CREATE INDEX `dmarc_rows_report` ON `dmarc_rows` (`workspace_id`,`report_id`);--> statement-breakpoint
CREATE TABLE `domain_dns_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`record` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`priority` integer,
	`provider` text DEFAULT 'all' NOT NULL,
	`purpose` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`last_checked_at` text
);
--> statement-breakpoint
CREATE INDEX `domain_dns_domain` ON `domain_dns_records` (`workspace_id`,`domain_id`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`region` text DEFAULT 'global' NOT NULL,
	`dkim_selector` text DEFAULT 'ms1' NOT NULL,
	`dkim_private_key` text,
	`dkim_public_key` text,
	`custom_return_path` text DEFAULT 'cf-bounce' NOT NULL,
	`open_tracking` integer DEFAULT true NOT NULL,
	`click_tracking` integer DEFAULT true NOT NULL,
	`tls` text DEFAULT 'opportunistic' NOT NULL,
	`dmarc_policy` text,
	`learned_daily_quota` integer,
	`last_verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_ws_name` ON `domains` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `domains_ws` ON `domains` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `message_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`message_id` text,
	`type` text NOT NULL,
	`recipient` text NOT NULL,
	`occurred_at` text NOT NULL,
	`provider` text,
	`audience_class` text,
	`link_url` text,
	`bounce_class` text,
	`smtp_code` text,
	`smtp_response` text,
	`ip` text,
	`user_agent` text,
	`geo_country` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_events_msg` ON `message_events` (`workspace_id`,`message_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `message_events_ws_type` ON `message_events` (`workspace_id`,`type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `message_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`message_id` text,
	`broadcast_id` text,
	`url` text NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`unique_click_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_links_msg` ON `message_links` (`workspace_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `message_links_broadcast` ON `message_links` (`workspace_id`,`broadcast_id`,`click_count`);--> statement-breakpoint
CREATE TABLE `message_tags` (
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_tags_lookup` ON `message_tags` (`workspace_id`,`name`,`value`,`message_id`);--> statement-breakpoint
CREATE INDEX `message_tags_msg` ON `message_tags` (`message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`domain_id` text,
	`from_address` text NOT NULL,
	`to_addresses` text NOT NULL,
	`cc_addresses` text,
	`bcc_addresses` text,
	`reply_to` text,
	`subject` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`state_rank` integer DEFAULT 10 NOT NULL,
	`provider` text,
	`provider_message_id` text,
	`environment` text DEFAULT 'live' NOT NULL,
	`broadcast_id` text,
	`automation_id` text,
	`contact_id` text,
	`template_id` text,
	`scheduled_at` text,
	`sent_at` text,
	`delivered_at` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`bounce_class` text,
	`smtp_code` text,
	`smtp_response` text,
	`error_message` text,
	`size_bytes` integer,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_ws_id` ON `messages` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_ws_status` ON `messages` (`workspace_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `messages_ws_domain` ON `messages` (`workspace_id`,`domain_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_broadcast` ON `messages` (`workspace_id`,`broadcast_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_contact` ON `messages` (`workspace_id`,`contact_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_provider_msg` ON `messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `messages_scheduled` ON `messages` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `placement_results` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`test_id` text,
	`domain_id` text,
	`recipient_provider` text NOT NULL,
	`inbox_percent` real NOT NULL,
	`spam_percent` real NOT NULL,
	`missing_percent` real NOT NULL,
	`source` text NOT NULL,
	`confidence` text NOT NULL,
	`sample_size` integer,
	`measured_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `placement_results_ws` ON `placement_results` (`workspace_id`,`domain_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `placement_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`domain_id` text,
	`name` text,
	`status` text DEFAULT 'running' NOT NULL,
	`seed_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `placement_tests_ws` ON `placement_tests` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rollups_daily` (
	`workspace_id` text NOT NULL,
	`day` text NOT NULL,
	`domain_id` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`unique_opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`unique_clicked` integer DEFAULT 0 NOT NULL,
	`unsubscribed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`delayed` integer DEFAULT 0 NOT NULL,
	`mpp_opened` integer DEFAULT 0 NOT NULL,
	`bot_opened` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rollups_daily_pk` ON `rollups_daily` (`workspace_id`,`day`,`domain_id`,`provider`);--> statement-breakpoint
CREATE TABLE `rollups_hourly` (
	`workspace_id` text NOT NULL,
	`hour` text NOT NULL,
	`domain_id` text DEFAULT '' NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rollups_hourly_pk` ON `rollups_hourly` (`workspace_id`,`hour`,`domain_id`);--> statement-breakpoint
CREATE TABLE `suppressions` (
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`original_email` text NOT NULL,
	`reason` text NOT NULL,
	`source` text,
	`expires_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_pk` ON `suppressions` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `suppressions_ws_created` ON `suppressions` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audiences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audiences_ws` ON `audiences` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`version` integer NOT NULL,
	`contact_id` text NOT NULL,
	`instance_id` text,
	`cohort` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_step` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_enrollments_unique` ON `automation_enrollments` (`workspace_id`,`automation_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_cohort` ON `automation_enrollments` (`workspace_id`,`automation_id`,`cohort`,`status`);--> statement-breakpoint
CREATE TABLE `automation_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_triggers_lookup` ON `automation_triggers` (`workspace_id`,`type`);--> statement-breakpoint
CREATE TABLE `automation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`version` integer NOT NULL,
	`steps` text NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_versions_pk` ON `automation_versions` (`workspace_id`,`automation_id`,`version`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`mode` text DEFAULT 'cohort' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`enrolled_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automations_ws` ON `automations` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `broadcast_sends` (
	`workspace_id` text NOT NULL,
	`broadcast_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`message_id` text,
	`variant` text,
	`holdout` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_sends_pk` ON `broadcast_sends` (`workspace_id`,`broadcast_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `broadcast_sends_msg` ON `broadcast_sends` (`message_id`);--> statement-breakpoint
CREATE TABLE `broadcast_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`broadcast_id` text NOT NULL,
	`key` text NOT NULL,
	`subject` text,
	`html` text,
	`text` text,
	`weight` integer DEFAULT 50 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_variants_pk` ON `broadcast_variants` (`workspace_id`,`broadcast_id`,`key`);--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text,
	`audience_id` text,
	`segment_id` text,
	`from_address` text,
	`reply_to` text,
	`subject` text,
	`preview_text` text,
	`template_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`throttle_per_minute` integer,
	`holdout_percent` integer DEFAULT 0 NOT NULL,
	`winner_metric` text,
	`winner_variant` text,
	`winner_inconclusive` integer,
	`total_recipients` integer DEFAULT 0 NOT NULL,
	`scheduled_at` text,
	`started_at` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `broadcasts_ws` ON `broadcasts` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `broadcasts_status` ON `broadcasts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `contact_dirty` (
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`fields` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_dirty_pk` ON `contact_dirty` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_fields` (
	`workspace_id` text NOT NULL,
	`audience_id` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`indexed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_fields_pk` ON `contact_fields` (`workspace_id`,`audience_id`,`key`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`audience_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`unsubscribed` integer DEFAULT false NOT NULL,
	`unsubscribed_at` text,
	`data` text,
	`last_open_at` text,
	`last_click_at` text,
	`last_send_at` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`send_count` integer DEFAULT 0 NOT NULL,
	`bounce_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_audience_email` ON `contacts` (`workspace_id`,`audience_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_ws_id` ON `contacts` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `contacts_engagement` ON `contacts` (`workspace_id`,`audience_id`,`last_open_at`);--> statement-breakpoint
CREATE INDEX `contacts_email` ON `contacts` (`workspace_id`,`email`);--> statement-breakpoint
CREATE TABLE `inbound_mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`address` text NOT NULL,
	`name` text,
	`forward_webhook_id` text,
	`agent_enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_mailboxes_address` ON `inbound_mailboxes` (`workspace_id`,`address`);--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`message_id_header` text,
	`in_reply_to` text,
	`from_address` text NOT NULL,
	`to_addresses` text NOT NULL,
	`subject` text NOT NULL,
	`snippet` text NOT NULL,
	`raw_key` text NOT NULL,
	`body_key` text,
	`spf` text,
	`dkim` text,
	`dmarc` text,
	`spam_score` integer,
	`parse_status` text DEFAULT 'parsed' NOT NULL,
	`matched_by` text,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbound_messages_thread` ON `inbound_messages` (`workspace_id`,`thread_id`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_messages_dedupe` ON `inbound_messages` (`workspace_id`,`raw_key`);--> statement-breakpoint
CREATE TABLE `inbound_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`subject` text NOT NULL,
	`subject_normalized` text NOT NULL,
	`participants` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`unread` integer DEFAULT true NOT NULL,
	`last_message_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbound_threads_mailbox` ON `inbound_threads` (`workspace_id`,`mailbox_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `inbound_threads_subject` ON `inbound_threads` (`workspace_id`,`subject_normalized`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `segment_members` (
	`workspace_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_members_pk` ON `segment_members` (`workspace_id`,`segment_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `segment_members_contact` ON `segment_members` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`audience_id` text NOT NULL,
	`name` text NOT NULL,
	`expression` text NOT NULL,
	`compiled` text,
	`depends_on` text,
	`member_count` integer DEFAULT 0 NOT NULL,
	`computed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `segments_ws` ON `segments` (`workspace_id`,`audience_id`);--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`subject` text,
	`html` text,
	`text` text,
	`ast` text,
	`variables` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_versions_pk` ON `template_versions` (`workspace_id`,`template_id`,`version`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`engine` text DEFAULT 'handlebars' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_slug` ON `templates` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response_status` integer,
	`response_body` text,
	`duration_ms` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_endpoint` ON `webhook_deliveries` (`workspace_id`,`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event` ON `webhook_deliveries` (`workspace_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret` text NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`description` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`disabled_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoints_ws` ON `webhook_endpoints` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `mcp_confirmations` (
	`token` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`consumed_at` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_confirmations_ws` ON `mcp_confirmations` (`workspace_id`,`status`,`expires_at`);
