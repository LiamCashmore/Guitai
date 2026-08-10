// ============================================================
// audio.js — SOUND  (the only file that touches Web Audio)
//
// Written against the Web Audio API and nothing else. That is deliberate:
// react-native-audio-api implements the same specification, so the phone
// build should be able to stand in for this module rather than replace
// it. Nothing here knows about the DOM, and nothing here knows about
// music theory — it is handed pitches and told when to sound them.
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

// ---- Playing ----------------------------------------------
let live = [];        // { src, gain } in flight, so a stop can reach them
let ringing = [];     // the note currently sounding on each string
let visualLoop = null;

/**
 * Silence everything.
 *
 * Stopping a source outright cuts the waveform wherever it happens to be
 * and that step to zero is a click, so each one is faded out over a few
 * milliseconds first. Sources still waiting their turn are stopped before
 * they start, which the spec takes to mean they never sound at all.
 */
function killScheduled(fade = 0.03) {
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
  live.push({ src, gain });

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

/**
 * Play a run, once, ascending — one note at a time, in playing order.
 *
 * @param notes [{ midi, string, key }] in playing order
 */
export function playSequence(notes, { bpm = 80, onNote, onEnd } = {}) {
  return sound(notes, 30 / bpm, {          // eighth notes at the given tempo
    // Lean very slightly on the first of each group of four, which is
    // enough to keep a long run from sounding mechanical.
    velocity: i => (i % 4 === 0 ? 1 : 0.88),
    onStrike: n => onNote?.(n),
    onEnd: () => { onNote?.(null); onEnd?.(); },
  });
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
 * Play a series of chords, one after another.
 *
 * Everything is scheduled up front, as a run is — but a progression is
 * long enough that the eye needs telling which chord has arrived, so the
 * rAF loop reports the chord rather than the note.
 *
 * Nothing is damped between chords except by the strings themselves: a
 * note on the fifth string is stopped when the next chord puts something
 * else on the fifth string, and left ringing when it doesn't. That is
 * what a guitar does, and it is why chords sharing a string bleed into
 * each other the way they should.
 *
 * @param chords   [[{midi, string, key}]] each in strumming order
 * @param gap      seconds between strings within one strum
 * @param chordGap seconds from one chord to the next
 */
export function playProgression(chords, { gap = 0.02, chordGap = 1.7, onChord, onEnd } = {}) {
  killScheduled();
  if (!ctx || !chords.length) return { stop() {} };

  const t0 = ctx.currentTime + 0.12;
  chords.forEach((notes, c) => {
    const at = t0 + c * chordGap;
    notes.forEach((n, i) => scheduleNote(n, at + i * gap, 1 - 0.06 * i));
  });

  const finish = t0 + (chords.length - 1) * chordGap + Math.min(chordGap, 1.4);
  let shown = -1;
  const tick = () => {
    const now = ctx.currentTime;
    const c = Math.min(chords.length - 1, Math.floor((now - t0) / chordGap));
    if (c > shown && c >= 0) { shown = c; onChord?.(c); }
    if (now >= finish) { visualLoop = null; onEnd?.(); return; }
    visualLoop = requestAnimationFrame(tick);
  };
  visualLoop = requestAnimationFrame(tick);

  return { stop() { killScheduled(); onEnd?.(); } };
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