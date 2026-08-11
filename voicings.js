// ============================================================
// voicings.js — CHORD VOICINGS  (grips, guitar and bass)
//
// A chord is sounded all at once, which runs into the hand: four
// fingers, six strings, and only so far a reach. This file finds every
// playable grip for a chord, works out how to finger it, and ranks the
// results so the easiest few can be shown first.
//
// Guitar and bass are covered together because they share almost every
// primitive here — gripFingering, chordRequirements, the low-interval
// clarity check — even though their search and their notion of "easy"
// diverge completely once a chord is voiced.
// ============================================================

import { getScaleDegrees } from "./theory.js";
import { instrument, numFrets, numStrings, droneStrings, midiAt, buildScaleGrid } from "./fretboard.js";
import { pitchAt } from "./paths.js";

// Four frets is what the hand covers without complaint on a guitar-scale
// neck. Five is reachable and sometimes the only way — a major 7 stacked
// in order on the lower strings is 8,7,5,4, and a diminished triad's flat
// fifth pulls the shape wide as well — but it is a stretch, so it is
// allowed and marked rather than treated as equal.
//
// These are read per instrument rather than fixed, because the same
// finger-count of frets is not the same stretch on every neck: a
// mandolin's scale is barely half a guitar's, so the frets themselves
// sit closer together and the hand can comfortably cover more of them.
// Falling back to the guitar's own numbers when an instrument doesn't
// say otherwise.
const chordSpan     = () => instrument.chords.maxSpan ?? 5;
const chordComfort  = () => instrument.chords.comfortSpan ?? 4;
const chordOpenSpan = () => instrument.chords.openSpan ?? 3; // ...and keeps the grip around it tight
const CHORD_FINGERS = 4;

const CHORD_MAX_BARRES = 2;   // the index can barre, and one other finger

/**
 * Which of a chord's notes have to sound, and which the guitar may let go.
 *
 * A thirteenth chord has seven notes; there are six strings and four
 * fingers. Leaving notes out isn't a liberty, it's forced — so the
 * question is which ones carry the chord's meaning:
 *
 *   - the third says major or minor, and never goes;
 *   - the seventh says which seventh it is, and never goes;
 *   - an altered note — b5, #5, b9, #9, #11, b13 — is the whole reason
 *     the chord is named what it is, so it stays;
 *   - the highest natural extension gives the chord its number: a 13
 *     chord without its 13th is just a 7;
 *   - the perfect fifth carries almost nothing and is dropped first;
 *   - lower extensions give way to higher ones — the 9th and 11th of a
 *     13 chord are colour, not identity.
 *
 * Triads are left whole: with only three notes there is nothing to spare.
 */
// Chords whose alterations are a choice rather than a list. "Alt" means
// altered, not exhaustive — the player takes the colours that fit the
// hand. Everywhere else, an alteration in the chord's name belongs to the
// chord: 7#5#9 wants both, and giving only one would make it a different
// chord entirely.
const CHORD_CHOICES = {
  "7alt": ["b9", "#9", "b5"],
};

export function chordRequirements(degrees, type) {
  if (degrees.length <= 3) return { required: new Set(degrees), anyOf: [] };
  const has = d => degrees.includes(d);

  const required = new Set(["1"]);
  for (const d of ["3", "b3", "2", "4"]) if (has(d)) required.add(d);   // quality
  for (const d of ["7", "b7", "bb7", "6"]) if (has(d)) required.add(d); // the seventh

  // Altered notes are the reason the chord is named what it is, so they
  // stay — unless this is a chord that leaves the choice open.
  const altered = degrees.filter(d =>
    /^[#b]/.test(d) && !["b3", "b7", "bb7"].includes(d));
  const optional = new Set(CHORD_CHOICES[type] ?? []);
  const anyOf = [];
  const choose = altered.filter(d => optional.has(d));
  for (const d of altered) if (!optional.has(d)) required.add(d);
  if (choose.length) anyOf.push(new Set(choose));

  const names = ["13", "11", "9"].find(has);                           // what it's called
  if (names) required.add(names);

  // Once a chord needs five notes there is nowhere left to put them, and
  // the note that goes is the root: a bass player or the next string down
  // supplies it, while the third, seventh and alterations carry the
  // chord's meaning by themselves. This is ordinary practice on dense
  // dominants, and it is what makes them playable across the whole neck.
  if (required.size >= 5) required.delete("1");

  return { required, anyOf };
}

/**
 * The same chord asked for less, for when the neck cannot hold it whole.
 *
 * A hand's width of neck sometimes has no room for every tone a chord
 * names, and not because the search is too strict — because the notes
 * are not there. G13 between frets 4 and 8 of a banjo has its seventh
 * and its thirteenth both on the second string and nowhere else in that
 * stretch, so no hand sounds the two together at any fingering.
 *
 * Refusing to answer leaves the board blank, which tells the player
 * nothing. What a player does there is play the shell — root, third,
 * seventh — and let the extension go, so that is what is offered, with
 * the missing tone named on the label rather than quietly dropped.
 *
 * Only the extensions give way. The third and the seventh are what the
 * chord IS; a grip without them is a different chord, not a thinner
 * voicing of this one. So a triad relaxes to itself, and a window that
 * cannot hold a triad stays honestly empty.
 */
export function shellRequirements(degrees, type) {
  const { required, anyOf } = chordRequirements(degrees, type);
  return {
    required: new Set([...required].filter(d => !EXTENSIONS.has(d))),
    anyOf,
  };
}

/** Does this set of sounding degrees satisfy the chord? */
function satisfies(sounded, { required, anyOf }) {
  for (const d of required) if (!sounded.has(d)) return false;
  for (const group of anyOf) {
    let found = false;
    for (const d of group) if (sounded.has(d)) { found = true; break; }
    if (!found) return false;
  }
  return true;
}

// ---- Things every grip needs saying about it ---------------
// Three questions get asked at every point a voicing is built, on both
// the guitar path and the bass one, and they were being answered in
// slightly different words each time — which is how the two ways of
// finding the lowest note came to disagree about whether the fret
// counted.

/** A grip's identity: which fret on which string, and nothing else. */
const gripKey = cells => cells.map(c => `${c.string}:${c.fret}`).join("|");

/** The cell sounding the lowest pitch — the one that names the inversion. */
const lowestCell = cells =>
  cells.reduce((low, c) => (pitchAt(c) < pitchAt(low) ? c : low), cells[0]);

/**
 * Is this grip a stretch?
 *
 * The same question the ease score asks, so it has to be asked the same
 * way. An instrument carrying real reach figures is measured in inches,
 * because a fret count means different things at different ends of a
 * short neck: the standard mandolin C shape at 12-10-7-8 covers six
 * frets but only 2.3 inches, which is inside the reach that instrument
 * declares comfortable. Counting frets alone labelled it a stretch while
 * the scorer was charging it as an easy grip.
 */
function isStretch(cells, span) {
  const { reach } = instrument.chords;
  return reach.max !== Infinity
    ? handReach(cells) > reach.comfort
    : span > chordComfort();
}

// Whichever note falls lowest names the inversion. Sevenths reach a third
// one, with the seventh itself in the bass.
const INVERSION = {
  "1": "root position",
  "2": "1st inversion",  "3": "1st inversion",  "b3": "1st inversion",
  "4": "2nd inversion",  "5": "2nd inversion",  "b5": "2nd inversion",
  "#5": "2nd inversion",
  "6": "3rd inversion",  "7": "3rd inversion",
  "b7": "3rd inversion", "bb7": "3rd inversion",
};

/**
 * What to call a grip, given what is sounding and what is underneath.
 *
 * A grip with no root at all isn't an inversion of anything — it's a
 * rootless voicing, and worth saying so.
 */
const labelFor = (notes, bass) =>
  notes.some(n => n.degree === "1") ? (INVERSION[bass] ?? "inversion") : "rootless";

/**
 * Can this grip be fingered, and with how many?
 *
 * A finger laid flat across fret F, covering strings a through b, works
 * whenever every played string between them is at fret F or higher: the
 * ones exactly at F it stops, the ones above it pass under untouched.
 * Nothing requires F to be the lowest fret in the chord — the index
 * barres low most of the time, but a ring finger barring higher up while
 * the index holds a single lower note is just as real a grip, and it is
 * what makes shapes like Gm7 as 313333 playable.
 *
 * So the count is worked out per fret: the notes sharing a fret are
 * gathered into the fewest runs one finger each can cover, and a run
 * breaks only where a string in the middle sits at a lower fret.
 *
 * @returns {{fingers, barre, barres} | null}
 */
export function gripFingering(played) {
  return layFingers(played);
}

// ============================================================
// WHICH HAND PLAYS IT
//
// Knowing a grip *can* be fingered is not the same as knowing it is one
// a player would reach for. Everything below is about the second
// question: given several grips that all sound the chord, which is the
// one to show first.
//
// The rule the hand actually follows is simple, and it is the same rule
// every method book gives: the frets go in order under the fingers.
// Whatever sits lowest is the index, and each fret further up takes the
// next finger along. A barre happens when one finger has to cover
// several strings at one fret — cheap and idiomatic when it is the index
// lying across the low fret, more awkward when it is the ring finger
// covering a fret with the index still holding something below.
// ============================================================

/**
 * Lay the fingers on a grip.
 *
 * Works up from the lowest fret. At each fret the notes are gathered into
 * runs one finger could cover, and then the question is only whether to
 * use one finger or several — which is decided by how many are left. A
 * player fingers a chord with separate fingers when they can, and barres
 * when they must, so that is the order tried:
 *
 *   1. every note its own finger,
 *   2. the index barred across the lowest fret,
 *   3. a second finger barring higher up.
 *
 * @returns {{fingers, barre, barres, assign, index} | null} null when no
 *          hand can hold it
 */
/** How many fingers a set of runs saves by being barred. */
const saving = runList => runList.reduce((n, r) => n + r.length - 1, 0);

function layFingers(played) {
  const stopped = played.filter(v => v.fret > 0);
  if (stopped.length === 0) return { fingers: 0, barre: null, barres: [], assign: [], index: 0 };

  const frets = stopped.map(v => v.fret);
  const low = Math.min(...frets), high = Math.max(...frets);
  if (high - low + 1 > chordSpan()) return null;

  const fretOn = new Map(played.map(p => [p.string, p.fret]));

  // The runs at one fret: neighbouring stopped strings that one finger
  // could cover together. A run breaks where a string in the middle sits
  // at a lower fret, because the finger would have to press through it.
  const runsAt = fret => {
    const strings = stopped.filter(v => v.fret === fret).map(v => v.string).sort((a, b) => a - b);
    const runs = [];
    let start = 0;
    for (let i = 1; i <= strings.length; i++) {
      let joins = i < strings.length;
      if (joins) {
        for (let sBetween = strings[i - 1] + 1; sBetween < strings[i]; sBetween++) {
          const f = fretOn.get(sBetween);
          if (f !== undefined && f < fret) { joins = false; break; }
        }
      }
      if (joins) continue;
      runs.push(strings.slice(start, i));
      start = i;
    }
    return runs;
  };

  const fretList = [...new Set(frets)].sort((a, b) => a - b);
  const runs = new Map(fretList.map(f => [f, runsAt(f)]));

  // How many fingers a given set of barred frets costs.
  const cost = barred => fretList.reduce((n, f) => n +
    (barred.has(f) ? runs.get(f).length
                   : runs.get(f).reduce((m, r) => m + r.length, 0)), 0);

  // Try barring as little as possible: nothing, then the index across the
  // lowest fret, then one more finger higher up — largest saving first,
  // since that is the barre a player would actually add.
  const barrable = fretList.filter(f => runs.get(f).some(r => r.length > 1));
  const attempts = [new Set()];
  if (barrable.includes(low)) attempts.push(new Set([low]));
  const others = barrable.filter(f => f !== low)
    .sort((a, b) => saving(runs.get(b)) - saving(runs.get(a)));
  if (others.length) {
    attempts.push(new Set(barrable.includes(low) ? [low, others[0]] : [others[0]]));
  }
  const chosen = attempts.find(set => cost(set) <= CHORD_FINGERS);
  if (!chosen) return null;
  if (chosen.size > CHORD_MAX_BARRES) return null;

  // Now name the fingers. Ascending frets take ascending fingers — that
  // is the whole of the rule, and it is why the note nearest the nut is
  // the index and the one furthest up is the little finger.
  const assign = [];
  const barres = [];
  let finger = 0;
  for (const f of fretList) {
    const units = chosen.has(f) ? runs.get(f) : runs.get(f).flatMap(r => r.map(x => [x]));
    for (const unit of units) {
      finger++;
      for (const string of unit) assign.push({ string, fret: f, finger });
      if (unit.length > 1) {
        barres.push({ fret: f, from: unit[0], to: unit[unit.length - 1], finger });
      }
    }
  }

  return {
    fingers: finger,
    barre: barres[0] ?? null,
    barres,
    assign,
    // Which finger lies across the barre, if any. The index barring the
    // lowest fret is the ordinary case; anything else is harder.
    index: barres.length ? barres[0].finger : 0,
  };
}

// ---- The CAGED grips --------------------------------------
// A triad has five shapes on a guitar and every player learns them in
// the same five places. They are worth naming and worth leading with,
// because a player recognising the shape gets the fingering for free.
//
// Each is written as the frets it uses, relative to its own lowest, on a
// named run of strings — which is exactly what a shape is: a pattern the
// hand keeps while the neck moves underneath it.
const CAGED_GRIPS = [
  { name: "E", quality: "major", from: 0, shape: [0, 2, 2, 1, 0, 0] },
  { name: "A", quality: "major", from: 1, shape: [0, 2, 2, 2, 0] },
  { name: "D", quality: "major", from: 2, shape: [0, 2, 3, 2] },
  { name: "C", quality: "major", from: 1, shape: [3, 2, 0, 1, 0] },
  { name: "G", quality: "major", from: 0, shape: [3, 2, 0, 0, 0, 3] },
  { name: "E", quality: "minor", from: 0, shape: [0, 2, 2, 0, 0, 0] },
  { name: "A", quality: "minor", from: 1, shape: [0, 2, 2, 1, 0] },
  { name: "D", quality: "minor", from: 2, shape: [0, 2, 3, 1] },
];

/** Which CAGED shape this grip is, if it is one. Triads only. */
function cagedGrip(voicing, degrees) {
  // The five shapes are named for a six-string guitar in fourths. A
  // mandolin's fifths or a banjo's open G can, purely by coincidence,
  // produce the same relative fret pattern on the same string numbers —
  // but calling it an "E shape" there would teach a shape that doesn't
  // exist on that instrument.
  if (!instrument.caged) return null;
  if (degrees.length !== 3) return null;
  const quality = degrees.includes("b3") ? "minor" : degrees.includes("3") ? "major" : null;
  if (!quality) return null;

  const lo = Math.min(...voicing.cells.map(c => c.fret));
  const pattern = voicing.cells.map(c => c.fret - lo);
  for (const grip of CAGED_GRIPS) {
    if (grip.quality !== quality) continue;
    if (grip.from !== voicing.strings[0]) continue;
    if (grip.shape.length !== pattern.length) continue;
    if (grip.shape.every((f, i) => f === pattern[i])) return grip.name;
  }
  return null;
}

// The tones that colour a chord rather than define it. The alterations
// of the fifth are not here: a b5 or #5 is a fifth, however bent, and it
// sits where a fifth sits.
const EXTENSIONS = new Set(["9", "b9", "#9", "11", "#11", "13", "b13"]);

// Strings below this are the chord's foundation — the sixth, fifth and
// fourth, where an extension muddies rather than colours.
const LOW_REGISTER = 3;

/**
 * How hard this grip is to play, as a number — lower is easier.
 *
 * Not a measurement of anything; a ranking, tuned so the grip that comes
 * out on top is the one a teacher would show first. The parts it weighs:
 *
 *   - a CAGED shape is what a player already knows, so it leads;
 *   - the reach matters most, and past four frets it stops being a grip
 *     and becomes a stretch;
 *   - an index barre across the lowest fret is ordinary; a barre by some
 *     other finger, with the index still holding a note below it, is not;
 *   - an open string costs no finger at all, which is why the open
 *     shapes are the first chords anyone learns;
 *   - the root underneath makes a chord sound like itself;
 *   - more strings sounding is fuller, and a run reaching the bass is
 *     worth more than one sitting on the top three;
 *   - a note repeated when it needn't be is a wasted string.
 */
function voicingEase(voicing, degrees) {
  const { cells, notes, span, strings } = voicing;
  let score = 0;

  const shape = cagedGrip(voicing, degrees);
  if (shape) score -= 3;

  // Cost of the stretch. Counted in frets by default — tuned for a
  // guitar, where a fret really does cost about the same stretch
  // wherever it falls. That stops being true on a short-scale neck: six
  // frets at the twelfth position is a smaller reach than six frets at
  // the first, because the frets themselves have narrowed. An
  // instrument with real reach numbers (see handReach, built for bass)
  // is charged in inches instead, so a wide span far up its neck isn't
  // punished the way the same fret count would be near the nut.
  const byInches = instrument.chords.reach.max !== Infinity;
  if (byInches) {
    const inches = handReach(cells);
    score += inches * (instrument.chords.reachCostPerInch ?? 1.2);
    if (inches > instrument.chords.reach.comfort) score += instrument.chords.stretchPenalty ?? 5;
  } else {
    score += (span - 1) * (instrument.chords.spanCostPerFret ?? 1.2);
    if (span > chordComfort()) score += instrument.chords.stretchPenalty ?? 5;
  }
  // Charging by inches makes a narrow span far up the neck look free,
  // since the frets themselves have narrowed — but the hand still has
  // to travel there, and the neck usually gets in the way of it too.
  // Guitar and banjo don't opt in: the guitar's own fret-count charges
  // already discourage a high position by way of discouraging the wide
  // span it usually takes to get there, and neither table needs a
  // second, independent nudge for the same thing.
  score += voicing.lo * (instrument.chords.positionCost ?? 0);
  // Past some point the body of the instrument is in the way as much as
  // the fingers are; a shape that's narrow in inches up there is still
  // asking the hand to travel further than the ease of holding it once
  // there would suggest.
  score += Math.max(0, voicing.lo - (instrument.chords.highPositionFret ?? Infinity))
    * (instrument.chords.highPositionCost ?? 0);
  // What a finger costs, and what an open string saves, both assume a
  // guitarist's habits by default: reach for the open shape, use as few
  // fingers as the chord allows. A mandolin (and to a lesser extent a
  // banjo) doesn't share that habit — the closed, movable shape fretted
  // on all four strings is the standard chop-chord grip, not a fallback
  // from the open one, so an instrument that plays that way can say its
  // fingers cost less and its open strings save less.
  const fingerCost = instrument.chords.fingerCost ?? 0.9;
  score += (voicing.fingers ?? 4) * fingerCost;

  for (const barre of voicing.barres ?? []) {
    // The index lying across the lowest fret is the barre everyone
    // plays. Any other finger barring means the hand is holding a note
    // below the barre as well, which is a different and harder thing.
    score += barre.finger === 1 ? 0.8 : 3;
  }

  // An open string needs no finger, which is why the open shapes are the
  // first chords anyone learns. Capped, though: three open strings do not
  // make a grip three times better, and left uncapped this alone would
  // float every thin two-string fragment to the top of the list.
  const open = cells.filter(c => c.fret === 0).length;
  const openBonus = instrument.chords.openBonus ?? 0.9;
  const openCap    = instrument.chords.openBonusCap ?? 2;
  score -= Math.min(open * openBonus, openCap);

  // A fully closed grip — every string fretted, none left silent — is
  // the mandolin chop chord specifically: a moveable, percussive shape
  // chosen because it's the same shape in any key, not one that happens
  // to fall on open strings. Nothing else here rewards that on its own
  // terms — the fullness bonus below cares only about the string COUNT,
  // and open strings already get their own bonus above regardless of
  // whether they add up to a complete, transposable shape.
  if (open === 0 && strings.length === numStrings && instrument.chords.closedGripBonus) {
    score -= instrument.chords.closedGripBonus;
  }

  // Root position naming the chord for whoever's listening matters more
  // on an instrument playing alone in the bass register than it does in
  // a mandolin's chop chord, which is felt as much as heard and where a
  // closed shape's inversion is chosen for the hand shape, not avoided.
  if (voicing.bass === "1") score -= instrument.chords.rootBonus ?? 2;

  // How many strings should sound depends on what the chord is.
  //
  // A triad wants to be full: six and five string grips are what you show
  // someone asking how to play it, and the top three are what they reach
  // for later. But a thirteenth is four or five notes of information, and
  // spreading it over six strings means doubling — which on a dense chord
  // means the root or fifth sounding twice against notes a tone apart
  // from them. Four notes is what a guitarist actually plays there, and
  // it is why the shell voicings exist.
  // Indexed by how many strings are left silent rather than by the raw
  // count sounding, so "every string is going" means the same thing on
  // a four-string mandolin as it does on a six-string guitar — both are
  // 0 left out — instead of a mandolin's fullest possible grip reading
  // as merely middling on a table sized for six.
  // A drone string is not one of the voices the hand is spreading the
  // chord across, so it has no say in how thinly it is spread. Counting
  // it made a banjo's 5th string a liability on exactly the chords it
  // helps most: letting it ring pushed a dense grip one row up this
  // table and cost more than the free chord tone was worth. Its own
  // worth is settled just below, on its own terms.
  const dense = degrees.length >= 5;
  const voiced = numStrings - droneStrings.size;
  const leftOut = voiced - strings.filter(s => !droneStrings.has(s)).length;
  score += dense
    ? ({ 0: 2, 1: 0.5, 2: -1.5, 3: 0.5 }[leftOut] ?? 2)
    : ({ 0: -3, 1: -2, 2: -0.5, 3: 2 }[leftOut] ?? 3);
  score += strings[0] * 0.2;       // a run reaching the bass strings is fuller

  // The drone string.
  //
  // A banjo's 5th string is not an open string in the sense the bonus
  // above means. It is ringing whatever the hand is doing — there is no
  // reach to the nut, no finger to free, nothing to weigh against the
  // grip — so a tone arriving on it is arriving for nothing, and the
  // capped open bonus (which the fretted open strings are competing for)
  // undersells that.
  //
  // It matters most exactly where the neck is tightest. A dense chord has
  // more tones than a hand has fingers, and the tone the drone can supply
  // is one the fingers no longer have to: the root off the 5th string is
  // what leaves all four fingers free for the third, the seventh and the
  // extension the chord is named for. So the same free string is worth
  // more on a 13th than it is on a triad, where the fingers were never
  // short in the first place.
  cells.forEach((c, i) => {
    if (c.fret !== 0 || !droneStrings.has(c.string)) return;
    score -= dense ? 1.5 : 0.5;
    // And the root above all, since that is the tone the dense-chord
    // rules are otherwise most willing to drop.
    if (notes[i].degree === "1") score -= dense ? 1.0 : 0.3;
  });

  // Every tone the chord names should be sounding if the hand allows it.
  const sounded = new Set(notes.map(n => n.degree));
  score += degrees.filter(d => !sounded.has(d)).length * 1.2;

  // Where the extensions sit.
  //
  // A guitar is not a piano: the low strings are thick and close
  // together, and a ninth or a thirteenth down there beats against the
  // root instead of colouring it. So the bottom of a chord is built from
  // the tones that define it — root, third, fifth, seventh — and the
  // extensions go on top, where the strings are thin and far enough
  // apart in pitch to let them ring as colour.
  //
  // A13 is the shape this produces: root on the sixth string, seventh on
  // the fourth, third on the third, and the thirteenth alone on the
  // second, up where it belongs. The penalty falls away entirely above
  // the D string, so nothing is being forced upward — only stopped from
  // sitting in the bass.
  cells.forEach((cell, i) => {
    if (!EXTENSIONS.has(notes[i].degree)) return;
    score += Math.max(0, LOW_REGISTER - cell.string) * 1.3;
  });

  // And an extension underneath everything is not a voicing of the chord
  // so much as a different chord — a 13th in the bass says the thirteenth
  // is the root and the ear believes it.
  if (EXTENSIONS.has(voicing.bass)) score += 3;

  // Doubling the root or the fifth is how guitars have always voiced
  // chords. Doubling anything else spends a string on nothing — on a
  // guitar. A mandolin or banjo sits an octave or more above one, where
  // a repeated third or seventh isn't a wasted string so much as the
  // register talking: the chord is being voiced the way the instrument
  // actually sits in an ensemble, thick strings and all. So the cost of
  // that doubling is instrument's to set, not fixed the way root-and-
  // fifth doubling is everywhere.
  const seen = new Map();
  for (const n of notes) seen.set(n.degree, (seen.get(n.degree) ?? 0) + 1);
  for (const [degree, count] of seen) {
    if (count < 2) continue;
    score += (degree === "1" || degree === "5")
      ? 0.15 * (count - 1)
      : (instrument.chords.doubleCost ?? 0.9) * (count - 1);
  }

  return { score, shape };
}

/**
 * Whittle a list of grips down to the few worth showing.
 *
 * A chord has hundreds of correct fingerings and almost all of them are
 * things nobody plays. Cycling through every one buries the three that
 * matter, so the list is cut to the easiest few — and two grips differing
 * by one doubled note are not two grips, so the near-duplicates go first.
 */
export function rankVoicings(list, type, { limit = 4 } = {}) {
  const degrees = getScaleDegrees(type);
  const onBass  = instrument.chords.strategy === "bass";
  const scored = list.map(v => {
    const { score, shape, grip, omits } = onBass
      ? bassVoicingEase(v, degrees, type)
      : voicingEase(v, degrees);
    return {
      ...v, ease: score,
      shape: shape ?? null, grip: grip ?? null,
      // The bass works its omissions out while scoring; the guitar search
      // records them as it builds the grip. Either way they belong to the
      // voicing, so a scorer with nothing to say must not erase them.
      omits: omits ?? v.omits ?? [],
    };
  }).sort((a, b) => a.ease - b.ease);

  // A grip that is another grip with strings taken away is not a second
  // way of playing the chord — it is the same hand, sounding less. Open
  // C is x32010; x320xx and xxx010 are that same shape with the player
  // simply not striking everything, and offering all three as choices
  // buries the ones that are genuinely different.
  //
  // Unless the bass changes. Adding the open sixth string to x32010
  // gives 032010, which is the same fingering but a different chord —
  // it sounds over an E — so that one stays.
  const fingersOf = v => new Map(v.cells.map(c => [c.string, c.fret]));
  const contains = (big, small) => {
    for (const [string, fret] of small) if (big.get(string) !== fret) return false;
    return true;
  };

  const kept = [];
  const keptMaps = [];
  for (const v of scored) {
    const mine = fingersOf(v);
    const shadowed = kept.some((k, i) =>
      k.bass === v.bass &&
      (contains(keptMaps[i], mine) || contains(mine, keptMaps[i])));
    if (shadowed) continue;
    kept.push(v);
    keptMaps.push(mine);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Full grips: every string in a run sounds a chord tone, and notes may
 * be doubled. This is how a guitar actually plays chords — open D is
 * D A D F#, with the root twice — and it is what produces the open and
 * barre shapes, since a barre is only reachable by doubling.
 *
 * @returns {Array<{cells, notes, lo, hi, strings, fingers, barre, ...}>}
 */
function fullVoicings(root, type, { openAnywhere = false, relaxed = false } = {}) {
  const grid = buildScaleGrid(root, type);
  const degrees = getScaleDegrees(type);
  // Asked for whole by default. `relaxed` is the second pass, run only
  // where the first found nothing: the chord's shell, with whatever
  // extensions happen to fit, and a note of what had to go.
  const strict = chordRequirements(degrees, type);
  const wants  = relaxed ? shellRequirements(degrees, type) : strict;
  const omitsOf = sounded =>
    relaxed ? [...strict.required].filter(d => !sounded.has(d)) : [];
  const out = [];
  const seen = new Set();

  // Every string open, unfretted, is the whole point of an open tuning —
  // strumming a banjo in open G with nothing held down IS a G major
  // chord. The search below is built around a fretted anchor and can
  // never produce that, so it's checked once here instead. Ordinary
  // tunings don't spell a chord this way (EADGBE resolves to no triad
  // at all), so this simply never fires for them.
  if (grid.every(row => row[0])) {
    const cells = grid.map((row, s) => ({ string: s, fret: 0 }));
    const notes = cells.map(c => grid[c.string][0]);
    const sounded = new Set(notes.map(n => n.degree));
    if (satisfies(sounded, wants)) {
      const lowest = lowestCell(cells);
      const bass = grid[lowest.string][lowest.fret].degree;
      out.push({
        cells, notes, span: 0, stretch: false,
        lo: 0, hi: 0, strings: cells.map(c => c.string),
        fingers: 0, barre: null, barres: [],
        order: notes.map(n => n.degree).join("-"),
        bass, omits: omitsOf(sounded),
        label: labelFor(notes, bass),
      });
    }
  }

  // Anchor on every fret, right to the end of the neck. Stopping a hand's
  // width early would silently lose every grip whose lowest note sits up
  // there — the reach simply runs out against the last fret instead.
  for (let lo = 1; lo <= numFrets; lo++) {
    // What each string can play: an open note, or one within the hand.
    const options = [];
    for (let s = 0; s < numStrings; s++) {
      const frets = [];
      if (grid[s][0]) frets.push(0);
      for (let f = lo; f <= Math.min(lo + chordSpan() - 1, numFrets); f++) {
        if (grid[s][f]) frets.push(f);
      }
      options.push(frets);
    }

    // Which strings sound. Neighbouring runs, mostly — but also runs with
    // the string just above the bass left out, because that is how a
    // guitarist voices anything dense. Putting the root on the sixth and
    // the rest on the fourth, third and second leaves the fifth string
    // silent under the hand, and it is silent because the finger holding
    // the root leans against it. That grip is most of the jazz vocabulary
    // and it cannot be built out of neighbouring strings alone.
    const stringSets = [];
    for (let first = 0; first < numStrings; first++) {
      for (let last = first + 2; last < numStrings; last++) {
        const run = [];
        for (let s = first; s <= last; s++) run.push(s);
        stringSets.push(run);
        // The same run with the string above the bass muted. Only worth
        // having if three still sound, and only where the bass is
        // fretted — an open string has no finger leaning off it, so
        // there is nothing to damp its neighbour with.
        if (last - first >= 3 && !options[first].every(f => f === 0)) {
          stringSets.push([first, ...run.slice(2)]);
        }
      }
    }

    for (const strings of stringSets) {
      if (strings.some(s => options[s].length === 0)) continue;

        const chosen = [];
        (function choose(i) {
          if (i === strings.length) {
            const cells = strings.map((string, k) => ({ string, fret: chosen[k] }));
            const stopped = cells.filter(c => c.fret > 0);
            if (stopped.length === 0) return;
            // A gap only works if the finger on the bass note can lie
            // against the silent string. An open bass has no finger on
            // it, so there is nothing to do the muting.
            const gapped = strings.at(-1) - strings[0] + 1 > strings.length;
            if (gapped && cells[0].fret === 0) return;
            // Anchor here, so each grip is counted once.
            if (Math.min(...stopped.map(c => c.fret)) !== lo) return;

            const hi = Math.max(...stopped.map(c => c.fret));
            const span = hi - lo + 1;
            // An open string belongs at the nut, so by default a grip
            // that lets one ring is kept tight around it — reaching up
            // the neck while it sounds is not what a player usually
            // wants. Asked for open strings outright, the only limit is
            // the hand's: an open string needs no finger, so the reach
            // is no harder than any other grip of the same span.
            //
            // A drone string never counts toward this. It isn't near the
            // nut the way a normal open string is — it rings from its
            // own separate string regardless of where the fretting hand
            // is, so there's no reach to speak of and nothing to cap.
            const openCap = openAnywhere ? chordSpan() : chordOpenSpan();
            const reachesForOpen = cells.some(c => c.fret === 0 && !droneStrings.has(c.string));
            if (reachesForOpen && span > openCap) return;

            const notes = cells.map(c => grid[c.string][c.fret]);
            // Every note it must sound has to be here; the rest are free
            // to appear or not.
            const sounded = new Set(notes.map(n => n.degree));
            if (!satisfies(sounded, wants)) return;

            // The root need not be the lowest note. Whichever tone falls
            // under the others names the inversion, and a guitar reaches
            // those as readily as it reaches root position.
            const lowest = lowestCell(cells);
            const bass = grid[lowest.string][lowest.fret].degree;

            const grip = gripFingering(cells);
            if (!grip) return;

            const key = gripKey(cells);
            if (seen.has(key)) return;
            seen.add(key);

            out.push({
              cells, notes, span,
              stretch: isStretch(cells, span),
              lo, hi, strings,
              fingers: grip.fingers,
              barre: grip.barre,
              barres: grip.barres,
              order: notes.map(n => n.degree).join("-"),
              bass, omits: omitsOf(sounded),
              label: labelFor(notes, bass),
            });
            return;
          }
        for (const f of options[strings[i]]) { chosen[i] = f; choose(i + 1); }
      })(0);
    }
  }
  // Up the neck. At the same fret, root position leads — it is what a
  // player reaches for first — then the fullest grip, then the easiest.
  return out.sort((a, b) =>
    a.lo - b.lo ||
    (a.bass === "1" ? 0 : 1) - (b.bass === "1" ? 0 : 1) ||
    b.cells.length - a.cells.length ||
    a.fingers - b.fingers || a.span - b.span);
}

/**
 * Can this chord use an open string at all?
 *
 * Only a string whose open note is one of the chord's own tones can ring
 * with it, so this is just a look along the nut. A chord with none — F#
 * major against E A D G B E — has no open shape anywhere on the neck, and
 * nothing to offer if asked for one.
 */
export function hasOpenVoicing(root, type) {
  const grid = buildScaleGrid(root, type);
  for (let s = 0; s < numStrings; s++) if (grid[s][0]) return true;
  return false;
}

/**
 * Every root-position voicing of a chord, low on the neck first.
 *
 * Stacked: one string per chord tone, nothing doubled — the closed shape
 * a piano would play, and the clearest way to see a chord's intervals.
 * Unstacked: every string in a run sounds, doubling freely, which is how
 * the open and barre chords a guitarist actually uses come about.
 *
 * `openAnywhere` lifts the rule that keeps an open string near the nut,
 * so grips that let one ring under a hand further up the neck are offered
 * too. Off, the only open shapes are the ones at the nut.
 *
 * `relaxed` asks for the chord's shell instead of the whole chord, and is
 * meant for the second pass when a stretch of neck turns out to hold no
 * complete grip. See shellRequirements. Each grip it returns carries the
 * tones it had to leave out, so the label can admit to them.
 *
 * @returns {Array<{cells, notes, lo, hi, strings, order, label, omits}>}
 */
export function chordVoicings(root, type, { stacked = true, openAnywhere = false, relaxed = false } = {}) {
  // A bass has one way of voicing a chord, not two. The guitar's split
  // between a stacked shape and a full strummed grip is about doubling
  // across six strings, and there is no doubling to be had on four.
  if (instrument.chords.strategy === "bass") {
    return bassVoicings(root, type, { openAnywhere });
  }
  if (!stacked) return fullVoicings(root, type, { openAnywhere, relaxed });
  const grid = buildScaleGrid(root, type);

  // A stack puts one note on each string, so it can only hold as many
  // notes as the hand can span. Up to five it takes the chord whole;
  // beyond that it stacks what the chord cannot do without, which is the
  // shell a guitarist would play anyway.
  //
  // Where a chord offers a choice of colour — an altered dominant with
  // its b9, #9 and b5 — each choice makes its own stack, so every version
  // is on offer rather than the chord being flattened to a plain seventh.
  const degrees = getScaleDegrees(type);
  const wants = chordRequirements(degrees, type);
  const noteSets = [];
  if (degrees.length <= 5) {
    noteSets.push(new Set(degrees));
  } else if (wants.anyOf.length === 0) {
    noteSets.push(new Set(wants.required));
  } else {
    // One stack per way of colouring the chord.
    let combos = [new Set(wants.required)];
    for (const group of wants.anyOf) {
      const grown = [];
      for (const base of combos) for (const pick of group) {
        grown.push(new Set([...base, pick]));
      }
      combos = grown;
    }
    noteSets.push(...combos);
  }

  const out = [];
  const seen = new Set();
  for (const wanted of noteSets) {
  const size = wanted.size;

  // Where each string carries one of the notes being stacked.
  const available = [];
  for (let s = 0; s < numStrings; s++) {
    const frets = [];
    for (let f = 0; f <= numFrets; f++) {
      if (grid[s][f] && wanted.has(grid[s][f].degree)) frets.push(f);
    }
    available.push(frets);
  }

  for (let first = 0; first + size - 1 < numStrings; first++) {
    const strings = Array.from({ length: size }, (_, i) => first + i);
    const chosen = [];

    (function choose(i) {
      if (i === size) {
        const cells = strings.map((string, k) => ({ string, fret: chosen[k] }));
        const notes = cells.map(c => grid[c.string][c.fret]);
        const pitches = cells.map(pitchAt);

        // Must climb as it crosses the strings, and sound every tone once.
        for (let k = 1; k < size; k++) if (pitches[k] <= pitches[k - 1]) return;
        if (new Set(notes.map(n => n.degree)).size !== size) return;

        // Any tone may sit at the bottom. Stacking the chord from its
        // third or fifth instead of its root gives the inversions, and on
        // a symmetric chord those are the whole vocabulary: a diminished
        // seventh is the same shape every three frets, each repeat an
        // inversion of the one below it.
        const bass = notes[0].degree;              // pitch rises, so this is lowest

        // Within one hand. Open strings need no finger, but they belong
        // to the nut — reaching up the neck while one rings is not a grip
        // anyone would choose.
        const stopped = cells.map(c => c.fret).filter(f => f > 0);
        const span = stopped.length
          ? Math.max(...stopped) - Math.min(...stopped) + 1 : 0;
        if (span > chordSpan()) return;
        if (cells.some(c => c.fret === 0) &&
            stopped.length && Math.max(...stopped) > instrument.chords.openReach) return;

        const frets = cells.map(c => c.fret);
        const key = gripKey(cells);
        if (seen.has(key)) return;      // two colourings can meet here
        seen.add(key);
        out.push({
          cells, notes, span,
          stretch: isStretch(cells, span),
          lo: Math.min(...frets), hi: Math.max(...frets),
          strings,
          order: notes.map(n => n.degree).join("-"),
          bass,
          label: labelFor(notes, bass),
        });
        return;
      }
      for (const f of available[strings[i]]) { chosen[i] = f; choose(i + 1); }
    })(0);
  }
  }

  // Up the neck; at the same fret, root position leads, then whichever
  // the hand covers most easily.
  return out.sort((a, b) =>
    a.lo - b.lo ||
    (a.bass === "1" ? 0 : 1) - (b.bass === "1" ? 0 : 1) ||
    a.span - b.span || a.strings[0] - b.strings[0]);
}

// ============================================================
// BASS CHORDS
//
// A bass is not a small guitar, and its chords are not guitar chords
// with two strings missing. Three things are different, and all three
// are arithmetic rather than taste.
//
// 1. THE LOW INTERVAL LIMIT. Two pitches close together low down fall
//    inside one filter in the ear and beat against each other instead of
//    blending. How close is too close depends on how low you are, and
//    the limits below are the ones arrangers have used for a century: a
//    minor third is clear at C3 and mud at E1; a fifth holds up down to
//    Bb1; below that only the octave survives. This is why the signature
//    bass chord is the TENTH — the third lifted an octave, out of the
//    range where it fights the root — and not the close triad a guitar
//    plays. Everything else here follows from this one rule.
//
// 2. THE NECK IS LONGER. A 34" scale puts the frets a third further
//    apart than a 25.5" one, so a four-fret grip at the first fret is a
//    five inch stretch on a bass against under four on a guitar. Fret
//    counts cannot express that; inches can, and the spacing is
//    computable — each fret sits one twelfth-root-of-two of the
//    remaining string closer to the bridge. Reassuringly, those same
//    inch caps applied to a guitar reproduce the four-and-five-fret
//    rules that were tuned by hand up there, which is a reason to trust
//    them down here.
//
// 3. THE ROOT IS THE JOB. A guitarist may drop the root from a crowded
//    chord because the bass player has it. The bass player has nobody
//    underneath, so the root stays, and whatever falls lowest genuinely
//    re-names the chord for the whole ensemble. Rootless voicings are
//    not offered; inversions are, ranked well below root position.
//
// What survives those three is small on purpose. A four-string bass
// voicing a seventh chord has room for the root, the third and the
// seventh — which is the shell a bass player actually plays.
// ============================================================

// The lowest pitch at which an interval still reads as harmony rather
// than as beating, in MIDI note numbers. Read as: a minor third (3
// semitones) is only clear from C3 (48) upward.
const LOW_INTERVAL_LIMITS = [
  { semitones: 1,  from: 52 },   // E3
  { semitones: 2,  from: 51 },   // Eb3
  { semitones: 3,  from: 48 },   // C3
  { semitones: 4,  from: 46 },   // Bb2
  { semitones: 5,  from: 41 },   // F2
  { semitones: 6,  from: 39 },   // Eb2
  { semitones: 7,  from: 34 },   // Bb1
  { semitones: 12, from: 0  },   // lower than that, the octave alone
];

/**
 * The smallest interval that stays clear above a given pitch.
 *
 * Monotone by construction: the lower the note, the wider its neighbour
 * has to be. A pair of pitches is clear when the gap between them is at
 * least this, measured up from the LOWER of the two.
 *
 * @param {number} midi  the lower pitch
 * @returns {number} semitones
 */
function minIntervalAt(midi) {
  for (const { semitones, from } of LOW_INTERVAL_LIMITS) {
    if (midi >= from) return semitones;
  }
  return 12;
}

/** How much room to spare a pair of pitches has, in semitones. */
function clarityMargin(lo, hi) {
  return (hi - lo) - minIntervalAt(lo);
}

/**
 * Distance from the nut to a fret, in inches.
 *
 * Each fret sits one twelfth-root-of-two of the remaining string closer
 * to the bridge, so the spacing shrinks geometrically and a grip that is
 * a stretch at the first fret is comfortable at the twelfth.
 */
function nutDistance(scaleLength, fret) {
  return scaleLength * (1 - Math.pow(2, -fret / 12));
}

/** How far apart the fingers must sit to hold a grip, in inches. */
export function handReach(cells) {
  const frets = cells.map(c => c.fret).filter(f => f > 0);
  if (frets.length < 2) return 0;
  const L = instrument.chords.scaleLength;
  return nutDistance(L, Math.max(...frets)) - nutDistance(L, Math.min(...frets));
}

/**
 * What a bass chord cannot do without: the root, because nothing is
 * underneath it to supply one, and the tone that says major or minor.
 *
 * Everything else — the fifth, the seventh, the extensions — is colour
 * the grip takes when it has room, and is scored rather than demanded.
 * That is not a compromise. A bass chord IS a shell, and asking a
 * four-string instrument for all seven notes of a thirteenth returns
 * nothing at all.
 */
function bassCore(degrees, { strict = true } = {}) {
  const has = d => degrees.includes(d);
  const core = new Set(["1"]);
  const quality = ["3", "b3", "4", "2"].find(has);
  if (quality) core.add(quality);

  // A bent fifth on a chord with no seventh is not colour, it is the
  // name of the chord: diminished and augmented differ from minor and
  // major in nothing else, so a grip that drops it is not a thin version
  // of the chord but a different chord, and offering C-Eb as a C
  // diminished would be a lie.
  //
  // Add a seventh and it changes hands. On a 7b5 the flat fifth is a
  // tension, and tensions belong to whoever is playing the upper
  // structure; what the bass owes the chord is the shell — root, third,
  // seventh — and a bassist comping an altered dominant plays exactly
  // that and lets the piano colour it. So the seventh stays and the
  // alteration becomes something to fit in if the neck allows.
  const bent = ["b5", "#5"].find(has);
  const seventh = ["7", "b7", "bb7", "6"].some(has);
  if (strict && bent && !seventh) core.add(bent);

  // Nothing but a fifth to work with — a power chord. Then the fifth is
  // the only thing carrying the sound, so it has to be there.
  if (core.size < 2) {
    const fifth = ["5", "b5", "#5"].find(has);
    if (fifth) core.add(fifth);
  }
  return core;
}

/**
 * The tones that make a chord more than a triad, and what each is worth
 * when the grip can carry it.
 *
 * A seventh turns a triad into a seventh chord and an alteration is the
 * whole reason an altered chord is named what it is, so those count
 * heavily. The fifth carries almost nothing and counts for little —
 * which is exactly why it is the first thing a bass player leaves out.
 */
function bassColour(degrees, type) {
  const has = d => degrees.includes(d);
  const worth = new Map();
  // The seventh is what the bass is for. Between a grip that keeps it and
  // one that keeps an alteration instead, the first is the one that
  // sounds like the chord, so this outweighs everything below it.
  for (const d of ["7", "b7", "bb7", "6"]) if (has(d)) worth.set(d, 3.0);
  // An alteration is next: it is the reason the chord is named what it
  // is, and worth more than the extension the chord is numbered for.
  for (const d of degrees) {
    if (/^[#b]/.test(d) && !["b3", "b7", "bb7"].includes(d)) worth.set(d, 2.2);
  }
  const named = ["13", "11", "9"].find(has);
  if (named) worth.set(named, 1.2);
  if (has("5")) worth.set("5", 0.3);
  return worth;
}

/** Every ascending run of strings, gaps allowed, of a workable size. */
function stringSubsets(count, min, max) {
  const out = [];
  const build = (start, picked) => {
    if (picked.length >= min) out.push([...picked]);
    if (picked.length === max) return;
    for (let s = start; s < count; s++) { picked.push(s); build(s + 1, picked); picked.pop(); }
  };
  build(0, []);
  return out;
}

// The shapes a bass player would name, as semitones between neighbouring
// notes. Naming them by interval rather than by chord is what makes them
// shapes: a tenth is a tenth whether the chord is major or minor.
const BASS_GRIPS = [
  { name: "tenth",        gaps: [15]    }, { name: "tenth",   gaps: [16]    },
  { name: "fifth",        gaps: [7]     }, { name: "octave",  gaps: [12]    },
  { name: "seventh",      gaps: [10]    }, { name: "seventh", gaps: [11]    },
  { name: "shell",        gaps: [10, 5] }, { name: "shell",   gaps: [11, 4] },
  { name: "shell",        gaps: [10, 6] }, { name: "shell",   gaps: [11, 5] },
  { name: "shell",        gaps: [ 7, 8] }, { name: "shell",   gaps: [ 7, 7] },
  { name: "spread triad", gaps: [ 8, 7] }, { name: "spread triad", gaps: [9, 7] },
  { name: "third",        gaps: [ 3]    }, { name: "third",   gaps: [ 4]    },
  { name: "sixth",        gaps: [ 8]    }, { name: "sixth",   gaps: [ 9]    },
  { name: "fourth",       gaps: [ 5]    },
];

/**
 * The chord tones a grip leaves out and ought to admit to.
 *
 * Nearly every bass voicing omits something, so listing all of it would
 * be noise — nobody notes a missing fifth, because the fifth is always
 * the first thing to go. What is worth saying is a missing seventh or a
 * missing alteration, because without those the grip is not really the
 * chord it is labelled with, and the player should know that before they
 * decide it is close enough.
 */
function bassOmissions(voicing, degrees, type) {
  const sounded = new Set(voicing.notes.map(n => n.degree));
  const out = [];
  for (const [degree, worth] of bassColour(degrees, type)) {
    if (worth >= 1.0 && !sounded.has(degree)) out.push(degree);
  }
  return out;
}

/** The name a player would give this grip, where it has one. */
function bassGripName(voicing) {
  const pitches = voicing.cells.map(pitchAt);
  const gaps = pitches.slice(1).map((p, i) => p - pitches[i]);
  const match = BASS_GRIPS.find(g =>
    g.gaps.length === gaps.length && g.gaps.every((v, i) => v === gaps[i]));
  if (match) return match.name;
  // Unnamed, but worth saying when the third is up where it belongs.
  const third = voicing.notes.findIndex(n => n.degree === "3" || n.degree === "b3");
  if (third > 0 && pitches[third] - pitches[0] >= 12) return "spread";
  return null;
}

/**
 * Every bass voicing of a chord.
 *
 * Two to four notes on any ascending run of strings — gaps included,
 * because a tenth needs one: the root on the E string and the third on
 * the G string leaves the two in between silent, and that grip is most
 * of the bass chord vocabulary.
 *
 * Nothing is doubled. On four strings a doubled note is a quarter of the
 * chord spent saying something already said, and down here it is also a
 * second voice inside the same critical band as the first.
 */
function bassVoicings(root, type, { openAnywhere = false } = {}) {
  const strict = bassSearch(root, type, bassCore(getScaleDegrees(type)), openAnywhere);
  if (strict.length) return strict;
  // The altered fifth could not be reached anywhere on this neck. Rather
  // than show an empty board, take the chord without it — the omission
  // is carried on every grip and said out loud in the label.
  return bassSearch(root, type,
    bassCore(getScaleDegrees(type), { strict: false }), openAnywhere);
}

function bassSearch(root, type, core, openAnywhere) {
  const grid    = buildScaleGrid(root, type);
  const { reach, openReach } = instrument.chords;

  // Where each string can put a chord tone at all.
  const options = [];
  for (let s = 0; s < numStrings; s++) {
    const frets = [];
    for (let f = 0; f <= numFrets; f++) if (grid[s][f]) frets.push(f);
    options.push(frets);
  }

  const out = [];
  const seen = new Set();

  for (const strings of stringSubsets(numStrings, 2, Math.min(4, numStrings))) {
    if (strings.some(s => options[s].length === 0)) continue;
    const chosen = [];

    (function choose(i) {
      if (i === strings.length) {
        const cells   = strings.map((string, k) => ({ string, fret: chosen[k] }));
        const pitches = cells.map(pitchAt);

        // Voices may not cross. A voicing that descends as it crosses the
        // strings is one already counted on a different run.
        for (let k = 1; k < pitches.length; k++) if (pitches[k] <= pitches[k - 1]) return;

        const notes   = cells.map(c => grid[c.string][c.fret]);
        const sounded = new Set(notes.map(n => n.degree));
        if (sounded.size !== notes.length) return;         // nothing doubled
        for (const d of core) if (!sounded.has(d)) return;

        // THE LOW INTERVAL LIMIT — the rule the whole model turns on.
        // Only neighbouring pairs are checked, because it is neighbours
        // that beat; the outer notes of a wide voicing were never at risk.
        for (let k = 1; k < pitches.length; k++) {
          if (clarityMargin(pitches[k - 1], pitches[k]) < 0) return;
        }

        const stopped = cells.map(c => c.fret).filter(f => f > 0);
        if (stopped.length === 0) return;                  // all open is not a grip
        const lo = Math.min(...stopped), hi = Math.max(...stopped);
        if (hi - lo + 1 > chordSpan()) return;
        const inches = handReach(cells);
        if (inches > reach.max) return;                    // no hand is that wide

        // An open string rings wherever the hand is, but a grip mixing
        // the nut with the top of the neck is not one anybody plays.
        if (cells.some(c => c.fret === 0) && !openAnywhere && hi > openReach) return;

        const grip = gripFingering(cells);
        if (!grip) return;

        const key = gripKey(cells);
        if (seen.has(key)) return;
        seen.add(key);

        const bass = notes[0].degree;    // pitch ascends, so this is the lowest
        out.push({
          cells, notes, strings,
          span: hi - lo + 1,
          reach: inches,
          stretch: inches > reach.comfort,
          lo, hi,
          fingers: grip.fingers,
          barre: grip.barre,
          barres: grip.barres,
          order: notes.map(n => n.degree).join("-"),
          bass,
          label: labelFor(notes, bass),
        });
        return;
      }
      // Pruned as it descends rather than at the leaf. Both tests that
      // matter — voices rising, and each new pair clearing the interval
      // limit — depend only on the note just placed and the one before
      // it, so a branch that fails either can never recover further
      // down, and cutting it there is what keeps a dense chord's search
      // from running into six figures.
      const prev = i > 0
        ? midiAt(strings[i - 1], chosen[i - 1])
        : null;
      for (const f of options[strings[i]]) {
        if (prev !== null) {
          const here = midiAt(strings[i], f);
          if (here <= prev) continue;
          if (clarityMargin(prev, here) < 0) continue;
        }
        chosen[i] = f;
        choose(i + 1);
      }
    })(0);
  }

  return out.sort((a, b) =>
    a.lo - b.lo ||
    (a.bass === "1" ? 0 : 1) - (b.bass === "1" ? 0 : 1) ||
    b.cells.length - a.cells.length ||
    a.reach - b.reach);
}

/**
 * How good a bass voicing is, as a number — lower is better.
 *
 * The ordering this produces is the one a bass teacher gives: the root
 * and its tenth first, then the shell with the seventh inside it, then
 * the bare fifths, and the close triads last and only high up the neck,
 * where they finally stop growling.
 */
function bassVoicingEase(voicing, degrees, type) {
  const { cells, notes, strings } = voicing;
  const pitches = cells.map(pitchAt);
  let score = 0;

  // How much room to spare the tightest pair has: the difference between
  // a chord and a rumble, so it leads.
  //
  // It saturates quickly, and that matters more than the weight. Clear is
  // clear — three semitones above the limit sounds no muddier than nine —
  // and an uncapped reward would send every answer to the top of the neck
  // chasing margin the ear cannot hear.
  let worst = Infinity;
  for (let k = 1; k < pitches.length; k++) {
    worst = Math.min(worst, clarityMargin(pitches[k - 1], pitches[k]));
  }
  score -= Math.min(worst, 3) * 0.9;

  // Nothing here penalises the low register directly. It would be double
  // counting: the interval limit above already forbids exactly those
  // voicings the bottom of the instrument cannot carry, and a wide one
  // down there — an open E under its tenth — is a real and good sound.

  // The root underneath. On a guitar an inversion is a colour; on a bass
  // it re-names the chord for everyone listening, so root position leads
  // by a wide margin and the inversions wait behind it.
  if (voicing.bass !== "1") score += 4;

  // Three notes is a bass chord. Two is the everyday one; four is
  // possible, and crowds an instrument with four strings and no spare
  // register to put them in.
  score += ({ 2: -0.6, 3: -1.2, 4: 0.6 }[cells.length] ?? 2);

  // The colour it manages to carry: the seventh above all, then the
  // alterations, then whatever the chord is named for.
  const sounded = new Set(notes.map(n => n.degree));
  for (const [degree, worth] of bassColour(degrees, type)) {
    if (!sounded.has(degree)) score += worth;
  }

  // An extension has to be on top. Underneath the third or the seventh
  // it is not colouring the chord, it is arguing with it.
  cells.forEach((c, i) => {
    if (EXTENSIONS.has(notes[i].degree) && i < cells.length - 1) score += 1.6;
  });

  // The hand, measured in inches rather than frets, because the same
  // grip is a stretch at the first fret and easy at the twelfth.
  score += voicing.reach * 0.7;
  if (voicing.stretch) score += 2.5;
  score += voicing.fingers * 0.7;

  // Where the hand is. A bassist lives in the lower half of the neck, and
  // past the twelfth fret is thumb position: the frets are tiny, the neck
  // is meeting the body, and the strings have lost the length that made
  // them sound like a bass. So the same grip is worth less the further up
  // it is asked for, and this is what settles the many places one
  // interval can be played in favour of the one people use.
  score += voicing.lo * 0.09;
  score += Math.max(0, voicing.lo - 12) * 0.35;

  // Bass strings are thick, stiff and high off the board. A barre a
  // guitarist would not think twice about is real work down here.
  score += (voicing.barres?.length ?? 0) * 4;

  // An open string is a free finger and the fullest tone the instrument
  // has, which is why so much bass writing sits in the open keys.
  score -= Math.min(cells.filter(c => c.fret === 0).length, 2) * 0.8;

  // Skipping a string is ordinary — it is how a tenth is reached — but
  // the plucking hand still has to clear whatever is left silent, and
  // two in a row is harder than one.
  score += (strings.at(-1) - strings[0] + 1 - strings.length) * 0.5;

  return {
    score,
    grip: bassGripName(voicing),
    omits: bassOmissions(voicing, degrees, type),
  };
}
