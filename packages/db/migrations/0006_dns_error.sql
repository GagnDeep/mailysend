-- "Verified" could outlive the check that produced it.
--
-- `checkRecord` returned the record's previous `verified` status whenever the
-- resolver threw, so an outage read as a pass and the domain roll-up re-stamped
-- itself verified over rows nobody had actually looked at. `status = 'error'`
-- is the missing third answer, and this column is why it happened.
ALTER TABLE `domain_dns_records` ADD COLUMN `error` text;
