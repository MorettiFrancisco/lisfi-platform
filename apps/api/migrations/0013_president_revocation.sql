DROP TRIGGER apply_approved_change;
--> statement-breakpoint
CREATE TRIGGER apply_approved_change AFTER INSERT ON change_approvals
WHEN (SELECT COUNT(*) FROM change_approvals a JOIN "user" u ON u.id = a.admin_id AND u.status = 'ACTIVE' AND u."twoFactorEnabled" = 1 WHERE a.request_id = NEW.request_id AND EXISTS (SELECT 1 FROM global_role_assignments g WHERE g.user_id = a.admin_id AND g.role = 'LEAGUE_ADMIN' AND g.revoked_at IS NULL) AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId" = a.admin_id AND t.verified = 1)) >= 2
BEGIN
  SELECT CASE WHEN (SELECT status FROM change_requests WHERE id = NEW.request_id) <> 'PENDING' THEN RAISE(ABORT, 'Request not pending') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind <> 'CLUB' AND NOT EXISTS (SELECT 1 FROM clubs c WHERE c.id = r.club_id AND c.status = 'ACTIVE')) THEN RAISE(ABORT, 'Club unavailable') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT' AND COALESCE((SELECT id FROM club_officials WHERE club_id = r.club_id AND position = 'PRESIDENT' AND ended_at IS NULL), '') <> COALESCE(json_extract(r.payload_json, '$.previousPresidentId'), '')) THEN RAISE(ABORT, 'President changed') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM change_requests r
    WHERE r.id = NEW.request_id AND r.kind = 'REPRESENTATIVE'
      AND NOT EXISTS (
        SELECT 1 FROM "user" u
        WHERE u.id = COALESCE(
          json_extract(r.payload_json, '$.userId'),
          (SELECT candidate.id FROM "user" candidate WHERE lower(candidate.email) = lower(json_extract(r.payload_json, '$.email')) AND candidate.status = 'ACTIVE' AND (candidate."emailVerified" = 1 OR EXISTS (SELECT 1 FROM representative_invitations ri WHERE ri.accepted_user_id = candidate.id AND ri.accepted_at IS NOT NULL)) LIMIT 1)
        )
          AND u.status = 'ACTIVE' AND (u."emailVerified" = 1 OR EXISTS (SELECT 1 FROM representative_invitations ri WHERE ri.accepted_user_id = u.id AND ri.accepted_at IS NOT NULL))
      )
  ) THEN RAISE(ABORT, 'User unavailable') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT' AND COALESCE((SELECT p.id FROM club_president_authorities p WHERE p.club_id = r.club_id AND p.revoked_at IS NULL), '') <> COALESCE(json_extract(r.payload_json, '$.previousAuthorityId'), '')) THEN RAISE(ABORT, 'President authority changed') END;
  INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json)
    SELECT NEW.id || '-president-revoked-' || p.id, NEW.admin_id, 'MEMBERSHIP_REVOKED', 'CLUB', p.club_id, NEW.created_at, json_object('membershipId', p.membership_id, 'userId', p.user_id, 'reason', 'PRESIDENT_CHANGED')
    FROM club_president_authorities p JOIN change_requests r ON r.club_id = p.club_id
    WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT' AND p.revoked_at IS NULL;
  UPDATE club_memberships SET revoked_at = NEW.created_at
    WHERE revoked_at IS NULL AND id IN (SELECT p.membership_id FROM club_president_authorities p JOIN change_requests r ON r.club_id = p.club_id WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT' AND p.revoked_at IS NULL);
  UPDATE club_president_authorities SET revoked_at = NEW.created_at
    WHERE revoked_at IS NULL AND club_id IN (SELECT r.club_id FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT');
  UPDATE representative_invitations SET expires_at = NEW.created_at
    WHERE kind = 'PRESIDENT' AND accepted_at IS NULL AND expires_at > NEW.created_at AND club_id IN (SELECT r.club_id FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'PRESIDENT');
  INSERT INTO clubs (id, name, short_name, slug, status, created_at, updated_at, version)
    SELECT json_extract(payload_json, '$.entityId'), json_extract(payload_json, '$.name'), json_extract(payload_json, '$.shortName'), json_extract(payload_json, '$.slug'), 'ACTIVE', NEW.created_at, NEW.created_at, 1 FROM change_requests WHERE id = NEW.request_id AND kind = 'CLUB';
  UPDATE club_officials SET ended_at = NEW.created_at WHERE id = (SELECT json_extract(payload_json, '$.previousPresidentId') FROM change_requests WHERE id = NEW.request_id AND kind = 'PRESIDENT') AND ended_at IS NULL;
  INSERT INTO club_officials (id, club_id, name, position, created_at)
    SELECT json_extract(payload_json, '$.entityId'), club_id, json_extract(payload_json, '$.name'), kind, NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind IN ('PRESIDENT', 'TECHNICAL_DIRECTOR');
  INSERT INTO club_memberships (id, user_id, club_id, role, created_at)
    SELECT json_extract(r.payload_json, '$.entityId'), COALESCE(json_extract(r.payload_json, '$.userId'), (SELECT candidate.id FROM "user" candidate WHERE lower(candidate.email) = lower(json_extract(r.payload_json, '$.email')) AND candidate.status = 'ACTIVE' AND (candidate."emailVerified" = 1 OR EXISTS (SELECT 1 FROM representative_invitations ri WHERE ri.accepted_user_id = candidate.id AND ri.accepted_at IS NOT NULL)) LIMIT 1)), r.club_id, 'CLUB_REPRESENTATIVE', NEW.created_at
    FROM change_requests r WHERE r.id = NEW.request_id AND r.kind = 'REPRESENTATIVE';
  INSERT INTO players (id, first_name, last_name, created_at)
    SELECT json_extract(payload_json, '$.entityId'), json_extract(payload_json, '$.firstName'), json_extract(payload_json, '$.lastName'), NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind = 'PLAYER';
  INSERT INTO club_players (id, club_id, player_id, created_at)
    SELECT json_extract(payload_json, '$.linkId'), club_id, json_extract(payload_json, '$.entityId'), NEW.created_at FROM change_requests WHERE id = NEW.request_id AND kind = 'PLAYER';
  INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json)
    SELECT NEW.id || '-applied', NEW.admin_id, 'CHANGE_APPLIED', 'CHANGE_REQUEST', id, NEW.created_at, json_object('kind', kind, 'clubId', club_id, 'entityId', json_extract(payload_json, '$.entityId')) FROM change_requests WHERE id = NEW.request_id;
  UPDATE change_requests SET status = 'APPLIED', resolved_at = NEW.created_at WHERE id = NEW.request_id;
END;
