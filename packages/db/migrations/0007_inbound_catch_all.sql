-- Receiving that works the way the button implies.
--
-- Cloudflare Email Routing's catch-all rule is what an operator binds to this
-- Worker, and the product's own copy said doing so made "every address start
-- arriving". It did not: the handler demanded an exact `inbound_mailboxes` row
-- and answered `550 5.1.1 No such mailbox` to everything else, so the first
-- message anybody sent to a freshly routed domain bounced.
--
-- One mailbox per domain may be the catch-all, which is what the partial unique
-- index enforces — two would make delivery depend on row order. The column
-- defaults to false, so an existing deployment behaves exactly as it did until
-- somebody turns it on.
ALTER TABLE `inbound_mailboxes` ADD `is_catch_all` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inbound_mailboxes` ADD `domain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_mailboxes_catch_all` ON `inbound_mailboxes` (`workspace_id`,`domain`) WHERE "is_catch_all" = 1;--> statement-breakpoint
-- Backfill, so the catch-all lookup finds existing mailboxes' domains too.
UPDATE `inbound_mailboxes` SET `domain` = lower(substr(`address`, instr(`address`, '@') + 1)) WHERE `domain` IS NULL;
