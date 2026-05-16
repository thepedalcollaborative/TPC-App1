-- ─────────────────────────────────────────────────────────────────────────────
-- Image quality + brands table
-- 2026-04-07
--
-- Changes:
--   1. pedals.image_source  — tracks WHERE the image came from
--   2. pedals.image_storage_path — path inside our 'pedal-images' Storage bucket
--   3. brands table — canonical brand registry with Reverb shop slugs
--
-- After running this migration:
--   • Create a PUBLIC Supabase Storage bucket named "pedal-images"
--     (Storage → New bucket → Name: pedal-images → Public: ON)
--   • Deploy edge functions: pedal-image, enrich-catalog
--   • Schedule enrich-catalog to run nightly via pg_cron (optional but recommended)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Image quality columns on pedals ────────────────────────────────────────

ALTER TABLE pedals
  ADD COLUMN IF NOT EXISTS image_source TEXT
    CHECK (image_source IN ('manufacturer', 'preferred_seller', 'reverb_listing', 'user_contributed')),
  ADD COLUMN IF NOT EXISTS image_storage_path TEXT;  -- path in pedal-images Storage bucket

-- Mark everything currently in the table as coming from Reverb listings
-- (that's what enrichMissingImages has been storing so far)
UPDATE pedals
SET image_source = 'reverb_listing'
WHERE image_url IS NOT NULL AND image_source IS NULL;

-- Indexes used by enrich-catalog to find pedals needing enrichment
CREATE INDEX IF NOT EXISTS idx_pedals_needs_image
  ON pedals (gas_count DESC NULLS LAST)
  WHERE image_url IS NULL;

CREATE INDEX IF NOT EXISTS idx_pedals_needs_enrichment
  ON pedals (gas_count DESC NULLS LAST)
  WHERE image_source IS NULL OR image_source = 'reverb_listing';

-- ── 2. Brands reference table ─────────────────────────────────────────────────
-- No FK to pedals yet — pedals.brand stays as plain text (avoids a big migration).
-- This table is used by the pedal-image edge function to look up official
-- Reverb shop slugs, and will power a brand browsing UI in the future.

CREATE TABLE IF NOT EXISTS brands (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,   -- canonical display name e.g. "Electro-Harmonix"
  slug              TEXT NOT NULL UNIQUE,   -- URL-safe e.g. "electro-harmonix"
  reverb_shop_slug  TEXT,                   -- official Reverb shop slug (NULL if not verified)
  website_url       TEXT,
  country           TEXT,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public read; only service role writes
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands_public_select" ON brands FOR SELECT USING (TRUE);

-- Seed with the major brands whose Reverb shop slugs are confirmed
INSERT INTO brands (name, slug, reverb_shop_slug, website_url, country, verified) VALUES
  ('Boss',                'boss',                'boss-us',               'https://www.boss.info',                    'JP', TRUE),
  ('Electro-Harmonix',    'electro-harmonix',    'electro-harmonix',      'https://www.ehx.com',                      'US', TRUE),
  ('Strymon',             'strymon',             'strymon',               'https://www.strymon.net',                  'US', TRUE),
  ('TC Electronic',       'tc-electronic',       'tc-electronic',         'https://www.tcelectronic.com',             'DK', TRUE),
  ('MXR',                 'mxr',                 'jim-dunlop',            'https://www.jimdunlop.com',                'US', TRUE),
  ('Walrus Audio',        'walrus-audio',        'walrus-audio',          'https://www.walrusaudio.com',              'US', TRUE),
  ('Eventide',            'eventide',            'eventide',              'https://www.eventideaudio.com',            'US', TRUE),
  ('Source Audio',        'source-audio',        'source-audio',          'https://www.sourceaudio.net',              'US', TRUE),
  ('JHS Pedals',          'jhs-pedals',          'jhs-pedals',            'https://jhspedals.info',                   'US', TRUE),
  ('Keeley Electronics',  'keeley-electronics',  'keeley-electronics',    'https://robertkeeley.com',                 'US', TRUE),
  ('Chase Bliss Audio',   'chase-bliss-audio',   'chase-bliss-audio',     'https://www.chaseblissaudio.com',          'US', TRUE),
  ('Meris',               'meris',               'meris',                 'https://www.meris.us',                     'US', TRUE),
  ('Earthquaker Devices', 'earthquaker-devices', 'earthquaker-devices',   'https://www.earthquakerdevices.com',       'US', TRUE),
  ('Universal Audio',     'universal-audio',     'universal-audio',       'https://www.uaudio.com',                   'US', TRUE),
  ('Neural DSP',          'neural-dsp',          'neural-dsp',            'https://neuraldsp.com',                    'FI', TRUE),
  ('Wampler Pedals',      'wampler-pedals',      'wampler-pedals',        'https://www.wamplerpedals.com',            'US', TRUE),
  ('Empress Effects',     'empress-effects',     'empress-effects',       'https://empresseffects.com',               'CA', TRUE),
  ('Pigtronix',           'pigtronix',           'pigtronix',             'https://www.pigtronix.com',                'US', TRUE),
  ('Catalinbread',        'catalinbread',        'catalinbread',          'https://catalinbread.com',                 'US', TRUE),
  ('Zvex Effects',        'zvex-effects',        'zvex-effects',          'https://www.zvex.com',                     'US', TRUE),
  ('Line 6',              'line-6',              'line-6',                'https://line6.com',                        'US', TRUE),
  ('Digitech',            'digitech',            'digitech-new-gear',     'https://www.digitech.com',                 'US', TRUE),
  ('Ibanez',              'ibanez',              NULL,                    'https://www.ibanez.com',                   'JP', FALSE),
  ('Zoom',                'zoom',                'zoom-north-america',    'https://www.zoom.co.jp',                   'JP', TRUE),
  ('Mooer',               'mooer',               'mooer-audio',           'https://www.mooeraudio.com',               'CN', TRUE),
  ('NUX',                 'nux',                 'nux-company',           'https://www.nuxefx.com',                   'CN', TRUE),
  ('Joyo',                'joyo',                'joyo-technology',       'https://www.joyoaudio.com',                'CN', TRUE),
  ('Hotone',              'hotone',              'hotone-music',          'https://www.hotoneaudio.com',              'CN', TRUE),
  ('Donner',              'donner',              'donner-music',          'https://www.donnerdeal.com',               'CN', TRUE),
  ('Caroline Guitar Co.', 'caroline-guitar-co',  'caroline-guitar-company','https://carolineguitarcompany.com',       'US', TRUE),
  ('Death By Audio',      'death-by-audio',      'death-by-audio',        'https://www.deathbyaudio.com',             'US', TRUE),
  ('Fairfield Circuitry', 'fairfield-circuitry', NULL,                    'https://fairfieldcircuitry.com',           'CA', FALSE),
  ('Old Blood Noise',     'old-blood-noise',     'old-blood-noise-endeavors','https://oldbloodnoise.com',             'US', TRUE),
  ('Hungry Robot',        'hungry-robot',        NULL,                    'https://hungryrobotpedals.com',            'US', FALSE),
  ('Hologram Electronics','hologram-electronics',NULL,                    'https://www.hologramelectronics.com',      'US', FALSE),
  ('Red Panda',           'red-panda',           'red-panda',             'https://redpandalab.com',                  'US', TRUE),
  ('Fender',              'fender',              'fender',                'https://www.fender.com',                   'US', TRUE),
  ('Roland',              'roland',              'roland-us',             'https://www.roland.com',                   'JP', TRUE),
  ('EBS',                 'ebs',                 NULL,                    'https://www.ebssweden.com',                'SE', FALSE),
  ('Darkglass Electronics','darkglass',          'darkglass-electronics', 'https://www.darkglass.com',               'FI', TRUE),
  ('Aguilar',             'aguilar',             NULL,                    'https://www.aguilaramp.com',               'US', FALSE),
  ('Origin Effects',      'origin-effects',      NULL,                    'https://origineffects.com',                'GB', FALSE),
  ('Analogman',           'analogman',           'analogman',             'https://www.analogman.com',                'US', TRUE),
  ('Klon',                'klon',                NULL,                    NULL,                                       'US', FALSE),
  ('Mad Professor',       'mad-professor',       NULL,                    'https://www.madprofessor.fi',              'FI', FALSE),
  ('Jam Pedals',          'jam-pedals',          NULL,                    'https://www.jampedals.com',                'GR', FALSE),
  ('Greer Amplification', 'greer',               NULL,                    'https://www.greeramps.com',                'US', FALSE),
  ('Caroline Guitar Company','caroline-guitar-company',NULL,              'https://carolineguitarcompany.com',        'US', FALSE)
ON CONFLICT (slug) DO NOTHING;
