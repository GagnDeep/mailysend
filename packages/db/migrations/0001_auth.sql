CREATE TABLE `claim_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claim_nonces_created` ON `claim_nonces` (`created_at`);--> statement-breakpoint
CREATE TABLE `device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`client` text,
	`user_id` text,
	`workspace_id` text,
	`approved_at` text,
	`denied_at` text,
	`issued_token` text,
	`redeemed_at` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_codes_hash` ON `device_codes` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_codes_user_code` ON `device_codes` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_codes_expiry` ON `device_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_codes_hash` ON `recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `recovery_codes_user` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`rp_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webauthn_challenges_expiry` ON `webauthn_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`rp_id` text NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_cid` ON `webauthn_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `webauthn_credentials_user` ON `webauthn_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `login_codes` ADD `ip` text;--> statement-breakpoint
CREATE INDEX `login_codes_ip` ON `login_codes` (`ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_codes_expiry` ON `login_codes` (`expires_at`);
