// ============================================================
// progressions.js — PROGRESSIONS
//
// A progression is not a list of chords, it is a route through them.
// Any of them can be played in a dozen places; what decides which is
// what comes before and after, because between two chords the hand has
// to physically get there. A grip that is easy on its own and eight
// frets from its neighbours is the wrong grip.
//
// So the chords are not chosen one at a time. The whole sequence is
// solved at once, and a grip that is slightly harder in itself wins if
// it leaves the hand where the next chord needs it.
// ============================================================

import { MAJOR_SCALE, spellScale, spellOn, letterAt, noteToPc, midiToPc } from "./theory.js";
import { instrument, droneStrings, capoFret, fretUnderHand, midiAt } from "./fretboard.js";
import { chordVoicings, rankVoicings, fragmentVoicings } from "./voicings.js";
import { chordSymbol } from "./symbols.js";

// The name the player's own progression goes under. A name rather than a
// flag because that is all a progression is to everything downstream —
// the menu, the cache key, the solver all take one and ask for its
// chords, and where those chords came from is this file's business.
export const CUSTOM_PROGRESSION = "Custom";

export const progressionGroups = {
  "Presets": ["I – IV – V", "ii – V – I"],
  "Your own": [CUSTOM_PROGRESSION],
};

// Written in scale degrees so they transpose to any key by construction.
const PROGRESSIONS = {
  "I – IV – V":  [
    { numeral: "I",  degree: 1, type: "Major Triad" },
    { numeral: "IV", degree: 4, type: "Major Triad" },
    { numeral: "V",  degree: 5, type: "Major Triad" },
  ],
  // The sevenths are the point of this one: ii-V-I played as triads is
  // a different and much plainer thing than the cadence it is named for.
  "ii – V – I": [
    { numeral: "ii", degree: 2, type: "Minor 7" },
    { numeral: "V",  degree: 5, type: "Dominant 7" },
    { numeral: "I",  degree: 1, type: "Major 7" },
  ],
};

// ------------------------------------------------------------
// THE PLAYER'S OWN
//
// A progression the player typed, parsed into the same steps a preset is
// written in — see symbols.js, which does the reading. It lives here as
// module state for the same reason the instrument and the tuning do:
// there is one of it, everything downstream asks what it is rather than
// being handed it, and a progression is a thing you have set up rather
// than an argument to a function.
//
// A typed progression may be written either way round, and the two mix
// freely. "Am F C G" names its own chords, and the key does nothing to
// it. "vi IV I V" names degrees, and is the same progression in whatever
// key is chosen — which is what the presets are, and why they transpose.
// ------------------------------------------------------------
let customSteps = [];

/** Hand over a parsed progression. @param {Array} steps from parseProgression */
export function setCustomProgression(steps) {
  customSteps = steps ?? [];
}

/** What is in it now, for anything caching by it. */
export function customProgressionKey() {
  return customSteps.map(s =>
    `${s.root ?? ""}${s.numeral ?? ""}${s.alter ?? ""}:${s.type}:${s.bass ?? ""}`).join("|");
}

/** The chords of a progression in a key, spelled from its major scale. */
export function progressionSteps(key, name) {
  const source = name === CUSTOM_PROGRESSION ? customSteps : (PROGRESSIONS[name] ?? []);
  const spelling = spellScale(key, MAJOR_SCALE);
  return source.map(step => {
    // A chord that named its own root keeps it; one written as a degree
    // takes the key's. An altered degree — bVII, #IV — keeps the letter
    // the degree lands on and moves the accidental, so the flat seventh
    // of C is Bb and not the A# it sounds the same as.
    const plain = step.root ?? spelling[step.degree - 1];
    const root = step.alter
      ? spellOn(noteToPc(plain) + step.alter, letterAt(key, step.degree))
      : plain;
    return { ...step, root, symbol: step.symbol ?? chordSymbol(root, step.type, step.bass) };
  });
}

/**
 * A handful of grips for one chord, spread along the neck.
 *
 * Ranking alone would return four grips from the same three frets, which
 * is no use to a search that may need to be somewhere else entirely. So
 * the neck is divided into stretches and the best of each is taken —
 * giving the sequence a real choice of where to be.
 */
/**
 * The chord over a named bass — the slash in C/G — kept where it can be.
 *
 * A slash chord is a real instruction: it says which note is underneath,
 * and on a guitar that is usually the whole reason the chord is written
 * that way. So grips whose lowest sounding note is that note are the
 * only ones offered, when there are any.
 *
 * When there are none it is dropped rather than the chord being. Inside
 * a five-fret window there are stretches of neck where the bass simply
 * isn't available under the chord, and a progression that loses a whole
 * chord to a preference is worse than one that plays it in a different
 * inversion — the same trade the shell and the fragment already make.
 */
function overBass(list, bass) {
  if (!bass) return list;
  const wanted = noteToPc(bass);
  const onBass = list.filter(v => {
    const low = v.cells.reduce((a, c) =>
      midiAt(c.string, c.fret) < midiAt(a.string, a.fret) ? c : a, v.cells[0]);
    return low && midiToPc(midiAt(low.string, low.fret)) === wanted;
  });
  return onBass.length ? onBass : list;
}

function candidatesAcrossNeck(root, type, bass, perRegion = 2) {
  const all = chordVoicings(root, type, { stacked: false, openAnywhere: false });

  // An open string rings whatever the hand is doing, so a grip mixing
  // open strings with notes at the tenth fret is not impossible — it is
  // just not a chord anybody plays. Elsewhere in the app the window hides
  // these, because the hand and the nut are never both inside it. Here
  // there is no window, so the rule has to be said outright: an open
  // string belongs to a grip near the nut.
  const grounded = all.filter(v => {
    const stopped = v.cells.filter(c => c.fret > 0).map(c => c.fret);
    if (!v.cells.some(c => c.fret === 0) || !stopped.length) return true;
    // Near the nut — which with a capo on is near the bar, since that is
    // where the open strings are ringing from.
    return Math.max(...stopped) - capoFret <= instrument.chords.openReach;
  });

  // Bucketed by the fret the grip starts on, not by a wider stretch of
  // neck. Three frets to a bucket sounds harmless and isn't: the grips
  // starting at the third fret crowd out the ones starting at the fifth,
  // so a hand asking for the fifth is offered the third and drifts.
  return bestPerStartingFret(overBass(grounded, bass), type, perRegion);
}

/**
 * The grips for one chord that a hand at THIS stretch of neck can hold.
 *
 * The window is a boundary, not a preference. A progression is shown
 * against a band of frets the player is being asked to keep their hand
 * in, so a chord that reaches two frets past it is not a slightly worse
 * answer — it is the wrong answer to the question asked, and it puts
 * notes on the board outside the very band the board is highlighting.
 *
 * Which means a chord can turn out to have no grip here at all, and the
 * answer to that is the same as everywhere else: ask for less rather
 * than nothing. The chord whole, then its shell, then whatever fragment
 * of it the window can sound — see fragmentVoicings. Every window holds
 * something, so every chord of the progression can be played without the
 * hand leaving the band.
 *
 * Open strings need no rule of their own here. An open string is fret 0,
 * so it is inside the window only when the window is at the nut — or at
 * the capo, which is the nut now — and that is exactly where open shapes
 * belong. A drone is the exception it always is: a banjo's 5th string
 * rings from its own nut wherever the hand is, so it is never out of
 * bounds.
 */
function candidatesInWindow(root, type, bass, { lo, hi }, perRegion = 2) {
  const fits = v => v.cells.every(c =>
    (c.fret === 0 && droneStrings.has(c.string)) || fretUnderHand(c.fret, lo, hi));

  const search = opts => chordVoicings(root, type, { stacked: false, openAnywhere: false, ...opts });
  let here = search({}).filter(fits);
  if (!here.length) here = search({ relaxed: true }).filter(fits);
  if (!here.length) here = fragmentVoicings(root, type, { lo, hi });

  return bestPerStartingFret(overBass(here, bass), type, perRegion);
}

/**
 * The best few grips at each fret a grip can start on.
 *
 * Ranking alone returns four ways of playing the same three frets, which
 * is no use to a search that may need the hand somewhere else — so the
 * candidates are grouped by where they begin and the best of each group
 * kept, giving the route a real choice of where to be.
 */
function bestPerStartingFret(list, type, perRegion) {
  const regions = new Map();
  for (const v of list) {
    if (!regions.has(v.lo)) regions.set(v.lo, []);
    regions.get(v.lo).push(v);
  }
  const out = [];
  for (const group of regions.values()) out.push(...rankVoicings(group, type, { limit: perRegion }));
  return out;
}

/** Where the hand sits to hold a grip: the middle of what it is fretting. */
function handAt(voicing) {
  const stopped = voicing.cells.filter(c => c.fret > 0).map(c => c.fret);
  if (!stopped.length) return 0;                 // open chords: at the nut
  return stopped.reduce((a, b) => a + b, 0) / stopped.length;
}

/**
 * What it costs to go from one grip to the next.
 *
 * Two things, and they pull against each other. Moving the hand costs —
 * the distance it travels along the neck, which is why a progression
 * mostly wants to stay put. But a finger already in the right place
 * costs nothing to leave there, so two grips sharing notes are cheaper
 * than their distance suggests, and a shared barre cheaper still: the
 * hand keeps its shape and only the free fingers move.
 */
function moveCost(from, to) {
  let cost = Math.abs(handAt(to) - handAt(from)) * 1.6;

  const held = new Set(from.cells.map(c => `${c.string}:${c.fret}`));
  const kept = to.cells.filter(c => c.fret > 0 && held.has(`${c.string}:${c.fret}`)).length;
  cost -= kept * 1.1;

  // An open chord either side is a free ride: nothing is being held, so
  // there is nothing to move.
  const openFrom = from.cells.every(c => c.fret === 0);
  const openTo   = to.cells.every(c => c.fret === 0);
  if (openFrom || openTo) cost *= 0.5;

  const barreFrom = from.barres?.[0], barreTo = to.barres?.[0];
  if (barreFrom && barreTo && barreFrom.fret === barreTo.fret) cost -= 1.5;

  return cost;
}

/**
 * Choose the grips for a whole progression at once.
 *
 * This is the shortest path through a small graph: a column of candidate
 * grips per chord, every one connected to every one in the next column,
 * and the cheapest route wins. Solved forward, keeping only the best way
 * to arrive at each grip, which is all that can matter — how you got
 * somewhere doesn't change what it costs to leave.
 *
 * The route is free to climb the neck. It only will if that is genuinely
 * cheaper than staying, since climbing is exactly what the movement cost
 * charges for.
 *
 * @param ease   how much a grip's own difficulty counts against how far
 *               the hand must travel to reach it
 * @param window {lo, hi} the stretch of neck being asked about, and a
 *               boundary: every note of every grip is inside it, down to
 *               a fragment of a chord where the whole one won't fit. Left
 *               out, the route is free to sit wherever the neck suits it.
 */
export function progressionVoicings(key, name, { ease = 1, window = null } = {}) {
  const steps = progressionSteps(key, name);
  if (!steps.length) return [];

  const columns = steps.map(s => window
    ? candidatesInWindow(s.root, s.type, s.bass, window)
    : candidatesAcrossNeck(s.root, s.type, s.bass));
  if (columns.some(c => c.length === 0)) return [];

  // Nothing here prices the window any more. It used to be a cost — a
  // few points per fret outside — which is the right shape for a
  // preference and the wrong one for a boundary: a chord that was much
  // easier two frets up simply paid the fine and went, and the board
  // then drew notes outside the band it was highlighting. The window is
  // applied where a boundary belongs, in what the columns are allowed to
  // contain at all, so by the time the route is solved everything left
  // is somewhere the hand already is.
  const nodeCost = v => v.ease * ease;

  // Best route to each grip of the first chord is simply the grip.
  let paths = columns[0].map(v => ({ cost: nodeCost(v), chain: [v] }));

  for (let i = 1; i < columns.length; i++) {
    paths = columns[i].map(v => {
      let best = null;
      for (const path of paths) {
        const cost = path.cost + moveCost(path.chain[path.chain.length - 1], v) + nodeCost(v);
        if (!best || cost < best.cost) best = { cost, chain: [...path.chain, v] };
      }
      return best;
    });
  }

  const winner = paths.reduce((a, b) => (b.cost < a.cost ? b : a));
  return winner.chain.map((voicing, i) => ({ ...voicing, ...steps[i] }));
}
