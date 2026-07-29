// ============================================================
// Music theory layer
// ============================================================

const chromaticScale = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

// Interval sequences (semitone steps). Each sums to 12 (a full octave).
const scaleFormulas = {
  "major":            [2, 2, 1, 2, 2, 2, 1],
  "minor":            [2, 1, 2, 2, 1, 2, 2],
  "major pentatonic": [2, 2, 3, 2, 3],
  "minor pentatonic": [3, 2, 2, 3, 2],
};

/**
 * Notes on a single string, from open (fret 0) to numFrets.
 * @param {string} openNote  tuning of the string, e.g. "E"
 * @param {number} numFrets
 */
function getFretNotes(openNote, numFrets) {
  const startIndex = chromaticScale.indexOf(openNote);
  const notes = [];
  for (let fret = 0; fret <= numFrets; fret++) {
    const noteIndex = (startIndex + fret) % chromaticScale.length; // wrap past 12
    notes.push(chromaticScale[noteIndex]);
  }
  return notes;
}

/**
 * The set of pitch classes belonging to a scale.
 * @param {string} root  e.g. "G#"
 * @param {string} type  key in scaleFormulas
 * @returns {string[]}   ordered notes of the scale (root first)
 */
function getScaleNotes(root, type) {
  const seq = scaleFormulas[type];
  if (!seq) throw new Error(`Unknown scale type: "${type}"`);

  const startIndex = chromaticScale.indexOf(root);
  if (startIndex === -1) throw new Error(`Unknown root note: "${root}"`);

  const notes = [];
  let interval = 0;
  for (let i = 0; i < seq.length; i++) {
    notes.push(chromaticScale[(startIndex + interval) % chromaticScale.length]);
    interval += seq[i];
  }
  return notes;
}

// ============================================================
// Rendering layer  (one renderer, scale = optional filter)
// ============================================================

/**
 * Prints the fretboard. If `highlight` is given, only those notes show;
 * every other position renders as a blank fret. The root is marked with ().
 *
 * @param {string[][]} strings          per-string note arrays (low -> high)
 * @param {number}     numFrets
 * @param {object}     [opts]
 * @param {Set<string>} [opts.highlight] notes to display (undefined = show all)
 * @param {string}     [opts.root]       note to emphasize, e.g. "G#"
 */
function renderNeck(strings, numFrets, opts = {}) {
  const { highlight, root } = opts;
  const stringsReversed = [...strings].reverse(); // high e on top

  // Fret-number header
  let header = "      ";
  for (let fret = 0; fret <= numFrets; fret++) {
    header += fret.toString().padEnd(5, " ");
  }
  console.log(header);

  stringsReversed.forEach((stringNotes) => {
    let row = stringNotes[0].padEnd(2, " ") + " |";
    stringNotes.forEach((note) => {
      const show = !highlight || highlight.has(note);
      if (!show) {
        row += "----|";
      } else {
        const label = note === root ? `(${note})` : note; // emphasize root
        row += label.padEnd(4, " ") + "|";
      }
    });
    console.log(row);
  });
  console.log(""); // spacer
}

/** All notes across the neck. */
function printNeck(strings, numFrets) {
  renderNeck(strings, numFrets);
}

/** Only the notes of a scale, root emphasized. */
function printScale(strings, numFrets, root, type) {
  const scaleNotes = getScaleNotes(root, type);
  console.log(`${root} ${type}:  ${scaleNotes.join("  ")}`);
  renderNeck(strings, numFrets, { highlight: new Set(scaleNotes), root });
}

// ============================================================
// Config + demo
// ============================================================

const numFrets = 12;

const standardTuning = ["E", "A", "D", "G", "B", "E"]; // low -> high
const strings = standardTuning.map((open) => getFretNotes(open, numFrets));

printNeck(strings, numFrets);
printScale(strings, numFrets, "G#", "major");