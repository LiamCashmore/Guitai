// ============================================================
// fretboard.js — INSTRUMENTS + THE LIVE FRETBOARD  (pure, no DOM)
//
// Turns the note theory in theory.js into a grid of frets for a given
// instrument. `instrument`, `numFrets`, `openMidi`, `tuning`,
// `chromaticGrid` and `numStrings` are the live fretboard state that
// everything downstream (positions, voicings, paths) reads from.
// ============================================================

import { noteToPc, getScalePcs, getScaleDegrees, getFretPcs, spellScale, midiToPc, FLAT_NAMES } from "./theory.js";

// ------------------------------------------------------------
// THE INSTRUMENTS
//
// An instrument is nothing but a list of open pitches. Everything else
// in this file — the grid, the scale shapes, the positions, the runs —
// is derived from that list and from the interval arithmetic above, so
// adding an instrument is adding a row here and nothing more.
//
// `openMidi` is the whole definition; `tuning` is only its pitch classes
// spelled out for the labels beside the nut, and is derived rather than
// written twice. Absolute pitch — not just pitch class — is what lets us
// spot unisons: the same note reachable on two different strings, e.g.
// open B and G-string fret 4 on a guitar.
//
// `caged` is not a matter of taste. The five CAGED shapes are the five
// movable major-chord forms of a SIX-string guitar tuned in fourths with
// a major third between strings 3 and 2; a bass in straight fourths has
// no such forms, so it takes the general position search instead, which
// works from the intervals themselves and needs no template.
//
// `kinds` is what the instrument is asked to display. A bass starts with
// scales and arpeggios: chords and progressions are grip searches built
// around a six-string hand, and a four-string bass wants its own voicing
// rules rather than the guitar's applied to fewer strings.
// ------------------------------------------------------------

export const INSTRUMENTS = {
  guitar: {
    id: "guitar",
    name: "Guitar",
    // E2 A2 D3 G3 B3 E4
    openMidi: [40, 45, 50, 55, 59, 64],
    numFrets: 17,
    caged: true,
    kinds: ["scale", "arpeggio", "chord", "progression"],
    chords: {
      strategy: "guitar",
      scaleLength: 25.5,
      // The guitar's grips are governed by the fret counts below, tuned
      // by hand, so no physical cap binds here. The bass entry says why
      // one is needed there.
      reach: { comfort: Infinity, max: Infinity },
      openReach: 5,
    },
  },
  bass: {
    id: "bass",
    name: "Bass",
    // E1 A1 D2 G2 — an octave below the guitar's bottom four, and all
    // fourths, so the shape of a scale is the same on every string pair.
    openMidi: [28, 33, 38, 43],
    numFrets: 17,
    caged: false,
    kinds: ["scale", "arpeggio", "chord", "progression"],
    chords: {
      strategy: "bass",
      // A bass neck is a third longer than a guitar's, so the same fret
      // count is a different stretch: frets 1-5 span five inches on a
      // guitar and six and a half on a bass. Counting frets calls those
      // the same grip. Counting inches does not, which is why the bass
      // caps its reach physically and the guitar need not.
      scaleLength: 34,
      reach: { comfort: 4.0, max: 5.3 },
      // An open string costs no finger, and a bass grip holds one or two
      // stopped notes at most, so a ringing open string does not tie the
      // hand to the nut the way it does under a six-string chord.
      openReach: 12,
    },
  },

  mandolin: {
    id: "mandolin",
    name: "Mandolin",
    // G3 D4 A4 E5 — tuned in fifths, like a violin, and the reason its
    // shapes look nothing like a guitar's. See stringIntervals() below.
    openMidi: [55, 62, 69, 76],
    numFrets: 17,
    // Each note is sounded by two strings tuned together. They are one
    // note to every calculation in this file — the pair exists for volume
    // and for the shimmer of two strings never quite in tune — so only
    // the drawing knows about it.
    courses: 2,
    caged: false,
    kinds: ["scale", "arpeggio", "chord"],
    chords: {
      // Guitar grip rules don't transfer as-is — a mandolin's fifths put
      // a chord's notes in completely different places than a guitar's
      // fourths — but the shared full-voicing search only cares about
      // open pitches and fret positions, and works from those either way.
      strategy: "guitar",
      scaleLength: 13.875,
      // Real inches rather than the guitar's uncapped, fret-counted
      // reach — a mandolin's neck is short enough that a wide fret span
      // can be a small stretch or a real one depending on where it
      // falls, and only physical distance tells the two apart. A closed
      // four-finger chop chord up around the seventh position spans
      // about two inches; that's the everyday grip, not a stretch, so
      // comfort is set to cover it.
      reach: { comfort: 2.5, max: 3.5 },
      reachCostPerInch: 1.2,
      openReach: 5,
      // A scale a third the length of a guitar's puts three or four
      // times the frets under the same span of fingers, so the same
      // finger-count reach the guitar's numbers assume is a much wider
      // stretch of neck here — common mandolin "chop" chords routinely
      // span five or six frets without being any harder to hold. Read
      // by the pass/fail cap (chordSpan/chordComfort); the ease cost
      // itself is charged in inches, above.
      maxSpan: 7,
      comfortSpan: 5,
      openSpan: 5,
      // How wide the hand-position window is on screen. Five frets is a
      // guitar's hand and the default everywhere else; a mandolin needs
      // six, and not as a luxury — six is where a whole class of standard
      // grips lives. C major as 12-10-7-8 (pinky, ring, index, middle;
      // 5-1-3-1) spans frets 7 to 12, and every note of it is inside one
      // still hand: 2.3 inches on this scale length, which is under the
      // comfort figure above. The search has always found that shape. A
      // five-fret window could never show it, because no five frets
      // contain it — the window was hiding grips the model itself calls
      // comfortable.
      windowFrets: 6,
      stretchPenalty: 2.5,
      // A guitarist reaches for the open chord and counts fewer fingers
      // as easier; a mandolin player's default is the closed, movable
      // chop-chord shape fretted on all four strings, so neither habit
      // should weigh as heavily here as it does on a guitar.
      fingerCost: 0.35,
      // And a barre is barely an event on this instrument: four light
      // strings a hand's width apart, over a neck a third the length of
      // a guitar's. The two-finger chop shapes are two small barres and
      // are what a player reaches for first, not a last resort.
      barreCost: 0.45,
      openBonus: 0.15,
      openBonusCap: 0.4,
      // A closed movable shape is chosen for its hand pattern more than
      // for where the root falls, so an inversion isn't the fallback
      // position it is on a lower, single-note-at-a-time instrument.
      rootBonus: 0.6,
      // The chop chord itself: every string fretted, none open. Worth
      // naming directly rather than hoping the other terms add up to
      // favouring it, since none of them are actually about this.
      closedGripBonus: 3,
      // And its mirror in the open position, worth exactly as much: the
      // first-position chords, 0-2-3-0 for C and 0-0-2-3 for G, where the
      // open strings sound the chord and the hand puts down two fingers
      // instead of four. A chop shape is chosen for being movable, and
      // nothing at the nut needs moving. Set equal to the closed bonus so
      // neither shape wins by fiat — the two cancel, and what decides is
      // what should: the fingers, the reach, the notes under them.
      openGripBonus: 3,
      // Charged in inches, a tight shape at the twelfth fret can look
      // cheaper than the same shape at the fifth — correctly, for the
      // hand's span, but the arm still has to get up there. A small tax
      // per fret of position keeps that preference from running away
      // with high grips that are narrow but simply far from the nut.
      positionCost: 0.08,
      // Frets 11 and up are where a mandolin's body meets the neck —
      // reachable, but the hand is working around the instrument as
      // much as fretting a chord, so it costs more per fret past there.
      highPositionFret: 10,
      highPositionCost: 0.6,
      // A mandolin sits an octave above a guitar, where a doubled third
      // or seventh colours the chord rather than wasting a string —
      // close to how a mandolin orchestra actually voices one.
      doubleCost: 0.25,
    },
  },

  banjo: {
    id: "banjo",
    name: "Banjo",
    // Open G. Indices 0-3 are the 4th through 1st strings, D3 G3 B3 D4,
    // low to high like every other tuning here — the 5th string (g4)
    // is last because the model orders by pitch and it's the highest
    // string on the instrument.
    openMidi: [50, 55, 59, 62, 67],
    numFrets: 17,
    // The 5th string is short: it has its own nut AT the 5th fret, and
    // there is simply no string below that to press. So it sounds open,
    // or fretted from the 6th fret on up — and the 6th fret is one
    // semitone above the open g, not six, because the string starts at
    // the 5th. That is why the 5th string reaches its octave at the
    // 17th fret rather than the 12th, which is the fact to check this
    // against: 5 + 12 = 17.
    //
    // `nutFret` is that nut's fret. Everything follows from it — which
    // frets exist, what each of them sounds, and where the view draws
    // the string's own nut and peg.
    droneStrings: [{ string: 4, nutFret: 5 }],
    // Pitch order puts the 5th string above the 1st, which is correct
    // for the model — everything here reasons in ascending pitch — but
    // physically the 5th string sits apart from the other four, off the
    // low side of the neck. This is purely a drawing order for the view:
    // the 4th-to-1st strings keep their usual low-to-high stack, with
    // the 5th string's row placed below all of them, matching the real
    // instrument rather than its pitch.
    displayOrder: [4, 0, 1, 2, 3],
    // Open G shares nothing with the guitar's CAGED shapes — different
    // tuning, different chord shapes entirely.
    caged: false,
    kinds: ["scale", "arpeggio", "chord"],
    chords: {
      strategy: "guitar",
      scaleLength: 26,
      reach: { comfort: Infinity, max: Infinity },
      openReach: 5,
      // The root underneath counts for far less here than on a guitar,
      // and the instrument's own open chord is the proof: strummed with
      // nothing held down, an open-G banjo sounds D G B D — a G major in
      // second inversion, with the D underneath, and nobody hears it as
      // anything but G. The 4th string is a middle-register D, not a
      // foundation, and the 5th string drones a g above the whole chord
      // regardless. Left at the guitar's figure, this bonus was buying
      // root position by dropping the 4th string from grips that want
      // it: a C at the fifth fret came out as a three-string barre with
      // the 4th muted, where every player simply lays the index across
      // all four.
      rootBonus: 0.6,
      // Four strings of light steel, and the fifth not under the hand at
      // all: laying one finger across the neck here is nothing like
      // doing it over six wound guitar strings, and the barred shapes up
      // the neck are the ordinary way to play in the closed keys.
      barreCost: 0.6,
      // A banjo chord is a shape on the 4th, 3rd, 2nd and 1st strings
      // with the 5th droning over it, and the four fingers are simply
      // what holds it — not a cost reluctantly paid, the way a guitarist
      // counts fingers against reaching for an open shape. So a finger
      // is cheap here, and every one of the four strings sounding is
      // worth going out of the way for. Between them these two say the
      // thing the ranking could not: prefer the whole grip.
      fingerCost: 0.45,
      fullGripBonus: 2.5,
      // A banjo sits above a guitar in register too, if not as far above
      // as a mandolin — and its usual grips lean on all four fingers
      // across the four fretted strings, where a repeated third or fifth
      // is normal rather than a wasted finger.
      doubleCost: 0.25,
    },
  },
};

export const DEFAULT_INSTRUMENT = "guitar";

// The live fretboard. These are `let` on purpose: an ES module export is
// a live binding, so reassigning them here updates every importer at
// once, and nothing downstream has to be told an instrument changed.
export let instrument   = INSTRUMENTS[DEFAULT_INSTRUMENT];
export let numFrets     = instrument.numFrets;
export let openMidi     = instrument.openMidi;
// The open notes as they actually sound, spelled for the labels beside
// the nut — which is not the same as the tuning written on the pegs once
// a capo is on. See capoFret.
export let tuning       = [];                                           // low -> high
// Chromatic grid: every pitch class at every fret of every string.
export let chromaticGrid = [];
export let numStrings    = 0;
// Short strings that start partway up the neck — a banjo's 5th, so far —
// mapped to the fret their own nut sits at. Read by midiAt below, by
// paths.js, which walks raw fret arithmetic rather than this grid and so
// needs telling directly, and by view.js for where to draw them.
export let droneStrings  = new Map();
// Which row each string draws on, bottom to top — identity unless an
// instrument says otherwise (see the banjo entry above for why one
// would). Purely a view concern; nothing in the model reads it.
export let displayOrder  = [];

// ------------------------------------------------------------
// THE CAPO
//
// A bar clamped across the neck, and to the model it does exactly one
// thing: it moves the open note. The notes under the bar ARE the open
// strings now — fret 0 of a capoed string sounds what that fret sounds —
// and there is nothing behind the bar to press, so those frets stop
// existing the way a drone string's do below its own nut.
//
// Fret numbers stay the board's own throughout. A capo at the 3rd fret
// does not renumber the 5th fret; it makes fret 0 sound what fret 3 did,
// and leaves frets 1-3 unreachable. Everything downstream reads the grid
// and gets that for free.
//
// Which strings it covers is not a per-instrument list: the bar lies
// across the neck, so it covers every string the neck carries — all of
// them, except a drone. A banjo's 5th string has its own nut at the 5th
// fret and sits off the low side of the neck, where no capo laid across
// the other four ever touches it, which is why a capoed banjo is D G B D
// with the high g still droning at pitch. That is the instrument, not a
// setting.
// ------------------------------------------------------------
export let capoFret = 0;

/** Is this string under the bar? A drone never is — see above. */
export function capoCovers(string) {
  return capoFret > 0 && !droneStrings.has(string);
}

// ------------------------------------------------------------
// THE SPIKE
//
// The answer to the paragraph above. A banjo's 5th string never goes
// under the capo, so players drive a small hooked pin into the fretboard
// beside it and push the string under that instead — usually at the 7th
// and 9th frets, which is exactly the pair that goes with a capo at the
// 2nd and 4th. Capo 2 with the string spiked at 7 puts the whole
// instrument in A: the four strings on the neck, and the drone up at a
// with them, instead of a g ringing against the chord all night.
//
// It is a capo for one string, and nothing here treats it as anything
// else. The two can never meet — a bar across the neck cannot reach a
// drone, and a pin is only ever driven beside one — so which of them
// holds a given string is settled once, in barFret below, and everything
// downstream asks that rather than asking about capos and spikes.
// ------------------------------------------------------------
export let spikeFrets = new Map();   // drone string -> the fret it is held at

/** Where the spike sits on a string, or 0 for none. */
export function spikeAt(string) {
  return spikeFrets.get(string) ?? 0;
}

/**
 * The frets a string's spike may occupy — from just above that string's
 * own nut to as far as a capo could reach — or null for a string that
 * cannot take one, which is every string but a drone.
 */
export function spikeRange(string) {
  const nut = droneStrings.get(string);
  return nut === undefined ? null : { lo: nut + 1, hi: maxCapoFret() };
}

/**
 * Drive a spike, or pull it out with 0.
 *
 * @returns {number} where it actually landed, after clamping
 */
export function setSpike(string, fret) {
  const range = spikeRange(string);
  if (!range) return 0;
  const at = fret ? Math.max(range.lo, Math.min(Math.round(fret), range.hi)) : 0;
  if (at) spikeFrets.set(string, at); else spikeFrets.delete(string);
  rebuild(instrument);
  return at;
}

/**
 * The fret a string is held at by something that isn't a finger — the
 * capo lying across the neck, or the spike beside a drone. 0 when the
 * string is free to ring from its own nut.
 *
 * This is the question every other part of the model actually has; capos
 * and spikes are two ways of answering it.
 */
export function barFret(string) {
  return droneStrings.has(string) ? spikeAt(string) : capoFret;
}

/** Everything clamped to the neck right now, for anything caching by it. */
export function barsKey() {
  return `${capoFret}` + [...spikeFrets].map(([s, f]) => `/${s}:${f}`).join("");
}

/**
 * The highest fret a capo may sit on. Past the octave nobody capos, and
 * the neck above it has to keep enough room for a hand.
 */
export function maxCapoFret() {
  return Math.max(1, Math.min(12, numFrets - 1));
}

/**
 * Is a hand sitting at fret `lo` up against the nut?
 *
 * Which is the question everything asks when it wants to know whether the
 * open strings are under that hand. With a capo on, the nut has moved,
 * and so has the answer.
 */
export function handAtNut(lo) {
  return lo <= capoFret;
}

/**
 * Is fret `f` under a hand covering frets lo..hi?
 *
 * Fret 0 is the open note rather than a place on the neck, so it is only
 * under the hand when the hand is at the nut — or at the capo, which is
 * now the same thing.
 */
export function fretUnderHand(f, lo, hi) {
  return f === 0 ? handAtNut(lo) : (f >= lo && f <= hi);
}

/**
 * Where a fret sits ON THE NECK, for measuring shapes, spans and how far
 * the hand travels — as opposed to what it sounds, which is midiAt.
 *
 * The fret number itself, except for the open note. That is played at the
 * nut, and a capo has moved the nut: an open string under a capo at the
 * 2nd fret is being held down at the 2nd fret, by the bar instead of by a
 * finger. Reading it as fret 0 puts it at the end of the neck, which is
 * how the open shapes stopped being recognisable under a capo — the very
 * thing a capo is for. Without one this is the identity.
 */
export function handFret(f) {
  return f === 0 ? capoFret : f;
}

/**
 * Move the capo, or take it off with 0.
 *
 * @returns {number} where it actually landed, after clamping
 */
export function setCapo(fret) {
  capoFret = Math.max(0, Math.min(Math.round(fret), maxCapoFret()));
  rebuild(instrument);
  return capoFret;
}

function identityOrder(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Recompute the whole board from an instrument's open pitches and
 * whatever is currently clamped to it. The one place the live state above
 * is written, so mounting an instrument and moving the capo are the same
 * operation with a different reason.
 */
function rebuild(forInstrument) {
  numFrets      = forInstrument.numFrets;
  openMidi      = forInstrument.openMidi;
  droneStrings  = new Map((forInstrument.droneStrings ?? []).map(d => [d.string, d.nutFret]));
  displayOrder  = forInstrument.displayOrder ?? identityOrder(openMidi.length);
  // A capo carried over from a longer neck may not fit this one, and a
  // spike belongs to a drone string another instrument may not have.
  capoFret      = Math.max(0, Math.min(capoFret, maxCapoFret()));
  spikeFrets    = new Map([...spikeFrets]
    .filter(([s]) => droneStrings.has(s))
    .map(([s, f]) => {
      const range = { lo: droneStrings.get(s) + 1, hi: Math.max(1, Math.min(12, numFrets - 1)) };
      return [s, Math.max(range.lo, Math.min(f, range.hi))];
    }));
  chromaticGrid = clampBars(
    capDroneStrings(openMidi.map(m => getFretPcs(midiToPc(m), numFrets)), forInstrument));
  numStrings    = chromaticGrid.length;
  // What the strings sound now, which is what belongs beside the nut —
  // capoed at the 2nd fret a guitar reads F# B E A C# F#, and printing
  // E A D G B E there would be printing a note nothing can play.
  tuning        = openMidi.map((_, s) => FLAT_NAMES[midiToPc(midiAt(s, 0))]);
}

/**
 * Lay whatever is clamped to the neck across the grid: the frets behind
 * a bar stop existing, and the fret it sits on becomes the open note.
 *
 * The same shape of edit capDroneStrings makes, and for the same reason —
 * a string that starts partway up the neck — except that here the frets
 * above the bar keep their own numbering, because the neck is unchanged
 * and only the string's starting point has moved.
 *
 * One loop covers the capo and the spike both, because to a string there
 * is no difference between them: something is holding it down at a fret,
 * and that fret is where it now begins.
 */
function clampBars(grid) {
  return grid.map((stringPcs, s) => {
    const bar = barFret(s);
    if (!bar) return stringPcs;
    return stringPcs.map((pc, f) => {
      if (f === 0) return stringPcs[bar];   // the bar is the open string now
      if (f <= bar) return null;            // behind it; nothing to press
      return pc;
    });
  });
}

// The board as it stands the moment this module loads.
rebuild(instrument);

/**
 * Re-lay a drone string's frets, which do not start where the board's do.
 *
 * A drone string is genuinely short, not fretless. Its nut sits partway
 * up the neck, and two things follow from that. Nothing below the nut
 * exists to press — blanking exactly that range means every search built
 * on chromaticGrid respects it for free, the same way it already respects
 * a fret simply not being in the scale.
 *
 * And the frets it does have are counted from ITS nut, not the board's.
 * A banjo's 5th string is open g at the 5th fret, so the 6th fret is one
 * semitone above the open string, not six. Numbering it by the board
 * would put a C where the G# is, and would have the string reach its
 * octave at the 12th fret when a banjo's 5th string reaches it at the
 * 17th — which is the arithmetic to check this against: 5 + 12 = 17.
 */
function capDroneStrings(grid, forInstrument) {
  for (const d of forInstrument.droneStrings ?? []) {
    const openPc = grid[d.string][0];
    grid[d.string] = grid[d.string].map((_, f) => {
      if (f === 0) return openPc;                        // the open string
      if (f <= d.nutFret) return null;                   // below its nut
      return (openPc + f - d.nutFret) % 12;
    });
  }
  return grid;
}

/**
 * What pitch a fret sounds on a string, in MIDI — the one place that
 * arithmetic is done.
 *
 * Ordinarily it is the open pitch plus the fret number. A drone string
 * is the exception, and has to be: its nut is up the neck, so the fret
 * number overstates how far above the open note it is by exactly the
 * distance to that nut.
 *
 * Fret 0 is the open note in every case — but a capo or a spike has moved
 * what that is, and only that: the frets above the bar are the same
 * pitches they always were, since the neck has not changed, only where
 * the string begins.
 *
 * Which makes the open note no special case at all. It is the string
 * sounding from wherever it is held, and the same arithmetic answers it.
 */
export function midiAt(string, fret) {
  const at = fret === 0 ? barFret(string) : fret;
  return openMidi[string] + Math.max(0, at - (droneStrings.get(string) ?? 0));
}

/**
 * The interval between each pair of neighbouring strings, in semitones.
 *
 * This is the single most consequential fact about a tuning, and almost
 * everything below is derived from it: a guitar and a bass are in
 * fourths, a mandolin in fifths, and that difference is why the same
 * scale makes a different shape on each.
 */
function stringIntervals() {
  return openMidi.slice(1).map((m, i) => m - openMidi[i]);
}

/**
 * How wide a hand position has to be.
 *
 * Not a fact about hands — a fact about the tuning. A string covering
 * frets lo to lo+span-1 reaches the pitch its neighbour starts on only
 * when span is at least the interval between them; anything narrower
 * leaves a band of pitches that exists on neither string, and scale
 * notes fall into that band and vanish. So the window is exactly the
 * widest gap between neighbouring strings: five for a guitar or bass in
 * fourths, seven for a mandolin in fifths.
 *
 * The hand copes because the fret spacing scales with the instrument. A
 * seven-fret stretch at the bottom of a 13.9" mandolin neck is 3.8
 * inches, which is what a four-fret stretch costs on a guitar — so the
 * wider window the tuning demands is the easier reach the small scale
 * length gives back.
 */
export function positionSpan() {
  return Math.max(...stringIntervals());
}

/** One finger per fret: the tightest hand that still covers the scale. */
export function tightSpan() {
  return positionSpan() - 1;
}

/**
 * Point the model at another instrument. Everything above is recomputed
 * from its open pitches; nothing else in the file needs to know.
 *
 * @param {string} id  a key of INSTRUMENTS
 * @returns {object} the instrument now in force
 */
export function setInstrument(id) {
  const next = INSTRUMENTS[id];
  if (!next) throw new Error(`unknown instrument: ${id}`);
  instrument = next;
  // The capo stays where it was put. It is a thing clamped to a neck, not
  // a property of one, and picking up another instrument with the capo
  // still in your hand is what actually happens.
  rebuild(next);
  return instrument;
}

/** Which displays this instrument offers. */
export function supportsKind(kind) {
  return instrument.kinds.includes(kind);
}

/**
 * Build the scale's own 2D grid, same shape as the chromatic grid
 * [string][fret], but each cell is either null (fret not in the scale)
 * or a note object { pc, midi, name, degree, isRoot }.
 */
export function buildScaleGrid(root, type) {
  const rootPc   = noteToPc(root);
  const scalePcs = getScalePcs(rootPc, type);
  const names    = spellScale(root, type);
  const degrees  = getScaleDegrees(type);

  const byPc = {}; // pitch class -> note info
  scalePcs.forEach((pc, i) => {
    byPc[pc] = { name: names[i], degree: degrees[i], isRoot: pc === rootPc };
  });

  return chromaticGrid.map((stringPcs, s) =>
    stringPcs.map((pc, f) =>
      (pc in byPc) ? { pc, midi: midiAt(s, f), ...byPc[pc] } : null)
  );
}
