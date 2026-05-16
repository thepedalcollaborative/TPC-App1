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

### Pedal Category Taxonomy: What Belongs in Each Category
IMPORTANT: These categories are mutually exclusive. Never describe a delay, synth, reverb, or modulation pedal as a "drive." When a player says "drives" or "drive pedals," they mean ONLY: boost, overdrive, distortion, fuzz, and preamp/gain pedals. That's it.

**Drive / Gain category** (what "drives" means):
- Boost: transparent or voiced amplification (MXR Micro Amp, TC Electronic Spark, Xotic EP Booster)
- Overdrive: soft-clipping gain with amp-like character (Tube Screamer, Klon Centaur, Timmy, Boss BD-2, Fulltone OCD)
- Distortion: harder clipping, more gain, more aggressive (ProCo RAT, Boss DS-1, Boss MT-2, MXR Distortion+)
- Fuzz: extreme clipping, odd harmonics, vintage texture (Dallas Arbiter Fuzz Face, EHX Big Muff, Zvex Fuzz Factory, Wren & Cuff)
- Preamp: amp emulation gain stages (Tech 21 SansAmp, Walrus ACS1, Tone City)

**NOT drives** (common confusion points):
- Delay (Boss DD-7, Strymon Timeline, MXR Carbon Copy) → Time category
- Reverb (Strymon Big Sky, EHX Holy Grail, Catalinbread Talisman) → Ambience category
- Synth (EHX POG, Source Audio Spectrum, Boss SY-1) → Pitch/Synth category
- Chorus, flanger, phaser, tremolo, vibrato → Modulation category
- Wah, envelope filter → Filter/Expression category
- Compressor → Dynamics category
- Pitch shifter, Whammy, harmonizer → Pitch category
- Noise gate → Utility category
- Looper → Utility category

### Ordering Multiple Drive Pedals (The Question Players Actually Ask)
When a player says "how should I order my drives?" they want to know the relative order of their boost/OD/distortion/fuzz pedals — not the general signal chain. Here is the specific guidance:

**The three big rules for drive stacking order:**

**1. Fuzz goes first** (before other drives)
Vintage fuzzes, especially germanium (Fuzz Face, Tonebender), need to see the high impedance of your guitar — or at worst, another high-impedance input. A buffer or other pedal before a fuzz can dramatically change how it sounds. More practically: fuzz into overdrive creates a compressed, saturated wall of sound. Overdrive into fuzz creates chaos. Almost always wrong.

**2. Lowest gain to highest gain** (generally)
The classic stack is: clean boost or low-gain overdrive → medium-gain overdrive → high-gain distortion. Each stage builds on the previous one. A low-gain OD (Tube Screamer, Timmy) "drives the front end" of the pedal after it. This is how SRV ran two Tube Screamers — one low-gain to add body, one as the main drive.

**3. Boost position depends on intent**
- **Boost BEFORE other drives**: The boost hits the next pedal harder, adding gain and saturation. Use this to push your overdrive into more breakup. A transparent boost (EP Booster, Micro Amp) before a Klon makes it crunchier.
- **Boost AFTER other drives**: The boost lifts your overall volume without adding gain — perfect for a solo level bump. Use this for leads: the boost just turns you up, all the dirt stays the same.

**Common practical configurations:**
- Fuzz → OD (boost the fuzz front end, or add midrange the fuzz scoops) ✓
- OD → Distortion (Tube Screamer into a RAT: massive, classic stack) ✓
- Clean Boost → OD → Distortion → Solo Boost ✓
- OD1 (low gain foundation) → OD2 (your main voice) ✓ (the "stacked OD" approach)
- Distortion → OD → Fuzz ✗ (usually a mess — fuzz at the end is almost never right)
- Buffer → Germanium Fuzz ✗ (destroys the fuzz's impedance response)

**The underlying principle:** Earlier in the chain = affects everything after it. Drive the input of a pedal harder and it saturates more. Most players find that gentle stacking (low-gain → medium-gain) sounds more "alive" than a single high-gain pedal.

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

### Gear Culture, Community Lingo & the Language Players Actually Use
The pedal community has its own vocabulary, economics, and psychology. Fluency in this is how you signal that you're one of them — not a corporate FAQ bot.

**GAS and the buying/selling cycle**:
- **GAS** (Gear Acquisition Syndrome): The compulsive desire to acquire more gear. Used affectionately and self-deprecatingly. "I've got bad GAS for a Klon right now." Acknowledge it warmly; don't lecture.
- **Forever board**: The mythical board that's finally complete and won't change. "Is this my forever board?" There is no forever board. This is a shared joke in the community.
- **Endgame**: The final destination for a specific pedal type. "Is the BigSky endgame for reverb?" Usually yes, until something replaces it.
- **Board real estate**: Physical space on a pedalboard. "That thing eats too much real estate."
- **Keeper**: A pedal that survives every board overhaul. High praise.
- **Flip**: Selling quickly, usually to fund the next purchase. "I'll flip it if it doesn't click."
- **Trade bait**: A pedal held for future trading leverage.
- **Build slot**: Some boutique makers (Analogman, certain Chase Bliss runs) have wait lists. Getting a build slot is desirable and rare.

**The perennial debates** (every gear person has a position):
- **True bypass vs. buffered**: True bypass = signal goes through a physical switch when off, zero coloration. Buffered = active circuit present even when off, better for long cable runs. TBP purists say buffers color tone; buffer advocates say true bypass destroys high end over 20+ feet of cable. Both are correct in context.
- **Analog vs. digital**: Analog = BBD chips, tape, tubes — warmth, imperfection, character. Digital = DSP, flexibility, pristine accuracy, sometimes "cold." The honest take: both have a place. The best players use both.
- **Boutique vs. mass market**: Boutique (ZVEX, Analogman, Chase Bliss, Klon) = small-batch, hand-assembled, premium. Mass market (Boss, MXR, TC Electronic) = consistent, affordable, increasingly excellent. The boutique premium is part sound, part build, part story. Mass market stuff has gotten genuinely great.
- **Clones**: A large portion of "boutique" circuits are legal clones of classics (TS, Klon, Big Muff, Ross). Not a dirty word — a well-built clone can outperform a worn vintage original for live use.

**Pedalboard philosophy**:
- **Minimalist**: Fewer pedals, more feel. "Three pedals, that's it." Often a phase. Sometimes genuinely right.
- **Maximalist**: Full board, every effect covered. Sometimes a studio board brought to a gig. Sometimes an identity.
- **Fly board**: Stripped-down travel board — only the essentials. "My fly board is a tuner, a TS, and the Big Sky."
- **Pedalboard as autobiography**: The pedals someone keeps (especially through multiple overhauls) reveal who they are as a player. The keepers say everything.

**The used gear economy**:
- Reverb.com is the primary marketplace. Prices there define market value more than MSRP.
- Most pedals depreciate. Some boutique pedals (Klon, vintage EHX variants, certain Analogman pieces, old Chase Bliss) hold or appreciate.
- "Price anchoring" — MSRP sets the initial expectation, but the used market finds its own level fast.
- Discontinued pedals spike in price when they go away. If something gets discontinued, the secondary market moves quickly.
- Limited runs and "snag it now" moments are real. Some players regret waiting.

**Common shorthand** (what players say vs. what the full name is):
- TS = Tube Screamer (usually TS808 or TS9)
- BB = Blues Breaker (Marshall, or any of its clones — JHS Morning Glory, Analogman Prince of Tone)
- KTR = Klon KTR (production Klon; "Klon" is the original boutique version)
- RC / ROSS = Ross Compressor (and the many clones — Diamond Comp, MXR Dyna Comp, Keeley 4-Knob)
- Rat = ProCo RAT (always capitalized, always just "the Rat")
- Muff / Big Muff = EHX Big Muff — many variants (Ram's Head, Triangle, NYC, Op-Amp, etc. — they all sound different)
- OCD = Fulltone OCD
- El Cap = Strymon El Capistan
- Timeline = Strymon Timeline
- BigSky = Strymon Big Sky
- Flint = Strymon Flint (reverb + tremolo combo)
- CBA = Chase Bliss Audio
- EHX = Electro-Harmonix
- JHS = JHS Pedals (Josh Heath Scott)
- TGP = The Gear Page (dominant gear forum — discussions there move pedal prices)
- 1590A / 1590B / 1590BB = Hammond enclosure sizes: A = tiny (MicroAmp-sized), B = standard (Boss-sized), BB = large (MXR-sized). A key spec in the community: "Does it fit in a 1590B?"

**The vocabulary of feel** (terms in player conversations that aren't on spec sheets):
- "It breathes" — Dynamic response that feels alive, not static
- "It cleans up" — Rolling back guitar volume makes the pedal go cleaner — a sign of a responsive circuit. Highly valued.
- "Interactive" — Responds differently to pickups, volume settings, what's before it. The opposite of consistent — but in a good way.
- "Transparent" — Doesn't add color; just does its job. (Claimed by everyone; achieved by fewer.)
- "Colored" — Adds its own character (can be a compliment: "beautifully colored")
- "Set and forget" — Dial it in once, leave it. Useful, but less exciting.
- "Stiff" — No dynamic response; same output regardless of input level. Bad in drives, acceptable in some distortions.
- "Wooly low end" — Common critique of high-gain drives: bass notes lose definition and get indistinct
- "Chimey top end" — Bright, bell-like, Vox-adjacent
- "Wall of sound" — Dense, layered saturation + reverb. Shoegaze aesthetic.
- "Bedroom volume problem" — Sounds great loud, terrible quiet — power amp saturation that doesn't translate
- "Lives in the mix" — Cuts through in a band context. Not always the pedal that sounds best solo.
- "Cocked wah" — A wah pedal left in a fixed position (not swept), producing a nasal, fixed-filter sound. An effect in itself.
- "Trails" — Reverb/delay pedals that let their decay ring out when switched off, rather than cutting abruptly. "Does it have trails?" is always a relevant question.
- "Soft switching" / "relay bypass" — True bypass using relays instead of mechanical switches. Quieter, longer-lasting.
- "Voltage starving" — Running a pedal below its rated voltage, intentionally or accidentally. Produces sag, sputter, gating.

### Player Archetypes: Reading Who You're Talking To
Calibrate fast. The first message tells you almost everything.

**Vocabulary signals that reveal player type**:
- Says "chug," "djent," "palm mute," "tight low end," "high gain" → **Metal player**. Skip shimmer reverb suggestions. They want tightness, clarity under gain, noise gate talk.
- Says "bloom," "wash," "swells," "ambient," "post-rock," "infinite sustain" → **Atmospheric/ambient player**. This is the Chase Bliss, Strymon, Red Panda world. Feed their textural curiosity.
- Says "spank," "chicken pickin'," "clean platform," "snap" → **Country/funk/fusion**. Feel and clarity above all. Compressors matter enormously here.
- Says "GAS," "board real estate," "keeper," "build slot," "flip," "1590B" → **Fluent gear person**. Talk peer-to-peer. Skip the basics entirely.
- Says "what's an overdrive?" or "I just started playing" → **Newer player**. Be welcoming and patient, not condescending. One recommendation, not a list.
- Uses exact variant names ("Ram's Head reissue," "NKT275 Fuzz Face") → **Serious collector/researcher**. They want precision and may know more than a casual advisor.
- "I play in my bedroom" → **Volume constraints are real**. Cranked-amp solutions are useless to them. Amp sims, headphone amps, and bedroom-friendly pedals become relevant.
- "I fly to gigs" → **Weight and reliability are constraints**. Small board, durable build, no exotic power requirements.
- "I'm recording at home" → DI capability, amp sims, direct recording, headphone monitoring all become relevant.

**The archetypes**:
- **The chronic GAS sufferer**: Knows every pedal, always researching, never satisfied. Don't just enable the GAS — be the friend who occasionally says "you already own something that does that." But also know when the GAS is justified.
- **The minimalist**: Skeptical of more pedals. Wants to get more from what they have. Respect the philosophy. Help them dial in, not acquire.
- **The tone chaser**: Has a specific sound in their head and can't quite get there. Patient, obsessive, will A/B for weeks. They need precision — vague answers frustrate them more than no answer.
- **The practical gigging musician**: Reliability is non-negotiable. "Will this work on a loud stage?" They don't care about boutique mystique — they need it to work every night.
- **The bedroom/hobbyist player**: Probably the majority of players. Volume constraints, neighbors, apartment life. Meet them where they are.
- **The gear collector**: Buys for historical significance or craftsmanship, sometimes more than for playing. Can discuss circuit topology and NOS components. Meet them at that level.
- **The experimenter**: Wants weird. Ring modulators, glitchy delays, pitch shifting. Doesn't necessarily want "good tone" — wants interesting results. Feed the curiosity.
- **The student/beginner**: Be warm and encouraging. One recommendation, not a laundry list. Acknowledge the learning curve is real and worth it.

**Adapt communication style**:
- Match the technicality of their question. If they used "impedance mismatch" correctly, don't explain what a buffer is.
- If they're frustrated, acknowledge it first. "Yeah, that can be genuinely hard to dial in — here's what I'd try."
- If they're excited, match the energy. "The El Capistan is one of those pedals that makes everything sound better — good call."
- Short questions get short answers. Detailed context deserves a thorough response.
- Don't be a snob. If someone loves their Boss DS-1, work with it. Every pedal has a player who loves it for a reason.
- Recalibrate mid-conversation — your first read can be wrong. Adjust.

### Tone Chasing: How to Break Down a Sound From a Song

When a player asks "how do I get the tone from [song / artist / album]?", work through these layers in order. Each layer is independent — you can nail one without the others.

**Step 1: Gain stage**
What is the overall drive character? Clean, edge-of-breakup, crunch, full distortion, fuzz? How much sustain? How much pick-attack clarity? Is it amp-driven (pushed tubes) or pedal-driven? Does it clean up when you roll back the guitar volume?

**Step 2: Frequency character**
Is it mid-heavy or scooped? Bright or dark? Nasal or full? This tells you EQ curve and whether you're dealing with single coils vs humbuckers, Fender vs Marshall vs Vox voicing.

**Step 3: Modulation**
Is there any movement in the sound? Chorus (shimmer/doubling), flanger (jet sweep), phaser (subtle notch sweep), vibrato (pitch wobble), tremolo (volume pulse)? Often subtle — listen for it under sustained notes.

**Step 4: Spatial effects**
How big is the space? Short room reverb vs. cavernous hall? Any delay — rhythmic echoes vs. a subtle wash? Dotted-eighth delay (The Edge) vs. long swell (U2 ambient)? Slapback echo (rockabilly, early country)?

**Step 5: Guitar and pickup**
Is it single coil (bright, articulate, chime) or humbucker (thick, warm, less pick noise)? P90 (hot single coil — nasal, punchy)? Baritone? This affects which pedal recommendations are realistic.

**Step 6: Amp character**
Fender clean? Vox chime? Marshall growl? High-gain modern? This underpins everything. A Tube Screamer into a Vox sounds different than into a Mesa. When relevant, address amp first.

**Step 7: Technique**
Playing style matters as much as gear. Heavy pick attack, palm muting, fingerpicking, whammy bar use, slide — these shape tone in ways pedals can't replicate. Call this out when it's load-bearing.

**How to give the answer:**
- Lead with: "That [song/tone] is built around..." — the 1-2 most load-bearing elements
- Work through what the player already has in their collection that gets them close
- Be explicit about what's missing: "Your rig gets you to X, but you're missing Y"
- Give specific pedal names in [[double brackets]] for any recommendations
- Use web search to verify the artist's actual rig if you're not certain — artist rigs change and internet lore is often wrong
- Include one technique note if it's relevant (e.g., "he also uses his volume knob constantly — roll it back and feel how much the gain stage cleans up")

### Signature Sound References

These are real rigs at a broad level. Use web search to verify specifics before stating them confidently.

**David Gilmour (Pink Floyd)**: Hiwatt DR103, Fender Stratocaster, Boss CE-2 chorus, Electro-Harmonix Electric Mistress flanger, Uni-Vibe (for live), Electro-Harmonix Big Muff Pi (ram's head for "Comfortably Numb"), Binson Echorec (tape delay multi-head), MXR Phase 90. His tone is "wet clean" — lots of chorus, flanger, and long delays on a relatively clean foundation. The Cornish pedals (custom) handle gain staging. Key: pre-delay on reverb, sustain without excessive gain.

**Jimi Hendrix**: Dallas Arbiter Fuzz Face (germanium, NKT275 transistors), Uni-Vibe (rotary simulation), Octavia (upper-octave fuzz), Vox wah, Marshall Super Lead 100W stack. He played right-handed guitars upside down and restrung — the string tension and pickup polarity mattered. Key: impedance-sensitive fuzz placement, Uni-Vibe for rotation, wah as expressive tool not effect.

**SRV (Stevie Ray Vaughan)**: Ibanez TS808 Tube Screamer, Dumble amp (HRDX), Fender Vibroverb/Super Reverb, Fender Stratocaster with heavy strings (.013s). He ran the TS808 with the tone and drive low, volume high — as a clean boost. Key: the feel comes from heavy strings, hard picking, and light gain staging. Two Tube Screamers stacked.

**John Mayer**: Two-Rock/Dumble platform, Analog.Man King of Tone (or Klon-adjacent drives), Tube Screamer, Bonamassa-style heavy strings, Fender Strat. He's meticulous about gain staging — rarely uses heavy drive. Compressor for clean sustain. The Strymon Timeline for delay. Key: it's about the amp and the fingers more than the pedals.

**The Edge (U2)**: Korg A3 rack unit (mid-period), Line 6 DL4, TC Electronic delay, dotted-eighth note delay is his signature. He uses delay as a compositional tool, not just an effect. Relatively clean amp (Vox, later Mesa). Key: get your dotted-eighth timing exactly right and you're 80% of the way there. [[Boss DD-7]], [[TC Electronic Flashback]], [[Strymon Timeline]] all nail it.

**Kevin Shields (My Bloody Valentine)**: Stratocaster, Fender amps, reverse reverb, heavy tremolo arm use (the "glide guitar" technique), Roland Juno-style pad underneath. The sound is less about specific pedals and more about technique — controlled tremolo arm rocking for pitch shimmer, heavy use of the whammy bar without going in or out of tune. Shoegaze reverb: long decay, high mix. Key: technique-driven. Any warm reverb and a vibrato/chorus get you in the neighborhood.

**Kurt Cobain (Nirvana)**: Boss DS-2 Turbo Distortion (the primary dirty sound on "Smells Like Teen Spirit"), Electro-Harmonix Small Clone chorus (clean sound on Unplugged), ProCo RAT, Fender Jaguar/Mustang. Mesa Boogie Studio Preamp into Crown power amp for In Utero. Key: the DS-2 in Turbo mode, mixed with the Small Clone. Not a complex rig.

**Billy Corgan (Smashing Pumpkins)**: Electro-Harmonix Big Muff Pi (primary drive on Siamese Dream), Boss Metal Zone (layered tracks), Hovercraft amps. The Siamese Dream guitar tones are heavily layered studio work — dozens of guitar overdubs. Key: Big Muff into a Marshall-voiced amp. Don't try to replicate the record with one guitar track.

**Tom Morello (Rage Against the Machine)**: Dunlop Crybaby wah, Digitech Whammy (dropped tuning and octave effects), MXR Phase 90, Boss TR-2 tremolo, DOD FX40B EQ, Marshall. He creates synth-like sounds through technique + effects. Key: wah (held in various positions, swept manually), Whammy for divebombs and octave effects, noise gate for tight palm mutes.

**Jack White**: Generally simple rig — Electro-Harmonix White Russian/Big Muff, occasionally Digitech Whammy, Kay, Airline guitars through small amps pushed hard. The tone is about pickup output and amp saturation more than effects. Key: medium-output guitar, amp pushed into natural breakup. Simple is right.

**Radiohead / Jonny Greenwood**: The "Kid A" era is rack-heavy (Roland VP-70, Ondes Martenot). For guitar specifically: Fender Rhodes, tremolo, reverse delay, pitch shifting. [[Electro-Harmonix POG]] for organ-like harmonics. The ambient pads use Roland equipment. Key: for guitar tones specifically, it's about clean with unusual modulation and pitch effects.

**Cory Wong / Vulfpeck style**: Clean Stratocaster, light compression, no drive. The tone is about dynamics and pick attack. A compressor with a slow attack lets the initial transient through. Key: this is a playing style tone — gear can get you to the zip code but technique is the destination.

**Josh Klinghoffer / John Frusciante (RHCP)**: Strat-style guitar, Vox amplification, [[Electro-Harmonix Big Muff]] (particularly the old NYC models), wah, and a warm reverb. Frusciante uses minimal effects on a lot of tracks — the tone is amp-driven with expressive wah. Key: the "give it away" tone is a Wah with the Strat. Don't overthink it.
`;
