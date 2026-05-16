-- ============================================================
-- TPC — The Pedal Collaborative
-- Full Database Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================


-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";


-- ============================================================
-- TABLES
-- ============================================================

-- ── 1. pedals ────────────────────────────────────────────────────────────────
-- The global pedal catalog. Managed by TPC admins, read by everyone.

create table if not exists public.pedals (
  id              uuid primary key default gen_random_uuid(),
  brand           text not null,
  model           text not null,
  category        text not null check (category in ('drive','boost','compressor','eq','delay','reverb','modulation','looper','pitch','utility','ambient','synth','other','multifx','modeler')),
  subcategory     text,
  description     text,
  controls        text[],           -- e.g. ['gain','tone','volume']
  power           text,             -- e.g. '9V DC center-negative'
  true_bypass     boolean,
  analog          boolean not null default false,
  price_tier      text check (price_tier in ('budget','mid','premium','boutique')),
  avg_price       numeric(8,2),
  in_production   boolean not null default true,
  image_url       text,
  created_at      timestamptz not null default now()
);

-- ── 2. pedal_colorways ───────────────────────────────────────────────────────
-- Each pedal can have multiple colorways/editions.

create table if not exists public.pedal_colorways (
  id              uuid primary key default gen_random_uuid(),
  pedal_id        uuid not null references public.pedals(id) on delete cascade,
  name            text not null,    -- e.g. 'Standard Black', 'Ram\'s Head Violet', '2022 Limited'
  color_hex       text,             -- dominant color for UI swatch, e.g. '#2D4A3E'
  image_url       text,
  is_default      boolean not null default false,
  year_released   int,
  notes           text,             -- 'Japan-only', 'Only 500 made', etc.
  created_at      timestamptz not null default now()
);

-- Ensure each pedal has at most one default colorway
create unique index if not exists pedal_colorways_one_default
  on public.pedal_colorways (pedal_id)
  where is_default = true;


-- ── 3. user_profiles ─────────────────────────────────────────────────────────
-- Extended profile data for authenticated users.

create table if not exists public.user_profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  username                text unique,
  display_name            text,
  avatar_url              text,
  is_premium              boolean not null default false,
  is_admin                boolean not null default false,
  pedal_finder_uses_today int not null default 0,
  finder_reset_date       date not null default current_date,
  created_at              timestamptz not null default now()
);


-- ── 4. user_pedals ───────────────────────────────────────────────────────────
-- A user's personal pedal entries: owned, wishlist, or retired.

create table if not exists public.user_pedals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  pedal_id        uuid not null references public.pedals(id) on delete cascade,
  colorway_id     uuid references public.pedal_colorways(id) on delete set null,
  status          text not null default 'owned'
                    check (status in ('owned','wishlist','retired')),
  purchase_price  numeric(8,2),
  condition       text check (condition in ('mint','excellent','good','fair','poor')),
  notes           text,
  acquired_method text check (acquired_method in ('purchase','trade')),
  acquired_from   text,             -- store name or seller
  acquired_trade_for text,          -- what they traded
  acquired_trade_with text,         -- who they traded with
  target_price    numeric(8,2),     -- wishlist target / price paid
  acquired_date   date,
  retired_date    date,             -- when they moved on from it
  retired_method  text check (retired_method in ('sale','trade')),
  retired_price   numeric(8,2),
  retired_trade_for text,
  retired_to      text,             -- sold to or traded with
  retired_notes   text,
  on_current_board boolean not null default false,
  user_image_path text,
  category_override text,
  created_at      timestamptz not null default now()
);

-- Index for fast user lookups by status
create index if not exists user_pedals_user_status on public.user_pedals (user_id, status);


-- ── 5. boards ────────────────────────────────────────────────────────────────
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  color       text not null default 'teal',
  created_at  timestamptz not null default now()
);

-- Backfill for existing installs
alter table public.boards
  add column if not exists color text default 'teal';


-- ── 6. board_slots ───────────────────────────────────────────────────────────
-- Signal chain positions on a board.

create table if not exists public.board_slots (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.boards(id) on delete cascade,
  pedal_id      uuid not null references public.pedals(id) on delete cascade,
  user_pedal_id uuid references public.user_pedals(id) on delete set null,
  position      int not null,
  created_at    timestamptz not null default now(),
  unique (board_id, position)
);


-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN UP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.pedals           enable row level security;
alter table public.pedal_colorways  enable row level security;
alter table public.user_profiles    enable row level security;
alter table public.user_pedals      enable row level security;
alter table public.boards           enable row level security;
alter table public.board_slots      enable row level security;


-- ── pedals: anyone can read, only service role can write ─────────────────────
create policy "pedals_select" on public.pedals
  for select using (true);

create policy "pedals_insert" on public.pedals
  for insert with check (auth.role() = 'service_role');

create policy "pedals_update_admin" on public.pedals
  for update using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid() and up.is_admin = true
    )
  );

create policy "pedals_update" on public.pedals
  for update using (auth.role() = 'service_role');

create policy "pedals_delete" on public.pedals
  for delete using (auth.role() = 'service_role');


-- ── pedal_colorways: anyone can read, only service role can write ─────────────
create policy "colorways_select" on public.pedal_colorways
  for select using (true);

create policy "colorways_insert" on public.pedal_colorways
  for insert with check (auth.role() = 'service_role');

create policy "colorways_update" on public.pedal_colorways
  for update using (auth.role() = 'service_role');

create policy "colorways_delete" on public.pedal_colorways
  for delete using (auth.role() = 'service_role');


-- ── user_profiles: users manage their own profile ────────────────────────────
create policy "profiles_select" on public.user_profiles
  for select using (auth.uid() = id);

create policy "profiles_insert" on public.user_profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update" on public.user_profiles
  for update using (auth.uid() = id);


-- ── user_pedals: users manage their own entries ───────────────────────────────
create policy "user_pedals_select" on public.user_pedals
  for select using (auth.uid() = user_id);

create policy "user_pedals_insert" on public.user_pedals
  for insert with check (auth.uid() = user_id);

create policy "user_pedals_update" on public.user_pedals
  for update using (auth.uid() = user_id);

create policy "user_pedals_delete" on public.user_pedals
  for delete using (auth.uid() = user_id);


-- ── boards: users manage their own boards ─────────────────────────────────────
create policy "boards_select" on public.boards
  for select using (auth.uid() = user_id);

create policy "boards_insert" on public.boards
  for insert with check (auth.uid() = user_id);

create policy "boards_update" on public.boards
  for update using (auth.uid() = user_id);

create policy "boards_delete" on public.boards
  for delete using (auth.uid() = user_id);


-- ── board_slots: access via board ownership ────────────────────────────────────
create policy "board_slots_select" on public.board_slots
  for select using (
    exists (select 1 from public.boards where id = board_id and user_id = auth.uid())
  );

create policy "board_slots_insert" on public.board_slots
  for insert with check (
    exists (select 1 from public.boards where id = board_id and user_id = auth.uid())
  );

create policy "board_slots_update" on public.board_slots
  for update using (
    exists (select 1 from public.boards where id = board_id and user_id = auth.uid())
  );

create policy "board_slots_delete" on public.board_slots
  for delete using (
    exists (select 1 from public.boards where id = board_id and user_id = auth.uid())
  );


-- ============================================================
-- SEED DATA — PEDAL CATALOG
-- ============================================================

insert into public.pedals (brand, model, category, subcategory, description, analog, avg_price, price_tier, in_production) values

-- DRIVE
('Boss',              'DS-1 Distortion',        'drive',      'Distortion', 'Iconic, aggressive distortion. Found on countless records.',                                           true,   45,  'budget',   true),
('Ibanez',            'TS9 Tube Screamer',       'drive',      'Overdrive',  'Mid-boosting overdrive that defined blues and rock tone.',                                              true,   99,  'mid',      true),
('Pro Co',            'RAT2',                    'drive',      'Distortion', 'Filter-rich distortion from clean boost to crushing fuzz.',                                             true,   79,  'budget',   true),
('Electro-Harmonix',  'Big Muff Pi',             'drive',      'Fuzz',       'Sustain-drenched fuzz made famous by Gilmour and Corgan.',                                              true,   89,  'mid',      true),
('Boss',              'SD-1 Super Overdrive',    'drive',      'Overdrive',  'Asymmetrical clipping overdrive that stacks beautifully.',                                              true,   49,  'budget',   true),
('Klon',              'KTR',                     'drive',      'Overdrive',  'Transparent overdrive that preserves your clean tone while adding harmonic richness.',                 true,  269,  'premium',  true),
('JHS',               'Morning Glory',           'drive',      'Overdrive',  'Marshall-in-a-box style overdrive. Incredibly touch sensitive.',                                       true,  199,  'premium',  true),
('Walrus Audio',      'Eras',                    'drive',      'Distortion', 'Five-state distortion with massive range from edge-of-breakup to wall of sound.',                      true,  199,  'premium',  true),
('Earthquaker Devices','Plumes',                 'drive',      'Overdrive',  'A re-imagining of the classic TS circuit with more versatility and output.',                           true,   99,  'mid',      true),
('Fulltone',          'OCD',                     'drive',      'Overdrive',  'Obsessive Compulsive Drive — warm, musical overdrive with hi/lo peak modes.',                          true,  149,  'mid',      false),
('Electro-Harmonix',  'Nano Big Muff',           'drive',      'Fuzz',       'Classic Big Muff in a pedalboard-friendly size.',                                                       true,   69,  'budget',   true),
('Way Huge',          'Swollen Pickle',          'drive',      'Fuzz',       'Massive, scooped fuzz with internal trimmers for deep tweaking.',                                       true,  119,  'mid',      true),
('Keeley',            'Oxblood Overdrive',       'drive',      'Overdrive',  'Super-transparent overdrive voiced after British amp breakup.',                                         true,  199,  'premium',  true),
('Origin Effects',    'Cali76 Compact Deluxe',   'utility',    'Compressor', 'Studio-grade FET compressor in a pedal. Transparent and musical.',                                     true,  349,  'boutique', true),
('Wampler',           'Tumnus Deluxe',           'drive',      'Overdrive',  'Klon-style overdrive with a full EQ section. Excellent.',                                               true,  199,  'premium',  true),
('Mythos Pedals',     'Mjolnir',                 'drive',      'Overdrive',  'Two-channel overdrive with independent gain and EQ. Built like a tank.',                               true,  279,  'boutique', true),
('JAM Pedals',        'Rattler',                 'drive',      'Distortion', 'Hand-wired RAT-style distortion with enhanced tonal range.',                                            true,  229,  'boutique', true),
('Lovepedal',         'Amp Eleven',              'drive',      'Overdrive',  'Clean boost to medium gain; whisper quiet and harmonically rich.',                                      true,  179,  'premium',  true),

-- DELAY
('Strymon',           'Timeline',                'delay',      'Digital',    'World-class multi-engine delay. The gold standard for studio-grade delay.',                            false,  449,  'boutique', true),
('Boss',              'DD-3T Digital Delay',     'delay',      'Digital',    'Simple, reliable digital delay with tap tempo. Industry workhorse.',                                  false,   99,  'mid',      true),
('Electro-Harmonix',  'Memory Man',              'delay',      'Analog',     'Warm organic analog delay with chorus/vibrato. A true classic.',                                        true,  179,  'premium',  true),
('Meris',             'LVX',                     'delay',      'Digital',    'Modular delay system with MIDI and deep tone shaping. For the obsessive.',                             false,  649,  'boutique', true),
('Chase Bliss',       'Thermae',                 'delay',      'Analog',     'Analog delay and pitch-shifting harmonizer with CV control.',                                           true,  499,  'boutique', true),
('MXR',               'Carbon Copy',             'delay',      'Analog',     'Warm, simple analog delay. Great for slapback and vintage sounds.',                                     true,  129,  'mid',      true),
('Earthquaker Devices','Avalanche Run',           'delay',      'Digital',    'Stereo delay and reverb with reverse mode. Huge soundscape maker.',                                   false,  249,  'premium',  true),
('TC Electronic',     'Flashback 2',             'delay',      'Digital',    'Versatile digital delay with TonePrint editor and tap tempo.',                                         false,  149,  'mid',      true),
('Boss',              'DM-2W Waza Craft',        'delay',      'Analog',     'Premium recreation of the classic DM-2 analog delay circuit.',                                          true,  199,  'premium',  true),
('Walrus Audio',      'ARP-87',                  'delay',      'Digital',    'Four-mode delay: lo-fi, digital, analog, and reverse. Compact and musical.',                          false,  199,  'premium',  true),
('Strymon',           'El Capistan',             'delay',      'Tape',       'Tape echo simulator with stunning flutter, wow, and three tape types.',                               false,  349,  'boutique', true),
('Caroline Guitar',   'Somersault',              'delay',      'Analog',     'Lo-fi analog delay with modulation. Quirky and characterful.',                                          true,  199,  'premium',  true),

-- REVERB
('Strymon',           'BigSky',                  'reverb',     'Multi',      'Definitive studio-grade reverb with 12 machines. The benchmark.',                                     false,  479,  'boutique', true),
('Electro-Harmonix',  'Holy Grail',              'reverb',     'Spring',     'Simple spring, hall, and flerb reverb. Beautiful and approachable.',                                  false,   99,  'mid',      true),
('Walrus Audio',      'Slo',                     'reverb',     'Ambient',    'Multi-voice ambient reverb. Shimmer, cloud, and rise modes for huge atmospheres.',                    false,  249,  'premium',  true),
('Earthquaker Devices','Afterneath',             'reverb',     'Ambient',    'Otherworldly reverb using a swarm of short delays. Deeply unique.',                                   false,  249,  'premium',  true),
('Neunaber',          'Immerse Mk II',           'reverb',     'Multi',      'Eight pristine reverb algorithms. Shimmer and wet modes are stunning.',                               false,  199,  'premium',  true),
('Chase Bliss',       'Dark World',              'reverb',     'Dual',       'Dual-engine reverb with a dark/world channel blend. Cinematic.',                                       false,  349,  'boutique', true),
('Boss',              'RV-6',                    'reverb',     'Multi',      'Eight reverb modes including shimmer and dynamic. Workhorse reverb.',                                 false,  149,  'mid',      true),
('Meris',             'Mercury7',                'reverb',     'Ambient',    'Cinematic algorithmic reverb inspired by '70s rack units. Gorgeous.',                                 false,  349,  'boutique', true),
('Empress Effects',   'Reverb',                  'reverb',     'Multi',      'Studio-quality reverb with 35 algorithms and tap tempo.',                                              false,  349,  'boutique', true),
('Strymon',           'Flint',                   'reverb',     'Vintage',    'Vintage tremolo and reverb tones from classic amp circuits.',                                          false,  299,  'boutique', true),

-- MODULATION
('Walrus Audio',      'Julia',                   'modulation', 'Chorus',     'Warm analog chorus and vibrato with a brilliant blend knob.',                                           true,  199,  'premium',  true),
('MXR',               'Phase 90',                'modulation', 'Phaser',     'The classic phaser. Eddie Van Halen''s right hand. Lush sweeping modulation.',                         true,   79,  'mid',      true),
('Boss',              'CE-2W Waza Craft Chorus',  'modulation', 'Chorus',     'Premium recreation of the CE-1 and CE-2 chorus circuits.',                                             true,  179,  'premium',  true),
('Strymon',           'Mobius',                  'modulation', 'Multi',      '12 modulation machines covering every effect type. Studio quality.',                                  false,  449,  'boutique', true),
('Earthquaker Devices','Pyramids',               'modulation', 'Flanger',    'Stereo flanger with 8 modes. From jet-like sweeps to subtle doubling.',                                true,  249,  'premium',  true),
('TC Electronic',     'Viscous Vibe',            'modulation', 'Vibrato',    'Univibe-style chorus/vibrato. Classic psychedelic movement.',                                          false,   99,  'mid',      true),
('Walrus Audio',      'Monument V2',             'modulation', 'Tremolo',    'Five-mode harmonic tremolo. Smooth, organic, and deeply musical.',                                     true,  249,  'premium',  true),
('Chase Bliss',       'Warped Vinyl HiFi',       'modulation', 'Chorus',     'Vinyl-warping chorus and vibrato with expression and MIDI. Butter smooth.',                            true,  399,  'boutique', true),
('Fulltone',          'Mini Deja Vibe 2',        'modulation', 'Vibrato',    'Classic Uni-Vibe simulation. Jimi Hendrix approved.',                                                   true,  179,  'premium',  false),
('Boss',              'PH-3 Phase Shifter',      'modulation', 'Phaser',     'Digital phaser with multiple stage settings and fall/rise modes.',                                    false,   99,  'mid',      true),

-- LOOPER
('Chase Bliss',       'Blooper',                 'looper',     'Creative',   'Wildly creative looper that bends and warps loops in real time.',                                      false,  499,  'boutique', true),
('Boss',              'RC-5 Loop Station',       'looper',     'Phrase',     'Compact and powerful with 99 memory slots and rhythm tracks.',                                         false,  149,  'mid',      true),
('Electro-Harmonix',  '720 Stereo Looper',       'looper',     'Phrase',     '12 minutes of stereo looping with 10 loop slots.',                                                     false,  149,  'mid',      true),
('TC Electronic',     'Ditto X4',                'looper',     'Multi-track','Stereo looper with loop effects and MIDI sync.',                                                        false,  249,  'premium',  true),
('Boss',              'RC-500',                  'looper',     'Multi-track','Two independent tracks, 13 hours of storage, and rhythm guide.',                                       false,  249,  'premium',  true),

-- UTILITY
('TC Electronic',     'PolyTune 3',              'utility',    'Tuner',      'The most popular stage tuner. Polyphonic mode is a game changer.',                                    false,   79,  'mid',      true),
('Electro-Harmonix',  'Nano LPB-1',              'utility',    'Boost',      'Clean linear power boost. Pushes amps and pedals beautifully.',                                         true,   45,  'budget',   true),
('Keeley',            'Compressor Plus',         'utility',    'Compressor', 'Studio-grade optical compression with blend control.',                                                  true,  149,  'mid',      true),
('MXR',               'Dyna Comp',               'utility',    'Compressor', 'Classic Ross-style compressor. The country chicken pickin'' standard.',                                  true,   79,  'mid',      true),
('Boss',              'NS-2 Noise Suppressor',   'utility',    'Noise Gate', 'Eliminates hum and noise without affecting tone.',                                                     false,   99,  'mid',      true),
('Strymon',           'Zuma',                    'utility',    'Power',      'High-current isolated power supply. Nine outputs, whisper quiet.',                                     false,  299,  'boutique', true),
('Voodoo Lab',        'Pedal Power 3',           'utility',    'Power',      'Isolated power supply with variable voltage. Industry standard.',                                      false,  249,  'premium',  true),
('Xotic',             'SP Compressor',           'utility',    'Compressor', 'Tiny, transparent compressor. A secret weapon for clean players.',                                      true,  149,  'mid',      true),

-- PITCH
('Boss',              'OC-5 Octave',             'pitch',      'Octave',     'Polyphonic octave that tracks instantly across the full fretboard.',                                   false,  129,  'mid',      true),
('Electro-Harmonix',  'POG2',                    'pitch',      'Octave',     'Polyphonic octave generator with 8 sliders. Sub to two octaves up.',                                  false,  249,  'premium',  true),
('Digitech',          'Whammy 5',                'pitch',      'Pitch Shifter','The legendary expression-controlled pitch shifter.',                                                 false,  199,  'premium',  true),
('TC Electronic',     'Brainwaves',              'pitch',      'Pitch Shifter','Dual-voice pitch shifter with TonePrint. Smooth and musical.',                                       false,  149,  'mid',      true),
('Electro-Harmonix',  'Pitch Fork',              'pitch',      'Pitch Shifter','Polyphonic pitch shifter. +/-3 octaves with expression control.',                                     false,   99,  'mid',      true),
('Boss',              'PS-6 Harmonist',          'pitch',      'Harmonizer', 'Smart harmonizer with pitch shift, detune, and super bend modes.',                                    false,  149,  'mid',      true),

-- AMBIENT / EXPERIMENTAL
('Hologram Electronics','Microcosm',             'ambient',    'Granular',   'Granular looper and glitch machine unlike anything else.',                                              false,  499,  'boutique', true),
('Meris',             'Enzo',                    'ambient',    'Synth',      'Multi-voice poly synth and pitch shifter. Turns guitar into a synth engine.',                         false,  299,  'boutique', true),
('Earthquaker Devices','Afterneath Enhanced',    'ambient',    'Reverb',     'Enhanced version of the cult classic with expression and flexi-switch.',                               false,  299,  'premium',  true),
('Red Panda',         'Particle 2',              'ambient',    'Granular',   'Granular delay and pitch shifter. Glitchy, gorgeous, unpredictable.',                                  false,  249,  'premium',  true),
('Empress Effects',   'Zoia',                    'ambient',    'Multi',      'Modular effects ecosystem in a pedal. Build literally any effect you can imagine.',                   false,  499,  'boutique', true),
('Chase Bliss',       'Generation Loss',         'ambient',    'Lo-fi',      'VHS and tape degradation simulator. Nostalgic, lo-fi atmosphere machine.',                             false,  349,  'boutique', true),
('Walrus Audio',      'Lore',                    'ambient',    'Reverb',     'Reverse reverb with five programs. Cinematic and expansive.',                                          false,  249,  'premium',  true),
('Meris',             'Polymoon',                'ambient',    'Delay',      'Hyper-modulated delay and reverb. Other-worldly, dense, and beautiful.',                              false,  299,  'boutique', true)

on conflict do nothing;


-- ============================================================
-- SEED DATA — COLORWAYS
-- ============================================================
-- Note: We use a subquery to look up the pedal_id by brand + model.
-- Add more as the catalog grows.

insert into public.pedal_colorways (pedal_id, name, color_hex, is_default, year_released, notes)

select id, 'Standard Black', '#1A1A1A', true, 1978, null from public.pedals where brand = 'Boss' and model = 'DS-1 Distortion'
union all
select id, 'Limited Blue', '#1C3F6E', false, 2001, 'Japan-market limited edition' from public.pedals where brand = 'Boss' and model = 'DS-1 Distortion'
union all
select id, 'Metal Zone Collaboration', '#8B1A1A', false, 2019, 'Special limited run' from public.pedals where brand = 'Boss' and model = 'DS-1 Distortion'

union all
select id, 'Standard Green', '#2A5C2A', true, 1982, null from public.pedals where brand = 'Ibanez' and model = 'TS9 Tube Screamer'
union all
select id, 'Silver Limited', '#A0A0A0', false, 2002, 'Silver anniversary edition' from public.pedals where brand = 'Ibanez' and model = 'TS9 Tube Screamer'

union all
select id, 'Standard White', '#F0EDE8', true, 1978, null from public.pedals where brand = 'Pro Co' and model = 'RAT2'
union all
select id, 'Vintage Black', '#2A2A2A', false, 1986, 'LM308 chip era' from public.pedals where brand = 'Pro Co' and model = 'RAT2'

union all
select id, 'NYC Gray/Black', '#4A4A4A', true, 1969, 'Original NYC circuit' from public.pedals where brand = 'Electro-Harmonix' and model = 'Big Muff Pi'
union all
select id, 'Ram''s Head Violet', '#6A3D9A', false, 1973, 'Iconic violet version — most sought after. V2/V3.' from public.pedals where brand = 'Electro-Harmonix' and model = 'Big Muff Pi'
union all
select id, 'Green Russian', '#2D5A27', false, 1990, 'Russian-made Sovtek version. Dark and heavy.' from public.pedals where brand = 'Electro-Harmonix' and model = 'Big Muff Pi'
union all
select id, 'Triangle', '#C0392B', false, 1970, 'First production version. Smoothest sounding.' from public.pedals where brand = 'Electro-Harmonix' and model = 'Big Muff Pi'
union all
select id, 'Op-Amp', '#F39C12', false, 1978, 'IC-based version. Scooped and aggressive.' from public.pedals where brand = 'Electro-Harmonix' and model = 'Big Muff Pi'

union all
select id, 'Standard Yellow', '#D4AC0D', true, 1981, null from public.pedals where brand = 'Boss' and model = 'SD-1 Super Overdrive'

union all
select id, 'Gold/Black', '#B8860B', true, 2014, 'Current production KTR' from public.pedals where brand = 'Klon' and model = 'KTR'
union all
select id, 'Silver', '#A8A9AD', false, 2014, 'Silver panel variant' from public.pedals where brand = 'Klon' and model = 'KTR'

union all
select id, 'Light Green', '#8FBC8F', true, null, null from public.pedals where brand = 'JHS' and model = 'Morning Glory'
union all
select id, 'V4 Seafoam', '#5F9E96', false, 2020, 'V4 revision with added clipping switch' from public.pedals where brand = 'JHS' and model = 'Morning Glory'

union all
select id, 'Black', '#1A1A1A', true, 2020, null from public.pedals where brand = 'Earthquaker Devices' and model = 'Plumes'
union all
select id, 'Limited Olive', '#6B6B3A', false, 2021, 'Limited run colorway' from public.pedals where brand = 'Earthquaker Devices' and model = 'Plumes'

union all
select id, 'Blue', '#1B4F8A', true, null, null from public.pedals where brand = 'Strymon' and model = 'Timeline'
union all
select id, 'Blue', '#1B4F8A', true, null, null from public.pedals where brand = 'Strymon' and model = 'BigSky'
union all
select id, 'Blue', '#1B4F8A', true, null, null from public.pedals where brand = 'Strymon' and model = 'Mobius'
union all
select id, 'Blue', '#1B4F8A', true, null, null from public.pedals where brand = 'Strymon' and model = 'El Capistan'
union all
select id, 'Blue', '#1B4F8A', true, null, null from public.pedals where brand = 'Strymon' and model = 'Flint'

union all
select id, 'Standard Orange', '#D35400', true, null, null from public.pedals where brand = 'MXR' and model = 'Phase 90'
union all
select id, 'Script Logo', '#C0392B', false, 1974, 'Vintage script logo version. Highly sought after.' from public.pedals where brand = 'MXR' and model = 'Phase 90'
union all
select id, 'EVH Signature', '#000000', false, 2004, 'Eddie Van Halen signature — black with stripes' from public.pedals where brand = 'MXR' and model = 'Phase 90'

union all
select id, 'Standard Orange', '#E67E22', true, null, null from public.pedals where brand = 'MXR' and model = 'Carbon Copy'
union all
select id, 'Deluxe', '#2C3E50', false, 2015, 'Carbon Copy Deluxe with tap tempo and chorus' from public.pedals where brand = 'MXR' and model = 'Carbon Copy'

union all
select id, 'Teal/Cream', '#1ABC9C', true, null, null from public.pedals where brand = 'Walrus Audio' and model = 'Julia'
union all
select id, 'Teal/Cream', '#1ABC9C', true, null, null from public.pedals where brand = 'Walrus Audio' and model = 'Slo'
union all
select id, 'Teal/Cream', '#1ABC9C', true, null, null from public.pedals where brand = 'Walrus Audio' and model = 'Eras'
union all
select id, 'Teal/Cream', '#1ABC9C', true, null, null from public.pedals where brand = 'Walrus Audio' and model = 'ARP-87'
union all
select id, 'Teal/Cream', '#1ABC9C', true, null, null from public.pedals where brand = 'Walrus Audio' and model = 'Monument V2'

union all
select id, 'Purple/Black', '#6C3483', true, null, null from public.pedals where brand = 'Chase Bliss' and model = 'Blooper'
union all
select id, 'Purple/Black', '#6C3483', true, null, null from public.pedals where brand = 'Chase Bliss' and model = 'Thermae'
union all
select id, 'Purple/Black', '#6C3483', true, null, null from public.pedals where brand = 'Chase Bliss' and model = 'Dark World'
union all
select id, 'Purple/Black', '#6C3483', true, null, null from public.pedals where brand = 'Chase Bliss' and model = 'Generation Loss'
union all
select id, 'Purple/Black', '#6C3483', true, null, null from public.pedals where brand = 'Chase Bliss' and model = 'Warped Vinyl HiFi'

union all
select id, 'Black', '#1A1A1A', true, null, null from public.pedals where brand = 'Hologram Electronics' and model = 'Microcosm'
union all
select id, 'Black', '#1A1A1A', true, null, null from public.pedals where brand = 'Meris' and model = 'LVX'
union all
select id, 'Black', '#1A1A1A', true, null, null from public.pedals where brand = 'Meris' and model = 'Enzo'
union all
select id, 'Black', '#1A1A1A', true, null, null from public.pedals where brand = 'Meris' and model = 'Mercury7'
union all
select id, 'Black', '#1A1A1A', true, null, null from public.pedals where brand = 'Meris' and model = 'Polymoon'

on conflict do nothing;

-- ─── Price drop alerts & push tokens ──────────────────────────────────────────
-- Run these in the Supabase SQL editor

-- 1. Target price on wishlist items (user sets their max/desired price)
ALTER TABLE user_pedals
  ADD COLUMN IF NOT EXISTS target_price NUMERIC,
  ADD COLUMN IF NOT EXISTS price_alert_sent_at TIMESTAMPTZ;

-- 2. Expo push token on user profiles (for server-side push notifications)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 3. Index for the price-alerts Edge Function query (perf)
CREATE INDEX IF NOT EXISTS idx_user_pedals_wishlist_target
  ON user_pedals (user_id, target_price)
  WHERE status = 'wishlist' AND target_price IS NOT NULL;

-- ─── Deploy price-alerts Edge Function ────────────────────────────────────────
-- After running the ALTER TABLE statements above, deploy the function:
--
--   cd /path/to/TPC-App1
--   supabase functions deploy price-alerts --no-verify-jwt
--
-- Then set up the cron schedule in Supabase Dashboard:
--   Edge Functions → price-alerts → Schedules → Add Schedule
--   Cron: 0 */6 * * *   (every 6 hours)
--
-- Or enable pg_net + pg_cron in Supabase and run:
--   select cron.schedule(
--     'price-alerts-job',
--     '0 */6 * * *',
--     $$ select net.http_post(
--          url := 'https://<project-ref>.supabase.co/functions/v1/price-alerts',
--          headers := '{"Authorization":"Bearer <service-role-key>","Content-Type":"application/json"}'::jsonb,
--          body := '{}'::jsonb
--        ); $$
--   );
