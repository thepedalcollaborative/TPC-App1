-- Repair misplaced pedals.manual_text (clipboard mishap during admin entry).
-- Audit findings (2026-07-16):
--   • Brothers AM's row held Big Time's descriptive text
--   • 7 Chase Bliss rows held Brothers AM's text
--   • Big Time, Chroma Console, Microcosm held a stray planning note
-- Every content guard below matches on a text prefix so re-running or racing
-- concurrent admin edits cannot clobber corrected data.

-- 1. Big Time gets its real text (currently in Brothers AM's row)
UPDATE pedals
SET manual_text = (
  SELECT manual_text FROM pedals
  WHERE brand = 'Chase Bliss' AND model = 'Brothers AM'
    AND manual_text LIKE 'Big Time occupies%'
)
WHERE brand = 'Chase Bliss' AND model = 'Big Time'
  AND manual_text LIKE 'Ok then once this is done%'
  AND EXISTS (
    SELECT 1 FROM pedals
    WHERE brand = 'Chase Bliss' AND model = 'Brothers AM'
      AND manual_text LIKE 'Big Time occupies%'
  );

-- 2. Brothers AM gets its real text (one of the 7 stray copies)
UPDATE pedals
SET manual_text = (
  SELECT manual_text FROM pedals
  WHERE brand = 'Chase Bliss' AND model = 'Onward'
    AND manual_text LIKE 'Brothers AM is a warm%'
)
WHERE brand = 'Chase Bliss' AND model = 'Brothers AM'
  AND manual_text LIKE 'Big Time occupies%'
  AND EXISTS (
    SELECT 1 FROM pedals
    WHERE brand = 'Chase Bliss' AND model = 'Onward'
      AND manual_text LIKE 'Brothers AM is a warm%'
  );

-- 3. Clear the stray Brothers AM copies (their real texts were never saved)
UPDATE pedals
SET manual_text = NULL
WHERE brand = 'Chase Bliss'
  AND model IN ('Blooper', 'Clean', 'CXM 1978', 'Generation Loss MKII', 'Lossy', 'MOOD MKII', 'Onward')
  AND manual_text LIKE 'Brothers AM is a warm%';

-- 4. Clear the stray planning note
UPDATE pedals
SET manual_text = NULL
WHERE manual_text LIKE 'Ok then once this is done%';
