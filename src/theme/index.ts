// TPC Brand System — single source of truth for all design tokens

export const colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────────
  background: '#F7F4F0',    // warm off-white (echoes brand Linen/Peach)
  surface: '#FFFFFF',        // pure white cards pop against background
  surfaceHigh: '#F2EDE7',   // slightly elevated surface for nested cards
  border: '#E2DDD7',         // warm light border

  // ── Brand ────────────────────────────────────────────────────────────────────
  teal: '#2D8A7E',           // exact brand Teal/Dark Cyan
  tealDark: '#216E64',       // darker for gradient bottom
  rose: '#F26080',           // exact brand Coral Pink/Watermelon
  roseDark: '#D94E6A',       // darker for gradient bottom

  // ── Brand accents ────────────────────────────────────────────────────────────
  slate: '#3D5261',          // exact brand Dark Slate Blue-Gray
  sage: '#C8EDAB',           // brand Light Sage Green (badges, highlights)
  linen: '#F0DCC8',          // brand Warm Linen/Peach (subtle accents)
  gold: '#E5C04A',           // brand Golden Yellow (milestone moments, Pro badge)
  goldDark: '#C9A830',       // darker gold for gradients

  // ── Semantic ─────────────────────────────────────────────────────────────────
  warning: '#C47D00',        // amber — darkened for legibility on light bg
  success: '#1A8C40',        // green — darkened for legibility on light bg
  error: '#D42B2B',          // red — darkened for legibility on light bg

  // ── Text ─────────────────────────────────────────────────────────────────────
  textPrimary: '#3D5261',    // brand Dark Slate — rich, not harsh black
  textSecondary: '#5E7585',  // mid-tone slate
  textMuted: '#8FA3AE',      // light muted slate
  text: '#3D5261',           // alias for legacy usages
  surfaceAlt: '#F5F5F5',     // alias for legacy usages

  // ── Effect category colors (distinct + legible on light backgrounds) ─────────
  drive: '#C45208',          // burnt orange
  boost: '#F59E0B',          // amber
  compressor: '#22C55E',     // green
  eq: '#0EA5E9',             // sky blue
  delay: '#2563EB',          // blue
  reverb: '#8B5CF6',         // violet
  modulation: '#EC4899',     // pink  (catch-all)
  looper: '#14B8A6',         // teal
  pitch: '#A16207',          // gold
  utility: '#6B7280',        // slate
  ambient: '#C026D3',        // fuchsia
  synth: '#4F46E5',          // indigo
  other: '#94A3B8',          // light slate
  multifx: '#F97316',        // orange
  modeler: '#38BDF8',        // light blue
  // ── Expanded categories ───────────────────────────────────────────────────
  fuzz: '#DC2626',           // red
  distortion: '#9A3412',     // dark rust
  chorus: '#0D9488',         // dark teal-green
  phaser: '#65A30D',         // olive
  flanger: '#6366F1',        // cornflower
  tremolo: '#B45309',        // dark caramel
  wah: '#D97706',            // amber-gold
  octave: '#7C3AED',         // deep purple
  volume: '#78716C',         // warm gray
  noisegate: '#15803D',      // dark green
  buffer: '#334155',         // dark slate
  preamp: '#92400E',         // dark amber / tubes
};

export const typography = {
  // Font families
  display: 'RuckSackBlack',       // brand font — loaded from assets/fonts/RuckSackBlack.otf
  displayFallback: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',

  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

// ── Gradient presets ──────────────────────────────────────────────────────────
export const gradients = {
  teal: [colors.teal, colors.tealDark] as [string, string],
  rose: [colors.rose, colors.roseDark] as [string, string],
  gold: [colors.gold, colors.goldDark] as [string, string],
  slate: ['#3D5261', '#2A3E4E'] as [string, string],
  header: ['#FFFFFF', '#F7F4F0'] as [string, string],
  surface: ['#FFFFFF', '#F7F4F0'] as [string, string],
  card: ['#FFFFFF', '#FAF7F3'] as [string, string],
};

// ── Font note ─────────────────────────────────────────────────────────────────
// RuckSack Black is now ACTIVE — loaded from assets/fonts/RuckSackBlack.otf.
// typography.display = 'RuckSackBlack' — applies to all headers, CTAs, numbers.
// SpaceGrotesk_700Bold kept as a loaded fallback (displayFallback).

// ── Category colors map ───────────────────────────────────────────────────────
export const categoryColors: Record<string, string> = {
  // Original
  drive:      colors.drive,
  boost:      colors.boost,
  compressor: colors.compressor,
  eq:         colors.eq,
  modulation: colors.modulation,
  delay:      colors.delay,
  reverb:     colors.reverb,
  utility:    colors.utility,
  looper:     colors.looper,
  pitch:      colors.pitch,
  ambient:    colors.ambient,
  synth:      colors.synth,
  other:      colors.other,
  multifx:    colors.multifx,
  modeler:    colors.modeler,
  // Expanded
  fuzz:       colors.fuzz,
  distortion: colors.distortion,
  chorus:     colors.chorus,
  phaser:     colors.phaser,
  flanger:    colors.flanger,
  tremolo:    colors.tremolo,
  wah:        colors.wah,
  octave:     colors.octave,
  volume:     colors.volume,
  noisegate:  colors.noisegate,
  buffer:     colors.buffer,
  preamp:     colors.preamp,
};

// ── Board colors (brand palette) ─────────────────────────────────────────────
export const boardColorOptions = [
  { key: 'teal', label: 'Teal', color: colors.teal },
  { key: 'slate', label: 'Slate', color: colors.slate },
  { key: 'rose', label: 'Rose', color: colors.rose },
  { key: 'sage', label: 'Sage', color: colors.sage },
  { key: 'linen', label: 'Linen', color: colors.linen },
  { key: 'amber', label: 'Amber', color: colors.warning },
];

export const boardColorMap: Record<string, string> = boardColorOptions.reduce(
  (acc, item) => {
    acc[item.key] = item.color;
    return acc;
  },
  {} as Record<string, string>
);
