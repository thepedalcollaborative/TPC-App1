-- Public read-only bucket for Terms of Service and Privacy Policy HTML pages.
-- Files are uploaded manually via the Supabase dashboard or CLI after this runs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('legal', 'legal', true, 102400, ARRAY['text/html'])
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anyone to read (no auth required — these are public legal pages)
DROP POLICY IF EXISTS "legal_public_read" ON storage.objects;
CREATE POLICY "legal_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'legal');
