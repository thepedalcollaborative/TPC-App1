/**
 * Pedal identity normalization
 *
 * Rules:
 *  - Version numbers (V2, MkII, etc.) make a pedal a DIFFERENT canonical pedal
 *    → preserve them in the canonical key
 *  - Colorway/cosmetic qualifiers (colors, materials, edition words) indicate a
 *    VARIANT of the same canonical pedal → strip them for exclusion matching
 *  - MkII === V2, MkIII === V3, etc. — normalize to Vn form
 */

// ── Version normalization ────────────────────────────────────────────────────
// Converts Mk/Mark notation to V notation so "MkII" and "V2" match each other.
export function normalizeVersion(model: string): string {
  return model
    .replace(/\bmark\s*iv\b/gi, 'V4')
    .replace(/\bmark\s*iii\b/gi, 'V3')
    .replace(/\bmark\s*ii\b/gi, 'V2')
    .replace(/\bmark\s*i\b/gi, 'V1')
    .replace(/\bmk\s*iv\b/gi, 'V4')
    .replace(/\bmk\s*iii\b/gi, 'V3')
    .replace(/\bmk\s*ii\b/gi, 'V2')
    .replace(/\bmk\s*i\b/gi, 'V1')
    // Mk3, Mk2, Mk1 (numeric)
    .replace(/\bmk\s*(\d+)\b/gi, (_, n) => `V${n}`)
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Condition / listing words ────────────────────────────────────────────────
// Reverb listing titles often start with condition words that bleed into model fields.
const CONDITION_WORDS = new Set([
  'used', 'mint', 'new', 'excellent', 'good', 'fair', 'poor', 'pristine',
  'vintage', 'rare', 'demo', 'refurbished', 'blemished',
]);

export function stripConditionWords(model: string): string {
  return model
    .split(/\s+/)
    .filter(w => !CONDITION_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Listing descriptor words ─────────────────────────────────────────────────
// Reverb sellers append effect-category and product words to listing titles.
// Strip these for canonical matching only — not for display.
const LISTING_DESCRIPTORS = new Set([
  'overdrive', 'distortion', 'fuzz', 'delay', 'reverb', 'modulation',
  'chorus', 'vibrato', 'phaser', 'flanger', 'tremolo', 'boost',
  'compressor', 'looper', 'pitch', 'shifter', 'octave', 'wah',
  'filter', 'eq', 'equalizer', 'preamp', 'multi',
  'pedal', 'effect', 'effects', 'guitar', 'bass', 'stompbox',
  'unit', 'processor', 'analog', 'digital', 'floor', 'instrument',
]);

export function stripListingDescriptors(model: string): string {
  return model
    .split(/\s+/)
    .filter(w => !LISTING_DESCRIPTORS.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    .join(' ')
    .replace(/\([^)]*\)/g, '')   // remove anything in parentheses
    .replace(/[()[\]{}]/g, '')   // remove stray brackets
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Colorway words ───────────────────────────────────────────────────────────
// Words that indicate a colorway/cosmetic variant — NOT a different canonical pedal.
// Conservative list: only words that are unambiguously cosmetic in guitar pedal context.
const COLORWAY_WORDS = new Set([
  // Pure colors
  'black', 'white', 'grey', 'gray', 'silver', 'gold', 'blue', 'red', 'green',
  'yellow', 'orange', 'purple', 'violet', 'pink', 'brown', 'cream', 'mint',
  'teal', 'cyan', 'turquoise', 'navy', 'olive', 'maroon', 'coral', 'midnight',
  'arctic', 'desert', 'sand', 'rust', 'seafoam', 'aqua', 'indigo', 'charcoal',
  'ivory', 'bone', 'champagne', 'burgundy', 'magenta',
  // Finishes / materials
  'matte', 'gloss', 'glossy', 'sparkle', 'metallic', 'chrome', 'brushed',
  'hammered', 'textured', 'satin',
  // Edition / release qualifiers
  'limited', 'edition', 'anniversary', 'exclusive', 'collector', 'reissue',
  'anniversary', 'tribute', 'signature',
]);

// ── Strip colorway qualifiers ────────────────────────────────────────────────
// Removes cosmetic words, leaving only the canonical model name + version.
export function stripColorway(model: string): string {
  return model
    .split(/\s+/)
    .filter(word => {
      const clean = word.toLowerCase().replace(/[^a-z]/g, '');
      return clean.length > 0 && !COLORWAY_WORDS.has(clean);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Canonical key ────────────────────────────────────────────────────────────
// Returns a single brand|model string with versions normalized and colorways stripped.
// Two pedals sharing the same canonical key are the same product for exclusion purposes.
export function canonicalKey(brand: string, model: string): string {
  const b = normalizeBrand(brand);
  const versionNormalized = normalizeVersion(model);
  const conditionStripped = stripConditionWords(versionNormalized);
  // Strip brand name from model if Reverb listing bled it in (e.g. "Chase Bliss Habit" → "Habit")
  const escapedBrand = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const brandStripped = conditionStripped
    .replace(new RegExp(escapedBrand, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip generic listing descriptor words (e.g. "Overdrive Pedal", "Guitar Effect")
  const descriptorsStripped = stripListingDescriptors(brandStripped || conditionStripped);
  const m = stripColorway(descriptorsStripped || brandStripped || conditionStripped).toLowerCase();
  return `${b}|${m}`;
}

// ── Brand normalization ──────────────────────────────────────────────────────
// Strips common suffixes so "Walrus Audio" and "Walrus" both collapse to "walrus",
// and handles well-known aliases (EHX, Boss casing, etc.)
export function normalizeBrand(brand: string): string {
  return brand
    .toLowerCase()
    .trim()
    .replace(/electro[\s\-]*harmonix/g, 'ehx')
    .replace(/\baudio\b/g, '')
    .replace(/\belectronics\b/g, '')
    .replace(/\beffects\b/g, '')
    .replace(/\bpedals\b/g, '')
    .replace(/\btoneworks\b/g, '')
    .replace(/\bguitarworks\b/g, '')
    .replace(/\bmusic\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Exact key ────────────────────────────────────────────────────────────────
export function exactKey(brand: string, model: string): string {
  return `${normalizeBrand(brand)}|${model.toLowerCase().trim()}`;
}

// ── Exclusion keys (for building the excluded Set from owned pedals) ─────────
// Returns all keys that should be added to the exclusion set when a user owns this pedal.
// Includes the exact key AND the canonical key so both colorway-matched and exact-matched
// candidates get excluded.
export function ownedExclusionKeys(brand: string, model: string): string[] {
  const exact = exactKey(brand, model);
  const canonical = canonicalKey(brand, model);
  return exact === canonical ? [exact] : [exact, canonical];
}

// ── Is excluded ──────────────────────────────────────────────────────────────
// Checks whether a candidate pedal is excluded by the set.
// 1. Exact key match
// 2. Canonical key match (strips colorways, condition words, listing descriptors)
// 3. Substring fallback: owned "385 V2" is contained in catalog "385 V2 Overdrive Pedal"
export function isExcluded(brand: string, model: string, excluded: Set<string>): boolean {
  const ek = exactKey(brand, model);
  const ck = canonicalKey(brand, model);
  if (excluded.has(ek)) return true;
  if (excluded.has(ck)) return true;

  // Substring fallback for messy Reverb listing titles
  const b = normalizeBrand(brand);
  const candidateModel = normalizeVersion(model).toLowerCase();
  const prefix = `${b}|`;
  for (const key of excluded) {
    if (key.startsWith('id:')) continue;
    if (!key.startsWith(prefix)) continue;
    const ownedModel = key.slice(prefix.length);
    // Only substring-match if the owned model is meaningful (> 3 chars) and
    // doesn't contain a version the candidate doesn't have (avoid V1 matching V2)
    if (ownedModel.length > 3 && candidateModel.includes(ownedModel)) return true;
  }
  return false;
}
