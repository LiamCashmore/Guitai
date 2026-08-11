// ============================================================
// music.js — MUSIC THEORY + FRETBOARD MODEL  (pure, no DOM)
//
// A barrel: the model used to live in this one file, and it got long
// enough to split by concern. Nothing moved logically — this just
// re-exports the pieces so view.js (and anything else) can keep
// importing from "./music.js" without caring how it's organised inside.
//
//   theory.js       note names, scale formulas, spelling
//   fretboard.js    instruments + the live fretboard grid
//   positions.js    CAGED shapes and general hand positions
//   progressions.js chord-sequence solving
//   voicings.js     chord grips, guitar and bass
//   paths.js        note-to-note runs through the scale
// ============================================================

export * from "./theory.js";
export * from "./fretboard.js";
export * from "./positions.js";
export * from "./progressions.js";
export * from "./voicings.js";
export * from "./paths.js";

import { scaleGroups, chordGroups, arpeggioGroups } from "./theory.js";
import { progressionGroups } from "./progressions.js";

/** The menu for a given kind of material. */
export function groupsFor(kind) {
  if (kind === "arpeggio")    return arpeggioGroups;
  if (kind === "chord")       return chordGroups;
  if (kind === "progression") return progressionGroups;
  return scaleGroups;
}
