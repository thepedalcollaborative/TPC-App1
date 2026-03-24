// ─── TPC Gear Knowledge Base ──────────────────────────────────────────────────
// Deep, opinionated gear expertise injected into both Advisor and Custom Shop
// system prompts. This is the curated knowledge that separates a genuine expert
// from a search engine. Think: the best guitar shop employee who's been doing
// this for 20 years and has opinions about everything.
//
// Layer 1 of 3 in the TPC knowledge strategy:
//   Layer 1 (this file): Curated static expertise — signal chain theory, category
//                        deep dives, amp interactions, the language of tone
//   Layer 2 (planned):   Pedal DNA — tone_dna field on pedals table, injected
//                        per-pedal for owned/wishlisted/discussed pedals
//   Layer 3 (planned):   pgvector RAG — semantic retrieval from a gear corpus
//                        (manuals, forum threads, reviews) at query time

export const GEAR_KNOWLEDGE_BASE = `
## Deep Gear Knowledge

### Signal Chain: Order and Why It Matters
The classic order exists for real sonic reasons, not arbitrary rules:

**Tuner → Dynamics → Filter → Drive → Modulation → Time → Reverb**

- **Tuner first**: Always. Cleanest signal for accurate tuning, and it kills your signal without affecting the rest of the chain.
- **Compressor before drive**: Evens out pick attack before clipping, giving smoother, more sustained distortion. More "amp-like" feel. A compressor AFTER drive tightens an already-broken signal — useful for stacking.
- **Wah and envelope filters before drive**: A wah after drive sounds cocked and throaty (a valid choice), but before drive gives the classic quacky sweep. Envelope filters need to see your pick dynamics unprocessed — put anything before them that changes dynamics and they lose their tracking.
- **Fuzzes hate buffers before them**: Vintage germanium fuzzes (Fuzz Face style) have high-impedance inputs that interact with your guitar's pickup. A buffered pedal or long cable before them changes the sound — often for the worse. Run your guitar straight into a fuzz, or know what you're doing.
- **Drive before modulation**: Modulating a dirty signal creates chaos. Usually not what you want. The exception: putting a phaser before a fuzz is its own classic sound.
- **Reverb last**: Almost always. You want the reverb to decay in space, not be processed by anything downstream. Exception: reverb into fuzz for massive textural sounds (shoegaze).
- **Delay before reverb**: Delay repeats should sit in the same space as the dry signal, so reverb goes last to unify everything.

### Drive / Overdrive / Fuzz: The Real Differences
These three words are not interchangeable. Each represents a different circuit topology and a different relationship with your amp:

**Overdrive** clips softly and asymmetrically, imitating the even-order harmonics of a tube amp being pushed. It adds hair without destroying the note shape. The Ibanez TS808/TS9 (Tube Screamer) is the archetype — a mid-hump, compressed, warm dirt that loves a slightly-cranked amp. Overdrives are "in conversation" with your amp. They push the front end. A great overdrive at unity gain on a clean amp can sound like a better version of your amp. The Klon Centaur/KTR, the Timmy, the Zendrive — these all live here.

**Distortion** clips harder, often symmetrically, and produces more even-order harmonics — brighter, more aggressive, and more independent from your amp's character. The ProCo RAT and Boss DS-1 are the archetypes. More sustain, more gain, but less "alive." Distortions can start to sound the same regardless of amp — that's by design for players who need consistency.

**Fuzz** is the wild animal. Fuzz circuits clip violently and produce heavy odd-order harmonics — the raw, sputtery, velcro sound. Germanium fuzzes (Fuzz Face, Tonebender) are voltage-sensitive, temperature-sensitive, and pickup-impedance-sensitive. They sag and bloom. Silicon fuzzes (Big Muff, many clones) are more predictable, louder, and better at stacking. The Big Muff is its own category — more of a "sustain machine" than a traditional fuzz. The key variable in any fuzz is whether it runs out of headroom gracefully or violently.

**How to stack drives**: Overdrive into overdrive is the most common stack — a lower-gain OD as a "foundation layer" that another OD sits on top of. The classic: Tube Screamer into a cranked amp (the SRV/John Mayer thing), or a clean boost into a Big Muff to hit it harder and bring the mids back. Fuzz almost always goes first in a stack.

### Compression: The Most Misunderstood Pedal Type
Compression is not just about squashing. It's about feel. A great compressor makes everything respond better — it doesn't necessarily change your sound, it changes how your instrument talks back to you.

**Optical compressors** (Demeter Compulator, Analogman Juicer, Empress Compressor) have a naturally slow attack because the optocoupler's light element takes time to respond. This lets the initial transient through before the compression kicks in, giving a more "natural" feel. Great for clean playing, chicken-pickin', arpeggios.

**VCA compressors** (MXR Dyna Comp, ROSS, Diamond Comp) are faster and snappier. The classic "squishy" country/funk compressor sound. The attack hits harder on the pick.

**FET compressors** (Urei 1176-style units) are the fastest and most aggressive — studio staple brought to pedalboard format.

**Invisible vs. effect compression**: At low ratios with a fast attack, a compressor is invisible — it just makes your playing feel more consistent and the note decay feel more even. Crank the ratio and the sustain, and it becomes an effect — the "squish" becomes part of the sound. Both are valid. Most players who say they don't like compressors have only heard the effect setting.

**Where it sits**: Before drives for smoother dirt. After drives to tighten an already-broken signal. Some players run two — one at the front for feel, one at the end as a limiter before the amp.

### Reverb: Understanding the Algorithms
Not all reverbs are the same, and the differences matter tonally:

**Spring**: The natural sound of a physical spring coil. Drips, splashes on transients. The sound of a Fender amp's built-in reverb — classic, slightly cheesy, beloved. The Catalinbread Belle Epoch Deluxe, Strymon Flint, and countless others nail this.

**Plate**: Large metal plates mechanically excited in a studio. Smoother than spring, less ringy, more enveloping. A studio standard for vocals and guitars that translates well to pedalboard use. Dense, smooth decay.

**Hall**: Simulates a concert hall — long, diffuse, with early reflections. The "big sound" reverb. Can swallow a band mix. Use sparingly or roll off the decay significantly for live use.

**Room**: Short, dense reflections. Adds size without washing things out. Often the most usable for live playing — gives the sense of space without sacrificing note definition.

**Shimmer**: Pitch-shifted reverb (usually an octave up or harmonized interval). Pioneered by Brian Eno/Daniel Lanois as a studio effect, now ubiquitous. Strymon BigSky's Shimmer algorithm, EHX Cathedral, Red Panda Particle. Huge for ambient/worship contexts. Easily overdone.

**Pre-delay**: The gap between the dry signal and the reverb tail. Even 15–30ms of pre-delay lets the dry signal breathe before the reverb fills in, dramatically improving clarity. This is the most underused parameter on any reverb pedal.

### Delay: Character Over Specs
Delay is the most personal effect on most boards. The character comes from:

**BBD analog delay** (Memory Man, Carbon Copy, Aqua Puss): Warm, slightly degraded repeats that sit under the dry signal naturally. Each repeat loses a bit of high end, which is a feature — the echoes don't compete with the original note. Maximum time is limited (usually under 600ms without slowing the clock).

**Tape delay** (Strymon El Capistan, Chase Bliss Tonal Recall, Roland Space Echo): Warble, flutter, head crackle, saturation. The "vintage" sound. Tape delays breathe and shift. They're imperfect in the most musical way possible.

**Digital delay** (Boss DD series, TC Electronic, Line 6): Clinical, accurate, infinite time. Repeats are exact copies of the original. Good when you need precision (dotted-eighth rhythmic delays, long ambient trails). Can sound sterile if you want warmth.

**Dotted-eighth tricks**: Set delay to dotted-eighth note time and match your tempo — the Edge (U2) style. Creates a triplet feel with straight picking. The math: (60,000 / BPM) × 0.75 = dotted-eighth time in ms.

**Self-oscillation**: When the feedback is cranked past the threshold where repeats decay, the delay regenerates into a screaming, runaway tone. Can be controlled artistically. The Memory Man's self-oscillation is a different character than a digital delay's.

### Modulation: The Three That Get Confused
**Chorus** splits your signal, pitch-modulates one copy slightly, and blends it back with the dry signal. The pitch detuning is slow and subtle. Result: a lush, thick, "doubled" sound. The Boss CE-2, TC Corona, Strymon Ola.

**Flanger** does the same thing but with a shorter delay time (typically 1–20ms vs. chorus at 20–50ms). The result is a comb-filtering "jet plane" sweep — more metallic and obvious than chorus. The same circuit can do both at different settings.

**Phaser** uses all-pass filters to shift phase at specific frequencies, creating notches that sweep up and down. Unlike chorus/flanger, it doesn't split the signal into two pitch-detuned versions — it's purely phase. Thinner-sounding than a flanger, more subtle. The MXR Phase 90 is the archetype. Great with single coils.

**Vibrato** is pitch-only modulation — 100% wet chorus with no dry signal. The pitch actually wobbles. Distinct from tremolo, which is amplitude-only (volume wobbles).

**Tremolo** pulses the volume. A simple but profound effect. The depth and rate determine the feel — slow/deep for ambient pulse, fast for a more urgent choppy rhythm. The key variable is waveshape: sine wave = smooth, square wave = choppy/gating.

### Amp Interaction: The Most Important Variable
How a pedal sounds depends enormously on what it's going into:

**Clean platforms** (Fender Twin, Fender Deluxe Reverb, Roland JC-120, Vox AC30 on clean channel): Let every pedal be heard exactly as designed. The amp is a neutral canvas. Best for drives that have their own character, for pristine modulation and reverb, for players who want the pedal to be the sound.

**Natural breakup amps** (Vox AC15/AC30, tweed Fender Deluxe, Matchless DC-30): The amp is already partly into its own drive. Drives and boosts push it further — often the most musical results come from a clean boost or low-gain OD into a "sweet spot" amp. These amps respond to your picking dynamics in ways high-gain amps don't.

**High-gain amps** (Mesa Boogie, Peavey 5150, EVH, Marshall JCM800 cranked): Drive pedals can be redundant or fight the amp. What works: a tight overdrive or EQ boost as a "gate" to tighten the palm mutes (the classic Boss SD-1 or Tube Screamer into a 5150). Modulation and time-based effects go in the effects loop on high-gain amps — putting reverb and delay before a high-gain preamp creates a muddy mess.

**Modelers** (Helix, Kemper, HX Stomp, Fractal Axe-FX, Neural DSP Quad Cortex): Often accept pedals before the input exactly like a real amp, or in effects loop positions. With modelers, impedance matching is less of an issue, but some vintage fuzzes and wahs still want the high-impedance input of a real amp. The best pedals to add to a modeler are those the modeler doesn't capture well: boutique drives, real spring reverb, specific analog character.

### Power: The Unsexy Thing That Ruins Everything
**Ground loops** cause hum. They happen when pedals share a common ground through a daisy chain power cable AND through audio signal cables. Every pedal in a daisy chain chain is connected through the power supply ground and through the signal path. Isolated power supplies (each output is electrically independent) eliminate this completely. Cioks, Strymon Zuma, Walrus Audio Aetos, MXR ISO-Brick — all isolated.

**Voltage sag** is what happens when a pedal is underpowered. Germanium fuzzes use voltage sag as a feature (the "dying battery" sound is intentional). Digital pedals will malfunction or crash. Most analog pedals react somewhere in between — some get gainy and compressed, others get glitchy.

**9V vs. 18V**: Some pedals (Fulltone OCD, Strymon Deco) run on 18V for more headroom. Running them at 9V changes the sound — less clean, more compressed. Running a 9V pedal at 18V can destroy it. Know what you're running.

**Current draw**: A digital pedal (reverb, delay, modulator) often draws 100–500mA. A simple analog pedal might draw 10mA. Running out of current on a power supply causes digital pedals to malfunction and analog pedals to behave strangely.

### The Language of Tone
When players describe tone, they use specific language that maps to real sonic properties. Being fluent in this vocabulary matters:

- **Warmth**: Low-mid emphasis, softened high-frequency transients. Often from tubes, transformers, analog circuits.
- **Bite**: Upper-mid presence and attack. Single coils "bite." A cranked Marshall bites.
- **Sag**: The compression and voltage droop that happens in a tube power amp when pushed hard. The feeling of the amp giving way slightly on hard attacks. Beloved by most players.
- **Bloom**: Notes that swell after the initial attack. Usually from optical compression or a compressor with slow attack and fast release.
- **Clarity**: Definition of individual notes even in complex chords. High-pass character, careful gain staging.
- **Spank**: Percussive, dynamic attack — the sound of single coils on a clean amp with slight compression. Funk, country, clean blues.
- **Chime**: High, bell-like harmonics. AC30 characteristic. Jingle-jangle.
- **Honk**: Nasal, midrange-forward character. P90s, some wah positions, cranked Vox.
- **Velcro**: Fuzz that sounds frayed and shaggy on the decay — usually higher gain silicon fuzzes or germanium near their bias threshold.
- **Cream**: Smooth, even-order harmonic distortion that sounds rich rather than harsh. Les Paul into Marshall. Smooth OD circuits.
- **Fizz**: Harsh, buzzy high-frequency distortion. Usually bad. Happens when there's too much gain, wrong EQ, or a poor circuit. Also happens running digital pedals into overly bright amps.
- **Gating**: Abrupt cutoff of sustain — either intentional (noise gate) or the natural artifact of some fuzz and drive circuits at lower bias voltages.
`;
