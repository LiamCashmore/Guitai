// ============================================================
// audio.js — SOUND  (the only file that touches Web Audio)
//
// Written against the Web Audio API and nothing else. That is deliberate:
// react-native-audio-api implements the same specification, so the phone
// build should be able to stand in for this module rather than replace
// it. Nothing here knows about the DOM, and nothing here knows about
// music theory — it is handed pitches and told when to sound them.
//
// It does know about time. The transport below — one tempo, one time
// signature, one grid of bars — is here rather than in the view because
// it is the same clock the sound is scheduled against, and a metronome
// kept anywhere else is a metronome that drifts.
// ============================================================

// ---- The graph --------------------------------------------
let ctx    = null;
let master = null;

/**
 * Bring the audio context up.
 *
 * Browsers start a context suspended and will only resume it inside a
 * real user gesture, so this has to be called from a click handler — not
 * on load, and not from a timer. Getting this wrong is the usual reason
 * audio silently does nothing.
 */
export async function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return false; }
  }
  return ctx.state === "running";
}

export const isAwake = () => !!ctx && ctx.state === "running";

/**
 * The audio clock, for anything that has to keep step with what is
 * being heard. Reading it is the only way a drawn thing can stay in
 * sync with sound: wall-clock time and the sample clock drift apart,
 * and over a long run at a slow tempo that drift is plainly visible.
 */
export const clock = () => (ctx ? ctx.currentTime : 0);

const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// ---- The string -------------------------------------------
// Karplus–Strong: fill a delay line one period long with noise, then read
// it round and round, averaging each pair of neighbours as it goes. The
// averaging is a one-zero lowpass, so every pass loses a little more of
// the high end — which is exactly what a real string does, and why the
// result sounds plucked rather than synthesised.
//
// It is rendered into a buffer rather than built from nodes because a
// feedback loop in the Web Audio graph cannot be shorter than one render
// quantum (128 samples). That puts a ceiling around 375Hz, which would
// lose the top two octaves of the neck — most of where a scale run goes.

const MAX_RING = 3.0;    // seconds; the low strings get about this long
const voices = new Map();  // midi -> AudioBuffer

function renderPluck(midi) {
  const rate = ctx.sampleRate;
  const freq = midiToFreq(midi);

  // The loop has to delay by exactly one period, and a period is not a
  // whole number of samples. Rounding it to one is the obvious thing and
  // it is badly wrong up the neck: at 880Hz a period is only 54 samples,
  // so being one sample out is a third of a semitone. The fix is to let
  // the delay be fractional — read between two samples and mix them in
  // proportion, which lands the loop on the exact period.
  //
  // The averaging that darkens the tone supplies half a sample of delay
  // by itself, so the line is asked for the rest.
  const loop = rate / freq;
  const N    = Math.max(2, Math.floor(loop - 0.5));
  const frac = Math.min(0.999, Math.max(0, loop - 0.5 - N));
  const seed = N + 2;

  // High notes shed their energy faster, as they do on a real instrument.
  const ring = Math.min(MAX_RING, Math.max(0.6, 3.0 * Math.pow(110 / freq, 0.45)));
  const len  = Math.ceil(ring * rate);
  const buf  = new Float32Array(len);

  // The pluck itself: noise, softened a little so it reads as a fingertip
  // rather than a pick.
  let smooth = 0;
  for (let i = 0; i < seed; i++) {
    smooth = 0.6 * smooth + 0.4 * (Math.random() * 2 - 1);
    buf[i] = smooth;
  }
  // Centre it, or the string starts displaced and thumps.
  let mean = 0;
  for (let i = 0; i < seed; i++) mean += buf[i];
  mean /= seed;
  for (let i = 0; i < seed; i++) buf[i] -= mean;

  // Lose 60dB over the ring time, spread across however many times the
  // wave goes round the loop in that time.
  //
  // Each pass averages a neighbouring pair — that is the lowpass — and
  // then mixes the two positions either side of the fractional delay.
  const decay = Math.pow(0.001, 1 / (ring * freq));
  for (let i = seed; i < len; i++) {
    const near = buf[i - N]     + buf[i - N - 1];
    const far  = buf[i - N - 1] + buf[i - N - 2];
    buf[i] = decay * 0.5 * (near + frac * (far - near));
  }

  // Even out the level between notes, then fade the tail so the end of
  // the buffer can't click.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const scale = peak > 0 ? 0.85 / peak : 0;
  const fade = Math.min(600, len);
  for (let i = 0; i < len; i++) {
    const t = i > len - fade ? (len - i) / fade : 1;
    buf[i] *= scale * t;
  }

  const out = ctx.createBuffer(1, len, rate);
  out.copyToChannel(buf, 0);
  return out;
}

function voiceFor(midi) {
  if (!voices.has(midi)) voices.set(midi, renderPluck(midi));
  return voices.get(midi);
}

// ============================================================
// THE TRANSPORT
//
// One tempo and one grid of bars laid out from it, shared by everything
// that plays in time: the click, a run, a progression. They have to be
// one thing rather than three — a run at 90 over a click at 80 is not a
// practice tool, it is two people disagreeing.
//
// Everything below measures in beats and bars rather than seconds, and
// turns them into seconds at the last moment. That is what lets the
// tempo be a slider: nothing has a duration of its own to be rescaled.
// ============================================================

// How long a loop turns around in. Music is written in fours — a phrase
// arrives at the top of the fifth bar, and a loop that came round after
// three and a half would be a different piece of music every time. So a
// phrase is padded out to whole fours rather than repeating when the
// notes happen to run out.
export const PHRASE_BARS = 4;

let bpm = 80;
let beatsPerBar = 4;

export const beatSeconds = () => 60 / bpm;
export const barSeconds  = () => beatSeconds() * beatsPerBar;
export const meter = () => beatsPerBar;

/**
 * Set the tempo, or the time signature, or both.
 *
 * A click already running is restarted rather than bent: the beats after
 * this one belong to the new tempo, and there is no sensible reading of
 * a grid that changes underneath beats already scheduled.
 */
export function setTempo({ bpm: nextBpm, beatsPerBar: nextBeats } = {}) {
  bpm = Math.max(20, Math.min(400, Math.round(nextBpm ?? bpm)));
  beatsPerBar = Math.max(2, Math.min(12, Math.round(nextBeats ?? beatsPerBar)));
  if (clickOn && !phrasePlaying) startClicking();
  return { bpm, beatsPerBar };
}

// ---- The click --------------------------------------------
let clickBus       = null;
let phraseClickBus = null;
let clickLive  = [];
let clickOn    = false;     // the metronome switch, on its own
let clickTimer = null;      // the pump that keeps the standalone click fed

// Where beat zero of the current grid sits on the audio clock, and how
// far ahead of the ear the clicks are written.
let gridStart  = 0;
let nextClickAt = 0;
let clickBeat  = 0;
const CLICK_AHEAD = 0.3;

function clickTo() {
  if (!clickBus) {
    clickBus = ctx.createGain();
    clickBus.gain.value = 0.9;
    clickBus.connect(master);
  }
  return clickBus;
}

/**
 * The clicks a phrase lays down under its own bars, on a switch of their
 * own.
 *
 * They are written a whole pass in advance, so switching the metronome
 * on halfway through a loop could not be heard until the pass after next
 * if it worked by not writing them. Instead they are always written and
 * this turns them up or down, which takes effect on the very next beat.
 * The count-in never comes through here: it is not the metronome, it is
 * the count, and it sounds whether the metronome is on or not.
 */
function phraseClicksTo() {
  if (!phraseClickBus) {
    phraseClickBus = ctx.createGain();
    phraseClickBus.gain.value = clickOn ? 1 : 0;
    phraseClickBus.connect(clickTo());
  }
  return phraseClickBus;
}

/**
 * One click: a short sine burst, higher and louder on the first beat of
 * the bar.
 *
 * Which is all a click should be. It has to be heard through a chord and
 * then ignored, and anything with more character to it than this starts
 * competing with what is being practised.
 */
function scheduleClick(when, accent, bus = null) {
  if (!ctx) return;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 950;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.26, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  osc.connect(gain).connect(bus ?? clickTo());
  osc.start(when);
  osc.stop(when + 0.07);
  const entry = { src: osc, gain };
  clickLive.push(entry);
  osc.onended = () => { clickLive = clickLive.filter(e => e !== entry); };
}

function killClicks() {
  const now = ctx ? ctx.currentTime : 0;
  for (const { src, gain } of clickLive) {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      src.stop(now);
    } catch { /* already done */ }
  }
  clickLive = [];
  if (clickTimer !== null) { clearInterval(clickTimer); clickTimer = null; }
}

/**
 * Run the click on its own, from a given point on the grid.
 *
 * Written a little ahead of the ear and topped up on a timer — the
 * ordinary way to sequence anything open-ended in Web Audio. A timer
 * cannot be trusted to fire on the beat, but it can be trusted to fire
 * often enough to keep a few beats' worth of exactly-timed clicks in
 * front of it, which is a different and much easier job.
 */
function startClicking(from = null, beat = 0) {
  killClicks();
  if (!ctx) return;
  gridStart   = from ?? ctx.currentTime + 0.12;
  clickBeat   = beat;
  nextClickAt = gridStart + beat * beatSeconds();
  const pump = () => {
    while (nextClickAt < ctx.currentTime + CLICK_AHEAD) {
      scheduleClick(nextClickAt, clickBeat % beatsPerBar === 0);
      clickBeat++;
      nextClickAt += beatSeconds();
    }
  };
  pump();
  clickTimer = setInterval(pump, 60);
  watchBeats();
}

/**
 * The metronome switch.
 *
 * Only the standalone click is switched here. While something is playing
 * the phrase owns the click — it has its own grid to keep, and two
 * schedulers laying beats over each other would be two metronomes.
 */
export function setMetronome(on) {
  clickOn = !!on;
  if (!ctx) return clickOn;
  if (phrasePlaying) {
    // Turned up rather than scheduled — see phraseClicksTo.
    phraseClicksTo().gain.setTargetAtTime(clickOn ? 1 : 0, ctx.currentTime, 0.005);
    return clickOn;
  }
  if (clickOn) startClicking(); else { killClicks(); stopWatching(); }
  return clickOn;
}

export const metronomeOn = () => clickOn;

// ---- Counting ---------------------------------------------
// What the eye is told. Driven off the clock rather than off the
// scheduler, for the reason everything else here is: the clicks are
// written ahead of time, so the moment one is scheduled is not the
// moment it is heard.
let beatWatch  = null;
let onBeat     = null;
let lastBeat   = -1;
// The shape of the thing playing, so a beat can be reported as the bar
// and beat of a phrase rather than as a number counting up forever.
let cycle = null;    // { countInBeats, cycleBeats, loop }
let phrasePlaying = false;

function beatReport(n) {
  // On its own the click is not counting through anything, so it counts
  // in phrases: bar 1 to 4 and round again, which is what a player is
  // hearing anyway.
  if (!cycle) {
    return {
      bar: Math.floor(n / beatsPerBar) % PHRASE_BARS + 1,
      beat: n % beatsPerBar + 1,
      countIn: false,
    };
  }
  const within = cycle.loop ? ((n % cycle.cycleBeats) + cycle.cycleBeats) % cycle.cycleBeats : n;
  const countIn = within < cycle.countInBeats;
  const from = countIn ? within : within - cycle.countInBeats;
  return {
    bar: Math.floor(from / beatsPerBar) + 1,
    beat: from % beatsPerBar + 1,
    countIn,
  };
}

/**
 * Be told where the beat is: { bar, beat, countIn }, or null when
 * nothing is counting.
 *
 * One listener, because there is one transport. What it is for is the
 * count-in — a bar of clicks with nothing on screen saying what they are
 * counting is a bar of confusion — and it serves the bar count under a
 * loop with the same numbers.
 */
export function onCount(callback) {
  onBeat = callback;
}

function watchBeats() {
  stopWatching();
  lastBeat = -1;
  const tick = () => {
    const n = Math.floor((ctx.currentTime - gridStart) / beatSeconds());
    if (n >= 0 && n !== lastBeat) { lastBeat = n; onBeat?.(beatReport(n)); }
    beatWatch = requestAnimationFrame(tick);
  };
  beatWatch = requestAnimationFrame(tick);
}

function stopWatching() {
  if (beatWatch !== null) { cancelAnimationFrame(beatWatch); beatWatch = null; }
  onBeat?.(null);
}

// ---- Playing ----------------------------------------------
let live = [];        // { src, gain } in flight, so a stop can reach them
let ringing = [];     // the note currently sounding on each string
let visualLoop = null;
// The timer writing the repeats of whatever is looping, if anything.
let phrasePump = null;

/** Let go of a phrase: no more repeats, and the click is its own again. */
function endPhraseNow() {
  if (phrasePump !== null) { clearInterval(phrasePump); phrasePump = null; }
  if (!phrasePlaying) return;
  phrasePlaying = false;
  cycle = null;
  killClicks();
  resumeClick();
}

/**
 * Silence everything.
 *
 * Stopping a source outright cuts the waveform wherever it happens to be
 * and that step to zero is a click, so each one is faded out over a few
 * milliseconds first. Sources still waiting their turn are stopped before
 * they start, which the spec takes to mean they never sound at all.
 */
function killScheduled(fade = 0.03) {
  // A phrase writes its repeats on a timer, so silencing the notes is
  // not enough to stop one — the timer would go on writing more. Anything
  // that cuts the sound off cuts the loop off with it.
  endPhraseNow();
  const now = ctx ? ctx.currentTime : 0;
  for (const { src, gain } of live) {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      src.stop(now + fade + 0.01);
    } catch { /* already finished */ }
  }
  live = [];
  ringing = [];
  if (visualLoop !== null) { cancelAnimationFrame(visualLoop); visualLoop = null; }
}

export function stopAll() { killScheduled(); }

/**
 * Sound one note at a given time on the audio clock.
 *
 * A guitar string can only hold one note, so starting a note damps
 * whatever was ringing on that string — while notes on other strings are
 * left alone to ring into each other. That single rule is most of what
 * makes a run sound like a guitar rather than a sequencer.
 */
function scheduleNote({ midi, string }, when, velocity = 1) {
  const src = ctx.createBufferSource();
  src.buffer = voiceFor(midi);
  const gain = ctx.createGain();
  gain.gain.value = velocity;
  src.connect(gain).connect(master);
  src.start(when);
  const entry = { src, gain };
  live.push(entry);
  // A loop writes another pass every few seconds and would otherwise
  // hand a stop an ever-growing list of notes that finished long ago.
  src.onended = () => { live = live.filter(e => e !== entry); };

  const held = ringing[string];
  if (held) {
    // Damp, don't cut: a quick fade, the way a finger landing on the
    // string stops it.
    held.gain.cancelScheduledValues(when);
    held.gain.setValueAtTime(held.gain.value, when);
    held.gain.linearRampToValueAtTime(0.0001, when + 0.035);
  }
  ringing[string] = gain;
}

/**
 * Sound a list of notes, evenly spaced, once.
 *
 * Everything is scheduled up front against the audio clock. Both a run
 * and a strum are short and bounded, so there is no need for the rolling
 * lookahead a looping sequencer would want — and the audio clock is
 * sample-accurate where a chain of setTimeouts would drift audibly.
 *
 * The eye is driven separately: a rAF loop reads the clock and reports
 * which note has just been struck. Touching the DOM from audio callbacks
 * is what makes this sort of thing stutter.
 *
 * @param gain     (index) => 0..1, how hard each note is struck
 * @param onStrike (note, index) as each note sounds
 * @param hold     seconds to keep reporting after the last note starts
 */
function sound(notes, gap, { velocity, onStrike, onEnd, hold = 0 } = {}) {
  killScheduled();
  if (!ctx || !notes.length) return { startsAt: 0, gap, stop() {} };

  const t0 = ctx.currentTime + 0.12;   // a moment to get the first one out
  notes.forEach((n, i) => scheduleNote(n, t0 + i * gap, velocity?.(i) ?? 1));

  const finish = t0 + (notes.length - 1) * gap + hold;
  let struck = -1;
  const tick = () => {
    const now = ctx.currentTime;
    const i = Math.min(notes.length - 1, Math.floor((now - t0) / gap));
    if (i > struck && i >= 0) {
      for (let k = struck + 1; k <= i; k++) onStrike?.(notes[k], k);
      struck = i;
    }
    if (now >= finish) { visualLoop = null; onEnd?.(); return; }
    visualLoop = requestAnimationFrame(tick);
  };
  visualLoop = requestAnimationFrame(tick);

  return {
    // When the first note lands, and how far apart they are — everything
    // needed to draw something that arrives with each note rather than
    // reacting after it.
    startsAt: t0,
    gap,
    stop() { killScheduled(); onEnd?.(); },
  };
}

// ---- Phrases ----------------------------------------------
// Everything that plays in time goes through here: a run, a progression,
// and the click over both. A phrase is a list of moments — each a beat
// to land on and the notes to sound there — and this turns that into a
// bar of counting in, the phrase itself, and, if asked, the whole thing
// round and round.

// How far in front of the ear the next repeat is written. Comfortably
// more than a background tab's throttled timer, which is the only thing
// that could otherwise leave a gap where the turnaround should be.
const PASS_AHEAD = 2.5;

/**
 * @param hits     [{ beat, notes, spread, velocity }] beats from the top
 * @param lengthBeats how long the phrase is, whether or not a note lands
 *                 on its last beat — a run of three notes is still a bar
 * @param countIn  a bar of clicks in front of it
 * @param loop     round and round until stopped, in whole four-bar
 *                 phrases, each pass counted in
 * @param onHit    (hit, index) as each moment arrives
 * @param onPass   (musicStartsAt, passIndex) as each repeat comes round
 */
function playPhrase(hits, {
  lengthBeats, countIn = false, loop = false, tail = 1.2, onHit, onPass, onEnd,
} = {}) {
  killScheduled();
  killClicks();
  if (!ctx || !hits.length) return { startsAt: 0, stop() {} };

  const beat = beatSeconds();
  // A bar in front — and under a loop it is not optional. Coming round
  // with no gap leaves the hand nowhere to get back to the beginning
  // from, and the whole use of a practice loop is that it gives you that
  // bar every time.
  const countInBars = (loop || countIn) ? 1 : 0;
  const musicBars   = Math.max(1, Math.ceil(lengthBeats / beatsPerBar));
  const phraseBars  = loop ? Math.ceil(musicBars / PHRASE_BARS) * PHRASE_BARS : musicBars;
  const cycleBeats  = (countInBars + phraseBars) * beatsPerBar;
  const cycleTime   = cycleBeats * beat;
  const offset      = countInBars * beatsPerBar * beat;

  const t0 = ctx.currentTime + 0.12;
  gridStart     = t0;
  cycle         = { countInBeats: countInBars * beatsPerBar, cycleBeats, loop };
  phrasePlaying = true;
  phraseClicksTo().gain.setValueAtTime(clickOn ? 1 : 0, ctx.currentTime);

  // One pass: the clicks across the whole cycle, then the notes. During
  // the count-in the click always sounds — that is what makes it a count
  // rather than a silence — and through the phrase itself only if the
  // metronome is switched on.
  const schedulePass = n => {
    const at = t0 + n * cycleTime;
    for (let b = 0; b < cycleBeats; b++) {
      const counting = b < cycle.countInBeats;
      scheduleClick(at + b * beat, b % beatsPerBar === 0,
        counting ? clickTo() : phraseClicksTo());
    }
    for (const hit of hits) {
      const when = at + offset + hit.beat * beat;
      hit.notes.forEach((n2, i) => scheduleNote(n2, when + i * (hit.spread ?? 0), hit.velocity?.(i) ?? 1));
    }
  };

  let written = 0;
  schedulePass(0);
  onPass?.(t0 + offset, 0);

  phrasePump = setInterval(() => {
    if (!loop || !ctx) return;
    while (t0 + (written + 1) * cycleTime < ctx.currentTime + PASS_AHEAD) {
      written++;
      schedulePass(written);
    }
  }, 120);

  // The notes already sounding are left to ring — the phrase is over,
  // not cut off. A stop, which really is cutting it off, goes through
  // killScheduled instead.
  const done = () => { endPhraseNow(); onEnd?.(); };

  let shownPass = 0, shownHit = -1;
  const finish = t0 + offset + hits[hits.length - 1].beat * beat + tail;
  const tick = () => {
    const now = ctx.currentTime;
    const pass = loop ? Math.max(0, Math.floor((now - t0) / cycleTime)) : 0;
    if (pass !== shownPass) {
      shownPass = pass; shownHit = -1;
      onPass?.(t0 + pass * cycleTime + offset, pass);
    }
    const within = now - (t0 + pass * cycleTime + offset);
    let i = -1;
    while (i + 1 < hits.length && hits[i + 1].beat * beat <= within) i++;
    if (i > shownHit) {
      for (let k = shownHit + 1; k <= i; k++) onHit?.(hits[k], k);
      shownHit = i;
    }
    if (!loop && now >= finish) { visualLoop = null; done(); return; }
    visualLoop = requestAnimationFrame(tick);
  };
  visualLoop = requestAnimationFrame(tick);
  watchBeats();

  return {
    startsAt: t0 + offset,
    stop() {
      killScheduled();     // silences the notes, and ends the phrase with them
      onEnd?.();
    },
  };
}

/**
 * Hand the click back to itself when a phrase lets go of it.
 *
 * On the same grid it was already keeping, so the beat after the last
 * one lands exactly where it would have — the click carries on rather
 * than starting again.
 */
function resumeClick() {
  if (!clickOn || !ctx) { stopWatching(); return; }
  const next = Math.ceil((ctx.currentTime - gridStart) / beatSeconds());
  startClicking(gridStart, next);
}

/**
 * Play a run — one note at a time, in playing order, as eighth notes at
 * the transport's tempo. Two to the beat, so a run and the click land on
 * each other rather than near each other.
 *
 * @param notes [{ midi, string, key }] in playing order
 */
export function playSequence(notes, { countIn, loop, onNote, onPass, onEnd } = {}) {
  const step = 0.5;                        // beats per note
  const hits = notes.map((n, i) => ({
    beat: i * step,
    notes: [n],
    // Lean very slightly on the first of each group of four, which is
    // enough to keep a long run from sounding mechanical.
    velocity: () => (i % 4 === 0 ? 1 : 0.88),
  }));
  const p = playPhrase(hits, {
    lengthBeats: notes.length * step,
    countIn, loop,
    onHit: (_, i) => onNote?.(notes[i]),
    onPass,
    onEnd: () => { onNote?.(null); onEnd?.(); },
  });
  // The playhead is drawn against the same schedule, so it is told where
  // the first note lands and how far apart they are.
  return { ...p, gap: step * beatSeconds() };
}

// How far apart the strings are struck, in seconds. At the fast end this
// is a flick of the wrist and the chord arrives as one sound; at the slow
// end the notes are plainly separate and you hear the chord being built.
const STRUM_FAST = 0.003;
const STRUM_SLOW = 0.30;

/** Where a 0..1 slider sits between those, by ear rather than by ruler. */
export const strumGap = t =>
  STRUM_SLOW * Math.pow(STRUM_FAST / STRUM_SLOW, Math.min(1, Math.max(0, t)));

/**
 * Play a series of chords, one to a bar.
 *
 * A bar each rather than a duration of their own, because that is how a
 * progression is counted and it is the only way the click means anything
 * over the top of it: four chords are four bars, which is the phrase a
 * loop turns around in.
 *
 * Nothing is damped between chords except by the strings themselves: a
 * note on the fifth string is stopped when the next chord puts something
 * else on the fifth string, and left ringing when it doesn't. That is
 * what a guitar does, and it is why chords sharing a string bleed into
 * each other the way they should.
 *
 * @param chords [[{midi, string, key}]] each in strumming order
 * @param gap    seconds between strings within one strum
 */
export function playProgression(chords, { gap = 0.02, countIn, loop, onChord, onPass, onEnd } = {}) {
  const hits = chords.map((notes, c) => ({
    beat: c * beatsPerBar,
    notes,
    spread: gap,
    // A pick loses a little energy as it crosses the strings.
    velocity: i => 1 - 0.06 * i,
  }));
  return playPhrase(hits, {
    lengthBeats: chords.length * beatsPerBar,
    countIn, loop,
    tail: Math.min(barSeconds(), 1.4),
    onHit: (_, c) => onChord?.(c),
    onPass,
    onEnd,
  });
}

/**
 * Strum a chord, low string to high.
 *
 * Unlike a run, the notes are meant to pile up — nothing damps anything,
 * because each string carries one note and they are all still ringing
 * when the last is struck. So the highlight accumulates too, and clears
 * together once the chord has had time to sound.
 *
 * @param notes [{ midi, string, key }] in strumming order, low string first
 */
export function playChord(notes, { gap = 0.02, onStrike, onEnd } = {}) {
  return sound(notes, gap, {
    // A pick loses a little energy as it crosses, and the bass string is
    // dug into slightly harder. Small, but it stops the chord sounding
    // like six notes triggered at once.
    velocity: i => 1 - 0.06 * i,
    onStrike,
    onEnd,
    hold: 1.1,
  });
}