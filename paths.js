// ============================================================
// paths.js — PATHS  (connecting two notes through the scale)
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

import { noteToPc, getScalePcs, midiToPc } from "./theory.js";
import { numFrets, numStrings, openMidi, droneStrings, midiAt, buildScaleGrid, positionSpan, tightSpan } from "./fretboard.js";
import { generalPositions, supportsCaged, cagedPositions, inspectBox, boxIsPlayable } from "./positions.js";

// Four notes on a string is the comfortable maximum, but it is a
// preference, not a rule. A dense scale like bebop dominant packs eight
// notes into an octave, so a three-octave run needs 25 notes — more than
// six strings can hold at four apiece. Treating the limit as a hard wall
// made such runs impossible; charging for the fifth note instead keeps
// them rare without ever ruling them out.
// The charge is levied per note past the fourth, so it mounts steeply
// and a fifth note only appears where the arithmetic demands one.
/**
 * How many notes a string carries before the run is crowding it.
 *
 * A string's share of a scale is whatever falls between it and its
 * neighbour, and a diatonic scale puts seven notes in every twelve
 * semitones — so an interval of n semitones holds about 7n/12 of them,
 * plus the note at each end. Fourths give four, which is the comfortable
 * maximum every method book quotes; a mandolin's fifths give five, which
 * is right, because a fifth simply holds more scale than a fourth does.
 */
function pathComfortPerString() {
  return Math.round(positionSpan() * 7 / 12) + 1;
}
const PATH_CROWD_PENALTY      = 4;
// The hand covers a position without moving, and will stretch one fret
// past it before giving up and shifting. Both come from the tuning, the
// same way the position boxes do: four and six on a guitar or bass, six
// and eight on a mandolin.
const pathHand      = () => tightSpan();
const pathMaxWindow = () => positionSpan() + 1;
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
function findPath(root, type, from, to, only = null) {
  // Prefer the most vertical run there is. Before searching the whole
  // neck, try to keep the entire run inside a single hand position —
  // narrowest first, and lowest among equals. Only when no such window
  // can hold the run does the search open up and allow the hand to move.
  for (let width = pathHand(); width <= pathMaxWindow(); width++) {
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

/** Absolute pitch of a fretboard cell. See midiAt for the drone case. */
export function pitchAt(cell) {
  return midiAt(cell.string, cell.fret);
}

// ============================================================
// RUNS  (a chain of paths, joined end to end)
// ============================================================
//
// A path joins two notes. A phrase joins several: you pick where to
// start, where to land, and then where to go from there — and the note
// you just landed on is where the next leg begins. So a run is a chain of
// notes, and the legs between them are what gets solved.
//
// Nothing here knows about screens. A leg is solved exactly as a lone
// path is; the chain only decides which pairs get handed to the search,
// and hands back enough about each leg for a renderer to draw it.

const cellKey = c => `${c.string}:${c.fret}`;

/**
 * Add a note to a run's chain.
 *
 * The rule is the whole idea in one line: the note picked last is where
 * the new leg starts, and the note just picked is where it ends. So the
 * first pick opens the chain, the second closes the first leg, and every
 * pick after that hangs another leg off the end of it.
 *
 * @param {Array<{string,fret}>} chain  the notes picked so far
 * @returns {Array<{string,fret}>} a new chain — the old one is untouched
 */
export function extendChain(chain, cell) {
  const next = { string: cell.string, fret: cell.fret };
  if (!chain.length) return [next];
  // Picking the note the chain already ends on asks for a leg of no
  // length, which is not a leg.
  if (cellKey(chain[chain.length - 1]) === cellKey(next)) return chain.slice();
  return [...chain, next];
}

/**
 * One leg of a run, with its held notes put in playing order.
 *
 * A stop that cannot be honoured is let go rather than failing the leg:
 * pins first, then the newest lock, so a deliberate hold outlives an
 * incidental one. Whatever survives comes back with the leg, because the
 * caller is drawing rings on those notes and must not go on drawing them
 * around a note the run no longer visits.
 */
function solveLeg(root, type, from, to, stops, only) {
  const ends = new Set([cellKey(from), cellKey(to)]);
  // A stop sitting on one of this leg's own ends has nothing to join.
  let held = stops.filter(s => !ends.has(cellKey(s)));
  const ascending = pitchAt(to) >= pitchAt(from);

  while (true) {
    const inOrder = held.slice().sort((a, b) =>
      ascending ? pitchAt(a) - pitchAt(b) : pitchAt(b) - pitchAt(a));
    const leg = findPathThrough(root, type, [from, ...inOrder, to], only);
    if (leg) return { leg, held };
    if (!held.length) return { leg: null, held };
    // Give up a pin before a lock.
    const loosest = held.map((s, i) => [s, i]).filter(([s]) => !s.locked).pop()
                 ?? held.map((s, i) => [s, i]).pop();
    held = held.filter((_, i) => i !== loosest[1]);
  }
}

/**
 * The whole run: every leg of the chain, solved and stitched together.
 *
 * The legs share their joints — the note ending one leg is the note
 * beginning the next — so `cells` counts each joint once and reads as a
 * single stream of notes in playing order, which is what gets played and
 * what gets drawn.
 *
 * @param {Array<{string,fret}>} chain  the notes picked, in order
 * @param {Array<Array<{string,fret,locked}>>} stops  held notes, one
 *        list per leg: stops[i] shapes the leg from chain[i] to chain[i+1]
 * @param {Set<string>} [only]  cells the run may use — a position's shape
 * @returns {{legs, held, cells, cost} | null}
 */
export function findRun(root, type, chain, stops = [], only = null) {
  if (!chain || chain.length < 2) return null;

  const legs = [], cells = [], held = [];
  let cost = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const solved = solveLeg(root, type, chain[i], chain[i + 1], stops[i] ?? [], only);
    held.push(solved.held);
    if (!solved.leg) return null;
    // Where this leg starts in the stitched stream. The joint belongs to
    // the leg before it as much as to this one, so it is counted here as
    // the leg's first note rather than skipped over.
    const at = cells.length ? cells.length - 1 : 0;
    legs.push({ ...solved.leg, from: chain[i], to: chain[i + 1], at });
    cells.push(...(cells.length ? solved.leg.cells.slice(1) : solved.leg.cells));
    cost += solved.leg.cost;
  }
  return { legs, held, cells, cost };
}

/**
 * Cut a run into stretches that travel one way.
 *
 * A leg climbs or falls throughout — its notes are every scale tone
 * between its ends, in order — but a run made of several legs turns
 * around wherever you asked it to, and a held note can turn a leg around
 * too. Which direction the hand is going is worth seeing, so it is worked
 * out here from the pitches themselves rather than assumed from the ends.
 *
 * The note a run turns on belongs to both stretches, so the pieces join
 * rather than leaving a gap where the direction changed.
 *
 * @returns {Array<{dir: 1|-1, from:number, to:number, cells:Array}>}
 *          indices are into `cells`, so a caller can tell which part of
 *          the run a stretch is
 */
export function runSegments(cells) {
  if (!cells || cells.length < 2) return [];
  const pitch = c => c.midi ?? pitchAt(c);

  const out = [];
  let start = 0, dir = 0;
  for (let i = 1; i < cells.length; i++) {
    // Two ways of sounding one pitch — open B and the G string's fourth
    // fret — are a real move on the neck but no move in pitch, so they
    // carry on in whatever direction the run was already going.
    const step = Math.sign(pitch(cells[i]) - pitch(cells[i - 1]));
    const here = step === 0 ? (dir || 1) : step;
    if (dir === 0) { dir = here; continue; }
    if (here === dir) continue;
    out.push({ dir, from: start, to: i - 1, cells: cells.slice(start, i) });
    start = i - 1;                       // the turning note is in both
    dir = here;
  }
  out.push({ dir: dir || 1, from: start, to: cells.length - 1, cells: cells.slice(start) });
  return out;
}

// The search proper. `window`, when given, confines every note to one
// stationary hand position.
function searchPath(root, type, from, to, only, window) {
  const pcs = new Set(getScalePcs(noteToPc(root), type));
  const startPitch = pitchAt(from);
  const endPitch   = pitchAt(to);
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
      cells: [from, to].map(c => ({ ...c, midi: pitchAt(c) })),
      cost: 0,
    };
  }

  const fretFor = (pitch, s) => {
    // Inverting midiAt. A drone string's frets are numbered from the
    // board's nut but counted from its own, so the fret sounding a given
    // pitch sits that distance further up — and its open note is fret 0
    // however far up the neck the string itself starts.
    const nut = droneStrings.get(s) ?? 0;
    const f = pitch === openMidi[s] ? 0 : pitch - openMidi[s] + nut;
    if (f < 0 || f > numFrets) return null;
    // A drone string sounds open, or fretted from its own nut on up —
    // never in between, since the string simply doesn't reach there.
    if (f > 0 && f <= nut) return null;
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
  const crowdingFrom = sameStringOnly ? Infinity : pathComfortPerString();

  // The hand covers pathHand() frets from `anchor`. Reaching a note inside
  // that window is free wherever it sits; reaching outside means moving
  // the whole hand, and the cost is how far it travels. Open strings need
  // no finger, so they are always free and leave the hand where it is.
  const HAND = pathHand();
  const reach = (anchor, fret) => {
    // Anything under the hand is free, open strings included — which is
    // what makes the open position, hand at the nut, come out free.
    if (fret >= anchor && fret <= anchor + HAND - 1) return { anchor, cost: 0 };
    // An open string needs no finger, so the hand never moves for one.
    // It still counts against a run whose hand is elsewhere, since
    // dropping to the nut mid-phrase is leaving the position.
    if (fret === 0) return { anchor, cost: PATH_OPEN_PENALTY };
    const moved = fret < anchor ? fret : fret - (HAND - 1);
    return { anchor: moved, cost: PATH_SHIFT_PENALTY + Math.abs(moved - anchor) };
  };

  const maxAnchor = Math.max(0, numFrets - HAND + 1);
  const stateKey = st => `${st.string}|${st.anchor}|${st.run}`;

  // The starting note doesn't fix the hand: the same fret can be played
  // with the index finger or the pinky. Every placement that reaches it
  // is a legitimate way to begin, so the search weighs them all.
  let layer = new Map();
  for (let anchor = 0; anchor <= maxAnchor; anchor++) {
    if (from.fret !== 0 && (from.fret < anchor || from.fret > anchor + HAND - 1)) continue;
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
    cells.push({ string: s.string, fret: s.fret, midi: midiAt(s.string, s.fret) });
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
