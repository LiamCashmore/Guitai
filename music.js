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
  "Whole Tone":              [2,2,2,2,2,2],
  "Diminished (W-H)":        [2,1,2,1,2,1,2,1],
  "Diminished (H-W)":        [1,2,1,2,1,2,1,2],
  "Augmented":               [3,1,3,1,3,1],

  // Bebop (8-note, added passing tone)
  "Bebop Dominant":          [2,2,1,2,2,1,1,1],
  "Bebop Major":             [2,2,1,2,1,1,2,1],
  "Bebop Dorian":            [2,1,1,1,2,2,1,2],
  "Bebop Melodic Minor":     [2,1,2,2,1,1,2,1],

  // Exotic
  "Hungarian Minor":         [2,1,3,1,1,3,1],
  "Double Harmonic":         [1,3,1,2,1,3,1],
  "Neapolitan Minor":        [1,2,2,2,1,3,1],
  "Neapolitan Major":        [1,2,2,2,2,2,1],
};

// Grouping just for the dropdown UI (keys must match scaleFormulas).
export const scaleGroups = {
  "Major Modes":          ["Ionian (Major)","Dorian","Phrygian","Lydian","Mixolydian","Aeolian (Minor)","Locrian"],
  "Melodic Minor Modes":  ["Melodic Minor","Dorian b2","Lydian Augmented","Lydian Dominant","Mixolydian b6","Locrian #2","Altered (Super Locrian)"],
  "Harmonic Minor Modes": ["Harmonic Minor","Locrian nat6","Ionian #5","Dorian #4","Phrygian Dominant","Lydian #2","Altered Diminished"],
  "Harmonic Major":       ["Harmonic Major"],
  "Pentatonic & Blues":   ["Major Pentatonic","Minor Pentatonic","Minor Blues","Major Blues"],
  "Symmetric":            ["Whole Tone","Diminished (W-H)","Diminished (H-W)","Augmented"],
  "Bebop":                ["Bebop Dominant","Bebop Major","Bebop Dorian","Bebop Melodic Minor"],
  "Exotic":               ["Hungarian Minor","Double Harmonic","Neapolitan Minor","Neapolitan Major"],
};

// ---- Scale-degree labels ----------------------------------
// Reference: semitone offset of each degree in the major scale.
const majorRef = [0, 2, 4, 5, 7, 9, 11]; // degrees 1..7

// Symmetric / bebop / pentatonic scales don't map onto 7 letter-names,
// so their degree spellings are given explicitly (conventional jazz usage).
const explicitDegrees = {
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
function spellScale(root, type) {
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

// A box is usable when the hand can stay put and the scale comes out
// whole: every string reachable, every pitch class present, and no hole
// anywhere in the run from its lowest note to its highest.
function boxIsPlayable(info) {
  return info.gaps === 0 && info.complete && info.minPerString >= 1;
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

  const boxes = [];
  const seen = new Set();
  for (let lo = 0; lo <= numFrets - TIGHT_SPAN + 1; lo++) {
    for (const span of [TIGHT_SPAN, POSITION_SPAN]) {
      const hi = lo + span - 1;
      if (hi > numFrets) continue;
      const info = inspectBox(grid, pcs, lo, hi);
      if (!boxIsPlayable(info)) continue;
      if (seen.has(info.key)) continue;        // same notes as an earlier box
      seen.add(info.key);
      boxes.push({ shape: null, lo: info.lo, hi: info.hi, notes: info.notes, key: info.key });
    }
  }
  return boxes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
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