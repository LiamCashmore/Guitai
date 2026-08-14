// ============================================================
// symbols.js — READING AND WRITING WHAT A PLAYER TYPES  (pure, no DOM)
//
// Everything else in this app names a note set the long way: "Minor 7",
// "Aeolian (Minor)", "Ionian (Major)". Nobody writes music that way. A
// player writes Am7, or C-7, or Cø, or ii7, and expects to be understood.
//
// This file is the one place that translation happens, in both
// directions: the symbol a chord is written with, and every spelling of
// it a player might type. One table serves both, because the two must
// agree — a parser that accepts what the app does not print, or prints
// what it cannot read back, is two facts pretending to be one.
//
// It knows nothing about instruments, frets or progressions. It turns
// text into the names theory.js already uses, and the rest of the app
// carries on exactly as if a menu had been used. That is what makes it
// reusable: a chord in a progression, a scale, an arpeggio and a chord
// on its own are all the same question — which root, which note set —
// and all four come through here.
// ============================================================

import { TYPE_NAMES } from "./theory.js";

// ------------------------------------------------------------
// THE CHORD VOCABULARY
//
// Keyed by the app's own name for the note set. The FIRST spelling is
// what gets printed; the rest are only ever read.
//
// Case is meaningful in chord symbols and nowhere else in music writing:
// CM7 is a major seventh and Cm7 is a minor one, and the only difference
// is the shift key. So an alias containing a capital letter is matched
// exactly as written, and only the all-lowercase ones are matched
// case-insensitively. That way "cmaj7" and "CMAJ7" both work, while "M7"
// and "m7" stay the two different chords they are.
// ------------------------------------------------------------
const CHORD_SYMBOLS = {
  "Major Triad":       ["", "maj", "major", "M", "ma", "Ma"],
  "Minor Triad":       ["m", "min", "minor", "-", "mi"],
  "Diminished Triad":  ["°", "dim", "o"],
  "Augmented Triad":   ["+", "aug"],
  "Sus2":              ["sus2", "sus9"],
  "Sus4":              ["sus4", "sus"],
  "Power (5)":         ["5", "no3"],

  "Major 6":           ["6", "maj6", "M6", "ma6"],
  "Minor 6":           ["m6", "min6", "-6", "mi6"],
  "6/9":               ["6/9", "69", "6add9"],
  "Add9":              ["add9", "add2"],
  "Minor Add9":        ["madd9", "minadd9", "-add9"],

  "Major 7":           ["maj7", "M7", "ma7", "major7", "j7"],
  "Dominant 7":        ["7", "dom7", "dom"],
  "Minor 7":           ["m7", "min7", "-7", "mi7"],
  "Minor 7b5":         ["m7b5", "halfdim", "min7b5", "-7b5"],
  "Diminished 7":      ["°7", "dim7", "o7"],
  "Minor-Major 7":     ["mmaj7", "mM7", "minmaj7", "-maj7"],
  "Augmented Major 7": ["maj7#5", "M7#5", "augmaj7", "+maj7"],
  "Augmented 7":       ["7#5", "aug7", "+7"],
  "7sus4":             ["7sus4", "7sus"],
  "7b5":               ["7b5"],

  "Major 9":           ["maj9", "M9", "ma9"],
  "Dominant 9":        ["9", "dom9"],
  "Minor 9":           ["m9", "min9", "-9", "mi9"],

  "Minor 11":          ["m11", "min11", "-11"],
  "Dominant 11":       ["11", "dom11"],

  "Dominant 13":       ["13", "dom13"],
  "Major 13":          ["maj13", "M13", "ma13"],
  "Minor 13":          ["m13", "min13", "-13"],

  "7b9":               ["7b9"],
  "7#9":               ["7#9"],
  "7#11":              ["7#11"],
  "Major 7#11":        ["maj7#11", "M7#11"],
  "7b13":              ["7b13"],
  "7alt":              ["7alt", "alt", "altered"],

  "9b5":               ["9b5"],
  "9#5":               ["9#5"],
  "9#11":              ["9#11"],
  "13b9":              ["13b9"],
  "13#11":             ["13#11"],
  "7b5b9":             ["7b5b9"],
  "7b5#9":             ["7b5#9"],
  "7#5b9":             ["7#5b9"],
  "7#5#9":             ["7#5#9"],
  "7b9b13":            ["7b9b13"],
  "7#9b13":            ["7#9b13"],
};

// ------------------------------------------------------------
// THE SCALE VOCABULARY
//
// Only the words that aren't already the name. Every canonical name is
// accepted as itself — "Lydian Dominant" is what a player would write
// anyway — so this is the short list of things they'd write instead.
//
// "major" and "minor" are the reason this list is separate from the
// chord one at all. In a chord they mean a triad; in a scale they mean
// the whole seven notes, which is a different note set under the same
// word. Only the asking knows which, so each context looks at its own
// vocabulary first.
// ------------------------------------------------------------
const SCALE_WORDS = {
  "major": "Ionian (Major)",
  "maj": "Ionian (Major)",
  "ionian": "Ionian (Major)",
  "minor": "Aeolian (Minor)",
  "min": "Aeolian (Minor)",
  "aeolian": "Aeolian (Minor)",
  "naturalminor": "Aeolian (Minor)",
  "pentatonic": "Major Pentatonic",
  "majorpent": "Major Pentatonic",
  "majpent": "Major Pentatonic",
  "minorpent": "Minor Pentatonic",
  "minpent": "Minor Pentatonic",
  "blues": "Minor Blues",
  "superlocrian": "Altered (Super Locrian)",
  "altered": "Altered (Super Locrian)",
  "wholetone": "Whole Tone",
  "diminished": "Diminished (W-H)",
  "halfwhole": "Diminished (H-W)",
  "wholehalf": "Diminished (W-H)",
};

/**
 * Everything a symbol can be written with, reduced to one spelling.
 *
 * The typographer's characters a player pastes in from a chart or a
 * phone keyboard mean exactly what the ASCII ones do, so they are turned
 * into them here rather than doubling every entry in the tables above.
 * The triangle is the major seventh whether or not a 7 follows it — CΔ
 * and CΔ7 are the same chord, and neither is a plain triad.
 *
 * Spaces survive this, and have to: b is both a flat and the first
 * letter of "blues", so "Ab" and "A blues" are told apart by nothing
 * else. See parseMaterial, which reads the root before the gap closes.
 */
function tidy(text) {
  return String(text)
    .replace(/[♯]/g, "#").replace(/[♭]/g, "b")
    .replace(/[Δ∆]7?/g, "maj7")
    .replace(/[øØ]7?/g, "m7b5")
    .replace(/[°º∘˚]7/g, "dim7").replace(/[°º∘˚]/g, "dim")
    .replace(/[‐‑‒–—−]/g, "-")
    .trim();
}

/** The same, closed up into the one string the tables are keyed by. */
function normal(text) {
  return tidy(text).replace(/[()\s]/g, "");
}

// The chord table, read backwards into a lookup. `exact` holds the
// spellings whose capitals carry meaning; `loose` holds everything that
// can be matched however it was typed. A name is never allowed to
// overwrite an earlier one, so the first spelling of a collision wins —
// which is why "m7" reads as minor even though "M7" is in the table too.
function buildTables(vocab) {
  const exact = new Map(), loose = new Map();
  for (const [name, aliases] of Object.entries(vocab)) {
    for (const alias of aliases) {
      const key = normal(alias);
      if (!exact.has(key)) exact.set(key, name);
      // A capital in an alias is the whole point of that alias, so it is
      // not also offered case-blind.
      if (key === key.toLowerCase() && !loose.has(key)) loose.set(key, name);
    }
  }
  return { exact, loose };
}

const CHORDS = buildTables(CHORD_SYMBOLS);
// The scale words are written the other way round — one word per line,
// several words pointing at one scale — and every one of them is
// lowercase, so there is nothing here for the exact table to protect.
const SCALE_WORD_MAP = new Map(
  Object.entries(SCALE_WORDS).map(([word, name]) => [normal(word).toLowerCase(), name]));

// Every name the app itself uses, accepted as typed. Case-blind: there
// is no "Major 7" / "major 7" distinction to protect here, unlike the
// symbols above.
const CANONICAL = new Map(TYPE_NAMES.map(n => [normal(n).toLowerCase(), n]));

/**
 * Which note set is this text naming?
 *
 * @param {string} text  the quality on its own — "m7", "dorian", ""
 * @param {string} kind  "chord" or "scale": which vocabulary is asked
 *                       first, and the whole of the difference between
 *                       "C major" the triad and "C major" the scale
 * @returns {string|null} a name from theory.js, or null
 */
export function resolveType(text, kind = "chord") {
  const key = normal(text);
  const low = key.toLowerCase();
  // Written as it was typed first, then case-blind — so a capital that
  // means something is honoured before anything that ignores it.
  const chords = [[CHORDS.exact, key], [CHORDS.loose, low]];
  const scales = [[SCALE_WORD_MAP, low]];
  const order = kind === "scale"
    ? [...scales, [CANONICAL, low], ...chords]
    : [...chords, [CANONICAL, low], ...scales];
  for (const [table, lookup] of order) {
    const hit = table.get(lookup);
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------
// READING
// ------------------------------------------------------------

const NOTE = /^([A-Ga-g])([#b]*)$/;
// The root, and everything after it. Read against text that still has
// its spaces, so the flats stop where the word does: "Ab" is a note and
// "A blues" is a note and a scale, and the space is the only thing that
// says so.
const ROOTED = /^([A-Ga-g])([#b]*)(.*)$/;
// A slash chord, but only when what follows the slash is a note. 6/9 is
// a chord whose name simply contains a slash, and C/G is a chord over a
// bass — telling them apart is exactly this question and nothing more.
const OVER = /^(.*)\/([A-Ga-g][#b]*)$/;

/** A note name, spelled the way the rest of the app spells one. */
function tidyNote(letter, accidentals) {
  return letter.toUpperCase() + accidentals;
}

/**
 * A chord written out in full: "Am7", "C#maj7", "Bb13", "F/A".
 *
 * @returns {{root, type, bass, symbol}|null}
 */
export function parseChord(text) {
  let s = tidy(text);
  if (!s) return null;

  let bass = null;
  const over = OVER.exec(s);
  if (over) {
    const note = NOTE.exec(over[2]);
    bass = tidyNote(note[1], note[2]);
    s = over[1];
  }

  const m = ROOTED.exec(s);
  if (!m) return null;
  const root = tidyNote(m[1], m[2]);
  const type = resolveType(m[3], "chord");
  if (!type) return null;

  return { root, type, bass, symbol: chordSymbol(root, type, bass) };
}

// The numerals, longest first so that IV is never read as I with a
// leftover V. An accidental in front lowers or raises the degree itself
// — bVII is the flattened seventh, which is a chord outside the key.
const NUMERAL = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/;
const DEGREE_OF = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

/**
 * A chord written as a scale degree: "ii7", "V", "bVII", "viiø".
 *
 * Case is the convention and it is load-bearing: an upper-case numeral
 * is a major chord and a lower-case one is minor. Which is also why a
 * bare 7 means two different chords — "V7" is the dominant seventh every
 * blues is made of, "ii7" is a minor seventh — so a lower-case numeral
 * looks for the minor form of whatever was asked for before the literal
 * one, and an upper-case numeral takes the symbol at face value.
 *
 * @returns {{numeral, degree, alter, type}|null}
 */
export function parseDegree(text) {
  const m = NUMERAL.exec(normal(text));
  if (!m) return null;

  const [, accidental, numeral, rest] = m;
  const minor = numeral === numeral.toLowerCase();
  const type = minor
    ? (resolveType("m" + rest, "chord") ?? resolveType(rest || "m", "chord"))
    : resolveType(rest, "chord");
  if (!type) return null;

  return {
    numeral: accidental + numeral,
    degree: DEGREE_OF[numeral.toLowerCase()],
    alter: accidental === "b" ? -1 : accidental === "#" ? 1 : 0,
    type,
  };
}

/**
 * One chord of a progression, however it was written.
 *
 * Degrees are tried first. The only place the two notations can be
 * confused is the flat sign, since b is a note as well: "bVII" has to be
 * the flattened seventh rather than a B chord with VII after it, and
 * asking the numeral first settles that without either notation having
 * to be declared up front.
 */
export function parseStep(text) {
  return parseDegree(text) ?? parseChord(text);
}

// Bars, commas and spaces are all just gaps between chords. A dash on
// its own is a gap too — it is how the preset progressions are written,
// "I – IV – V" — but a dash attached to a chord is a minor sign, which
// is why only a token that is nothing but dashes is dropped.
const GAP = /[\s,|]+/;

/**
 * A whole progression: "Am7 | D7 | Gmaj7", "I IV V", "vi IV I V".
 *
 * Both notations can be mixed in one line — there is nothing to stop
 * "C Am F G7" or "I vi ii V", and no reason to. What separates them is
 * only whether the chord names its own root or takes it from the key.
 *
 * @returns {{steps: Array, errors: string[]}} everything that read, and
 *          every word that didn't — reported rather than skipped, since
 *          a silently dropped chord is a progression that isn't the one
 *          the player wrote.
 */
export function parseProgression(text) {
  const steps = [], errors = [];
  for (const token of String(text ?? "").split(GAP)) {
    if (!token || /^-+$/.test(normal(token))) continue;
    const step = parseStep(token);
    if (step) steps.push(step); else errors.push(token);
  }
  return { steps, errors };
}

/**
 * A root and a note set, from one phrase: "C dorian", "F# m7", "Eb".
 *
 * The same reading as a chord, asked in whichever vocabulary the caller
 * is working in — so the scale menu and the chord menu can both be
 * driven by typing, and "A minor" means the scale in one and the triad
 * in the other, which is what it means to a player in each case.
 *
 * @param {string} kind  "chord" (also arpeggios) or "scale"
 * @returns {{root, type}|null}
 */
export function parseMaterial(text, kind = "chord") {
  const m = ROOTED.exec(tidy(text));
  if (!m) return null;
  const type = resolveType(m[3], kind);
  return type ? { root: tidyNote(m[1], m[2]), type } : null;
}

// ------------------------------------------------------------
// WRITING
// ------------------------------------------------------------

/** How a chord quality is written above a stave, rather than named. */
export function typeSymbol(type) {
  // A chord with no symbol of its own is written out — better a long
  // label than a wrong one.
  return CHORD_SYMBOLS[type]?.[0] ?? ` ${type}`;
}

/** The whole chord as it would appear on a chart. */
export function chordSymbol(root, type, bass = null) {
  return root + typeSymbol(type) + (bass ? `/${bass}` : "");
}
