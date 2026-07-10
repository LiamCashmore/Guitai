function printMajorScale(root) {
//   const startIndex = chromaticScale.indexOf(root);
//   const notes = [];

//   let curInterval = 0;
//   for (note = 0; note < 7; note++) {
//       const noteIndex = (startIndex + curInterval) % chromaticScale.length;
//       notes.push(chromaticScale[noteIndex]);
//       curInterval += majSeq[note];
//   }
    
//   const stringsReversed = [...strings].reverse(); // high e on top

//   // Print fret numbers on top
//   let header = "     ";
//   for (let fret = 0; fret <= numFrets; fret++) {
//     header += fret.toString().padEnd(5, " ");
//   }
//   console.log(header);

//   // Print each string as a row, using actual note names
//   stringsReversed.forEach((stringNotes) => {
//     let row = stringNotes[0].padEnd(2, " ") + "|";
//     stringNotes.forEach((note) => {
//       if (notes.includes(note)){
//         row += note.padEnd(4, " ") + "|";
//       } else {
//         row += "----|"
//       }
//     });
//     console.log(row);
//   });

// }

// function printMinorScale(root) {
//   const startIndex = chromaticScale.indexOf(root);
//   const notes = [];

//   let curInterval = 0;
//   for (note = 0; note < 7; note++) {
//       const noteIndex = (startIndex + curInterval) % chromaticScale.length;
//       notes.push(chromaticScale[noteIndex]);
//       curInterval += minSeq[note];
//   }
    
//   const stringsReversed = [...strings].reverse(); // high e on top

//   // Print fret numbers on top
//   let header = "     ";
//   for (let fret = 0; fret <= numFrets; fret++) {
//     header += fret.toString().padEnd(5, " ");
//   }
//   console.log(header);

//   // Print each string as a row, using actual note names
//   stringsReversed.forEach((stringNotes) => {
//     let row = stringNotes[0].padEnd(2, " ") + "|";
//     stringNotes.forEach((note) => {
//       if (notes.includes(note)){
//         row += note.padEnd(4, " ") + "|";
//       } else {
//         row += "----|"
//       }
//     });
//     console.log(row);
//   });

// }