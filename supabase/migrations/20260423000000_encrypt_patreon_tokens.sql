-- Encrypt Patreon tokens at rest
-- Existing plaintext tokens are cleared (they expire in hours anyway).
-- Going forward, the patreon-connect Edge Function stores AES-GCM encrypted
-- ciphertext (IV prepended, base64-encoded) using the PATREON_TOKEN_ENCRYPTION_KEY secret.

-- Wipe existing plaintext tokens so no unencrypted values remain at rest.
-- Users will simply re-connect Patreon on next login if needed.
UPDATE patreon_connections
SET access_token  = '',
    refresh_token = ''
WHERE access_token  != ''
   OR refresh_token != '';

-- Add a flag so the application can tell whether a stored token is encrypted.
-- Rows written before this migration have encrypted = false (now cleared above).
-- All new rows written by the updated Edge Function will have encrypted = true.
ALTER TABLE patreon_connections
  ADD COLUMN IF NOT EXISTS encrypted boolean NOT NULL DEFAULT false;

-- Mark all existing rows as encrypted = false (they were plaintext, now cleared).
UPDATE patreon_connections SET encrypted = false;

-- Future inserts from the updated Edge Function will set encrypted = true.
