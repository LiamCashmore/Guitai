// ============================================================
// positions.js — HAND POSITIONS  (CAGED shapes + general boxes)
//
// A position is a fret window the hand can hold still in. This file
// finds them two ways: the five CAGED shapes (guitar, major-scale
// family only) and a general search that works for any scale on any
// instrument.
// ============================================================

import { noteToPc, getScalePcs, midiToPc } from "./theory.js";
import {
  chromaticGrid, numFrets, numStrings, droneStrings, cagedShapes,
  buildScaleGrid, tightSpan, positionSpan, capoFret, fretUnderHand, handFret,
} from "./fretboard.js";

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

// CAGED is only meaningful for the natural modes, and only on an
// instrument tuned so that it has the shapes at all — see cagedShapes()
// in the fretboard model, and the INSTRUMENTS table it reads.
export function supportsCaged(type) {
  return cagedShapes() && (type in MODE_TO_PARENT);
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
  // chromaticGrid[0][0] is that string's open note as it actually sounds,
  // so under a capo this measures from the capo — and the fret it names
  // has to be counted from there too, since the shapes sit on the neck by
  // fret number and the bar has moved where "open" is.
  const parentPc  = ((noteToPc(root) - MODE_TO_PARENT[type]) % 12 + 12) % 12;
  const rootFret6 = capoFret + ((parentPc - chromaticGrid[0][0]) % 12 + 12) % 12;

  const boxes = [];
  const seen = new Set();
  for (let octave = -1; octave <= 2; octave++) {
    for (const t of CAGED_TEMPLATES) {
      let lo = rootFret6 + t.offset + 12 * octave;
      // The nut — or the capo, which is the nut now — is a hard boundary.
      // A shape reaching just one fret below it still works, because open
      // strings stand in for that fret; this is what puts the G shape at
      // 0-4 in open position. Anything further below genuinely doesn't
      // fit and is skipped; it will reappear an octave higher.
      if (lo === capoFret - 1) lo = capoFret;
      if (lo < capoFret) continue;
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

// Null out every cell outside a fret-window box. The open notes belong to
// a box that reaches the nut — or the capo — which is what fretUnderHand
// decides; everything else is simply inside the fret range or not.
function maskToBox(grid, box) {
  return grid.map(row =>
    row.map((cell, f) => (cell && fretUnderHand(f, box.lo, box.hi)) ? cell : null)
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
function prunePlayable(grid) {
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

// The box widths come from the tuning rather than from a number chosen
// here — see positionSpan() up in the fretboard model for why the widest
// interval between neighbouring strings is exactly the width that makes
// a missing scale note impossible. On a guitar or a bass that comes out
// as the five and four these constants used to be; on a mandolin it
// comes out as seven and six, which is the same reach on a neck half
// the length.

/** Describe one box: note count, spread, and whether the run has holes. */
export function inspectBox(grid, pcs, lo, hi) {
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
  // Measured where the hand is: an open note is played at the nut, and
  // under a capo the nut is the bar. Without one this is fret 0 either way.
  const frets = cells.map(c => handFret(c.fret));
  return {
    // Trimmed to the frets actually played: a box can open on a fret
    // nothing lands on, and that dead edge is not part of the position.
    lo: Math.min(...frets), hi: Math.max(...frets),
    notes: cells.length, gaps, perString, cells,
    complete: covered.size === pcs.size,
    // A drone string only ever sounds open, so it has no vote here — a
    // box off the nut leaving it silent is normal, not a hole in the
    // fingering the way a genuinely empty fretted string would be.
    minPerString: Math.min(...perString.filter((_, s) => !droneStrings.has(s))),
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
export function boxIsPlayable(info, sparse) {
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
  const tight = tightSpan(), full = positionSpan();
  // Nothing below the capo is playable, so no hand starts there.
  for (let lo = capoFret; lo <= numFrets - tight + 1; lo++) {
    for (const span of [tight, full]) {
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
