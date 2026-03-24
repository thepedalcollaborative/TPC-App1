import { FullExpertProfile } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelectOption = { label: string; value: string };

export type StepConfig =
  | {
      type: 'single';
      field: keyof FullExpertProfile;
      question: string;
      subtitle?: string;
      options: SelectOption[];
      detailField?: keyof FullExpertProfile;
      detailLabel?: string;
      detailPlaceholder?: string;
    }
  | {
      type: 'multiselect';
      field: keyof FullExpertProfile;
      question: string;
      subtitle?: string;
      maxSelect?: number;
      options: SelectOption[];
    }
  | {
      type: 'freetext';
      field: keyof FullExpertProfile;
      question: string;
      subtitle?: string;
      placeholder: string;
      skippable: true;
    }
  | {
      type: 'combined';
      question: string;
      subtitle?: string;
      parts: {
        field: keyof FullExpertProfile;
        label: string;
        options: SelectOption[];
        detailField?: keyof FullExpertProfile;   // optional free-text add-on
        detailLabel?: string;
        detailPlaceholder?: string;
      }[];
    };

// ─── Question Definitions ─────────────────────────────────────────────────────

export const STEPS: StepConfig[] = [
  // Q1 — Experience
  {
    type: 'single',
    field: 'experience_years',
    question: 'How long have you been playing guitar?',
    options: [
      { label: 'Less than 1 year', value: 'less_than_1' },
      { label: '1–3 years', value: '1_3' },
      { label: '4–7 years', value: '4_7' },
      { label: '8–15 years', value: '8_15' },
      { label: '15+ years', value: '15_plus' },
    ],
    detailField: 'year_started',
    detailLabel: 'Year you started',
    detailPlaceholder: 'e.g. 2009',
  },
  // Q2 — Tone Identity
  {
    type: 'freetext',
    field: 'tone_identity',
    question: 'Describe your tone in three words.',
    subtitle: "Don't overthink it.",
    placeholder: 'e.g. warm, dark, haunting',
    skippable: true,
  },
  // Q3 — Guitar Heroes
  {
    type: 'freetext',
    field: 'guitar_heroes',
    question: 'Name 2–3 guitarists who have your ideal tone.',
    subtitle: 'Famous, obscure, alive, dead — anyone.',
    placeholder: 'e.g. Kevin Shields, David Gilmour, Nels Cline',
    skippable: true,
  },
  // Q4 — Sonic Moments
  {
    type: 'multiselect',
    field: 'sonic_moments',
    question: 'Which of these sounds makes you stop and listen?',
    subtitle: 'Pick up to 3.',
    maxSelect: 3,
    options: [
      { label: "A fuzz that sounds like it's about to fall apart", value: 'fuzz_collapsing' },
      { label: 'Delay so washy it becomes atmosphere', value: 'delay_washy' },
      { label: 'A chorus that makes one guitar sound like ten', value: 'chorus_lush' },
      { label: 'Overdrive that sounds like a cranked amp in a room', value: 'overdrive_amp' },
      { label: 'A filter that makes the guitar talk', value: 'filter_talk' },
      { label: 'Tremolo that turns a note into a pulse', value: 'tremolo_pulse' },
      { label: 'Reverb so deep it sounds like another dimension', value: 'reverb_deep' },
      { label: 'Synth-like tones from a guitar', value: 'synth_tones' },
      { label: 'Feedback and noise as texture', value: 'feedback_noise' },
      { label: 'Compression that makes everything feel glued', value: 'compression_glue' },
    ],
  },
  // Q5 — Rig (guitar + amp, each with a free-text brag field)
  {
    type: 'combined',
    question: 'Tell me about your rig.',
    subtitle: "Don't be shy — brag a little.",
    parts: [
      {
        field: 'guitar_type',
        label: 'Your main guitar',
        options: [
          { label: 'Single coils (Strat, Tele, Jazzmaster)', value: 'single_coils' },
          { label: 'Humbuckers (Les Paul, 335, SG)', value: 'humbuckers' },
          { label: 'P90s', value: 'p90s' },
          { label: 'Mix / multiple guitars', value: 'mix' },
        ],
        detailField: 'guitar_details',
        detailLabel: 'What are you actually playing?',
        detailPlaceholder: "e.g. '65 Strat reissue, Collings I-35, Jazzmaster...",
      },
      {
        field: 'amp_type',
        label: 'Your amp situation',
        options: [
          { label: 'Clean platform (Fender-style)', value: 'clean_platform' },
          { label: 'Natural breakup (Vox, tweed)', value: 'natural_breakup' },
          { label: 'High gain (Mesa, Marshall)', value: 'high_gain' },
          { label: 'Modeler / direct (Kemper, HX Stomp)', value: 'modeler' },
          { label: 'No amp / straight to interface', value: 'no_amp' },
        ],
        detailField: 'amp_details',
        detailLabel: "What's in your setup?",
        detailPlaceholder: 'e.g. Fender Deluxe Reverb, Two Rock, HX Stomp...',
      },
    ],
  },
  // Q6 — Signal chain (stereo / mono)
  {
    type: 'single',
    field: 'signal_chain',
    question: 'How do you run your signal?',
    subtitle: 'Helps us flag stereo-specific pedals when relevant.',
    options: [
      { label: 'Full stereo — two amps, stereo effects, the works', value: 'full_stereo' },
      { label: 'Mono and proud of it', value: 'mono' },
      { label: 'Start mono, end up stereo', value: 'mono_to_stereo' },
      { label: 'Stereo sometimes, mono at rehearsal', value: 'sometimes_stereo' },
      { label: "Doesn't matter to me", value: 'no_preference' },
    ],
  },
  // Q8 — Genre
  {
    type: 'multiselect',
    field: 'genres',
    question: 'What do you actually play?',
    options: [
      { label: 'Blues', value: 'blues' },
      { label: 'Classic rock / hard rock', value: 'classic_rock' },
      { label: 'Indie / alternative', value: 'indie_alt' },
      { label: 'Shoegaze / dream pop', value: 'shoegaze' },
      { label: 'Math rock / post-rock', value: 'math_rock' },
      { label: 'Jazz / fusion', value: 'jazz' },
      { label: 'Metal / doom / stoner', value: 'metal' },
      { label: 'Ambient / experimental', value: 'ambient' },
      { label: 'Country / Americana', value: 'country' },
      { label: 'Funk / soul / R&B', value: 'funk' },
      { label: 'Pop / singer-songwriter', value: 'pop' },
      { label: 'Praise & Worship', value: 'praise_worship' },
      { label: 'Electronic / noise', value: 'electronic' },
    ],
  },
  // Q7 — Board Philosophy
  {
    type: 'single',
    field: 'board_philosophy',
    question: 'When you think about your pedalboard, what feels most true?',
    options: [
      { label: 'Every pedal has a clear, practical job', value: 'practical' },
      { label: "Sounds I can't get anywhere else, even if they're weird", value: 'weird' },
      { label: 'The board disappears and just makes my amp sound better', value: 'transparent' },
      { label: 'The board itself is the instrument', value: 'instrument' },
    ],
  },
  // Q9 — Brand Attitude
  {
    type: 'single',
    field: 'brand_attitude',
    question: 'How do you think about pedal brands?',
    options: [
      { label: 'Big names — Boss, EHX, MXR. Proven and reliable.', value: 'big_names' },
      { label: "I'll go boutique if there's a real reason, not just hype", value: 'boutique_selective' },
      { label: 'I actively seek out small builders and micro-runs', value: 'micro_builders' },
      { label: "I don't care who made it — I care what it does", value: 'agnostic' },
    ],
  },
  // Q10 — Complexity Tolerance
  {
    type: 'single',
    field: 'complexity_tolerance',
    question: 'How do you feel about pedals with a deep learning curve?',
    options: [
      { label: 'Plug in and immediately find the sound', value: 'plug_and_play' },
      { label: "I'll spend an afternoon with a manual if the ceiling is high enough", value: 'patient' },
      { label: 'The more knobs and modes the better', value: 'deep_dive' },
      { label: 'Depends on the pedal', value: 'depends' },
    ],
  },
  // Q11 — Budget
  {
    type: 'single',
    field: 'budget_range',
    question: "What's your sweet spot for a single pedal purchase?",
    options: [
      { label: 'Under $100', value: 'under_100' },
      { label: '$100–$175', value: '100_175' },
      { label: '$175–$300', value: '175_300' },
      { label: '$300–$500', value: '300_500' },
      { label: "No ceiling if it's the right one", value: 'no_ceiling' },
    ],
  },
  // Q12 — The Chase
  {
    type: 'freetext',
    field: 'tone_chase',
    question: "What's the one sound you've been chasing that you haven't nailed yet?",
    placeholder: "e.g. that blown-out, collapsing fuzz on Loveless. I can't find it.",
    skippable: true,
  },
];

export const TOTAL_STEPS = STEPS.length;

// ─── Helper ───────────────────────────────────────────────────────────────────

export function getLabelForValue(field: keyof FullExpertProfile, value: string): string {
  if (!value) return '';
  for (const step of STEPS) {
    if (step.type === 'single' && step.field === field) {
      return step.options.find(o => o.value === value)?.label ?? value;
    }
    if (step.type === 'multiselect' && step.field === field) {
      return step.options.find(o => o.value === value)?.label ?? value;
    }
    if (step.type === 'combined') {
      for (const part of step.parts) {
        if (part.field === field) {
          return part.options.find(o => o.value === value)?.label ?? value;
        }
      }
    }
  }
  return value;
}
