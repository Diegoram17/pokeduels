-- Up Migration
-- Item #7 (bracket-walkover): add 'walkover' to the duels.end_reason CHECK.
-- A walkover (timeout-based default loss between bracket rounds) is a distinct
-- end reason from 'disconnect' (a mid-duel forfeit): it can end a 'pending'
-- duel that never started, and reconciliation (#8) needs to distinguish it.
ALTER TABLE duels
  DROP CONSTRAINT duels_end_reason_check,
  ADD CONSTRAINT duels_end_reason_check
    CHECK (end_reason IN ('ko','disconnect','surrender','server_restart','walkover'));

-- Down Migration
ALTER TABLE duels
  DROP CONSTRAINT duels_end_reason_check,
  ADD CONSTRAINT duels_end_reason_check
    CHECK (end_reason IN ('ko','disconnect','surrender','server_restart'));
