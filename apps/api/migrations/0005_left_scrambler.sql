CREATE TABLE `change_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`admin_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `change_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admin_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_approval_per_admin` ON `change_approvals` (`request_id`,`admin_id`);--> statement-breakpoint
CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`club_id` text,
	`requester_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "change_kind_check" CHECK("change_requests"."kind" IN ('CLUB', 'PRESIDENT', 'REPRESENTATIVE', 'TECHNICAL_DIRECTOR', 'PLAYER')),
	CONSTRAINT "change_status_check" CHECK("change_requests"."status" IN ('PENDING', 'APPLIED', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `change_status_idx` ON `change_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TRIGGER apply_approved_change AFTER INSERT ON change_approvals
WHEN (SELECT COUNT(*) FROM change_approvals a JOIN "user" u ON u.id = a.admin_id AND u.status = 'ACTIVE' AND u."twoFactorEnabled" = 1 WHERE a.request_id = NEW.request_id AND EXISTS (SELECT 1 FROM global_role_assignments g WHERE g.user_id = a.admin_id AND g.role = 'LEAGUE_ADMIN' AND g.revoked_at IS NULL) AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId" = a.admin_id AND t.verified = 1)) >= 2
BEGIN
  SELECT CASE WHEN (SELECT status FROM change_requests WHERE id = NEW.request_id) <> 'PENDING' THEN RAISE(ABORT, 'Request not pending') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind <> 'CLUB' AND NOT EXISTS (SELECT 1 FROM clubs c WHERE c.id = r.club_id AND c.status = 'ACTIVE')) THEN RAISE(ABORT, 'Club unavailable') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT' AND COALESCE((SELECT id FROM club_officials WHERE club_id = r.club_id AND position = 'PRESIDENT' AND ended_at IS NULL), '') <> COALESCE(json_extract(r.payload_json, '$.previousPresidentId'), '')) THEN RAISE(ABORT, 'President changed') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'REPRESENTATIVE' AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = json_extract(r.payload_json, '$.userId') AND u.status = 'ACTIVE' AND u."emailVerified" = 1)) THEN RAISE(ABORT, 'User unavailable') END;
  INSERT INTO clubs (id, name, short_name, slug, status, created_at, updated_at, version)
    SELECT json_extract(payload_json, '$.entityId'), json_extract(payload_json, '$.name'), json_extract(payload_json, '$.shortName'), json_extract(payload_json, '$.slug'), 'ACTIVE', NEW.created_at, NEW.created_at, 1 FROM change_requests WHERE id = NEW.request_id AND kind = 'CLUB';
  UPDATE club_officials SET ended_at = NEW.created_at WHERE id = (SELECT json_extract(payload_json, '$.previousPresidentId') FROM change_requests WHERE id = NEW.request_id AND kind = 'PRESIDENT') AND ended_at IS NULL;
  INSERT INTO club_officials (id, club_id, name, position, created_at)
    SELECT json_extract(payload_json, '$.entityId'), club_id, json_extract(payload_json, '$.name'), kind, NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind IN ('PRESIDENT', 'TECHNICAL_DIRECTOR');
  INSERT INTO club_memberships (id, user_id, club_id, role, created_at)
    SELECT json_extract(payload_json, '$.entityId'), json_extract(payload_json, '$.userId'), club_id, 'CLUB_REPRESENTATIVE', NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind = 'REPRESENTATIVE';
  INSERT INTO players (id, first_name, last_name, created_at)
    SELECT json_extract(payload_json, '$.entityId'), json_extract(payload_json, '$.firstName'), json_extract(payload_json, '$.lastName'), NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind = 'PLAYER';
  INSERT INTO club_players (id, club_id, player_id, created_at)
    SELECT json_extract(payload_json, '$.linkId'), club_id, json_extract(payload_json, '$.entityId'), NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind = 'PLAYER';
  INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json)
    SELECT NEW.id || '-applied', NEW.admin_id, 'CHANGE_APPLIED', 'CHANGE_REQUEST', id, NEW.created_at, payload_json FROM change_requests WHERE id = NEW.request_id;
  UPDATE change_requests SET status = 'APPLIED', resolved_at = NEW.created_at WHERE id = NEW.request_id;
END;
