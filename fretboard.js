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
    kinds: ["scale", "arpeggio"],
    chords: {
      // Not offered yet, so nothing reads this but the fields the shared
      // code touches. Guitar grip rules would not transfer anyway: they
      // assume fourths, and a mandolin's fifths put a chord's notes in
      // completely different places.
      strategy: "guitar",
      scaleLength: 13.875,
      reach: { comfort: Infinity, max: Infinity },
      openReach: 5,
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
export let chromaticGrid = openMidi.map(m => getFretPcs(midiToPc(m), numFrets));
export let numStrings    = chromaticGrid.length;

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
  chromaticGrid = openMidi.map(m => getFretPcs(midiToPc(m), numFrets));
  numStrings    = chromaticGrid.length;
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
