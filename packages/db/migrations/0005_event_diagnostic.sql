-- The failure reason has always been produced and never stored.
--
-- `markFailed` emits a `diagnostic` on every failed send, the event contract
-- accepts it, and the INSERT below it had no column to put it in — so the one
-- row that explains why a send failed was assembled, queued, and dropped. The
-- timeline for exactly the messages that need an explanation was blank.
ALTER TABLE `message_events` ADD COLUMN `diagnostic` text;
