-- Load the real Chase Bliss Big Time manual into manual_text.
-- Extracted from the official PDF (chasebliss.com, 26 pages) on 2026-07-16.
-- Replaces the tone-description placeholder (which also lives in tone_dna)
-- so TPC.ai can answer controls/toggles/settings questions authoritatively.
UPDATE pedals
SET manual_text = $manual$CBA+EAE ref 2026 - BT001
Big Time
Table of Contents
2
4
6
8
10
12
18 
20
22
24
26
30
32
34
36
38
40
42
44
46
Foreword
Overview 
Setup 
Getting Started 
Big Time 101
Controls
Alt Controls
Presets
Factory Presets
Color and Preamp
Modes
Time and Scales
Motion
State and Limiter
Cluster
Voicing and Tilt EQ
Options Menu
External Control 
Signal Flow
Bye 
Power req: 9V DC Center Negative ~ 1A
Foreword
02 03
Big Time is a strange entanglement of analog and digital circuit blocks. 
I don’t think it could have come from either of us on our own.
The story begins in 2019. I met Knobs and we talked about digital delays 
— specifically the older ones that are a bit strange around the edges.
The thesis goes like this: 
Until fairly recently, every medium that could hold onto a bit of audio 
had some limitation. Overcoming these limitations required techniques 
which in turn imparted their own character. More than the delay 
element itself, the sounds are shaped by how filtering, compression, and 
carefully tailored preamps evolve feedback loops over time.
Some time later, I helped Joel and co with an esoteric, last-minute 
circuit problem. He’s a very nice fella, so we kept in touch. Not long 
after that, my good friend Charlie joined Chase Bliss as an engineer. 
Collaboration started to feel inevitable.
Project ideas were kicked around casually at first, then as a series of 
increasingly ambitious What Ifs until Joel threw down the gauntlet by 
giving Charlie and me virtually endless creative freedom.
While making Big Time, we broke some rules. We took the long way 
around to see what new things would emerge in the process. Drawing 
from my previous work, I contributed saturation techniques that we 
wove in tightly with digitally-enhanced control. The processor in Big 
Time delays and diffuses audio while also dynamically adjusting the 
surrounding analog circuitry in response to that same audio. Where the 
digital brain and analog heart were previously detached, there’s now a 
strange loop of causality. The outcome is something more expansive 
and ambitious than any EAE pedal, and more wild and dangerous than 
any Chase Bliss pedal.
Big Time is very hard to explain, but very easy to get lost in. You’ll see 
what I mean. Thanks for being along for the ride.
 
-John Snyder
  founder of Electronic Audio Experiments
Overview
Welcome to your absolute whopper of a new pedal. 
A handful of highly coveted and mythical echoes emerged from this 
era, and what makes them so special is that they did everything the 
hard way. Digital technology was in its infancy and – while it made all 
kinds of new and very fun things possible – it was also kinda bad. It 
needed help. So analog circuitry made up the difference – instead of 
digital or analog, you got both.  
Big Time arduously replicates the circuit design found in these early 
delays, but leans alllll the way into the hybrid possibilities, taking the 
digital/analog teamwork beyond a practical necessity and testing 
how far it can go.
It has two separate sources of analog coloration: an analog preamp at 
the front of the circuit, and a clipping limiter within the feedback loop. 
In our opinion, it’s the best of everything:
           The anything-is-possible of digital
           The everything-sounds-good of analog
04
Big Time is our foolish return
     to doing things the hard way ,
        so that you can sound very good,
           and do whatever you want. 
Big Time is an exploration of the 
mixed-up circuitry found in
rackmount delays from the early 8 0s.
 
Big Time can be used in mono, stereo, or mono to stereo, with either 
balanced or unbalanced signals (pg. 40).
INPUT L/MONO
INPUT R
OUTPUT L
OUTPUT R
Setup
06 07
Let’s get connected. 
POWER
Big Time requires big power. 
                   It needs 9V DC, center negative power with 1A of current.
                   Voltage higher than 9V risks damaging your pedal.
We recommend using one of the two included power solutions:
A simple high-amperage center negative 9 volt power brick – just plug it in. 
A current-doubling merger cable so you can use Big Time with your 
existing power supply. Plug the single end into Big Time and each of the 
Y-plugs into a 500mA output on your power supply. 
Okay , time to go. 
MONO
Use the IN L / MONO input, and OUT L output. 
STEREO
Use all four inputs and outputs.
MISO (Mono In, Stereo Out)
Use the IN L / MONO input, and both outputs (MISO will engage 
automatically). 
Big Time is a true stereo device. You have three options for how stereo 
processing works, configured  by SPREAD (pg. 19).
OPTIONS
Big Time has a number of ways to customize your experience for 
different setups and creative preferences. It ships in a nice “default” 
state, but you can skip ahead to the Options Menu (pg. 40) if you need 
to go a little deeper. 
500mA
500mA
500mA
TO 
BIG
TIME
08
Turn up CLUSTER to introduce additional 
taps and spread out.
Switch over to the %&#$ state to engage 
the limiter and misbias the repeats. 
Max out COLOR to drive the preamp and 
saturate your instrument. 
Max out FEEDBACK to make it last forever.
Getting Started
Welcome to the Big Time.
When you first power up Big Time it will load preset 0. You will see this. 
A nice starting point for some good ol’ delay. 
Each of Big Time’s presets explores a different part of its personality, 
and wandering through them is a good way to get a sampling of what’s 
possible, and how to do it. 
But let's stay here and start to explore.
You should now have a big, sizzling wash of slow-moving 
atmosphere that reacts to your playing.  
Let’s talk about why that happened.
09
Big Time 101
Big Time replicates the hybrid signal flow of rackmount delays from the 
early 80s, where analog circuitry was used to make up for the short-
comings of crude digital systems. 
It includes both an analog preamp at the input stage, 
and an analog limiter within the delay’s feedback loop. 
It’s all about loudness, which is controlled by three interconnected faders:
PREAMP OUTPUTDELAY
Boosts your instrument 
going into the pedal
Sets whether echoes 
will get quieter or 
louder over time
Sets the final output 
volume of the pedal 
With each repeat, your digital echoes take on a bit more analog 
character as they collide with the limiter. How this sounds – and what 
the limiter is set to do – depends on the STATE button. 
It’s all interconnected, and the preamp will also impart its own saturation 
at the input stage when COLOR is turned up. The result is a big, swirling, 
ever-changing mass of saturated space.
Consider this a starting point as you explore the pedal and this guide: 
If ever you are getting too much or not enough, adjust the gain and Big 
Time will spark to life (or settle down). 
Listen to the difference between FEEDBACK halfway up, 
and then at max. If FEEDBACK is too high the echoes will 
crash violently into the limiter and become immediately 
distorted; too low and they won’t come into contact with 
the limiter at all. FEEDBACK not only controls the number 
of repeats, but also how they change over time. 
Now start to adjust COLOR and notice how this changes 
the balance. If FEEDBACK is higher than COLOR your 
echoes will grow over time and overpower the input – 
useful for big, evolving drones – but if COLOR is higher 
you can overwhelm even the wildest oscillations with 
your playing. 
Try this out to start 
putting these ideas to 
use and exploring the 
ways FEEDBACK and 
COLOR interact.
FEEDBACK
COLOR
1110
LIMITER
What makes Big Time unique is 
the limiter. It lives inside of Big 
Time’s delay line, and it waits for 
something to get loud. When 
COLOR or FEEDBACK (or both) are 
turned up, your signal will begin 
to bump into it. The higher the gain, the more 
influence the limiter will have. 
COLOR FEEDBACK WET
Controls - Faders 
F
E
D
A
B
C
12
COLOR
Controls the gain of the preamp. As COLOR is turned up, two 
things will happen:
 1.  The preamp will start to saturate.
 2.  The limiter’s effects will intensify (instantly). 
TIME
Adjusts the delay time. TIME is a clock control that interacts with 
both MODE and SCALE. MODE sets the overall range, and SCALE 
decides whether the time changes smoothly or in musical steps. 
TIME will snap to the middle position when tap tempo is used or 
a loop is deleted. This lets you speed up or slow down by equal 
amounts, and find the original speed easily.
CLUSTER
Gradually blends in additional delay taps and diffusion. 
TILT EQ
Splits the frequency spectrum in half and lets you cut either 
side: push up to cut lows, bring down to cut highs. Use the 
CROSSOVER alt control to set the middle point. At noon the TILT 
EQ will have no effect. 
FEEDBACK
Controls the gain of the feedback loop. As FEEDBACK is turned 
up, two things will happen:
 1.  You will get more repeats.
 2.  The limiter’s effects will intensify (over time).
WET
Sets the output loudness of the effect.
COLOR TIME CLUSTER TILT EQ FEEDBACK WET
A
B
C
D
E
F
13
Controls - Buttons
14
A B C D E
SCALE
Sets how both TIME and MOTION respond – either smoothly or in 
tuned steps. 
MOTION can be set to ignore SCALE in the Options Menu (pg. 41).
MOTION
Turns on modulation and selects the type. The movement can be 
adjusted using the DEPTH and RATE alt controls. To automatically 
reset the movement to a nice starting point, hold MOTION for 
two seconds. 
MODE
Selects the range of the delay and behavior of the footswitches.
You can also use MODE to quickly clear your settings and start 
fresh. Hold MODE for two seconds to reset to a simple delay.
VOICING
Selects the core tone of the device. VOICING is independent of 
the TILT EQ and instead cycles through different fixed filter 
arrangements to give Big Time its base character. 
STATE
Sets the role of the limiter, and as a result the overall sound and 
response of Big Time. Each state has its own unique parameter 
adjusted by the TEXTURE alt control.
SCALE MOTION MODE VOICING STATE
A
B
C
D
E
15
TAP RIGHT
HOLD RIGHT
 
 
TAP LEFT
 
 
 
 
 
 
HOLD LEFT
 
BYPASS - Turns the effect on/off. 
STOP – Stops and resets the loop. 
A second tap will resume playback.
 
HOLD – Loops and preserves the current sound infinitely. 
You can play overtop without being recorded. 
DELETE – Erases the current loop.
OVERLOAD – Ramps both COLOR and FEEDBACK up to the 
max (beware volume levels!).
 
TAP TEMPO – Tap twice to manually set the delay time 
and range.
RECORD/PLAY – Controls recording and playback of 
loops; alternates between overdub and playback once 
a loop is recorded. 
MOTION TOGGLE - Turns the selected MOTION mode on/off.
 
     PRESETS – Enters/exits the preset menu. 
Controls - Footswitches
16
TEMPO BYPASS
AB
The behavior of Big Time’s footswitches varies by MODE. 
A
TAP
A
HOLD
B
TAP
B
HOLD
17
Tap tempo is like a variant of the SHORT/LONG delay modes with its 
own unique range. The TIME fader will snap to the center position when 
tap tempo is used so you can adjust the speed freely and easily return 
to the tapped tempo. You will also notice the MODE button go dim – 
press it to turn tap tempo off. 
PLAY/DUB
In Loop Mode, decides what Big Time will do once you’ve recorded the initial loop.
       Go into playback.
       Go straight to overdubbing.
A
B
C
Alt Controls 
B
A
ALT CONTROLS - BUTTONS
C ALT CONTROLS - FOOTSWITCH
SHIFT
Hold to enter the Alt Menu. 
SPREAD
Engages stereo processing. 
       Offsets both CLUSTER and MOTION for subtle widening. 
       Engages ping-pong delay for wide, panning echoes. 
0.5X
Lowers the bit depth from 32 to 12 and cuts the sample rate in half, replicating 
the digital sound quality of early 80s rackmount delays. 
DIFFUSE TYPE
Doubles the strength of the DIFFUSE alt control. 
+12dB
Bumps up the preamp gain, useful for quieter input signals or if you want more 
blown-out effects. 
ALT CONTROLS - FADERS
TEXTURE
Controls a unique characteristic for each STATE. 
RATE
Sets the speed of MOTION. When ENV or STEP is selected, RATE will control the 
GLIDE time. 
DEPTH
Sets the range of MOTION. When a scale is selected DEPTH selects the harmonic 
interval. 
CROSSOVER
Selects where the frequency spectrum is split on the TILT EQ.
DIFFUSE
Gradually introduces diffusion, causing echoes to smear and dissolve.
DRY
Sets the output loudness of the dry signal. 
TEXTURE RATE DEPTH CROSSOVER DIFFUSE DRY
SHIFT
PLAY/DUB
SPREAD 0.5X DIFFUSE
TYPE
+12dB
1918
Hold the SHIFT button to access the Alt Menu. The faders will jump to 
their alt settings. 
The display will blink "A " to indicate that you are in the Alt Menu.
Presets
Big Time lets you store and recall ten internal presets.
To access the Preset Menu, hold the left footswitch. The LED will turn 
green to let you know you’re there. 
HOLD
You can access the Preset Menu in all of Big Time's modes via the same 
footswitch gesture. Try using it as a performance tool to warp between 
different settings. 
SAVE TO - If you want to save your current settings to a different slot, hold 
the SHIFT button and then scroll to your preferred slot. With SHIFT held 
down you can scroll freely without auto-loading the other presets. 
Release shift and hold the right footswitch as usual to save.
TAP TAP
SCROLL
TO NEXT
PRESET
SCROLL TO 
PREVIOUS
PRESET
HOLD HOLD
SAVE TO
PRESET
SLOT
EXIT
PRESET
MENU
Big Time will automatically and instantly load your presets as you 
scroll through the various slots.
This is how you get around:
OPEN
PRESET
MENU
2120
PRESET NUMBER WILL FLASH WHEN SAVED,
AND BIG TIME WILL EXIT THE PRESET MENU.
You can also use MIDI to save up to 127 presets.
Factory Presets
0. NICE DELAY
A good ol’ echo with a bit of modulation, long trails, and the 
preamp set on the edge of breakup. 
Use this as a starter for making simple delays. 
1. COMPRESSED CHORUS
Smooth modulation with a dreamy character, compressed to 
bring out the details.
Use this as a starter for making classic modulation. 
2. SLAP/DOUBLE
A big, burly expander with two stages of clipping and room-like 
ambience. 
Use this as a starter for doubling and almost-real-time textures.
3. SAGGING ECHOES
Immersive echoes with long, compressed trails that react to your 
playing. 
Use this as a starter for dynamic delays. 
4. BOUNCY THERMAE
An upbeat echo sequencer reminiscent of an old friend. 
Use this as a starter for exploring sequencing.
5. BROKEN DYNAFLANGE
A starved flanger that fills the gaps between your notes with 
dynamic oscillations that react to your instrument’s loudness. 
Use this as a starter for making unorthodox modulation. 
6. CLUSTER$%&!
A misbiased wash of swirling clusters – start with sparse playing 
and see where it takes you. 
Use this as a starter for exploring strange ambience.
7. CRUSHED ANALOG
A murky, modulated, and saturated delay. 
Use this as a starter for making vintage echoes. 
8. NOSTALGIC REPEATER
A cozy looping delay that crumbles and quivers, with no
dry signal. 
Use this as a starter for malfunctioning echoes and
Frippertronics looping.
9. LOOP DIFFUSER 
A slowly dissolving delay with infinite feedback – play a few 
notes, sit back, and see what happens. 
Use this as a starter for musical drones and slow-building 
atmosphere.
You can return to the factory preset for any slot by holding the MOTION and VOICING buttons 
while in the Preset Menu. This will work even if you’ve already saved over the preset.
2322
Color and Preamp
The first stage of Big Time is a stereo, analog preamp. 
Both the wet and dry signals are amplified by default, but the dry 
signal can bypass the preamp if you prefer (pg. 41). 
The COLOR fader does two important things at the same time:
       1. It overdrives the input signal 
       2. It sets the input gain to the delay line
COLOR
+12db
Let's talk about why the input gain to the delay matters. 
COLOR sets the loudness of the signal before it enters the delay line, 
FEEDBACK sets the loudness of the signal within the delay line. You can 
get a whole bunch of different results depending on how you balance 
these forces. 
If COLOR starts high, your echoes will bonk into the limiter immediately. 
The loudness of your first echo and the “maximum loudness” are 
similar, because the signal was boosted at the start.
But if COLOR is low – and FEEDBACK is high – your echoes will instead 
gradually climb towards that point. With each repeat things get a bit 
louder, until eventually the echoes encounter the limiter and begin to 
transform and settle into a “maximum loudness.” 
The second scenario above can be great because it’s where you find the 
most change over time – echoes that slowly saturate, oscillate, and 
crumble. It can also be real loud and scary if you’re not expecting it. 
There’s a huge gap between the input loudness, and the point where 
the limiter wrangles the echoes. 
Be mindful of this as you set the WET level, and enjoy the ride. 
The gain of the preamp is set by the 
COLOR fader.
And there’s a 12dB+ boost in the
alt controls if you need to go further. 
PREAMP MODE - To isolate the preamp and use it on its own, without 
any echoes or spatial effects, simply turn the WET slider all the way 
down. You have a stereo, analog preamp now. Note that only the 
COLOR, DRY, and +12db controls will do anything in this state.
COLOR
FEEDBACK
PREAMP LIMITER
PREAMP
LIMITER
COLOR
FEEDBACK
2524
This is where you decide what you want to do.
The MODE button sets both the range of the delay and the role of the 
footswitches, priming Big Time for different possibilities. 
MOD (3 – 46 ms)
Mod gives you fine control over a narrow range of very short delay 
times. It’s useful for creating modulation, resonators, and doubling 
effects.
Footswitch gestures:
SHORT + LONG
Both of these modes share the same footswitch gestures, the only 
difference is the range of their delay times. 
SHORT (46 – 736 ms)
This is where you’ll find what you typically expect from a delay pedal, 
a nice balanced range of delay times for everything from slapback to 
multi-tap. 
  
Max out TIME to underclock Big Time and introduce just a touch of 
crispy aliasing.
LONG (736ms – 12.2 s)
Long is a playground for ambience and composition, useful for 
slow-building performances and atmosphere.
Turn up DIFFUSION and CLUSTER to explore some long-form ambient 
haze (changing STATE to Saturated won’t hurt either).
Footswitch gestures:
Modes
Load up Preset 1 to get some nice starter settings for creating      
modulation on Big Time. 
TAP LEFT
Tapping the left 
footswitch in Mod 
toggles your selected 
MOTION on/off, 
useful for turning the 
movement into a 
performative effect.
HOLD RIGHT
Ramps both COLOR 
and FEEDBACK up to 
the max (beware 
volume levels!).
TAP LEFT
Tap twice to manually set 
the delay time. The TIME 
knob will snap to the center 
position so you can speed 
up or slow down, and easily 
return to the tapped 
tempo. Press MODE to turn 
tap tempo off.
HOLD RIGHT
Loops and preserves 
the current sound 
infinitely. You can 
play overtop without 
being recorded. 
Turn on MOTION Crank FEEDBACK
Set TIME very lowTurn up CLUSTER
2726
Footswitch gestures:
LOOP (VARIABLE LENGTH)
Loop mode turns Big Time into a phrase looper with a distinct set of 
footswitch gestures. All of the buttons and faders otherwise work the 
same, the only difference is that you can use the footswitches to 
decide how and when sound is recorded. 
Big Time will automatically carry over the audio from Long mode when 
you first enter Loop mode, so that you can turn your echoes into loops 
and move freely between modes without suddenly encountering silence.
To ensure the loop doesn’t degrade or change while in playback, Big 
Time switches over to digital feedback behind the scenes. This means 
changing STATE or adjusting TEXTURE will not be heard until you start 
overdubbing again.
TAP LEFT
Tap once to start 
recording, and again to 
begin looping. Once 
looping, tap to alternate 
between overdub and 
playback; from stopped, 
tap to resume playback.
TAP RIGHT
Stops and resets
the loop. A second tap 
resumes playback.
HOLD RIGHT
Deletes your loop
and starts fresh. 
When overdubbing, all of the pedal’s controls are 
active and will influence the loop – if CLUSTER is turned 
up, your loops will gradually scatter; if FEEDBACK is 
turned down, your loops will fade away. 
When in playback, the loop will be “frozen” and will not 
change or deteriorate, regardless of how you change 
the controls – you will still hear the influence of these 
changes, but they won’t be recorded. 
2928
FIRST PRESS SECOND PRESS
HOLD
BYPASS
So let’s start by clearing that out.
Hold the right footswitch to delete 
the loop and start fresh.  
Tap the left footswitch once to start recording, and a second time to 
set the end point.
At this point your recording will start looping. Now, tap the left 
footswitch to alternate between overdubbing and playback. 
For stable, “traditional” looping use the Digital state. Every other state 
is designed to change and disintegrate over time.
When first recording a loop, Big Time can either go into playback 
(default) or directly into overdubbing. Set this up in the Alt Menu (pg. 19).
Max loop length will vary depending on the position of the TIME fader. 
After clearing a loop TIME will snap to the middle position, which gives 
you 48 seconds of loop time at roughly 44kHz. You can push the fader 
up to lower the resolution and record longer loops (a max of 3.2 
minutes at roughly 11kHz) or lower it to increase the resolution at the 
expense of loop length (a max length of 12 seconds at roughly 172kHz 
with TIME at minimum).
But once a scale is selected we get something a little different. Now, 
TIME moves in steps that are tuned to precise musical intervals – any 
audio in the feedback loop will be sped up or slowed down just right to 
create harmonized pitch-shifting. 
TIME is a clock control. 
It adjusts the delay time of your echoes, but also lets you tap into 
some interesting abilities when combined with SCALE. 
To understand the relationship between MODE and TIME, think of a 
tape loop: 
        MODE sets the length of the tape.
        TIME sets the speed of the motor.
Time and Scales
This is how the scales break down:
You can use the scales to transpose your loops, subdivide tap tempo, 
and create bursts of pitch-shifting.
Or pair them with MOTION to create sequences. 
MODESPEED
TIME
TIME works just like any other delay when SCALE is off. It 
smoothly adjusts the playback speed, changing the 
delay time and detuning your echoes. 
SCALE
CHROMATIC OCT+4+5 OCTAVE
3130
Moves in half steps to
give you access to the full 
spectrum of possibilities. 
This means it can be 
dissonant, but useful for 
sound effects and precise 
transposition. 
Sits in the middle, moving 
between selected intervals 
that are generally 
harmonious but can 
introduce a bit of tension 
as well, giving you 
movement similar to a 
chord progression. 
Moves in big jumps that let 
you instantly double or half 
the delay time. Simple, 
quick, and always musical.

Motion
Movement can play a variety of roles within Big Time. 
You can build classic modulation from scratch,
           o r dynamically warp your echoes, 
                                        or create melodic se quences.
When SCALE is on, the movement will jump between 
harmonically-related delay times to create pitch-shifting.
TIME sets the starting delay time and DEPTH sets the 
shifted delay time. Big Time will then move back and 
forth between those spots. 
SCALE
Use the MOTION button to turn it on and select the 
movement type. 
The behavior of the movement is interactive with the 
SCALE setting.
When SCALE is off you will get classic, bendy pitch 
modulation, useful for creating chorusing, flanging, 
and tape-style warble.
MOTION
SCALE
We designed MOTION to be quick and easy, so you don’t have to spend 
all of your time in the Alt Menu. You can reset it to a nice, pleasing 
“default sound” at any time by simply holding the MOTION button for 
two seconds.
Use DEPTH to set the range. 
Use RATE to set the speed. 
SINE - Smooth, classic modulation
SQUARE - Choppy, atonal modulati on
ENV - Envelope-controlled time bends
Env is a bit unique. Instead of constantly responding to your signal, it 
instead waits for a transient or a distinct note, then moves the 
sequence forward. You can think of it like a version of Step (pg. 41) that 
is controlled by your playing.  
The envelope detection follows both the input and 
delay line. Turning up COLOR and/or FEEDBACK will 
make the envelope more sensitive, because the 
envelope also responds to your echoes.  
SINE - Step sequencing with adj ustable glide.
 RATE - Glide time
SQUARE - Step sequencing with adjustable rate.
 RATE - Sequence speed
ENV - Envelope-controlled step s equencing.
 RATE - Glide time
MOTION can be set to ignore the selected scale if you prefer (pg. 41). 
This makes it possible to use scales on the TIME fader while retaining 
classic, smooth modulation.
FEEDBACK
 COLOR
3332
We covered the basics of Big Time’s limiter back in 101 (pg. 10), so now 
let’s talk about all the things it can do.
A quick refresher:
Big Time’s limiter is inside of the delay line – each time an echo 
repeats it passes by the limiter, and if it’s loud enough it will collide 
with it. The higher FEEDBACK and COLOR are set, the more impactful 
the collision and the more intense the effect. 
You have four different states to choose from, and each one accesses 
a different part of the limiter’s abilities. The TEXTURE alt control is how 
you adjust the character of each state. 
State and Limiter
DIGITAL   -   No limiter.
The Digital state removes the limiter from the circuit and 
uses a completely digital feedback path,  useful when you 
want cleaner textures and stable, steady feedback (when 
looping, for example).
TEXTURE introduces aliasing and lowers the bit depth.
COMPRESSED   -   Clean compression and sag. 
The Compressed state is useful for echoes that change 
over time and react dynamically, while always remaining 
clean. Create snappy repeats with extra punch, or glitchy 
modulation that sags and falters, or endless trails that 
duck out of the way when you play. 
TEXTURE sets the amount of compression, from a subtle 
squeeze to ducking sag. 
SATURATED   -   Distortion and deterioration. 
You can think of Saturated as Big Time’s default state. 
These were the sounds that started us on this journey: 
echoes that slowly disintegrate and expand into a big 
harmonic mass. Use it for colorful degradation, churning 
oscillation, and cutting ambience.
TEXTURE controls the symmetry of the clipping, becoming 
more ragged as it’s turned up. 
#!&%   -   Starving and mangling. 
The &!$# state sabotages and misbiases the limiter to see 
what it can do wrong. It has a raw, electric character that’s 
useful for broken and obliterated sounds, lively sound-
scapes, and textural sound design. 
TEXTURE sets the sensitivity of the misbiasing.
TEXTURE
COLOR
COLOR WET
(OUTPUT)
DELAY
(THE LIMITER IS IN HERE)(PREAMP)
Boosts your instrument 
going into the pedal
Sets whether echoes 
will get quieter or
louder over time
Sets the final output 
volume of the pedal 
FEEDBACK
3534
Cluster
The CLUSTER fader gradually blends in additional delay taps that are 
subtly modulated. The function of these clusters and how they sound is 
a little different in each mode.  
SYNCED MULTITAP
The first 25% of the journey fades in one additional 
echo (two in stereo) that’s synced to the delay 
time. This range of the sweep is useful for rhythmic 
multi-tap patterns and widening.
DRIFTING DIFFUSION
The final 25% of the sweep introduces a layer of 
modulated diffusion on top of the echo clusters. 
This range is useful for more immediate and 
hazy ambience. 
SCATTERED AMBIENCE
The middle of the sweep fades in a second echo, 
and then a third (for a total of six in stereo),      
that are disconnected from the delay time.     
Turn up FEEDBACK while in this range to replicate 
the behavior of early reverb units that would 
create ambience by recirculating echoes until 
they dissolved.
CLUSTER is also one of the ways Big Time generates a stereo image. 
Bump it up if your stereo field is feeling a little narrow (see pg. 19 for 
more on SPREAD). 
CLUSTER
CLUSTER + MODE
The way the clusters manifest depends on the MODE and TIME settings. 
The longer the delay time, the more spaced out the clusters become. 
Because CLUSTER is creating additional echoes, it will also increase 
the gain in the delay line. As you turn CLUSTER up you may wish to 
decrease FEEDBACK to compensate. 
In MOD mode – due to the extremely short 
delay times – the clusters clump together 
into a modulated mass. In this range, 
CLUSTER acts like a thickener, stereo 
widener, and secondary modulation. 
In LOOP mode it all depends on the length 
of your loop – the longer the loop, the 
more spread out and distinct each voice 
in the cluster becomes.  
In SHORT mode the clusters appear as 
dense clouds of scattering ambience, 
while in LONG mode you’ll experience 
more distinct multi-tap effects that 
function like rhythmic patterns at lower 
CLUSTER levels, and orbiting ambience 
as the fader is turned up. 
3736
They can be used for spatial widening, 
        rhythmic multi-tap, 
                echo clouds, and more. 
Big Time includes two independent stages of tone-shaping:
        A VOICING button to select the core character
        A TILT EQ to shape and adjust the frequency spectrum
VOICING
Think of VOICING like the character of a piece of hardware – the unique 
aspects of a circuit that give something its signature sound. Each voice 
is a different starting point inspired by our favorite devices and past 
work, a distinct stage of fixed filters independent from the TILT EQ.  
Voicing and Tilt EQ
TILT EQ
The TILT EQ is where you can get more hands-on. It’s a flexible, 
studio-style EQ that splits the frequency spectrum in half at a point of 
your choosing, and cuts either the highs or lows. The CROSSOVER alt 
control sets the middle point. 
               HIFI
Clear and pure, useful for 
modulation, looping, and
wide open textures.
               FOCUS
Subtle filtering that reveals itself 
over time, gradually shaving 
away both highs and lows to 
create focused, floating repeats. 
               WARM
Emulates the filtering techniques 
used by primitive digital rack 
delays, with their signature 
elliptical ripple.
               ANALOG
The dark and rich sound of a 
BBD-based analog delay.
Test out different ways to combine VOICING and TILT EQ. For example, 
set VOICING to Analog and push up the TILT EQ to create narrow but 
characterful echoes that slice right through the middle.
Maybe you want to cut 
the mud from your bass.
Push the fader up 
to cut the lows...
...and down to cut 
the highs. 
In the middle 
position, the EQ 
will be neutral.
In many cases setting CROSSOVER right to the middle will be ideal 
and keep things nice and simple, but it depends on your instrument 
and needs. 
TILT EQ CROSSOVER
TILT EQ CROSSOVER
Or have echoes that float 
overtop of the vocals. 
CROSSOVER
 CROSSOVER
CROSSOVER
3938
MAGNITUDE (dB)
FREQUENCY (Hz)

To access the Options Menu 
tap both footswitches 
simultaneously.
This is where you can set up external control and your preferences.
SCALE IGNORE (SCALE BUTTON)
MOTION will ignore all scales and always be smooth. This makes it 
possible to use the TIME slider to transpose loops while retaining 
classic, smooth pitch modulation. 
STEP (MOTION BUTTON)
Changes the tap function of the TEMPO footswitch. When engaged, 
each tap will create a momentary wave of movement. With a scale 
selected, this will advance to the next step in the sequence. 
STEP does not work in the Loop mode and Mod mode.
TRAILS (MODE BUTTON)
Allows the echoes to naturally fade out after the pedal is bypassed.
DRY KILL (VOICING BUTTON)
Removes the dry signal from the pedal’s output. 
DRY CLEAN (STATE BUTTON)
Your dry signal will now bypass Big Time’s preamp.
By default both the dry and wet signal will be processed by the preamp.
BALANCED/UNBALANCED (HOLD RIGHT FOOTSWITCH)
Big Time can either accept unbalanced, or ultra-low-noise balanced 
inputs and outputs. Unbalanced I/O is the default. Hold the right 
footswitch for two seconds to engage balanced I/O, indicated by the 
LED turning green. Hold again to revert back to unbalanced, indicated 
by a red LED.
Options Menu
SCALE
IGNORE
STEP TRAILS DRY KILL DRY CLEAN
4140
HOLD
BALANCED /
UNBALANCED
Exit the Options Menu and you’re all set. 
AUX
An external footswitch can be used to control Big Time’s gestures 
remotely, which can be handy for tabletop setups and expanding 
performance possibilities.
To begin, simply plug any normally-open momentary footswitch (e.g. 
Boss FS-6) into the AUX jack.
There are three available modes. To cycle through them, press the AUX 
footswitch while in the Options Menu. 
External Control
Big Time can be controlled with MIDI, CV, expression, and external 
footswitches.
MIDI
Every aspect of Big Time can be controlled via MIDI, including syncing 
to an external clock. You also have the option to output Big Time’s own 
clock, letting you sync other devices to your loops and echoes. 
Refer to the dedicated MIDI guide for details. 
EXPRESSION / CV
Either CV or an expression pedal can be used to control any or all of Big 
Time’s faders, with a range and direction of your choosing. 
MIDI
AUX
EXPIN OUT
STANDARD
5-PIN DIN
EXP: TRS CABLE
CV: FLOATING RING
TRS TO TS CABLE
TRS CABLE WITH 
NORMALLY-OPEN 
FOOTSWITCH
CV range = 0-5V
(higher voltage or any negative 
voltage could damage the pedal)
The first page of the Options Menu is where you choose 
which faders you wish to control. Move a fader up to its 
maximum position to assign expression or CV control 
to that parameter. 
TIME
TIME
TIME
Tap the right footswitch to enter the “toe” page. Here 
you decide where the fader(s) will stop once you reach 
the toe (or maximum) position. 
Tap the left footswitch to enter the “heel” page. Here 
you decide where the fader(s) will stop once you reach 
the heel (or minimum) position. 
Enter the Options 
Menu to set up 
expression / CV, 
as well as external 
footswitches.
If you’re using a footswitch with only a single button, you will have 
access to the first function of each mode (e.g. Preset Up). Exit the 
Options Menu once you've made your selection. 
See the MIDI Manual for more details on AUX functionality.
1. 2.
P = PRESET
1. Preset Up
2. Preset Down
F = FUN
1. 0.5x
2. Buffer Clear
D = DESKTOP
1. Tap / Record
2. Bypass / Stop
4342
Signal Flow
DELAY VOICING / TILTLIMIT / COLORPREAMP
LEFT FEEDBACK
RIGHT FEEDBACK
LEFT OUT
RIGHT OUT
LEFT IN
RIGHT IN
4x2
MATRIX
MIXER
PREAMP
Big Time’s preamp is a combination of a voltage-controlled amplifier 
and a unique clipping diode arrangement that provides extremely 
high dynamic range and a smooth transition into clipping. This circuit 
block is wrapped in a matched emphasis/de-emphasis network to 
provide additional high harmonic lift while maintaining a flat frequency 
response. It’s designed to be colorful, but respectful of a variety of 
instruments and input signals.
FEEDBACK LIMITER
A hybrid limiter made up of two distinct parts:
1. A voltage-controlled matrix mixer with sidechain compression.
2. A nonlinear waveshaper with voltage-controlled bias shift.
The matrix mixer handles compression and sag, while the waveshaper 
clips and mangles. By shifting the bias into a highly asymmetrical 
state, we achieve texturally broken sounds, reminiscent of a ripped 
speaker or failing console channel.  
4544
You are here. Big Time, big manual. 
We’re done now. 
If you have any lingering questions, 
feel free to write us:
help@chasebliss.com 
We will respond. 
Hope you’re enjoying your large new pedal. 
*exhale*
 
9V in, over - voltage and reverse polarity protected up to 
+ /- 20V . 400mA nominal, 1A required for startup surge 
currents and large slider movements.
Stereo, selectable TRS balanced/ unbalanced operation
1MΩ  (single-ended) 20KΩ  (balanced, common - mode)
 50Ω
Dry Path: - 100dBV
Delay Path: - 94dBV
0dB to + 20dB, or + 12dB to +3 2dB (+12dB mode active)
3 2 bit, 48kHz
SPEC SHEET
P OWE R
I /O
INPUT IMPEDANCE
OUTPUT IMPEDANCE
NOISE  (RMS, 20Hz to 20kHz, A weighted)
 
 
PREAMP GAIN (NOMINAL) 
A/ D CONVERSION$manual$
WHERE brand = 'Chase Bliss' AND model = 'Big Time';
