-- Clear this week's cached weekly picks. Picks generated before the
-- owned/wishlist/retired guard was added (2026-07-15) may recommend pedals
-- the user already owns (e.g. Ottobit X while owning one) and are served
-- from cache until the ISO week rolls over. Deleting them forces regeneration
-- through the guarded path on next open.
DELETE FROM weekly_picks
WHERE week_key = to_char(now(), 'IYYY-"W"IW');
