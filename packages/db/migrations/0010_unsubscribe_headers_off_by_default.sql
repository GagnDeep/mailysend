-- List-Unsubscribe headers make a message look like mailing-list mail to
-- clients such as Apple Mail. Existing domains therefore begin with them off
-- for individual sends; broadcasts carry an unsubscribe path independently.
ALTER TABLE `domains` ADD `unsubscribe_headers` integer DEFAULT false NOT NULL;
