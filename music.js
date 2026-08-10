// ============================================================
// music.js — MUSIC THEORY + FRETBOARD MODEL  (pure, no DOM)
//
// Notes are handled internally as pitch classes (0..11, A = 0).
// Display spelling (sharps vs flats) is decided from each note's
// scale degree, so every letter A..G is used once in a 7-note scale
// and accidentals match the key context.
//
// Nothing in this file touches the page. It returns plain arrays and
// objects, so the same logic can feed the SVG view today or a React
// Native view later.
// ============================================================

const LETTERS   = ["A","B","C","D","E","F","G"];
const LETTER_PC = { A:0, B:2, C:3, D:5, E:7, F:8, G:10 };

// Root choices offered in the UI. Black keys list both spellings so the
// player chooses the tonal context (e.g. Db major vs C# major).
export const rootOptions = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];

// Canonical name of the major scale (used to gate CAGED, etc.).
export const MAJOR_SCALE = "Ionian (Major)";

// Parse a note name ("Db", "F##", "G") into a pitch class 0..11.
function noteToPc(name) {
  let pc = LETTER_PC[name[0]];
  for (let i = 1; i < name.length; i++) {
    pc += name[i] === "#" ? 1 : name[i] === "b" ? -1 : 0;
  }
  return ((pc % 12) + 12) % 12;
}

// Accidental string needed to spell pitch class `pc` on a given letter.
function accidental(pc, letter) {
  let d = (((pc - LETTER_PC[letter]) % 12) + 12) % 12; // 0..11
  if (d > 6) d -= 12;                                  // fold to -5..6
  return d < 0 ? "b".repeat(-d) : "#".repeat(d);
}

// Semitone-step formulas. Every array sums to 12 (one octave).
const scaleFormulas = {
  // Major (diatonic) modes
  "Ionian (Major)":          [2,2,1,2,2,2,1],
  "Dorian":                  [2,1,2,2,2,1,2],
  "Phrygian":                [1,2,2,2,1,2,2],
  "Lydian":                  [2,2,2,1,2,2,1],
  "Mixolydian":              [2,2,1,2,2,1,2],
  "Aeolian (Minor)":         [2,1,2,2,1,2,2],
  "Locrian":                 [1,2,2,1,2,2,2],

  // Melodic minor modes
  "Melodic Minor":           [2,1,2,2,2,2,1],
  "Dorian b2":               [1,2,2,2,2,1,2],
  "Lydian Augmented":        [2,2,2,2,1,2,1],
  "Lydian Dominant":         [2,2,2,1,2,1,2],
  "Mixolydian b6":           [2,2,1,2,1,2,2],
  "Locrian #2":              [2,1,2,1,2,2,2],
  "Altered (Super Locrian)": [1,2,1,2,2,2,2],

  // Harmonic minor modes
  "Harmonic Minor":          [2,1,2,2,1,3,1],
  "Locrian nat6":            [1,2,2,1,3,1,2],
  "Ionian #5":               [2,2,1,3,1,2,1],
  "Dorian #4":               [2,1,3,1,2,1,2],
  "Phrygian Dominant":       [1,3,1,2,1,2,2],
  "Lydian #2":               [3,1,2,1,2,2,1],
  "Altered Diminished":      [1,2,1,2,2,1,3],

  // Harmonic major
  "Harmonic Major":          [2,2,1,2,1,3,1],

  // Pentatonic & blues
  "Major Pentatonic":        [2,2,3,2,3],
  "Minor Pentatonic":        [3,2,2,3,2],
  "Minor Blues":             [3,2,1,1,3,2],
  "Major Blues":             [2,1,1,3,2,3],

  // Symmetric
  "Chromatic":               [1,1,1,1,1,1,1,1,1,1,1,1],
  "Whole Tone":              [2,2,2,2,2,2],
  "Diminished (W-H)":        [2,1,2,1,2,1,2,1],
  "Diminished (H-W)":        [1,2,1,2,1,2,1,2],
  "Augmented":               [3,1,3,1,3,1],

  // Bebop (8-note: a seven-note scale plus one chromatic passing tone,
  // placed so chord tones land on the beat when the scale is run in
  // eighth notes — which is the whole point of them)
  "Bebop Dominant":          [2,2,1,2,2,1,1,1],   // Mixolydian + natural 7
  "Bebop Major":             [2,2,1,2,1,1,2,1],   // Ionian + #5
  "Bebop Dorian":            [2,1,1,1,2,2,1,2],   // Dorian + natural 3
  "Bebop Melodic Minor":     [2,1,2,2,1,1,2,1],   // melodic minor + #5
  "Bebop Harmonic Minor":    [2,1,2,2,1,2,1,1],   // natural minor + natural 7
  "Bebop Half-Diminished":   [1,2,2,1,1,1,2,2],   // Locrian + natural 5
  "Bebop Dominant b9":       [1,3,1,2,1,2,1,1],   // Phrygian dominant + natural 7

  // Exotic
  "Hungarian Minor":         [2,1,3,1,1,3,1],
  "Double Harmonic":         [1,3,1,2,1,3,1],
  "Neapolitan Minor":        [1,2,2,2,1,3,1],
  "Neapolitan Major":        [1,2,2,2,2,2,1],

  // ---- Arpeggios ----------------------------------------
  // Chords laid out as note sets, exactly like scales — just sparser.
  // Everything downstream (the grid, spelling, positions, runs) treats
  // them the same way, so nothing else has to know the difference.
  "Major Triad":             [4,3,5],       // 1  3  5
  "Minor Triad":             [3,4,5],       // 1 b3  5
  "Diminished Triad":        [3,3,6],       // 1 b3 b5
  "Augmented Triad":         [4,4,4],       // 1  3 #5
  // Suspended: the third gives way to the note either side of it, which
  // is why they sound unresolved — neither major nor minor.
  "Sus2":                    [2,5,5],       // 1  2  5
  "Sus4":                    [5,2,5],       // 1  4  5

  "Major 7":                 [4,3,4,1],     // 1  3  5  7
  "Dominant 7":              [4,3,3,2],     // 1  3  5 b7
  "Minor 7":                 [3,4,3,2],     // 1 b3  5 b7
  "Minor 7b5":               [3,3,4,2],     // 1 b3 b5 b7
  "Diminished 7":            [3,3,3,3],     // 1 b3 b5 bb7
  "Minor-Major 7":           [3,4,4,1],     // 1 b3  5  7
  "Augmented Major 7":       [4,4,3,1],     // 1  3 #5  7
  "Augmented 7":             [4,4,2,2],     // 1  3 #5 b7
  "7sus4":                   [5,2,3,2],     // 1  4  5 b7

  "Major 6":                 [4,3,2,3],     // 1  3  5  6
  "Minor 6":                 [3,4,2,3],     // 1 b3  5  6

  // ---- Extended and altered -----------------------------
  // Written as pitch-class sets like everything else, so a 13th chord is
  // simply a seven-note set. Which of those notes a guitar can actually
  // sound is decided later, by essentialDegrees.
  "Power (5)":               [7,5],         // 1  5
  "Add9":                    [2,2,3,5],     // 1  9  3  5
  "Minor Add9":              [2,1,4,5],     // 1  9 b3  5
  "7b5":                     [4,2,4,2],     // 1  3 b5 b7
  "6/9":                     [2,2,3,2,3],   // 1  9  3  5  6

  "Major 9":                 [2,2,3,4,1],   // 1  9  3  5  7
  "Dominant 9":              [2,2,3,3,2],   // 1  9  3  5 b7
  "Minor 9":                 [2,1,4,3,2],   // 1  9 b3  5 b7

  "Minor 11":                [2,1,2,2,3,2], // 1  9 b3 11  5 b7
  "Dominant 11":             [2,2,1,2,3,2], // 1  9  3 11  5 b7

  "Dominant 13":             [2,2,1,2,2,1,2], // 1 9  3 11 5 13 b7
  "Major 13":                [2,2,1,2,2,2,1], // 1 9  3 11 5 13  7
  "Minor 13":                [2,1,2,2,2,1,2], // 1 9 b3 11 5 13 b7

  "7b9":                     [1,3,3,3,2],   // 1 b9  3  5 b7
  "7#9":                     [3,1,3,3,2],   // 1 #9  3  5 b7
  "7#11":                    [4,2,1,3,2],   // 1  3 #11 5 b7
  "Major 7#11":              [4,2,1,4,1],   // 1  3 #11 5  7
  "7b13":                    [4,3,1,2,2],   // 1  3  5 b13 b7
  "7alt":                    [1,2,1,2,4,2], // 1 b9 #9  3 b5 b7

  // ---- Altered dominants --------------------------------
  // The working vocabulary of jazz: a dominant seventh with its upper
  // notes bent one way or the other to pull harder toward the tonic.
  // Where two alterations are named, both belong to the chord — unlike
  // a plain "alt", where the player chooses.
  "9b5":                     [2,2,2,4,2],   // 1  9  3 b5 b7
  "9#5":                     [2,2,4,2,2],   // 1  9  3 #5 b7
  "9#11":                    [2,2,2,1,3,2], // 1  9  3 #11 5 b7
  "13b9":                    [1,3,3,2,1,2], // 1 b9  3  5 13 b7
  "13#11":                   [2,2,2,3,1,2], // 1  9  3 #11 13 b7
  "7b5b9":                   [1,3,2,4,2],   // 1 b9  3 b5 b7
  "7b5#9":                   [3,1,2,4,2],   // 1 #9  3 b5 b7
  "7#5b9":                   [1,3,4,2,2],   // 1 b9  3 #5 b7
  "7#5#9":                   [3,1,4,2,2],   // 1 #9  3 #5 b7
  "7b9b13":                  [1,3,3,1,2,2], // 1 b9  3  5 b13 b7
  "7#9b13":                  [3,1,3,1,2,2], // 1 #9  3  5 b13 b7
};

// Grouping just for the dropdown UI (keys must match scaleFormulas).
export const scaleGroups = {
  "Major Modes":          ["Ionian (Major)","Dorian","Phrygian","Lydian","Mixolydian","Aeolian (Minor)","Locrian"],
  "Melodic Minor Modes":  ["Melodic Minor","Dorian b2","Lydian Augmented","Lydian Dominant","Mixolydian b6","Locrian #2","Altered (Super Locrian)"],
  "Harmonic Minor Modes": ["Harmonic Minor","Locrian nat6","Ionian #5","Dorian #4","Phrygian Dominant","Lydian #2","Altered Diminished"],
  "Harmonic Major":       ["Harmonic Major"],
  "Pentatonic & Blues":   ["Major Pentatonic","Minor Pentatonic","Minor Blues","Major Blues"],
  "Symmetric":            ["Chromatic","Whole Tone","Diminished (W-H)","Diminished (H-W)","Augmented"],
  "Bebop":                ["Bebop Dominant","Bebop Major","Bebop Dorian","Bebop Melodic Minor","Bebop Harmonic Minor","Bebop Half-Diminished","Bebop Dominant b9"],
  "Exotic":               ["Hungarian Minor","Double Harmonic","Neapolitan Minor","Neapolitan Major"],
};

// (arpeggioGroups is defined below, sharing the chord list.)

// Chords use the same note sets; the difference is that they are gripped
// rather than played in sequence.
export const chordGroups = {
  "Triads & Power":  ["Major Triad", "Minor Triad", "Diminished Triad",
                      "Augmented Triad", "Sus2", "Sus4", "Power (5)"],
  "Sixths & Adds":   ["Major 6", "Minor 6", "6/9", "Add9", "Minor Add9"],
  "Sevenths":        ["Major 7", "Dominant 7", "Minor 7", "Minor 7b5",
                      "Diminished 7", "Minor-Major 7", "Augmented Major 7",
                      "Augmented 7", "7sus4", "7b5"],
  "Ninths":          ["Major 9", "Dominant 9", "Minor 9"],
  "Elevenths & Thirteenths":
                     ["Minor 11", "Dominant 11", "Dominant 13",
                      "Major 13", "Minor 13"],
  "Altered":         ["7b9", "7#9", "7#11", "Major 7#11", "7b13", "7alt"],
  "Altered Dominants":
                     ["9b5", "9#5", "9#11", "13b9", "13#11",
                      "7b5b9", "7b5#9", "7#5b9", "7#5#9",
                      "7b9b13", "7#9b13"],
};

// Every chord is also an arpeggio — the same notes, played one at a time
// instead of together. The two menus share a list so they cannot drift
// apart as chords are added.
export const arpeggioGroups = chordGroups;

/** The menu for a given kind of material. */
export function groupsFor(kind) {
  if (kind === "arpeggio") return arpeggioGroups;
  if (kind === "chord")    return chordGroups;
  return scaleGroups;
}

// ---- Scale-degree labels ----------------------------------
// Reference: semitone offset of each degree in the major scale.
const majorRef = [0, 2, 4, 5, 7, 9, 11]; // degrees 1..7

// Symmetric / bebop / pentatonic scales don't map onto 7 letter-names,
// so their degree spellings are given explicitly (conventional jazz usage).
const explicitDegrees = {
  // Ascending chromatic is conventionally written with flats, so the
  // raised degrees are spelled as lowered ones: b2 rather than #1.
  "Chromatic":           ["1","b2","2","b3","3","4","b5","5","b6","6","b7","7"],

  "Major Pentatonic":    ["1","2","3","5","6"],
  "Minor Pentatonic":    ["1","b3","4","5","b7"],
  "Minor Blues":         ["1","b3","4","b5","5","b7"],
  "Major Blues":         ["1","2","b3","3","5","6"],
  "Whole Tone":          ["1","2","3","#4","#5","b7"],
  "Diminished (W-H)":    ["1","2","b3","4","b5","#5","6","7"],
  "Diminished (H-W)":    ["1","b2","#2","3","#4","5","6","b7"],
  "Augmented":           ["1","#2","3","5","#5","7"],
  "Bebop Dominant":      ["1","2","3","4","5","6","b7","7"],
  "Bebop Major":         ["1","2","3","4","5","#5","6","7"],
  "Bebop Dorian":        ["1","2","b3","3","4","5","6","b7"],
  "Bebop Melodic Minor": ["1","2","b3","4","5","#5","6","7"],
  "Bebop Harmonic Minor":["1","2","b3","4","5","b6","b7","7"],
  "Bebop Half-Diminished":["1","b2","b3","4","b5","5","b6","b7"],
  "Bebop Dominant b9":   ["1","b2","3","4","5","b6","b7","7"],

  // Arpeggios: chord tones, so the degrees are given outright.
  "Major Triad":         ["1","3","5"],
  "Minor Triad":         ["1","b3","5"],
  "Diminished Triad":    ["1","b3","b5"],
  "Augmented Triad":     ["1","3","#5"],
  "Sus2":                ["1","2","5"],
  "Sus4":                ["1","4","5"],
  "Augmented Major 7":   ["1","3","#5","7"],
  "Augmented 7":         ["1","3","#5","b7"],
  "7sus4":               ["1","4","5","b7"],
  "Major 7":             ["1","3","5","7"],
  "Dominant 7":          ["1","3","5","b7"],
  "Minor 7":             ["1","b3","5","b7"],
  "Minor 7b5":           ["1","b3","b5","b7"],
  "Diminished 7":        ["1","b3","b5","bb7"],
  "Minor-Major 7":       ["1","b3","5","7"],
  "Major 6":             ["1","3","5","6"],
  "Minor 6":             ["1","b3","5","6"],

  "Power (5)":           ["1","5"],
  "Add9":                ["1","9","3","5"],
  "Minor Add9":          ["1","9","b3","5"],
  "7b5":                 ["1","3","b5","b7"],
  "6/9":                 ["1","9","3","5","6"],
  "Major 9":             ["1","9","3","5","7"],
  "Dominant 9":          ["1","9","3","5","b7"],
  "Minor 9":             ["1","9","b3","5","b7"],
  "Minor 11":            ["1","9","b3","11","5","b7"],
  "Dominant 11":         ["1","9","3","11","5","b7"],
  "Dominant 13":         ["1","9","3","11","5","13","b7"],
  "Major 13":            ["1","9","3","11","5","13","7"],
  "Minor 13":            ["1","9","b3","11","5","13","b7"],
  "7b9":                 ["1","b9","3","5","b7"],
  "7#9":                 ["1","#9","3","5","b7"],
  "7#11":                ["1","3","#11","5","b7"],
  "Major 7#11":          ["1","3","#11","5","7"],
  "7b13":                ["1","3","5","b13","b7"],
  "7alt":                ["1","b9","#9","3","b5","b7"],

  "9b5":                 ["1","9","3","b5","b7"],
  "9#5":                 ["1","9","3","#5","b7"],
  "9#11":                ["1","9","3","#11","5","b7"],
  "13b9":                ["1","b9","3","5","13","b7"],
  "13#11":               ["1","9","3","#11","13","b7"],
  "7b5b9":               ["1","b9","3","b5","b7"],
  "7b5#9":               ["1","#9","3","b5","b7"],
  "7#5b9":               ["1","b9","3","#5","b7"],
  "7#5#9":               ["1","#9","3","#5","b7"],
  "7b9b13":              ["1","b9","3","5","b13","b7"],
  "7#9b13":              ["1","#9","3","5","b13","b7"],
};

// Degree labels for a scale, in the same order as getScalePcs.
function getScaleDegrees(type) {
  if (explicitDegrees[type]) return explicitDegrees[type];
  const seq = scaleFormulas[type];
  const labels = [];
  let offset = 0;
  for (let i = 0; i < seq.length; i++) {
    const diff = offset - majorRef[i];
    const acc = diff < 0 ? "b".repeat(-diff) : diff > 0 ? "#".repeat(diff) : "";
    labels.push(acc + (i + 1));
    offset += seq[i];
  }
  return labels;
}

// Pitch classes of a scale, in order (root first).
function getScalePcs(rootPc, type) {
  const seq = scaleFormulas[type];
  const pcs = [];
  let interval = 0;
  for (let i = 0; i < seq.length; i++) {
    pcs.push((rootPc + interval) % 12);
    interval += seq[i];
  }
  return pcs;
}

// Pitch classes on a single string, from open (fret 0) to numFrets.
function getFretPcs(openPc, frets) {
  const arr = [];
  for (let f = 0; f <= frets; f++) arr.push((openPc + f) % 12);
  return arr;
}

// Properly spelled note names for a scale. The scale degree fixes the
// letter (degree 3 -> two letters up from the root letter, etc.); the
// accidental is whatever makes that letter equal the actual pitch.
// Plain flat names, indexed by pitch class (A = 0).
const FLAT_NAMES = ["A","Bb","B","C","Db","D","Eb","E","F","Gb","G","Ab"];

function spellScale(root, type) {
  // The chromatic scale is written pragmatically rather than by degree.
  // Spelling all twelve notes strictly by degree forces a letter for each
  // one, which in flat keys produces double flats (Eb's b5 is Bbb) and in
  // sharp keys a mix of sharps and flats. Ascending chromatic is
  // conventionally read in flats, so that is what it gets — with the root
  // kept as chosen, so picking C# doesn't relabel itself Db.
  if (type === "Chromatic") {
    const rootPc = noteToPc(root);
    return getScalePcs(rootPc, type)
      .map((pc, i) => i === 0 ? root : FLAT_NAMES[pc]);
  }

  const rootIdx = LETTERS.indexOf(root[0]);
  const rootPc  = noteToPc(root);
  const pcs     = getScalePcs(rootPc, type);
  const degrees = getScaleDegrees(type);
  return degrees.map((deg, i) => {
    const num = parseInt(deg.replace(/[^0-9]/g, ""), 10); // 1..7
    const letter = LETTERS[(rootIdx + num - 1) % 7];
    return letter + accidental(pcs[i], letter);
  });
}

// ============================================================
// FRETBOARD MODEL
// ============================================================

export const numFrets = 17;
export const tuning = ["E","A","D","G","B","E"];   // low -> high
// MIDI pitch of each open string (E2 A2 D3 G3 B3 E4). Absolute pitch —
// not just pitch class — is what lets us spot unisons: the same note
// reachable on two different strings, e.g. open B and G-string fret 4.
export const openMidi = [40, 45, 50, 55, 59, 64];
// Chromatic grid: every pitch class at every fret of every string.
export const chromaticGrid = tuning.map(o => getFretPcs(noteToPc(o), numFrets));
export const numStrings = chromaticGrid.length;

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

// ============================================================
// CAGED SHAPES  (natural modes only)
//
// The five shapes come from the five movable major-chord forms, so
// they only apply to the major scale and its modes. Each shape is a
// fret window defined RELATIVE to where the parent major's root sits
// on the low-E string — not anchored on the root itself.
//
// Crucially the spans are NOT uniform: they alternate 5 and 4 frets.
// Forcing every box to 4 frets is what drops notes out of the E, D
// and A shapes.
//
// Offsets below are measured from the parent root's fret on string 6.
// For G major (root at fret 3) they produce:
//   G 0-4 · E 2-5 · D 4-8 · C 7-10 · A 9-13, then an octave up G 11-15.
//
// The G shape sits BELOW its root (offset -4), so in the open position
// it would start at fret -1; the nut clamps it to 0. Higher up the neck
// it lands where it belongs — for G major that is 11-15, not 12-16.
// Anchoring it at the root instead forces 3-note strings across 5 frets.
// ============================================================

const CAGED_TEMPLATES = [
  { shape: "G", offset: -4, span: 5 },
  { shape: "E", offset: -1, span: 4 },
  { shape: "D", offset:  1, span: 5 },
  { shape: "C", offset:  4, span: 4 },
  { shape: "A", offset:  6, span: 5 },
];

// A hand covers four frets comfortably; open strings cost no finger.
const MAX_FRETTED_SPAN = 4;

// Semitones from a parent major's root up to each mode's root. Every
// mode shares its note set (and therefore its shapes) with that parent.
const MODE_TO_PARENT = {
  "Ionian (Major)": 0, "Dorian": 2, "Phrygian": 4, "Lydian": 5,
  "Mixolydian": 7, "Aeolian (Minor)": 9, "Locrian": 11,
};

// CAGED is only meaningful for the natural modes.
export function supportsCaged(type) {
  return type in MODE_TO_PARENT;
}

/**
 * Every CAGED box that fits on the neck, ordered low to high.
 * Shapes repeat an octave (12 frets) higher, and the list simply stops
 * when the next box would run off either end of the fretboard.
 *
 * @returns {Array<{shape, lo, hi}>} empty if the scale isn't a mode
 */
export function cagedPositions(root, type) {
  if (!supportsCaged(type)) return [];

  // Resolve the parent major, then find its root on the low-E string.
  const parentPc  = ((noteToPc(root) - MODE_TO_PARENT[type]) % 12 + 12) % 12;
  const rootFret6 = ((parentPc - chromaticGrid[0][0]) % 12 + 12) % 12;

  const boxes = [];
  const seen = new Set();
  for (let octave = -1; octave <= 2; octave++) {
    for (const t of CAGED_TEMPLATES) {
      let lo = rootFret6 + t.offset + 12 * octave;
      // The nut is a hard boundary. A shape reaching just one fret below
      // it still works, because open strings stand in for that fret --
      // this is what puts the G shape at 0-4 in open position. Anything
      // further below the nut genuinely doesn't fit and is skipped; it
      // will reappear an octave higher.
      if (lo === -1) lo = 0;
      if (lo < 0) continue;
      const hi = lo + t.span - 1;
      if (hi > numFrets) continue;             // ran off the high end
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boxes.push({ shape: t.shape, lo, hi, maxSpan: MAX_FRETTED_SPAN });
    }
  }
  boxes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  return boxes;
}

// Null out every cell outside a fret-window box.
export function maskToBox(grid, box) {
  return grid.map(row =>
    row.map((cell, f) => (cell && f >= box.lo && f <= box.hi) ? cell : null)
  );
}

/**
 * Remove unisons. The same pitch is often reachable on two strings —
 * open B and G-string fret 4 are both B3 — and a scale should sound each
 * pitch once, so the copy at the higher fret is dropped.
 *
 * Nothing else is removed. If a note sits inside the box and belongs to
 * the scale, it is shown; notes that happen to fall close together on
 * one string are simply easy to play, not a problem to prune away.
 */
export function prunePlayable(grid) {
  const out = grid.map(row => row.slice());

  const bestByMidi = new Map();
  out.forEach((row, s) => row.forEach((cell, f) => {
    if (!cell) return;
    const prev = bestByMidi.get(cell.midi);
    if (!prev || f < prev.f) bestByMidi.set(cell.midi, { s, f });
  }));
  out.forEach((row, s) => row.forEach((cell, f) => {
    if (!cell) return;
    const keep = bestByMidi.get(cell.midi);
    if (keep.s !== s || keep.f !== f) out[s][f] = null;
  }));

  return out;
}

/**
 * The scale grid reduced to a single position: everything inside the
 * box that belongs to the scale, minus unisons.
 */
export function getShapeGrid(root, type, box) {
  return prunePlayable(maskToBox(buildScaleGrid(root, type), box));
}

// ============================================================
// PLAYABLE POSITIONS  (works for every scale)
//
// A position is built as an ascending RUN rather than by filtering a
// rectangle. That distinction matters: a rigid fret window leaves a
// two-semitone blind spot between the top of one string and the bottom
// of the next, so notes fall out of the middle of the scale. Walking
// the scale note by note and handing successive notes to successive
// strings makes gaps impossible by construction.
//
// Every position therefore:
//   - runs through consecutive scale degrees with nothing skipped,
//   - never repeats a pitch (each note is strictly higher than the last),
//   - keeps 2-3 notes per string inside a four-fret reach.
//
// Only if a scale cannot be covered that way do the tiers relax to a
// five-fret reach, then to four notes per string.
// ============================================================

// A five-fret box is the natural unit here. Adjacent strings are five
// semitones apart, so a five-fret window covers every pitch in its range
// with no blind spot between strings — which makes a missing scale note
// impossible. Four-fret windows leave a one-semitone hole between each
// pair of strings, and that hole is where notes used to disappear.
const TIGHT_SPAN    = 4;   // one finger per fret — the tightest hand
const POSITION_SPAN = 5;   // index anchors the low note, pinky stretches one

// MIDI note -> pitch class in this file's convention (A = 0).
function midiToPc(midi) { return (midi + 3) % 12; }

/** Describe one box: note count, spread, and whether the run has holes. */
function inspectBox(grid, pcs, lo, hi) {
  const kept = prunePlayable(maskToBox(grid, { lo, hi }));
  const cells = [];
  const perString = Array(numStrings).fill(0);

  for (let s = 0; s < numStrings; s++) {
    for (let f = 0; f <= numFrets; f++) {
      if (!kept[s][f]) continue;
      cells.push({ string: s, fret: f, midi: kept[s][f].midi, pc: kept[s][f].pc });
      perString[s]++;
    }
  }
  if (cells.length === 0) {
    return { lo, hi, notes: 0, gaps: Infinity, complete: false, minPerString: 0, perString, cells };
  }

  const pitches = cells.map(c => c.midi).sort((a, b) => a - b);
  const have = new Set(pitches);
  let gaps = 0;
  for (let p = pitches[0]; p <= pitches[pitches.length - 1]; p++) {
    if (pcs.has(midiToPc(p)) && !have.has(p)) gaps++;
  }
  const covered = new Set(cells.map(c => c.pc));
  const frets = cells.map(c => c.fret);
  return {
    // Trimmed to the frets actually played: a box can open on a fret
    // nothing lands on, and that dead edge is not part of the position.
    lo: Math.min(...frets), hi: Math.max(...frets),
    notes: cells.length, gaps, perString, cells,
    complete: covered.size === pcs.size,
    minPerString: Math.min(...perString),
    // Identity of the position — the exact notes under the hand.
    key: cells.map(c => `${c.string}:${c.fret}`).sort().join("|"),
  };
}

/**
 * A box is usable when the hand can stay put and the material comes out
 * whole: every pitch class present, and no hole anywhere in the run from
 * its lowest note to its highest.
 *
 * Normally every string should sound too. A set as sparse as a power
 * chord can't manage that — its two notes sit seven semitones apart, so a
 * hand's width of neck will sometimes cross a string carrying neither —
 * and demanding it would leave the shape with no positions at all.
 */
function boxIsPlayable(info, sparse) {
  if (info.gaps !== 0 || !info.complete) return false;
  return sparse ? info.notes >= 3 : info.minPerString >= 1;
}

/**
 * Every playable position for a scale, ordered low to high.
 *
 * One box is tried at each fret rather than sampling every few, because
 * neighbouring boxes are genuinely different fingerings — shifting a
 * whole-tone box by one fret swaps a three-note low E string for a
 * two-note one, and that second shape is just as playable as the first.
 *
 * Both a four-fret and a five-fret hand are tried at every fret, and
 * each one that produces a different set of notes is kept — the wider
 * box is a real alternative fingering, not a worse copy of the tight
 * one, so both are offered.
 *
 * Boxes are identified by the notes they hold rather than by their fret
 * bounds. Two windows one fret apart can land on exactly the same notes
 * when the extra fret is empty; that is one position, not two, so the
 * repeat is dropped.
 */
export function generalPositions(root, type) {
  const grid = buildScaleGrid(root, type);
  const pcs  = new Set(getScalePcs(noteToPc(root), type));
  // Fewer than three notes and the set is too thin to reach every string.
  const sparse = pcs.size < 3;

  const boxes = [];
  const seen = new Set();
  for (let lo = 0; lo <= numFrets - TIGHT_SPAN + 1; lo++) {
    for (const span of [TIGHT_SPAN, POSITION_SPAN]) {
      const hi = lo + span - 1;
      if (hi > numFrets) continue;
      const info = inspectBox(grid, pcs, lo, hi);
      if (!boxIsPlayable(info, sparse)) continue;
      if (seen.has(info.key)) continue;        // same notes as an earlier box
      seen.add(info.key);
      boxes.push({ shape: null, lo: info.lo, hi: info.hi, notes: info.notes, key: info.key });
    }
  }
  return boxes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
}

// ============================================================
// CHORD VOICINGS  (grips, not sequences)
//
// A chord is sounded all at once, which runs into the hand: four
// fingers, six strings, and only so far a reach. A voicing here puts one
// note on each of a run of neighbouring strings, rising in pitch as it
// crosses them — the close, stacked shape a triad naturally makes on a
// guitar.
//
// Root position only for now: the root is the lowest note sounding.
// The notes above it may still land in either order, so a triad comes
// out as 1-3-5 or as 1-5-3 depending on where the strings fall.
// ============================================================

// Four frets is what the hand covers without complaint. Five is reachable
// and sometimes the only way — a major 7 stacked in order on the lower
// strings is 8,7,5,4, and a diminished triad's flat fifth pulls the shape
// wide as well — but it is a stretch, so it is allowed and marked rather
// than treated as equal.
const CHORD_COMFORT = 4;
const CHORD_SPAN    = 5;
const CHORD_OPEN    = 5;   // an open string belongs near the nut
const CHORD_OPEN_SPAN = 3; // ...and keeps the grip around it tight
const CHORD_FINGERS = 4;

const CHORD_MAX_BARRES = 2;   // the index can barre, and one other finger

/**
 * Which of a chord's notes have to sound, and which the guitar may let go.
 *
 * A thirteenth chord has seven notes; there are six strings and four
 * fingers. Leaving notes out isn't a liberty, it's forced — so the
 * question is which ones carry the chord's meaning:
 *
 *   - the third says major or minor, and never goes;
 *   - the seventh says which seventh it is, and never goes;
 *   - an altered note — b5, #5, b9, #9, #11, b13 — is the whole reason
 *     the chord is named what it is, so it stays;
 *   - the highest natural extension gives the chord its number: a 13
 *     chord without its 13th is just a 7;
 *   - the perfect fifth carries almost nothing and is dropped first;
 *   - lower extensions give way to higher ones — the 9th and 11th of a
 *     13 chord are colour, not identity.
 *
 * Triads are left whole: with only three notes there is nothing to spare.
 */
// Chords whose alterations are a choice rather than a list. "Alt" means
// altered, not exhaustive — the player takes the colours that fit the
// hand. Everywhere else, an alteration in the chord's name belongs to the
// chord: 7#5#9 wants both, and giving only one would make it a different
// chord entirely.
const CHORD_CHOICES = {
  "7alt": ["b9", "#9", "b5"],
};

export function chordRequirements(degrees, type) {
  if (degrees.length <= 3) return { required: new Set(degrees), anyOf: [] };
  const has = d => degrees.includes(d);

  const required = new Set(["1"]);
  for (const d of ["3", "b3", "2", "4"]) if (has(d)) required.add(d);   // quality
  for (const d of ["7", "b7", "bb7", "6"]) if (has(d)) required.add(d); // the seventh

  // Altered notes are the reason the chord is named what it is, so they
  // stay — unless this is a chord that leaves the choice open.
  const altered = degrees.filter(d =>
    /^[#b]/.test(d) && !["b3", "b7", "bb7"].includes(d));
  const optional = new Set(CHORD_CHOICES[type] ?? []);
  const anyOf = [];
  const choose = altered.filter(d => optional.has(d));
  for (const d of altered) if (!optional.has(d)) required.add(d);
  if (choose.length) anyOf.push(new Set(choose));

  const names = ["13", "11", "9"].find(has);                           // what it's called
  if (names) required.add(names);

  // Once a chord needs five notes there is nowhere left to put them, and
  // the note that goes is the root: a bass player or the next string down
  // supplies it, while the third, seventh and alterations carry the
  // chord's meaning by themselves. This is ordinary practice on dense
  // dominants, and it is what makes them playable across the whole neck.
  if (required.size >= 5) required.delete("1");

  return { required, anyOf };
}

/** The notes a chord cannot do without, ignoring either/or choices. */
export function essentialDegrees(degrees, type) {
  return chordRequirements(degrees, type).required;
}

/** Does this set of sounding degrees satisfy the chord? */
function satisfies(sounded, { required, anyOf }) {
  for (const d of required) if (!sounded.has(d)) return false;
  for (const group of anyOf) {
    let found = false;
    for (const d of group) if (sounded.has(d)) { found = true; break; }
    if (!found) return false;
  }
  return true;
}

// Whichever note falls lowest names the inversion. Sevenths reach a third
// one, with the seventh itself in the bass.
const INVERSION = {
  "1": "root position",
  "2": "1st inversion",  "3": "1st inversion",  "b3": "1st inversion",
  "4": "2nd inversion",  "5": "2nd inversion",  "b5": "2nd inversion",
  "#5": "2nd inversion",
  "6": "3rd inversion",  "7": "3rd inversion",
  "b7": "3rd inversion", "bb7": "3rd inversion",
};

/**
 * Can this grip be fingered, and with how many?
 *
 * A finger laid flat across fret F, covering strings a through b, works
 * whenever every played string between them is at fret F or higher: the
 * ones exactly at F it stops, the ones above it pass under untouched.
 * Nothing requires F to be the lowest fret in the chord — the index
 * barres low most of the time, but a ring finger barring higher up while
 * the index holds a single lower note is just as real a grip, and it is
 * what makes shapes like Gm7 as 313333 playable.
 *
 * So the count is worked out per fret: the notes sharing a fret are
 * gathered into the fewest runs one finger each can cover, and a run
 * breaks only where a string in the middle sits at a lower fret.
 *
 * @returns {{fingers, barre, barres} | null}
 */
export function gripFingering(played) {
  return layFingers(played);
}

// ============================================================
// WHICH HAND PLAYS IT
//
// Knowing a grip *can* be fingered is not the same as knowing it is one
// a player would reach for. Everything below is about the second
// question: given several grips that all sound the chord, which is the
// one to show first.
//
// The rule the hand actually follows is simple, and it is the same rule
// every method book gives: the frets go in order under the fingers.
// Whatever sits lowest is the index, and each fret further up takes the
// next finger along. A barre happens when one finger has to cover
// several strings at one fret — cheap and idiomatic when it is the index
// lying across the low fret, more awkward when it is the ring finger
// covering a fret with the index still holding something below.
// ============================================================

/**
 * Lay the fingers on a grip.
 *
 * Works up from the lowest fret. At each fret the notes are gathered into
 * runs one finger could cover, and then the question is only whether to
 * use one finger or several — which is decided by how many are left. A
 * player fingers a chord with separate fingers when they can, and barres
 * when they must, so that is the order tried:
 *
 *   1. every note its own finger,
 *   2. the index barred across the lowest fret,
 *   3. a second finger barring higher up.
 *
 * @returns {{fingers, barre, barres, assign, index} | null} null when no
 *          hand can hold it
 */
/** How many fingers a set of runs saves by being barred. */
const saving = runList => runList.reduce((n, r) => n + r.length - 1, 0);

function layFingers(played) {
  const stopped = played.filter(v => v.fret > 0);
  if (stopped.length === 0) return { fingers: 0, barre: null, barres: [], assign: [], index: 0 };

  const frets = stopped.map(v => v.fret);
  const low = Math.min(...frets), high = Math.max(...frets);
  if (high - low + 1 > CHORD_SPAN) return null;

  const fretOn = new Map(played.map(p => [p.string, p.fret]));

  // The runs at one fret: neighbouring stopped strings that one finger
  // could cover together. A run breaks where a string in the middle sits
  // at a lower fret, because the finger would have to press through it.
  const runsAt = fret => {
    const strings = stopped.filter(v => v.fret === fret).map(v => v.string).sort((a, b) => a - b);
    const runs = [];
    let start = 0;
    for (let i = 1; i <= strings.length; i++) {
      let joins = i < strings.length;
      if (joins) {
        for (let sBetween = strings[i - 1] + 1; sBetween < strings[i]; sBetween++) {
          const f = fretOn.get(sBetween);
          if (f !== undefined && f < fret) { joins = false; break; }
        }
      }
      if (joins) continue;
      runs.push(strings.slice(start, i));
      start = i;
    }
    return runs;
  };

  const fretList = [...new Set(frets)].sort((a, b) => a - b);
  const runs = new Map(fretList.map(f => [f, runsAt(f)]));

  // How many fingers a given set of barred frets costs.
  const cost = barred => fretList.reduce((n, f) => n +
    (barred.has(f) ? runs.get(f).length
                   : runs.get(f).reduce((m, r) => m + r.length, 0)), 0);

  // Try barring as little as possible: nothing, then the index across the
  // lowest fret, then one more finger higher up — largest saving first,
  // since that is the barre a player would actually add.
  const barrable = fretList.filter(f => runs.get(f).some(r => r.length > 1));
  const attempts = [new Set()];
  if (barrable.includes(low)) attempts.push(new Set([low]));
  const others = barrable.filter(f => f !== low)
    .sort((a, b) => saving(runs.get(b)) - saving(runs.get(a)));
  if (others.length) {
    attempts.push(new Set(barrable.includes(low) ? [low, others[0]] : [others[0]]));
  }
  const chosen = attempts.find(set => cost(set) <= CHORD_FINGERS);
  if (!chosen) return null;
  if (chosen.size > CHORD_MAX_BARRES) return null;

  // Now name the fingers. Ascending frets take ascending fingers — that
  // is the whole of the rule, and it is why the note nearest the nut is
  // the index and the one furthest up is the little finger.
  const assign = [];
  const barres = [];
  let finger = 0;
  for (const f of fretList) {
    const units = chosen.has(f) ? runs.get(f) : runs.get(f).flatMap(r => r.map(x => [x]));
    for (const unit of units) {
      finger++;
      for (const string of unit) assign.push({ string, fret: f, finger });
      if (unit.length > 1) {
        barres.push({ fret: f, from: unit[0], to: unit[unit.length - 1], finger });
      }
    }
  }

  return {
    fingers: finger,
    barre: barres[0] ?? null,
    barres,
    assign,
    // Which finger lies across the barre, if any. The index barring the
    // lowest fret is the ordinary case; anything else is harder.
    index: barres.length ? barres[0].finger : 0,
  };
}

// ---- The CAGED grips --------------------------------------
// A triad has five shapes on a guitar and every player learns them in
// the same five places. They are worth naming and worth leading with,
// because a player recognising the shape gets the fingering for free.
//
// Each is written as the frets it uses, relative to its own lowest, on a
// named run of strings — which is exactly what a shape is: a pattern the
// hand keeps while the neck moves underneath it.
const CAGED_GRIPS = [
  { name: "E", quality: "major", from: 0, shape: [0, 2, 2, 1, 0, 0] },
  { name: "A", quality: "major", from: 1, shape: [0, 2, 2, 2, 0] },
  { name: "D", quality: "major", from: 2, shape: [0, 2, 3, 2] },
  { name: "C", quality: "major", from: 1, shape: [3, 2, 0, 1, 0] },
  { name: "G", quality: "major", from: 0, shape: [3, 2, 0, 0, 0, 3] },
  { name: "E", quality: "minor", from: 0, shape: [0, 2, 2, 0, 0, 0] },
  { name: "A", quality: "minor", from: 1, shape: [0, 2, 2, 1, 0] },
  { name: "D", quality: "minor", from: 2, shape: [0, 2, 3, 1] },
];

/** Which CAGED shape this grip is, if it is one. Triads only. */
function cagedGrip(voicing, degrees) {
  if (degrees.length !== 3) return null;
  const quality = degrees.includes("b3") ? "minor" : degrees.includes("3") ? "major" : null;
  if (!quality) return null;

  const lo = Math.min(...voicing.cells.map(c => c.fret));
  const pattern = voicing.cells.map(c => c.fret - lo);
  for (const grip of CAGED_GRIPS) {
    if (grip.quality !== quality) continue;
    if (grip.from !== voicing.strings[0]) continue;
    if (grip.shape.length !== pattern.length) continue;
    if (grip.shape.every((f, i) => f === pattern[i])) return grip.name;
  }
  return null;
}

// The tones that colour a chord rather than define it. The alterations
// of the fifth are not here: a b5 or #5 is a fifth, however bent, and it
// sits where a fifth sits.
const EXTENSIONS = new Set(["9", "b9", "#9", "11", "#11", "13", "b13"]);

// Strings below this are the chord's foundation — the sixth, fifth and
// fourth, where an extension muddies rather than colours.
const LOW_REGISTER = 3;

/**
 * How hard this grip is to play, as a number — lower is easier.
 *
 * Not a measurement of anything; a ranking, tuned so the grip that comes
 * out on top is the one a teacher would show first. The parts it weighs:
 *
 *   - a CAGED shape is what a player already knows, so it leads;
 *   - the reach matters most, and past four frets it stops being a grip
 *     and becomes a stretch;
 *   - an index barre across the lowest fret is ordinary; a barre by some
 *     other finger, with the index still holding a note below it, is not;
 *   - an open string costs no finger at all, which is why the open
 *     shapes are the first chords anyone learns;
 *   - the root underneath makes a chord sound like itself;
 *   - more strings sounding is fuller, and a run reaching the bass is
 *     worth more than one sitting on the top three;
 *   - a note repeated when it needn't be is a wasted string.
 */
function voicingEase(voicing, degrees) {
  const { cells, notes, span, strings } = voicing;
  let score = 0;

  const shape = cagedGrip(voicing, degrees);
  if (shape) score -= 3;

  score += (span - 1) * 1.2;
  if (span > CHORD_COMFORT) score += 5;              // a stretch, not a grip
  score += (voicing.fingers ?? 4) * 0.9;

  for (const barre of voicing.barres ?? []) {
    // The index lying across the lowest fret is the barre everyone
    // plays. Any other finger barring means the hand is holding a note
    // below the barre as well, which is a different and harder thing.
    score += barre.finger === 1 ? 0.8 : 3;
  }

  // An open string needs no finger, which is why the open shapes are the
  // first chords anyone learns. Capped, though: three open strings do not
  // make a grip three times better, and left uncapped this alone would
  // float every thin two-string fragment to the top of the list.
  const open = cells.filter(c => c.fret === 0).length;
  score -= Math.min(open * 0.9, 2);

  if (voicing.bass === "1") score -= 2;

  // How many strings should sound depends on what the chord is.
  //
  // A triad wants to be full: six and five string grips are what you show
  // someone asking how to play it, and the top three are what they reach
  // for later. But a thirteenth is four or five notes of information, and
  // spreading it over six strings means doubling — which on a dense chord
  // means the root or fifth sounding twice against notes a tone apart
  // from them. Four notes is what a guitarist actually plays there, and
  // it is why the shell voicings exist.
  const dense = degrees.length >= 5;
  score += dense
    ? ({ 6: 2, 5: 0.5, 4: -1.5, 3: 0.5 }[strings.length] ?? 2)
    : ({ 6: -3, 5: -2, 4: -0.5, 3: 2 }[strings.length] ?? 3);
  score += strings[0] * 0.2;       // a run reaching the bass strings is fuller

  // Every tone the chord names should be sounding if the hand allows it.
  const sounded = new Set(notes.map(n => n.degree));
  score += degrees.filter(d => !sounded.has(d)).length * 1.2;

  // Where the extensions sit.
  //
  // A guitar is not a piano: the low strings are thick and close
  // together, and a ninth or a thirteenth down there beats against the
  // root instead of colouring it. So the bottom of a chord is built from
  // the tones that define it — root, third, fifth, seventh — and the
  // extensions go on top, where the strings are thin and far enough
  // apart in pitch to let them ring as colour.
  //
  // A13 is the shape this produces: root on the sixth string, seventh on
  // the fourth, third on the third, and the thirteenth alone on the
  // second, up where it belongs. The penalty falls away entirely above
  // the D string, so nothing is being forced upward — only stopped from
  // sitting in the bass.
  cells.forEach((cell, i) => {
    if (!EXTENSIONS.has(notes[i].degree)) return;
    score += Math.max(0, LOW_REGISTER - cell.string) * 1.3;
  });

  // And an extension underneath everything is not a voicing of the chord
  // so much as a different chord — a 13th in the bass says the thirteenth
  // is the root and the ear believes it.
  if (EXTENSIONS.has(voicing.bass)) score += 3;

  // Doubling the root or the fifth is how guitars have always voiced
  // chords. Doubling anything else spends a string on nothing.
  const seen = new Map();
  for (const n of notes) seen.set(n.degree, (seen.get(n.degree) ?? 0) + 1);
  for (const [degree, count] of seen) {
    if (count < 2) continue;
    score += (degree === "1" || degree === "5") ? 0.15 * (count - 1) : 0.9 * (count - 1);
  }

  return { score, shape };
}

/**
 * Whittle a list of grips down to the few worth showing.
 *
 * A chord has hundreds of correct fingerings and almost all of them are
 * things nobody plays. Cycling through every one buries the three that
 * matter, so the list is cut to the easiest few — and two grips differing
 * by one doubled note are not two grips, so the near-duplicates go first.
 */
export function rankVoicings(list, type, { limit = 4 } = {}) {
  const degrees = getScaleDegrees(type);
  const scored = list.map(v => {
    const { score, shape } = voicingEase(v, degrees);
    return { ...v, ease: score, shape };
  }).sort((a, b) => a.ease - b.ease);

  // A grip that is another grip with strings taken away is not a second
  // way of playing the chord — it is the same hand, sounding less. Open
  // C is x32010; x320xx and xxx010 are that same shape with the player
  // simply not striking everything, and offering all three as choices
  // buries the ones that are genuinely different.
  //
  // Unless the bass changes. Adding the open sixth string to x32010
  // gives 032010, which is the same fingering but a different chord —
  // it sounds over an E — so that one stays.
  const fingersOf = v => new Map(v.cells.map(c => [c.string, c.fret]));
  const contains = (big, small) => {
    for (const [string, fret] of small) if (big.get(string) !== fret) return false;
    return true;
  };

  const kept = [];
  const keptMaps = [];
  for (const v of scored) {
    const mine = fingersOf(v);
    const shadowed = kept.some((k, i) =>
      k.bass === v.bass &&
      (contains(keptMaps[i], mine) || contains(mine, keptMaps[i])));
    if (shadowed) continue;
    kept.push(v);
    keptMaps.push(mine);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Full grips: every string in a run sounds a chord tone, and notes may
 * be doubled. This is how a guitar actually plays chords — open D is
 * D A D F#, with the root twice — and it is what produces the open and
 * barre shapes, since a barre is only reachable by doubling.
 *
 * @returns {Array<{cells, notes, lo, hi, strings, fingers, barre, ...}>}
 */
function fullVoicings(root, type, { openAnywhere = false } = {}) {
  const grid = buildScaleGrid(root, type);
  const wants = chordRequirements(getScaleDegrees(type), type);
  const out = [];
  const seen = new Set();

  // Anchor on every fret, right to the end of the neck. Stopping a hand's
  // width early would silently lose every grip whose lowest note sits up
  // there — the reach simply runs out against the last fret instead.
  for (let lo = 1; lo <= numFrets; lo++) {
    // What each string can play: an open note, or one within the hand.
    const options = [];
    for (let s = 0; s < numStrings; s++) {
      const frets = [];
      if (grid[s][0]) frets.push(0);
      for (let f = lo; f <= Math.min(lo + CHORD_SPAN - 1, numFrets); f++) {
        if (grid[s][f]) frets.push(f);
      }
      options.push(frets);
    }

    // Which strings sound. Neighbouring runs, mostly — but also runs with
    // the string just above the bass left out, because that is how a
    // guitarist voices anything dense. Putting the root on the sixth and
    // the rest on the fourth, third and second leaves the fifth string
    // silent under the hand, and it is silent because the finger holding
    // the root leans against it. That grip is most of the jazz vocabulary
    // and it cannot be built out of neighbouring strings alone.
    const stringSets = [];
    for (let first = 0; first < numStrings; first++) {
      for (let last = first + 2; last < numStrings; last++) {
        const run = [];
        for (let s = first; s <= last; s++) run.push(s);
        stringSets.push(run);
        // The same run with the string above the bass muted. Only worth
        // having if three still sound, and only where the bass is
        // fretted — an open string has no finger leaning off it, so
        // there is nothing to damp its neighbour with.
        if (last - first >= 3 && !options[first].every(f => f === 0)) {
          stringSets.push([first, ...run.slice(2)]);
        }
      }
    }

    for (const strings of stringSets) {
      if (strings.some(s => options[s].length === 0)) continue;

        const chosen = [];
        (function choose(i) {
          if (i === strings.length) {
            const cells = strings.map((string, k) => ({ string, fret: chosen[k] }));
            const stopped = cells.filter(c => c.fret > 0);
            if (stopped.length === 0) return;
            // A gap only works if the finger on the bass note can lie
            // against the silent string. An open bass has no finger on
            // it, so there is nothing to do the muting.
            const gapped = strings.at(-1) - strings[0] + 1 > strings.length;
            if (gapped && cells[0].fret === 0) return;
            // Anchor here, so each grip is counted once.
            if (Math.min(...stopped.map(c => c.fret)) !== lo) return;

            const hi = Math.max(...stopped.map(c => c.fret));
            const span = hi - lo + 1;
            // An open string belongs at the nut, so by default a grip
            // that lets one ring is kept tight around it — reaching up
            // the neck while it sounds is not what a player usually
            // wants. Asked for open strings outright, the only limit is
            // the hand's: an open string needs no finger, so the reach
            // is no harder than any other grip of the same span.
            const openCap = openAnywhere ? CHORD_SPAN : CHORD_OPEN_SPAN;
            if (cells.some(c => c.fret === 0) && span > openCap) return;

            const notes = cells.map(c => grid[c.string][c.fret]);
            // Every note it must sound has to be here; the rest are free
            // to appear or not.
            if (!satisfies(new Set(notes.map(n => n.degree)), wants)) return;

            // The root need not be the lowest note. Whichever tone falls
            // under the others names the inversion, and a guitar reaches
            // those as readily as it reaches root position.
            const lowest = cells.reduce((low, c) =>
              openMidi[c.string] + c.fret < openMidi[low.string] + low.fret ? c : low, cells[0]);
            const bass = grid[lowest.string][lowest.fret].degree;

            const grip = gripFingering(cells);
            if (!grip) return;

            const key = cells.map(c => `${c.string}:${c.fret}`).join("|");
            if (seen.has(key)) return;
            seen.add(key);

            out.push({
              cells, notes, span,
              stretch: span > CHORD_COMFORT,
              lo, hi, strings,
              fingers: grip.fingers,
              barre: grip.barre,
              barres: grip.barres,
              order: notes.map(n => n.degree).join("-"),
              bass,
              // A grip with no root at all isn't an inversion of anything —
              // it's a rootless voicing, and worth saying so.
              label: notes.some(n => n.degree === "1")
                ? (INVERSION[bass] ?? "inversion")
                : "rootless",
            });
            return;
          }
        for (const f of options[strings[i]]) { chosen[i] = f; choose(i + 1); }
      })(0);
    }
  }
  // Up the neck. At the same fret, root position leads — it is what a
  // player reaches for first — then the fullest grip, then the easiest.
  return out.sort((a, b) =>
    a.lo - b.lo ||
    (a.bass === "1" ? 0 : 1) - (b.bass === "1" ? 0 : 1) ||
    b.cells.length - a.cells.length ||
    a.fingers - b.fingers || a.span - b.span);
}

/**
 * Can this chord use an open string at all?
 *
 * Only a string whose open note is one of the chord's own tones can ring
 * with it, so this is just a look along the nut. A chord with none — F#
 * major against E A D G B E — has no open shape anywhere on the neck, and
 * nothing to offer if asked for one.
 */
export function hasOpenVoicing(root, type) {
  const grid = buildScaleGrid(root, type);
  for (let s = 0; s < numStrings; s++) if (grid[s][0]) return true;
  return false;
}

/**
 * Every root-position voicing of a chord, low on the neck first.
 *
 * Stacked: one string per chord tone, nothing doubled — the closed shape
 * a piano would play, and the clearest way to see a chord's intervals.
 * Unstacked: every string in a run sounds, doubling freely, which is how
 * the open and barre chords a guitarist actually uses come about.
 *
 * `openAnywhere` lifts the rule that keeps an open string near the nut,
 * so grips that let one ring under a hand further up the neck are offered
 * too. Off, the only open shapes are the ones at the nut.
 *
 * @returns {Array<{cells, notes, lo, hi, strings, order, label}>}
 */
export function chordVoicings(root, type, { stacked = true, openAnywhere = false } = {}) {
  if (!stacked) return fullVoicings(root, type, { openAnywhere });
  const grid = buildScaleGrid(root, type);

  // A stack puts one note on each string, so it can only hold as many
  // notes as the hand can span. Up to five it takes the chord whole;
  // beyond that it stacks what the chord cannot do without, which is the
  // shell a guitarist would play anyway.
  //
  // Where a chord offers a choice of colour — an altered dominant with
  // its b9, #9 and b5 — each choice makes its own stack, so every version
  // is on offer rather than the chord being flattened to a plain seventh.
  const degrees = getScaleDegrees(type);
  const wants = chordRequirements(degrees, type);
  const noteSets = [];
  if (degrees.length <= 5) {
    noteSets.push(new Set(degrees));
  } else if (wants.anyOf.length === 0) {
    noteSets.push(new Set(wants.required));
  } else {
    // One stack per way of colouring the chord.
    let combos = [new Set(wants.required)];
    for (const group of wants.anyOf) {
      const grown = [];
      for (const base of combos) for (const pick of group) {
        grown.push(new Set([...base, pick]));
      }
      combos = grown;
    }
    noteSets.push(...combos);
  }

  const out = [];
  const seen = new Set();
  for (const wanted of noteSets) {
  const size = wanted.size;

  // Where each string carries one of the notes being stacked.
  const available = [];
  for (let s = 0; s < numStrings; s++) {
    const frets = [];
    for (let f = 0; f <= numFrets; f++) {
      if (grid[s][f] && wanted.has(grid[s][f].degree)) frets.push(f);
    }
    available.push(frets);
  }

  for (let first = 0; first + size - 1 < numStrings; first++) {
    const strings = Array.from({ length: size }, (_, i) => first + i);
    const chosen = [];

    (function choose(i) {
      if (i === size) {
        const cells = strings.map((string, k) => ({ string, fret: chosen[k] }));
        const notes = cells.map(c => grid[c.string][c.fret]);
        const pitches = cells.map(c => openMidi[c.string] + c.fret);

        // Must climb as it crosses the strings, and sound every tone once.
        for (let k = 1; k < size; k++) if (pitches[k] <= pitches[k - 1]) return;
        if (new Set(notes.map(n => n.degree)).size !== size) return;

        // Any tone may sit at the bottom. Stacking the chord from its
        // third or fifth instead of its root gives the inversions, and on
        // a symmetric chord those are the whole vocabulary: a diminished
        // seventh is the same shape every three frets, each repeat an
        // inversion of the one below it.
        const bass = notes[0].degree;              // pitch rises, so this is lowest

        // Within one hand. Open strings need no finger, but they belong
        // to the nut — reaching up the neck while one rings is not a grip
        // anyone would choose.
        const stopped = cells.map(c => c.fret).filter(f => f > 0);
        const span = stopped.length
          ? Math.max(...stopped) - Math.min(...stopped) + 1 : 0;
        if (span > CHORD_SPAN) return;
        if (cells.some(c => c.fret === 0) &&
            stopped.length && Math.max(...stopped) > CHORD_OPEN) return;

        const frets = cells.map(c => c.fret);
        const key = cells.map(c => `${c.string}:${c.fret}`).join("|");
        if (seen.has(key)) return;      // two colourings can meet here
        seen.add(key);
        out.push({
          cells, notes, span,
          stretch: span > CHORD_COMFORT,
          lo: Math.min(...frets), hi: Math.max(...frets),
          strings,
          order: notes.map(n => n.degree).join("-"),
          bass,
          label: INVERSION[bass] ?? "inversion",
        });
        return;
      }
      for (const f of available[strings[i]]) { chosen[i] = f; choose(i + 1); }
    })(0);
  }
  }

  // Up the neck; at the same fret, root position leads, then whichever
  // the hand covers most easily.
  return out.sort((a, b) =>
    a.lo - b.lo ||
    (a.bass === "1" ? 0 : 1) - (b.bass === "1" ? 0 : 1) ||
    a.span - b.span || a.strings[0] - b.strings[0]);
}

// ============================================================
// PATHS  (connecting two notes through the scale)
//
// Where a position asks "what can the hand reach standing still", a path
// asks "how do I travel from here to there". The notes are fixed — every
// scale tone between the two endpoints, in order — so the only question
// is which string plays each one.
//
// That makes it a shortest-path problem: each note is a choice of string,
// and the cost of a choice is how far the hand must move to make it.
// Crossing to the next string is free when the new fret lands where the
// hand already is; the cost is the distance from that resting spot.
// ============================================================

// Four notes on a string is the comfortable maximum, but it is a
// preference, not a rule. A dense scale like bebop dominant packs eight
// notes into an octave, so a three-octave run needs 25 notes — more than
// six strings can hold at four apiece. Treating the limit as a hard wall
// made such runs impossible; charging for the fifth note instead keeps
// them rare without ever ruling them out.
// The charge is levied per note past the fourth, so it mounts steeply
// and a fifth note only appears where the arithmetic demands one.
const PATH_COMFORT_PER_STRING = 4;
const PATH_CROWD_PENALTY      = 4;
const PATH_HAND           = 4;   // frets the fingers cover without moving
const PATH_MAX_WINDOW     = 6;   // widest stretch worth trying before moving
const PATH_MAX_STEP       = 6;   // furthest one leap along a string may reach
const PATH_SHIFT_PENALTY  = 1;   // fixed cost of breaking position at all
const PATH_SKIP_PENALTY   = 3;   // discourages hopping over a string
// Moving the hand between strings is natural; stretching or sliding it
// in the middle of a string, while notes are still to be played there,
// is what actually hurts. Pricing that higher makes the search cross to
// the next string instead of reaching further along the current one.
const PATH_STRETCH_PENALTY = 3;
// An open string needs no finger, so it never moves the hand. But left
// entirely free the search would dive for the nut from anywhere on the
// neck, so an open note is only free while the hand is already down
// there — that is, while fret 0 falls inside its span. Reaching back for
// one from further up costs a little, which keeps open-position runs
// tight without letting distant runs cheat their way to the nut.
const PATH_OPEN_PENALTY   = 0.5;

/**
 * A playable run from one note to another through the scale.
 *
 * @param {{string:number, fret:number}} from  where the run starts
 * @param {{string:number, fret:number}} to    where it must finish
 * @param {Set<string>} [only]  optional "string:fret" cells the run may
 *        use — pass a position's notes to keep the run inside that shape
 * @returns {{cells:Array<{string,fret,midi}>, cost:number} | null}
 */
export function findPath(root, type, from, to, only = null) {
  // Prefer the most vertical run there is. Before searching the whole
  // neck, try to keep the entire run inside a single hand position —
  // narrowest first, and lowest among equals. Only when no such window
  // can hold the run does the search open up and allow the hand to move.
  for (let width = PATH_HAND; width <= PATH_MAX_WINDOW; width++) {
    for (let lo = 0; lo + width - 1 <= numFrets; lo++) {
      const hi = lo + width - 1;
      const holds = c => c.fret === 0 ? lo === 0 : (c.fret >= lo && c.fret <= hi);
      if (!holds(from) || !holds(to)) continue;
      const run = searchPath(root, type, from, to, only, { lo, hi });
      if (run) return run;
    }
  }
  return searchPath(root, type, from, to, only, null);
}

/**
 * A run that must pass through given notes on the way.
 *
 * Each leg is solved on its own and the legs are stitched together. A
 * waypoint doesn't change which notes the run plays — the endpoints fix
 * that — it decides which string plays one of them, which is how a
 * fingering gets reshaped without altering the music.
 *
 * @param {Array<{string:number, fret:number}>} points  start, waypoints…, end
 */
export function findPathThrough(root, type, points, only = null) {
  // Drop repeats: a waypoint sitting on an end has nothing to join.
  const stops = points.filter((p, i) =>
    i === 0 || p.string !== points[i - 1].string || p.fret !== points[i - 1].fret);
  if (stops.length < 2) return null;

  const cells = [];
  let cost = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    // Each leg travels in its own direction, so a waypoint that lies
    // outside the two ends simply turns the run around at that note
    // rather than making it impossible.
    const leg = findPath(root, type, stops[i], stops[i + 1], only);
    if (!leg) return null;
    cells.push(...(i === 0 ? leg.cells : leg.cells.slice(1)));
    cost += leg.cost;
  }
  return cells.length ? { cells, cost } : null;
}

/** Absolute pitch of a fretboard cell. */
export function pitchAt(cell) {
  return openMidi[cell.string] + cell.fret;
}

// The search proper. `window`, when given, confines every note to one
// stationary hand position.
function searchPath(root, type, from, to, only, window) {
  const pcs = new Set(getScalePcs(noteToPc(root), type));
  const startPitch = openMidi[from.string] + from.fret;
  const endPitch   = openMidi[to.string]   + to.fret;
  if (!pcs.has(midiToPc(startPitch)) || !pcs.has(midiToPc(endPitch))) return null;

  // Every scale tone between the endpoints, in playing order.
  const ascending = endPitch >= startPitch;
  const sequence = [];
  if (ascending) {
    for (let p = startPitch; p <= endPitch; p++) if (pcs.has(midiToPc(p))) sequence.push(p);
  } else {
    for (let p = startPitch; p >= endPitch; p--) if (pcs.has(midiToPc(p))) sequence.push(p);
  }
  // Two ways of sounding the same pitch — say open B and G-string fret 4.
  // There is nothing to travel through, but the pair is still a real
  // choice on the neck, so show it rather than refusing.
  if (sequence.length < 2) {
    if (from.string === to.string && from.fret === to.fret) return null;
    return {
      cells: [from, to].map(c => ({ ...c, midi: openMidi[c.string] + c.fret })),
      cost: 0,
    };
  }

  const fretFor = (pitch, s) => {
    const f = pitch - openMidi[s];
    if (f < 0 || f > numFrets) return null;
    if (only && !only.has(`${s}:${f}`)) return null;   // outside the shape
    if (window) {                                      // outside the hand
      if (f === 0 ? window.lo !== 0 : (f < window.lo || f > window.hi)) return null;
    }
    return f;
  };

  // Which way the hand crosses the strings is set by the endpoints, not
  // by the pitch: a run can climb in pitch while moving toward the lower
  // strings, simply by travelling up the neck. When both notes sit on the
  // same string the run stays there — that is a horizontal run, and it is
  // allowed as many notes as it needs.
  const stringDir = Math.sign(to.string - from.string);
  const sameStringOnly = stringDir === 0;
  // A run held to one string on purpose is a horizontal run; crowding
  // isn't a fault there, so it goes unpenalised.
  const crowdingFrom = sameStringOnly ? Infinity : PATH_COMFORT_PER_STRING;

  // The hand covers PATH_HAND frets from `anchor`. Reaching a note inside
  // that window is free wherever it sits; reaching outside means moving
  // the whole hand, and the cost is how far it travels. Open strings need
  // no finger, so they are always free and leave the hand where it is.
  const reach = (anchor, fret) => {
    // Anything under the hand is free, open strings included — which is
    // what makes the open position, hand at the nut, come out free.
    if (fret >= anchor && fret <= anchor + PATH_HAND - 1) return { anchor, cost: 0 };
    // An open string needs no finger, so the hand never moves for one.
    // It still counts against a run whose hand is elsewhere, since
    // dropping to the nut mid-phrase is leaving the position.
    if (fret === 0) return { anchor, cost: PATH_OPEN_PENALTY };
    const moved = fret < anchor ? fret : fret - (PATH_HAND - 1);
    return { anchor: moved, cost: PATH_SHIFT_PENALTY + Math.abs(moved - anchor) };
  };

  const maxAnchor = Math.max(0, numFrets - PATH_HAND + 1);
  const stateKey = st => `${st.string}|${st.anchor}|${st.run}`;

  // The starting note doesn't fix the hand: the same fret can be played
  // with the index finger or the pinky. Every placement that reaches it
  // is a legitimate way to begin, so the search weighs them all.
  let layer = new Map();
  for (let anchor = 0; anchor <= maxAnchor; anchor++) {
    if (from.fret !== 0 && (from.fret < anchor || from.fret > anchor + PATH_HAND - 1)) continue;
    const st = { cost: 0, prev: null, string: from.string, fret: from.fret, run: 1, anchor };
    layer.set(stateKey(st), st);
  }
  if (layer.size === 0) return null;

  for (let i = 1; i < sequence.length; i++) {
    const next = new Map();
    for (const state of layer.values()) {
      const moves = [];

      // Stay on this string.
      const sameFret = fretFor(sequence[i], state.string);
      if (sameFret !== null && Math.abs(sameFret - state.fret) <= PATH_MAX_STEP) {
        const r = reach(state.anchor, sameFret);
        const stretch = r.cost > 0 ? PATH_STRETCH_PENALTY : 0;
        const crowd = state.run + 1 > crowdingFrom ? PATH_CROWD_PENALTY : 0;
        moves.push({ string: state.string, fret: sameFret, run: state.run + 1,
                     anchor: r.anchor, cost: r.cost + stretch + crowd });
      }

      // Cross toward the string the run has to finish on. Any distance is
      // allowed — a short run may have to jump several strings at once to
      // land where it must — but each string vaulted over is charged for,
      // and the run never crosses past its destination, since the
      // direction of travel gives it no way back.
      if (!sameStringOnly) {
        const remaining = Math.abs(to.string - state.string);
        for (let step = 1; step <= remaining; step++) {
          const s2 = state.string + stringDir * step;
          if (s2 < 0 || s2 >= numStrings) break;
          const f2 = fretFor(sequence[i], s2);
          if (f2 === null) continue;
          const r = reach(state.anchor, f2);
          moves.push({ string: s2, fret: f2, run: 1,
                       anchor: r.anchor, cost: r.cost + (step - 1) * PATH_SKIP_PENALTY });
        }
      }

      for (const move of moves) {
        const cand = { ...move, cost: state.cost + move.cost, prev: state };
        const key = stateKey(cand);
        const seen = next.get(key);
        if (!seen || cand.cost < seen.cost) next.set(key, cand);
      }
    }
    if (next.size === 0) return null;
    layer = next;
  }

  // Of the ways to finish, keep the cheapest that lands on the chosen note.
  let best = null;
  for (const state of layer.values()) {
    if (state.string !== to.string || state.fret !== to.fret) continue;
    if (!best || state.cost < best.cost) best = state;
  }
  if (!best) return null;

  const cells = [];
  for (let s = best; s; s = s.prev) {
    cells.push({ string: s.string, fret: s.fret, midi: openMidi[s.string] + s.fret });
  }
  cells.reverse();
  return { cells, cost: best.cost };
}

/**
 * Every playable position for a scale.
 *
 * The natural modes get the same full sweep as everything else — the
 * five CAGED shapes are only a selection from it, and the boxes sitting
 * between them are perfectly playable variations. Those CAGED shapes are
 * still identified by name; the rest simply carry no name.
 *
 * @returns {{system: "caged"|"position", boxes: Array}}
 */
export function getPositions(root, type) {
  const boxes = generalPositions(root, type);
  if (!supportsCaged(type)) return { system: "position", boxes };

  // Work out which of those boxes ARE the CAGED shapes, by comparing the
  // notes they hold rather than their fret bounds.
  const grid = buildScaleGrid(root, type);
  const pcs  = new Set(getScalePcs(noteToPc(root), type));
  const shapeByKey = new Map();

  for (const shape of cagedPositions(root, type)) {
    let info = inspectBox(grid, pcs, shape.lo, shape.hi);
    if (info.gaps > 0) {                       // widen a fret to close it
      const wider = inspectBox(grid, pcs, shape.lo, Math.min(shape.hi + 1, numFrets));
      if (wider.gaps === 0) info = wider;
    }
    if (boxIsPlayable(info)) shapeByKey.set(info.key, shape.shape);
  }

  return {
    system: "caged",
    boxes: boxes.map(b => ({ ...b, shape: shapeByKey.get(b.key) ?? null })),
  };
}