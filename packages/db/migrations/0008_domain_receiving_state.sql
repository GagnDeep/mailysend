-- Receiving was observed and then thrown away.
--
-- `POST /v1/domains/:id/receiving-check` resolved the MX, compared it to
-- Cloudflare Email Routing and returned the answer without storing it, so a
-- fresh page load knew nothing about receiving and could only offer another
-- button. These three columns memoise that observation.
--
-- `mx`, not `receiving`: a verified MX proves mail reaches Email Routing and
-- proves nothing about whether its catch-all rule is bound to this Worker,
-- which Cloudflare's API does not expose. There is no `receiving_ready` column
-- here because there is no observation that would justify one.
--
-- All three nullable with no default. Null means nobody has looked, which is a
-- different statement from `pending` — we looked, and the domain publishes no
-- MX at all.
ALTER TABLE `domains` ADD `receiving_mx_status` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `receiving_mx_found` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `receiving_checked_at` text;--> statement-breakpoint
CREATE INDEX `mail_messages_mailbox` ON `mail_messages` (`workspace_id`,`mailbox_id`,`at`);
