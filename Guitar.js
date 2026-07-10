
const chromaticScale = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

const majSeq = [2, 2, 1, 2, 2, 2, 1];
const minSeq = [2, 1, 2, 2, 1, 2, 2];

const minPent = [3, 2, 2, 2, 2];
const majPent = [2, 2, 3, 2, 3];



/**
 * Maps out string notes on fretboard 
 * given string tuning (openNote) and scale length (numFrets)
 * param {*} openNote 
 * param {*} numFrets 
 */
function getFretNotes(openNote, numFrets) {
  const startIndex = chromaticScale.indexOf(openNote);
  const notes = [];

  for (let fret = 0; fret <= numFrets; fret++) {
    const noteIndex = (startIndex + fret) % chromaticScale.length; // restarts note sequence if > 12 notes 
    notes.push(chromaticScale[noteIndex]);
  }

  return notes;
}


/**
 * Prints fretboard grid and all respective notes
 */
function printNeck() {
  const stringsReversed = [...strings].reverse(); // high e on top

  // Print fret numbers on top
  let header = "     ";
  for (let fret = 0; fret <= numFrets; fret++) {
    header += fret.toString().padEnd(5, " ");
  }
  console.log(header);

  // Print each string as a row, using actual note names
  stringsReversed.forEach((stringNotes) => {
    let row = stringNotes[0].padEnd(2, " ") + "|";
    stringNotes.forEach((note) => {
      row += note.padEnd(4, " ") + "|";
    });
    console.log(row);
  });
}


/**
 * Prints all notes associated with 
 * a given scale and a given root on entire neck
 * 
 * param {*} root 
 * param {*} type 
 */
function printScale(root, type) {
  let seq = []; 
  switch(type) {
      case "major":
          seq = majSeq;
          break;
      case "minor":
          seq = minSeq;
          break;
      case "major pentatonic":
          seq = majPent;
          break;
      case "minor pentatonic":
          seq = minPent;
          break;
      default:
          break;
  }

  const startIndex = chromaticScale.indexOf(root);
  const notes = [];

  let curInterval = 0;
  for (note = 0; note < 7; note++) {
      const noteIndex = (startIndex + curInterval) % chromaticScale.length;
      notes.push(chromaticScale[noteIndex]);
      curInterval += seq[note];
  }
    
  const stringsReversed = [...strings].reverse(); // high e on top

  // Print fret numbers on top
  let header = "     ";
  for (let fret = 0; fret <= numFrets; fret++) {
    header += fret.toString().padEnd(5, " ");
  }
  console.log(header);

  // Print each string as a row, using actual note names
  stringsReversed.forEach((stringNotes) => {
    let row = stringNotes[0].padEnd(2, " ") + "|";
    stringNotes.forEach((note) => {
      if (notes.includes(note)){
        row += note.padEnd(4, " ") + "|";
      } else {
        row += "----|"
      }
    });
    console.log(row);
  });
}

const numFrets = 12;

const strings = [
  getFretNotes("E", numFrets), // low E string
  getFretNotes("A", numFrets), // A string
  getFretNotes("D", numFrets), // D string
  getFretNotes("G", numFrets), // G string
  getFretNotes("B", numFrets), // B string
  getFretNotes("E", numFrets), // high e string
];


printNeck();
printScale("G", "minor pentatonic"); 

