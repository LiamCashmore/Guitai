// ============================================================
// theory.js — NOTE NAMES + SCALE FORMULAS  (pure, no DOM)
//
// Notes are handled internally as pitch classes (0..11, A = 0).
// Display spelling (sharps vs flats) is decided from each note's
// scale degree, so every letter A..G is used once in a 7-note scale
// and accidentals match the key context.
//
// Nothing in this file touches an instrument — it doesn't know how
// many strings there are or how they're tuned. fretboard.js is what
// turns this into a grid of frets.
// ============================================================

const LETTERS   = ["A","B","C","D","E","F","G"];
const LETTER_PC = { A:0, B:2, C:3, D:5, E:7, F:8, G:10 };

// Root choices offered in the UI. Black keys list both spellings so the
// player chooses the tonal context (e.g. Db major vs C# major).
export const rootOptions = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];

// Canonical name of the major scale (used to gate CAGED, etc.).
export const MAJOR_SCALE = "Ionian (Major)";

// Parse a note name ("Db", "F##", "G") into a pitch class 0..11.
export function noteToPc(name) {
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
  // sound is decided later, by chordRequirements.
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
// (groupsFor, which also covers progressions, lives in music.js — the
// progression list is solved in progressions.js, and importing it from
// here would put a cycle through fretboard.js's own top-level code.)

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
export function getScaleDegrees(type) {
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
export function getScalePcs(rootPc, type) {
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
export function getFretPcs(openPc, frets) {
  const arr = [];
  for (let f = 0; f <= frets; f++) arr.push((openPc + f) % 12);
  return arr;
}

// Properly spelled note names for a scale. The scale degree fixes the
// letter (degree 3 -> two letters up from the root letter, etc.); the
// accidental is whatever makes that letter equal the actual pitch.
// Plain flat names, indexed by pitch class (A = 0).
export const FLAT_NAMES = ["A","Bb","B","C","Db","D","Eb","E","F","Gb","G","Ab"];

export function spellScale(root, type) {
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

// MIDI note -> pitch class in this file's convention (A = 0).
export function midiToPc(midi) { return (midi + 3) % 12; }
