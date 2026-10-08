ALTER TABLE `account` ADD COLUMN `issuer` TEXT NULL AFTER `id`;
UPDATE `account` SET `issuer` = CONCAT('local:', `providerId`) WHERE `issuer` IS NULL;
ALTER TABLE `account` MODIFY `issuer` TEXT NOT NULL;
CREATE UNIQUE INDEX `account_issuer_accountId_key` ON `account` (`issuer`, `accountId`);
ALTER TABLE `user` ADD COLUMN `username` TEXT NULL;
ALTER TABLE `user` ADD COLUMN `displayUsername` TEXT NULL;
