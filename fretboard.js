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
      stretchPenalty: 2.5,
      // A guitarist reaches for the open chord and counts fewer fingers
      // as easier; a mandolin player's default is the closed, movable
      // chop-chord shape fretted on all four strings, so neither habit
      // should weigh as heavily here as it does on a guitar.
      fingerCost: 0.35,
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
    // The 5th string has its own short nut around the 5th fret and is
    // never fretted below it — on a real neck because the string simply
    // isn't there yet. It sounds open, or fretted from its own nut on
    // up; `startFret` is where both the model's fret range and the
    // view's drawing of its nut begin.
    droneStrings: [{ string: 4, startFret: 5 }],
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
export let tuning       = openMidi.map(m => FLAT_NAMES[midiToPc(m)]);   // low -> high
// Chromatic grid: every pitch class at every fret of every string.
export let chromaticGrid = capDroneStrings(
  openMidi.map(m => getFretPcs(midiToPc(m), numFrets)), instrument);
export let numStrings    = chromaticGrid.length;
// Strings with no fret but the open one — a banjo's 5th string, so far —
// mapped to the fret the view should draw their nut and open note at.
// Read by paths.js, which walks raw fret arithmetic rather than this
// grid and so needs telling directly which strings that arithmetic
// isn't allowed to fret; and by view.js, for where to draw them.
export let droneStrings  = new Map((instrument.droneStrings ?? []).map(d => [d.string, d.startFret]));
// Which row each string draws on, bottom to top — identity unless an
// instrument says otherwise (see the banjo entry above for why one
// would). Purely a view concern; nothing in the model reads it.
export let displayOrder  = instrument.displayOrder ?? identityOrder(numStrings);

function identityOrder(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Blank out the frets a drone string doesn't physically have.
 *
 * A drone string is genuinely short, not fretless: it sounds open, and
 * it can be fretted from its own nut on up, but nothing below that nut
 * exists to press. Blanking exactly that range means every search built
 * on chromaticGrid — scale positions, chord voicings — respects it for
 * free, the same way it already respects a fret simply not being in the
 * scale.
 */
function capDroneStrings(grid, forInstrument) {
  for (const d of forInstrument.droneStrings ?? []) {
    grid[d.string] = grid[d.string].map((pc, f) =>
      (f === 0 || f >= d.startFret) ? pc : null);
  }
  return grid;
}

/**
 * The interval between each pair of neighbouring strings, in semitones.
 *
 * This is the single most consequential fact about a tuning, and almost
 * everything below is derived from it: a guitar and a bass are in
 * fourths, a mandolin in fifths, and that difference is why the same
 * scale makes a different shape on each.
 */
export function stringIntervals() {
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
  instrument    = next;
  numFrets      = next.numFrets;
  openMidi      = next.openMidi;
  tuning        = openMidi.map(m => FLAT_NAMES[midiToPc(m)]);
  chromaticGrid = capDroneStrings(openMidi.map(m => getFretPcs(midiToPc(m), numFrets)), next);
  numStrings    = chromaticGrid.length;
  droneStrings  = new Map((next.droneStrings ?? []).map(d => [d.string, d.startFret]));
  displayOrder  = next.displayOrder ?? identityOrder(numStrings);
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
      (pc in byPc) ? { pc, midi: openMidi[s] + f, ...byPc[pc] } : null)
  );
}
