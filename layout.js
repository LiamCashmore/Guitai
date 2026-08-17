// ============================================================
// layout.js — BOARD GEOMETRY  (pure, no DOM)
//
// Where everything on the neck sits, in numbers. Nothing here touches
// the document: it is given the model from music.js and hands back
// plain coordinates, so a React Native or JSX renderer can ask it the
// same questions view.js does and draw the answers its own way.
//
// ---- Neck space --------------------------------------------
// The board is measured in its own two axes and only turned into screen
// coordinates at the last moment:
//
//   u — ALONG the neck. 0 at the board's nut, growing toward the body.
//   v — ACROSS the strings. 0 at the first display row, growing away.
//
// A guitar neck is the same shape whichever way round it is drawn, so
// every measurement — frets, inlays, the capo, the band under a hand —
// is worked out once in neck space and then projected. Turning the board
// on its end is therefore a change of one function, `project`, and not a
// second copy of the geometry.
//
//   horizontal   nut at the left, low string along the bottom  (desktop)
//   vertical     nut at the top, low string down the left      (phone)
//
// The vertical arrangement is the one every chord chart uses, and the
// one that fits a phone: a neck is long and thin, and so is a phone, so
// they should point the same way.
// ============================================================

import {
  numFrets, numStrings, displayOrder, droneStrings, capoFret, barFret,
} from "./music.js";

export const HORIZONTAL = "horizontal";
export const VERTICAL   = "vertical";

/**
 * The two sets of measurements.
 *
 * They are not the same numbers scaled: a phone is narrow across and
 * long down, so the vertical board spends its room on fret spacing and
 * pulls the strings closer together, while the desktop board — which
 * scrolls sideways in a window as wide as the page — can afford the
 * opposite. `R` follows suit, because a marker on a touch screen is
 * something you hit with a finger.
 *
 *   ALONG   padding before the nut (headstock side)
 *   TAIL    padding after the last fret
 *   ACROSS  padding before the first string row
 *   TRAIL   padding after the last string row
 *   FRET    distance between fret wires
 *   GAP     distance between strings — a function, since the vertical
 *           board fits its strings to the width it has
 *   OPEN_*  how far behind the nut (or the capo's bar) an open note sits
 *   REACH   how far behind the nut a band at the nut reaches back
 */
const METRICS = {
  [HORIZONTAL]: {
    ALONG: 70, TAIL: 30, ACROSS: 74, TRAIL: 24,
    FRET: 62, GAP: () => 46, R: 15,
    OPEN_BAR: 38, OPEN_NUT: 34, REACH: 52,
    CAPO_W: 16, EDGE: 18, MARK_R: 6,
    HANDLE_LANE: 14, HANDLE_THICK: 24,
  },
  [VERTICAL]: {
    // TRAIL leaves the hand's bar its lane down the high string's side,
    // plus a little air — see handleBox.
    ALONG: 74, TAIL: 22, ACROSS: 44, TRAIL: 54,
    FRET: 48, GAP: () => Math.min(56, Math.floor(276 / Math.max(1, numStrings - 1))), R: 17,
    OPEN_BAR: 30, OPEN_NUT: 28, REACH: 46,
    CAPO_W: 16, EDGE: 18, MARK_R: 6,
    HANDLE_LANE: 20, HANDLE_THICK: 26,
  },
};

let mode = HORIZONTAL;

/** Returns true when the orientation actually changed, so a caller
 *  knows whether the board has to be rebuilt. */
export function setOrientation(next) {
  if (next !== HORIZONTAL && next !== VERTICAL) return false;
  if (next === mode) return false;
  mode = next;
  return true;
}
export const orientation = () => mode;
export const isVertical = () => mode === VERTICAL;

/** The live measurements. Read through this rather than captured, so a
 *  change of orientation or of instrument is picked up at once. */
export const metrics = () => METRICS[mode];
export const R = () => METRICS[mode].R;
export const gap = () => METRICS[mode].GAP();
export const fretLen = () => METRICS[mode].FRET;

// ---- Along the neck ----------------------------------------

/** Where fret `f`'s wire sits, in u. Fret 0 is the nut itself. */
export const fretU = f => f * METRICS[mode].FRET;

/** How far the neck runs, nut to last fret. */
export const neckU = () => numFrets * METRICS[mode].FRET;

/**
 * A string's own nut. Ordinarily the board's, at u = 0 — but a drone
 * string (a banjo's 5th) starts partway up the neck at its own, and so
 * does everything that belongs to it.
 */
export function nutU(s) {
  const droneFret = droneStrings.get(s);
  return droneFret ? fretU(droneFret) : 0;
}

/** The fret wire the capo is clamped against. */
export const capoU = () => fretU(capoFret);

/**
 * The centre of a note at fret `f` on string `s`, in u.
 *
 * A fretted note sits between its wire and the one behind it. An open
 * note sits behind whichever nut it actually sounds from — the board's,
 * a drone string's own, or a bar clamped across the string — so open
 * markers travel up the neck with a capo and sit in the dead frets
 * behind it, where nothing else is drawn.
 */
export function noteU(f, s) {
  const M = METRICS[mode];
  if (f !== 0) return (f - 0.5) * M.FRET;
  const bar = barFret(s);
  return bar ? fretU(bar) - M.OPEN_BAR : nutU(s) - M.OPEN_NUT;
}

/** The fret nearest a point along the neck — used when a capo, a spike
 *  or the hand's bar is dragged, all of which snap fret to fret. */
export const fretAtU = u => Math.round(u / METRICS[mode].FRET);

// ---- Across the strings ------------------------------------

/** Which row a string is drawn on. Usually its own index, but an
 *  instrument can reorder its rows — see fretboard.js's displayOrder. */
export const stringRow = s => displayOrder.indexOf(s);

/** Row 0 is the LAST row across (the bottom, drawn horizontally), which
 *  is where the low string belongs on both boards. */
export const rowV = row => (numStrings - 1 - row) * gap();
export const stringV = s => rowV(stringRow(s));

/** The board's two extremes across — the outer ROWS, which is not the
 *  same as the outermost string indices once an instrument reorders. */
export const firstV = () => 0;
export const lastV  = () => (numStrings - 1) * gap();

/**
 * How far across a fret's wire reaches.
 *
 * Ordinarily the whole board. But a fret a drone string has not reached
 * yet — a banjo's first five — has no business drawing a fretboard under
 * a string that is not there, so the wire stops short of that row.
 */
export function fretEndV(f) {
  let cutRow = null;
  for (const [s, droneFret] of droneStrings) {
    if (f > droneFret) continue;
    const row = stringRow(s);
    cutRow = cutRow === null ? row : Math.max(cutRow, row);
  }
  return cutRow === null ? lastV() + METRICS[mode].EDGE : rowV(cutRow) - gap() / 2;
}

// ---- Neck space to screen ----------------------------------

/**
 * The projection, and the whole of the difference between the two
 * boards.
 *
 * Horizontal lays u out to the right and v downward, which puts the nut
 * on the left and the low string along the bottom.
 *
 * Vertical lays u DOWN the screen and v across it, mirrored — so the nut
 * is at the top and v = 0, the row drawn topmost when horizontal, ends
 * up on the right. That mirror is what puts the low string down the left
 * hand side, which is where every chord chart ever printed has it.
 */
export function project(u, v) {
  const M = METRICS[mode];
  return mode === VERTICAL
    ? { x: M.ACROSS + (lastV() - v), y: M.ALONG + u }
    : { x: M.ALONG + u,              y: M.ACROSS + v };
}

/** Screen back to neck space — for turning a pointer into a fret. */
export function unproject(x, y) {
  const M = METRICS[mode];
  return mode === VERTICAL
    ? { u: y - M.ALONG, v: lastV() - (x - M.ACROSS) }
    : { u: x - M.ALONG, v: y - M.ACROSS };
}

/** A note's centre, ready to draw. */
export const notePoint = (f, s) => project(noteU(f, s), stringV(s));

/**
 * A box in neck space, as a screen rectangle.
 *
 * Projecting both corners and normalising means a caller never has to
 * know which way round the axes came out — it says which stretch of
 * neck and which strings it wants covered, and gets a rectangle.
 */
export function box(u1, v1, u2, v2) {
  const a = project(u1, v1);
  const b = project(u2, v2);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width:  Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** A straight line in neck space, as two screen points. */
export function line(u1, v1, u2, v2) {
  const a = project(u1, v1);
  const b = project(u2, v2);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/**
 * A transform that slides something to `u` along the neck and leaves it
 * where it is across.
 *
 * Objects clamped to the neck — the capo, a spike, the hand's bar — are
 * moved by transform rather than redrawn, so CSS can ease them. Which
 * screen axis "along the neck" means is this module's business, not the
 * caller's.
 */
export function slideAlong(u) {
  return mode === VERTICAL ? `translate(0px, ${u}px)` : `translate(${u}px, 0px)`;
}

/** Whole-board size, once the instrument is known. */
export function boardSize() {
  const M = METRICS[mode];
  const along  = M.ALONG  + neckU() + M.TAIL;
  const across = M.ACROSS + lastV() + M.TRAIL;
  return mode === VERTICAL
    ? { w: across, h: along }
    : { w: along,  h: across };
}

// ---- The hand's band ---------------------------------------

/**
 * The stretch of neck a hand at frets lo..hi covers, in u.
 *
 * A hand at the nut has the open strings under it too, so its band
 * reaches back behind the nut — or behind the capo's bar, which is the
 * nut now — to take them in.
 */
export function bandU(lo, hi, atNut) {
  return {
    u1: atNut ? (capoFret ? capoU() : 0) - METRICS[mode].REACH : fretU(lo - 1),
    u2: fretU(Math.min(hi, numFrets)),
  };
}

/**
 * The bar the hand's band is dragged by.
 *
 * Horizontally it rides in a lane above the neck, as long as the band is
 * wide. Vertically the lane is beside the neck instead — off the high
 * string's edge, where a thumb reaches without covering the notes.
 */
export function handleBox(u1, u2) {
  const M = METRICS[mode];
  if (mode === VERTICAL) {
    return {
      x: M.ACROSS + lastV() + M.HANDLE_LANE,
      y: M.ALONG + u1,
      width: M.HANDLE_THICK,
      height: u2 - u1,
      along: "height",
    };
  }
  return {
    x: M.ALONG + u1,
    y: M.HANDLE_LANE,
    width: u2 - u1,
    height: M.HANDLE_THICK,
    along: "width",
  };
}

/** Where the marker inlays go: down the middle of the board, and either
 *  side of it at the twelfth. */
export const midV = () => lastV() / 2;
