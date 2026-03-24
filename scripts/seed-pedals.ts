/**
 * TPC Pedal Seed Script
 * ─────────────────────
 * Inserts every pedal from pedalSeed.ts into the Supabase `pedals` table.
 * Safe to re-run — uses upsert, so existing rows are skipped (no duplicates).
 *
 * Usage:
 *   1. Grab your service role key from:
 *      Supabase Dashboard → Settings → API → service_role (secret)
 *
 *   2. Run:
 *      SUPABASE_SERVICE_ROLE_KEY=your_key_here npx tsx scripts/seed-pedals.ts
 *
 *   Optional: also fetch images from Reverb for each pedal:
 *      SUPABASE_SERVICE_ROLE_KEY=your_key FETCH_IMAGES=true npx tsx scripts/seed-pedals.ts
 */

import { createClient } from '@supabase/supabase-js';

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://skejiotfywhmnvsivfsk.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FETCH_IMAGES = process.env.FETCH_IMAGES === 'true';

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌  Missing SUPABASE_SERVICE_ROLE_KEY\n');
  console.error('Run with: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/seed-pedals.ts\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Catalog ─────────────────────────────────────────────────────────────────
// Inline copy so this script is self-contained (no React Native module issues)

const PEDAL_CATALOG = [
  // DRIVE
  { brand: 'Boss', model: 'DS-1 Distortion', category: 'drive', subcategory: 'Distortion', price: 45, analog: true, description: 'Iconic, aggressive distortion. Found on countless records.' },
  { brand: 'Ibanez', model: 'TS9 Tube Screamer', category: 'drive', subcategory: 'Overdrive', price: 99, analog: true, description: 'Mid-boosting overdrive that defined blues and rock tone.' },
  { brand: 'Pro Co', model: 'RAT2', category: 'drive', subcategory: 'Distortion', price: 79, analog: true, description: 'Filter-rich distortion from clean boost to crushing fuzz.' },
  { brand: 'Electro-Harmonix', model: 'Big Muff Pi', category: 'drive', subcategory: 'Fuzz', price: 89, analog: true, description: 'Sustain-drenched fuzz made famous by Gilmour and Corgan.' },
  { brand: 'Boss', model: 'SD-1 Super Overdrive', category: 'drive', subcategory: 'Overdrive', price: 49, analog: true, description: 'Asymmetrical clipping overdrive that stacks beautifully.' },
  { brand: 'Klon', model: 'KTR', category: 'drive', subcategory: 'Overdrive', price: 269, analog: true, description: 'Transparent overdrive that preserves your clean tone while adding harmonic richness.' },
  { brand: 'JHS', model: 'Morning Glory', category: 'drive', subcategory: 'Overdrive', price: 199, analog: true, description: 'Marshall-in-a-box style overdrive. Incredibly touch sensitive.' },
  { brand: 'Walrus Audio', model: 'Eras', category: 'drive', subcategory: 'Distortion', price: 199, analog: true, description: 'Five-state distortion with massive range from edge-of-breakup to wall of sound.' },
  { brand: 'Earthquaker Devices', model: 'Plumes', category: 'drive', subcategory: 'Overdrive', price: 99, analog: true, description: 'A re-imagining of the classic TS circuit with more versatility and output.' },
  { brand: 'Fulltone', model: 'OCD', category: 'drive', subcategory: 'Overdrive', price: 149, analog: true, description: 'Obsessive Compulsive Drive — warm, musical overdrive with hi/lo peak modes.' },
  { brand: 'Electro-Harmonix', model: 'Nano Big Muff', category: 'drive', subcategory: 'Fuzz', price: 69, analog: true, description: 'Classic Big Muff in a pedalboard-friendly size.' },
  { brand: 'Way Huge', model: 'Swollen Pickle', category: 'drive', subcategory: 'Fuzz', price: 119, analog: true, description: 'Massive, scooped fuzz with internal trimmers for deep tweaking.' },

  // DELAY
  { brand: 'Strymon', model: 'Timeline', category: 'delay', subcategory: 'Digital', price: 449, analog: false, description: 'World-class multi-engine delay. The gold standard for studio-grade delay.' },
  { brand: 'Boss', model: 'DD-3T Digital Delay', category: 'delay', subcategory: 'Digital', price: 99, analog: false, description: 'Simple, reliable digital delay with tap tempo. Industry workhorse.' },
  { brand: 'Electro-Harmonix', model: 'Memory Man', category: 'delay', subcategory: 'Analog', price: 179, analog: true, description: 'Warm organic analog delay with chorus/vibrato. A true classic.' },
  { brand: 'Meris', model: 'LVX', category: 'delay', subcategory: 'Digital', price: 649, analog: false, description: 'Modular delay system with MIDI and deep tone shaping. For the obsessive.' },
  { brand: 'Chase Bliss', model: 'Thermae', category: 'delay', subcategory: 'Analog', price: 499, analog: true, description: 'Analog delay and pitch-shifting harmonizer with CV control.' },
  { brand: 'MXR', model: 'Carbon Copy', category: 'delay', subcategory: 'Analog', price: 129, analog: true, description: 'Warm, simple analog delay. Great for slapback and vintage sounds.' },
  { brand: 'Earthquaker Devices', model: 'Avalanche Run', category: 'delay', subcategory: 'Digital', price: 249, analog: false, description: 'Stereo delay and reverb with reverse mode. Huge soundscape maker.' },
  { brand: 'TC Electronic', model: 'Flashback 2', category: 'delay', subcategory: 'Digital', price: 149, analog: false, description: 'Versatile digital delay with TonePrint editor and tap tempo.' },

  // REVERB
  { brand: 'Strymon', model: 'BigSky', category: 'reverb', subcategory: 'Multi', price: 479, analog: false, description: 'Definitive studio-grade reverb with 12 machines. The benchmark.' },
  { brand: 'Electro-Harmonix', model: 'Holy Grail', category: 'reverb', subcategory: 'Spring', price: 99, analog: false, description: 'Simple spring, hall, and flerb reverb. Beautiful and approachable.' },
  { brand: 'Walrus Audio', model: 'Slo', category: 'reverb', subcategory: 'Ambient', price: 249, analog: false, description: 'Multi-voice ambient reverb. Shimmer, cloud, and rise modes for huge atmospheres.' },
  { brand: 'Earthquaker Devices', model: 'Afterneath', category: 'reverb', subcategory: 'Ambient', price: 249, analog: false, description: 'Otherworldly reverb using a swarm of short delays. Deeply unique.' },
  { brand: 'Neunaber', model: 'Immerse Mk II', category: 'reverb', subcategory: 'Multi', price: 199, analog: false, description: 'Eight pristine reverb algorithms. Shimmer and wet modes are stunning.' },
  { brand: 'Chase Bliss', model: 'Dark World', category: 'reverb', subcategory: 'Dual', price: 349, analog: false, description: 'Dual-engine reverb with a dark/world channel blend. Cinematic.' },

  // MODULATION
  { brand: 'Walrus Audio', model: 'Julia', category: 'modulation', subcategory: 'Chorus', price: 199, analog: true, description: 'Warm analog chorus and vibrato with a brilliant blend knob.' },
  { brand: 'MXR', model: 'Phase 90', category: 'modulation', subcategory: 'Phaser', price: 79, analog: true, description: "The classic phaser. Eddie Van Halen's right hand. Lush sweeping modulation." },
  { brand: 'Boss', model: 'CE-2W Waza Craft Chorus', category: 'modulation', subcategory: 'Chorus', price: 179, analog: true, description: 'Premium recreation of the CE-1 and CE-2 chorus circuits.' },
  { brand: 'Strymon', model: 'Mobius', category: 'modulation', subcategory: 'Multi', price: 449, analog: false, description: '12 modulation machines covering every effect type. Studio quality.' },
  { brand: 'Earthquaker Devices', model: 'Pyramids', category: 'modulation', subcategory: 'Flanger', price: 249, analog: true, description: 'Stereo flanger with 8 modes. From jet-like sweeps to subtle doubling.' },
  { brand: 'TC Electronic', model: 'Viscous Vibe', category: 'modulation', subcategory: 'Vibrato', price: 99, analog: false, description: 'Univibe-style chorus/vibrato. Classic psychedelic movement.' },

  // LOOPER
  { brand: 'Chase Bliss', model: 'Blooper', category: 'looper', subcategory: 'Creative', price: 499, analog: false, description: 'Wildly creative looper that bends and warps loops in real time.' },
  { brand: 'Boss', model: 'RC-5 Loop Station', category: 'looper', subcategory: 'Phrase', price: 149, analog: false, description: 'Compact and powerful with 99 memory slots and rhythm tracks.' },
  { brand: 'Electro-Harmonix', model: '720 Stereo Looper', category: 'looper', subcategory: 'Phrase', price: 149, analog: false, description: '12 minutes of stereo looping with 10 loop slots.' },
  { brand: 'TC Electronic', model: 'Ditto X4', category: 'looper', subcategory: 'Multi-track', price: 249, analog: false, description: 'Stereo looper with loop effects and MIDI sync.' },

  // UTILITY
  { brand: 'TC Electronic', model: 'PolyTune 3', category: 'utility', subcategory: 'Tuner', price: 79, analog: false, description: 'The most popular stage tuner. Polyphonic mode is a game changer.' },
  { brand: 'Electro-Harmonix', model: 'Nano LPB-1', category: 'utility', subcategory: 'Boost', price: 45, analog: true, description: 'Clean linear power boost. Pushes amps and pedals beautifully.' },
  { brand: 'Keeley', model: 'Compressor Plus', category: 'utility', subcategory: 'Compressor', price: 149, analog: true, description: 'Studio-grade optical compression with blend control.' },
  { brand: 'MXR', model: 'Dyna Comp', category: 'utility', subcategory: 'Compressor', price: 79, analog: true, description: "Classic Ross-style compressor. The country chicken pickin' standard." },
  { brand: 'Boss', model: 'NS-2 Noise Suppressor', category: 'utility', subcategory: 'Noise Gate', price: 99, analog: false, description: 'Eliminates hum and noise without affecting tone.' },

  // PITCH
  { brand: 'Boss', model: 'OC-5 Octave', category: 'pitch', subcategory: 'Octave', price: 129, analog: false, description: 'Polyphonic octave that tracks instantly across the full fretboard.' },
  { brand: 'Electro-Harmonix', model: 'POG2', category: 'pitch', subcategory: 'Octave', price: 249, analog: false, description: 'Polyphonic octave generator with 8 sliders. Sub to two octaves up.' },
  { brand: 'Digitech', model: 'Whammy 5', category: 'pitch', subcategory: 'Pitch Shifter', price: 199, analog: false, description: 'The legendary expression-controlled pitch shifter.' },
  { brand: 'TC Electronic', model: 'Brainwaves', category: 'pitch', subcategory: 'Pitch Shifter', price: 149, analog: false, description: 'Dual-voice pitch shifter with TonePrint. Smooth and musical.' },

  // AMBIENT / EXPERIMENTAL
  { brand: 'Hologram Electronics', model: 'Microcosm', category: 'ambient', subcategory: 'Granular', price: 499, analog: false, description: 'Granular looper and glitch machine unlike anything else.' },
  { brand: 'Meris', model: 'Enzo', category: 'ambient', subcategory: 'Synth', price: 299, analog: false, description: 'Multi-voice poly synth and pitch shifter. Turns guitar into a synth engine.' },
  { brand: 'Earthquaker Devices', model: 'Afterneath Enhanced', category: 'ambient', subcategory: 'Reverb', price: 299, analog: false, description: 'Enhanced version of the cult classic with expression and flexi-switch.' },
  { brand: 'Red Panda', model: 'Particle 2', category: 'ambient', subcategory: 'Granular', price: 249, analog: false, description: 'Granular delay and pitch shifter. Glitchy, gorgeous, unpredictable.' },
  { brand: 'Empress Effects', model: 'Zoia', category: 'ambient', subcategory: 'Multi', price: 499, analog: false, description: 'Modular effects ecosystem in a pedal. Build literally any effect you can imagine.' },
  { brand: 'Chase Bliss', model: 'Generation Loss', category: 'ambient', subcategory: 'Lo-fi', price: 349, analog: false, description: 'VHS and tape degradation simulator. Nostalgic, lo-fi atmosphere machine.' },
];

// ─── Reverb image fetch ───────────────────────────────────────────────────────

async function fetchReverbImage(brand: string, model: string): Promise<string | null> {
  try {
    const { data } = await supabase.functions.invoke('search-pedals', {
      body: { query: `${brand} ${model}` },
    });
    const url = (data?.results as { photo_url?: string }[])?.[0]?.photo_url;
    return url ?? null;
  } catch {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱  Seeding ${PEDAL_CATALOG.length} pedals into Supabase...\n`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const pedal of PEDAL_CATALOG) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('pedals')
      .select('id, image_url')
      .ilike('brand', pedal.brand)
      .ilike('model', pedal.model)
      .maybeSingle();

    let imageUrl: string | null = existing?.image_url ?? null;

    // Optionally fetch image from Reverb if we don't have one
    if (FETCH_IMAGES && !imageUrl) {
      process.stdout.write(`  🔍 Fetching image for ${pedal.brand} ${pedal.model}...`);
      imageUrl = await fetchReverbImage(pedal.brand, pedal.model);
      console.log(imageUrl ? ` ✓` : ` (no image found)`);
      // Small delay to be polite to the Reverb API
      await new Promise(r => setTimeout(r, 300));
    }

    if (existing) {
      // Update image_url if we found one and it was missing
      if (FETCH_IMAGES && imageUrl && !existing.image_url) {
        await supabase.from('pedals').update({ image_url: imageUrl }).eq('id', existing.id);
        console.log(`  ↑  Updated image: ${pedal.brand} ${pedal.model}`);
      } else {
        console.log(`  ⏭  Skipped (exists): ${pedal.brand} ${pedal.model}`);
      }
      skipped++;
      continue;
    }

    // Insert new pedal
    const { error } = await supabase.from('pedals').insert({
      brand: pedal.brand,
      model: pedal.model,
      category: pedal.category,
      subcategory: pedal.subcategory,
      description: pedal.description,
      analog: pedal.analog,
      avg_price: pedal.price,
      in_production: true,
      image_url: imageUrl,
    });

    if (error) {
      console.error(`  ❌  Error inserting ${pedal.brand} ${pedal.model}: ${error.message}`);
      errors++;
    } else {
      console.log(`  ✅  Inserted: ${pedal.brand} ${pedal.model}`);
      inserted++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`✅  Inserted:  ${inserted}`);
  console.log(`⏭   Skipped:  ${skipped}`);
  console.log(`❌  Errors:   ${errors}`);
  console.log(`─────────────────────────────────────\n`);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
