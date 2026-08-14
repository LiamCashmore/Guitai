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
import { instrument, numFrets, numStrings, droneStrings, midiAt, buildScaleGrid, capoFret, handAtNut, handFret, cagedShapes } from "./fretboard.js";
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

/**
 * The tones a grip was asked for and hasn't got, in the order the chord
 * names them. The root is never on the list: a grip without one is
 * labelled rootless already, and saying both is saying it twice.
 */
const missingFrom = (wanted, sounded, degrees) =>
  degrees.filter(d => d !== "1" && wanted.has(d) && !sounded.has(d));

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

  // Barring as little as possible: nothing, then the index across the
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
  const usable = attempts.filter(set =>
    set.size <= CHORD_MAX_BARRES && cost(set) <= CHORD_FINGERS);
  if (!usable.length) return null;

  // Which of those a player uses is not "the fewest barres that fit". A
  // barre is one finger doing several fingers' work, and a hand reaches
  // for it whenever the work saved is real — two fingers or more. Nobody
  // fingers a banjo's C at the fifth fret with four separate fingertips
  // in a row just because they have four fingers; they lay the index
  // across it. Taking the first fingering that merely fit was doing
  // exactly that, and then charging the grip for the fingers it had
  // needlessly spent — which quietly pushed every full four-string barre
  // shape below the same shape with a string dropped.
  //
  // One finger saved is not enough to swing it, and that matters as much:
  // open D is xx0232, where the index could lie across the second fret
  // under the middle finger, and no one plays it that way.
  const chosen = usable.reduce((best, set) =>
    cost(best) - cost(set) >= 2 ? set : best);

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
  // exist on that instrument. Nor does one survive a peg being turned:
  // the same pattern of frets in drop D is a different chord.
  if (!cagedShapes()) return null;
  if (degrees.length !== 3) return null;
  const quality = degrees.includes("b3") ? "minor" : degrees.includes("3") ? "major" : null;
  if (!quality) return null;

  // Measured where the hand actually is, so an open string under a capo
  // counts as held at the bar. This is the whole point of a capo: the
  // open shapes are what a player moves up the neck to keep playing, and
  // reading their open strings as fret 0 made the shape unrecognisable
  // the moment one went on.
  const frets = voicing.cells.map(c => handFret(c.fret));
  const lo = Math.min(...frets);
  const pattern = frets.map(f => f - lo);
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

// Where an extension stops colouring a chord and starts muddying it.
//
// Written as a pitch, because that is what the fact is about: two notes
// a tone apart beat against each other low down and ring as colour high
// up, and the ear is answering to frequency, not to which string the
// note came off. G3 is the guitar's fourth string, and below it the
// sixth and fifth are where a ninth turns to mud.
//
// This used to be a string number — anything below the fourth string —
// which is the same statement on a guitar and nonsense anywhere else. A
// banjo's four melody strings are D3 G3 B3 D4, all at or above that
// line, and the rule was charging its 3rd string as if it were a bass
// E; a mandolin sits an octave above a guitar and was being charged on
// every string it has. It was enough to bury the grips that actually
// carried a chord's #11 or 13th, which is how a Cmaj7#11 on a banjo
// came to show as a plain C major triad.
//
// The per-semitone rate reproduces the old guitar numbers exactly where
// they were tuned — an open sixth, fifth or fourth string costs 3.9,
// 2.6, 1.3 — while letting the charge fall away up the neck, where the
// same string is no longer in that register at all.
const EXTENSION_FLOOR = 55;        // G3
const EXTENSION_MUD   = 0.26;      // per semitone below it

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
function voicingEase(voicing, degrees, type) {
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

  // What a barre costs the hand.
  //
  // Two things decide it. The index lying across a fret is the barre
  // everyone plays; any other finger barring means the hand is holding a
  // note below the barre as well, which is a different and harder thing.
  // And how far the finger has to reach across matters as much: two
  // neighbouring strings under one fingertip is a double stop, something
  // a hand does without noticing, while the same finger flattened over
  // all six is the grip beginners spend a month on. Charging both the
  // same made the mandolin's everyday two-finger chop shapes read as
  // hard as a full barre chord.
  const barreCost = instrument.chords.barreCost ?? 1;
  for (const barre of voicing.barres ?? []) {
    const across = barre.to - barre.from + 1;
    score += barreCost * ((barre.finger === 1 ? 0.4 : 1.1) + 0.25 * (across - 2));
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
  const sounded = new Set(notes.map(n => n.degree));
  const { required } = chordRequirements(degrees, type);
  // A dense chord wants four voices and a triad wants every string, and
  // those are two different statements: the first is a count, the second
  // is "all of them". The count has to be read against the instrument.
  // Four notes out of six leaves a guitarist two strings to drop, and
  // that is the shell voicing the note above is describing — but a banjo
  // has four strings to voice with, so four notes IS every string, and a
  // table that rewarded leaving two of them out was telling it to play a
  // 7#11 on two strings and call the missing tones colour. Which is how
  // a Cmaj7#11 came out as a C major triad: the tones that name the
  // chord were on the strings the ranking had decided to drop.
  const sounding = strings.filter(s => !droneStrings.has(s)).length;
  score += dense
    ? Math.abs(sounding - Math.min(4, voiced)) * 1.5
    : ({ 0: -3, 1: -2, 2: -0.5, 3: 2 }[leftOut] ?? 3);
  score += strings[0] * 0.2;       // a run reaching the bass strings is fuller

  // Nothing left out at all, which on some instruments is not one row of
  // that table but the whole idea of a chord there. A banjo is played
  // with all four fretted strings sounding under the drone: the shapes
  // are named for the four of them, the right hand rolls across all of
  // them, and a grip with the 4th string dropped is the same shape being
  // played incompletely rather than a different way of playing it. The
  // table above can't say that on its own, because it is graded in
  // strings and the difference between four sounding and three is one
  // step of it — worth about a finger, which is exactly what a fourth
  // string costs, so the two cancelled and the thinner grip won.
  //
  // Deliberately a bonus and not a rule. It is worth a finger or two, so
  // it decides between grips a hand takes equally easily; a full grip
  // that is a real stretch still loses to a comfortable partial one,
  // which is the right answer — the fourth string is worth having, not
  // worth spraining a hand for.
  //
  // And it is only ever paid on a grip that is actually the chord. In a
  // window too thin to hold one, a G5 across all four strings and a
  // two-string G-and-B are both partial answers, and the fuller of them
  // is the one missing the third — which is not the fuller answer at
  // all, it is the emptier one spread wider.
  if (leftOut === 0 && [...required].every(d => sounded.has(d))) {
    score -= instrument.chords.fullGripBonus ?? 0;
  }

  // And the chop chord's mirror, at the bottom of the neck.
  //
  // A closed shape earns its bonus by being movable — the same grip in
  // every key. That virtue is worth nothing in the open position, where
  // the strings are already sounding the chord's own notes for free: a
  // mandolin's open C is 0-2-3-0 and its open G is 0-0-2-3, two fingers
  // apiece against the chop chord's four, and no player chops those with
  // the open strings sitting right there. Without this the chop bonus
  // won everywhere, including at the nut, and the open chords — the first
  // shapes anyone learns on the instrument — were never offered.
  //
  // The capped open bonus above cannot say this on its own. It is capped
  // precisely so that open strings don't float thin two-string fragments
  // to the top, so it is far too small to outweigh a whole closed grip.
  // This is the other statement: not "open strings are nice" but "this is
  // the open chord", every string sounding and the chord complete, which
  // is the same shape of claim the closed bonus makes and settles against
  // it directly.
  //
  // It needs no sense of where the window is. An open string only reaches
  // a grip when the hand is at the nut — or at the capo, which is the nut
  // now, so a capoed open shape earns this exactly as its nut-position
  // original does.
  if (open > 0 && leftOut === 0 && [...required].every(d => sounded.has(d))) {
    score -= instrument.chords.openGripBonus ?? 0;
  }

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

  // Every tone the chord names should be sounding if the hand allows it —
  // but they are not worth the same, and the order is the one every
  // player knows. The tone that says major or minor goes last of all.
  // The seventh, and any alteration the chord is named for, go next to
  // last. The fifth goes first and is barely missed.
  //
  // Mostly this is chordRequirements read as a preference rather than a
  // rule, but with two tones named outright, because that list is a
  // yes-or-no and this is an order. On a triad it says all three tones
  // are required — true, there is nothing to spare — which left a G and
  // a B costing the same as a G and a D when only one pair was reachable,
  // and one of those is a G major while the other is a G5.
  //
  // It only ever speaks for grips that got through by being asked for
  // less: the shell of a chord too wide for the neck, or the fragment of
  // one in a window that holds no shell. Anywhere else, everything on
  // the list is already sounding.
  // The weights are heavy on purpose, and heavier than any of the
  // ergonomics above. In a window that can only sound part of a chord,
  // what the player needs to see is the part that makes it that chord —
  // the third, the seventh, the alteration it is named for — and a grip
  // is worth two extra frets of reach and a fourth finger to get one of
  // them. Weighted level with the reach, a Cmaj7#11 came out as a plain
  // C major triad, because dropping the 7th and the #11 was cheaper than
  // the two frets it took to hold them.
  const QUALITY = new Set(["3", "b3", "2", "4"]);
  const missingCost = d =>
    d === "5" ? 1.2 : QUALITY.has(d) ? 6.0 : required.has(d) ? 5.0 : 1.2;
  score += degrees.filter(d => !sounded.has(d)).reduce((n, d) => n + missingCost(d), 0);

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
  // G3, so nothing is being forced upward — only stopped from sitting in
  // the bass.
  cells.forEach((cell, i) => {
    if (!EXTENSIONS.has(notes[i].degree)) return;
    score += Math.max(0, EXTENSION_FLOOR - pitchAt(cell)) * EXTENSION_MUD;
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
      : voicingEase(v, degrees, type);
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
 * The same string sets again, with the drone added to each.
 *
 * A run of strings is a run because the picking hand has to get across
 * it and the fretting hand has to silence what is left out — which is
 * an argument about strings that lie next to each other under the hand,
 * and a banjo's 5th string is not one of them. It is off the side of
 * the neck with its own nut at the 5th fret, it rings whatever the hand
 * is doing, and a player picks it or doesn't. Whether the 1st string is
 * sounding has nothing to do with whether the drone can.
 *
 * Left out of the runs, it could only ever join a grip that already
 * reached the top string, which quietly barred the drone from every
 * shape voiced on the lower strings — including the one a banjo player
 * would reach for on a chord too big for four strings, where the free
 * tone off the 5th is exactly what makes it playable.
 */
function withDrone(sets) {
  if (!droneStrings.size) return [];
  const drones = [...droneStrings.keys()];
  const out = [];
  for (const set of sets) {
    const missing = drones.filter(d => !set.includes(d));
    if (!missing.length) continue;
    out.push([...set, ...missing].sort((a, b) => a - b));
  }
  return out;
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
    relaxed ? missingFrom(strict.required, sounded, degrees) : [];
  const out = [];
  const seen = new Set();

  // Every string open, unfretted, is the whole point of an open tuning —
  // strumming a banjo in open G with nothing held down IS a G major
  // chord, and capoed at the 2nd fret it is an A. The search below is
  // built around a fretted anchor and can never produce that, so it is
  // checked once here instead. Ordinary tunings don't spell a chord this
  // way (EADGBE resolves to no triad at all), so this simply never fires
  // for them.
  //
  // What "every string" means is the question a capo turns up. A drone
  // is the exception it always is: it sits off the side of the neck and
  // is picked on its own, so a drone that doesn't belong to the chord is
  // simply not picked — where an ordinary string, under the strumming
  // hand with nothing stopping it, will sound whether it belongs or not
  // and there is no finger anywhere to damp it with.
  //
  // Which is exactly a capoed banjo. Capo the 2nd fret and the four
  // strings on the neck are E A C# E — an A chord, the same open shape
  // the instrument is built around, moved up. The 5th string goes on
  // droning g, which is not in A, so a player leaves it alone or spikes
  // it. Demanding it belong meant the one grip a banjo player would
  // actually reach for was never offered at all, and the board fell back
  // to whatever fragment it could find.
  {
    const open = [];      // strings whose open note is in the chord
    let spoiled = false;  // one that isn't, and that a strum would sound
    for (let s = 0; s < numStrings; s++) {
      if (grid[s][0]) open.push(s);
      else if (!droneStrings.has(s)) { spoiled = true; break; }
    }
    if (!spoiled && open.length) {
      const cells = open.map(s => ({ string: s, fret: 0 }));
      const notes = cells.map(c => grid[c.string][0]);
      const sounded = new Set(notes.map(n => n.degree));
      if (satisfies(sounded, wants)) {
        const lowest = lowestCell(cells);
        const bass = grid[lowest.string][lowest.fret].degree;
        out.push({
          cells, notes, span: 0, stretch: false,
          // Open notes are played at the nut, and the capo is the nut
          // now — so this grip sits at the bar, not at fret 0, for
          // everything that asks where on the neck the hand is.
          lo: capoFret, hi: capoFret, strings: cells.map(c => c.string),
          fingers: 0, barre: null, barres: [],
          order: notes.map(n => n.degree).join("-"),
          bass, omits: omitsOf(sounded),
          label: labelFor(notes, bass),
        });
      }
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
    stringSets.push(...withDrone(stringSets));

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
            // it, so there is nothing to do the muting. A drone is not a
            // gap in this sense — it sits off to the side of the neck
            // and is picked or not picked, with nothing in between it
            // and the strings the hand is on to fall silent.
            const melody = strings.filter(s => !droneStrings.has(s));
            const gapped = melody.at(-1) - melody[0] + 1 > melody.length;
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
    return bassVoicings(root, type, { openAnywhere, relaxed });
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
        // How far up the neck an open string may be left ringing is
        // measured from wherever the open note is — the nut, or the capo.
        if (cells.some(c => c.fret === 0) && stopped.length &&
            Math.max(...stopped) - capoFret > instrument.chords.openReach) return;

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

/**
 * Whatever of the chord a given stretch of neck can actually hold.
 *
 * The last answer, for windows where the chord itself — and then its
 * shell — turned out to be unreachable. G major between the 4th and 8th
 * frets of a banjo has its B and its D on the same string and nowhere
 * else in that stretch: no hand sounds both, so no complete grip exists
 * there at any fingering, and neither does a shell, because a triad's
 * shell is the triad.
 *
 * A blank board is the one answer that teaches nothing. What is true
 * there is that the hand can still sound G and B, which is a G major
 * missing its fifth — thin, honest, and playable — so that is what this
 * finds: every grip of two or more chord tones inside the window, with
 * the tones it cannot reach named on the label. Nothing is required of
 * it, so it can always answer; the ranking then does the choosing, and
 * because an absent tone is charged for there, the fullest grip the
 * window holds is the one that comes out on top.
 *
 * Only ever a window's worth of neck, so the whole-neck cost of the
 * other two searches doesn't apply — and it is only run where they
 * both came back empty.
 */
export function fragmentVoicings(root, type, { lo, hi, openAnywhere = false } = {}) {
  const grid    = buildScaleGrid(root, type);
  const degrees = getScaleDegrees(type);
  const strict  = chordRequirements(degrees, type);
  const onBass  = instrument.chords.strategy === "bass";
  const { reach } = instrument.chords;

  // What each string can sound with the hand here: a chord tone under it,
  // or an open one. An open string counts when the window is at the nut,
  // when open strings were asked for outright, or when it is a drone —
  // which rings from its own nut wherever the hand happens to be. These
  // are the same three cases the window filter in the view lets through,
  // and they have to stay the same or this would offer grips that the
  // board then refuses to draw.
  const options = [];
  for (let s = 0; s < numStrings; s++) {
    const frets = [];
    if (grid[s][0] && (handAtNut(lo) || openAnywhere || droneStrings.has(s))) frets.push(0);
    for (let f = Math.max(lo, 1); f <= Math.min(hi, numFrets); f++) {
      if (grid[s][f]) frets.push(f);
    }
    options.push(frets);
  }

  // Which strings may sound together. A bass mutes with the plucking
  // hand and skips strings freely — that is how a tenth is reached — so
  // any ascending run will do. A guitar's silent strings have to be
  // damped by the fretting hand, so the same neighbouring-runs rule the
  // full search uses applies here, only down to two strings instead of
  // three, since two notes may be all the window has.
  const sets = onBass
    ? stringSubsets(numStrings, 2, Math.min(4, numStrings))
    : (() => {
        const out = [];
        for (let first = 0; first < numStrings; first++) {
          for (let last = first + 1; last < numStrings; last++) {
            const run = [];
            for (let s = first; s <= last; s++) run.push(s);
            out.push(run);
            if (last - first >= 3 && !options[first].every(f => f === 0)) {
              out.push([first, ...run.slice(2)]);
            }
          }
        }
        out.push(...withDrone(out));
        return out;
      })();

  const out = [];
  const seen = new Set();
  const openCap = openAnywhere ? chordSpan() : chordOpenSpan();

  for (const strings of sets) {
    if (strings.some(s => options[s].length === 0)) continue;
    const chosen = [];

    (function choose(i) {
      if (i === strings.length) {
        const cells = strings.map((string, k) => ({ string, fret: chosen[k] }));
        const stopped = cells.map(c => c.fret).filter(f => f > 0);
        if (!stopped.length) return;                // all open is not a grip
        // A skipped string has to be silenced by the finger on the bass
        // note leaning against it, and an open bass has no finger on it
        // to do that with — the same rule the full search plays by, and
        // the drone is no more a gap here than it is there.
        const melody = strings.filter(s => !droneStrings.has(s));
        if (!onBass && cells[0].fret === 0 &&
            melody.at(-1) - melody[0] + 1 > melody.length) return;
        const loF = Math.min(...stopped), hiF = Math.max(...stopped);
        if (hiF - loF + 1 > chordSpan()) return;
        const inches = handReach(cells);
        if (inches > reach.max) return;
        const reachesForOpen =
          cells.some(c => c.fret === 0 && !droneStrings.has(c.string));
        if (reachesForOpen && hiF - loF + 1 > openCap) return;

        const notes   = cells.map(c => grid[c.string][c.fret]);
        const pitches = cells.map(pitchAt);
        if (onBass) {
          // Voices rise across the strings, here as in the main bass
          // search — which also means a doubled tone is always an octave
          // apart and never a unison, since two strings sounding the
          // same pitch would not be rising.
          for (let k = 1; k < pitches.length; k++) {
            if (pitches[k] <= pitches[k - 1]) return;
          }
        }

        const grip = gripFingering(cells);
        if (!grip) return;
        const key = gripKey(cells);
        if (seen.has(key)) return;
        seen.add(key);

        const lowest  = lowestCell(cells);
        const bass    = grid[lowest.string][lowest.fret].degree;
        const sounded = new Set(notes.map(n => n.degree));
        out.push({
          cells, notes, strings,
          span: hiF - loF + 1,
          reach: inches,
          stretch: isStretch(cells, hiF - loF + 1),
          lo: loF, hi: hiF,
          fingers: grip.fingers,
          barre: grip.barre,
          barres: grip.barres,
          order: notes.map(n => n.degree).join("-"),
          bass,
          // Everything the chord could not spare and this grip has not
          // got. The label says it out loud rather than letting a player
          // believe a fifth is sounding that isn't.
          omits: missingFrom(strict.required, sounded, degrees),
          label: labelFor(notes, bass),
        });
        return;
      }
      for (const f of options[strings[i]]) { chosen[i] = f; choose(i + 1); }
    })(0);
  }

  return out;
}

// ============================================================
// BASS CHORDS
//
// A bass is not a small guitar, but it is closer to one than this file
// used to assume. Two things are different, and both are arithmetic
// rather than taste.
//
// NO LOW INTERVAL LIMIT. There was one, and it is worth saying what it
// was and why it went. Two pitches close together low down fall inside
// one filter in the ear and beat rather than blend; how close is too
// close depends on how low you are, and arrangers have written the
// limits down for a century. The search used to enforce them, which is
// why the tenth — the third lifted an octave, clear of the range where
// it fights the root — came out as the signature bass chord and the
// close triad a guitar plays never appeared at all.
//
// It is a real acoustic fact and it was the wrong thing to build a
// board on. A fretboard diagram is asked what CAN be played there, and
// a rule that silences half the answers is answering a different
// question — one about arranging, and one the player can hear for
// themselves the moment they play the grip. Every chord tone the hand
// can reach is now offered, on the bass exactly as on the guitar, and
// what to do about the low ones is left where it belongs.
//
// 1. THE NECK IS LONGER. A 34" scale puts the frets a third further
//    apart than a 25.5" one, so a four-fret grip at the first fret is a
//    five inch stretch on a bass against under four on a guitar. Fret
//    counts cannot express that; inches can, and the spacing is
//    computable — each fret sits one twelfth-root-of-two of the
//    remaining string closer to the bridge. Reassuringly, those same
//    inch caps applied to a guitar reproduce the four-and-five-fret
//    rules that were tuned by hand up there, which is a reason to trust
//    them down here.
//
// 2. THE ROOT IS THE JOB — but it is not the chord. A guitarist may
//    drop the root from a crowded chord because the bass player has it;
//    the bass player has nobody underneath, so whatever falls lowest
//    genuinely re-names the chord for the whole ensemble. That makes the
//    root worth a great deal, and it is paid for in the scoring: root
//    position leads, an inversion follows, and a grip with no root at
//    all comes last. What it is not is a requirement. Demanding one on
//    four strings spends the whole instrument on the root and the third
//    and leaves nothing for the seventh — which is the tone that says
//    what the chord is. So the search asks for the shell and the scoring
//    asks for the root, and the neck decides how much of both it gives.
//
// What survives is small on purpose, but no smaller than it has to be.
// A four-string bass voicing a seventh chord has room for the root, the
// third and the seventh — the shell a bass player actually plays.
// ============================================================

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
 * What a bass chord cannot do without.
 *
 * The same answer a guitarist gives, and for the same reason: what a
 * chord IS, is the tone that says major or minor and the tone that says
 * which seventh — the shell. Everything else is colour the grip takes
 * when it has room.
 *
 * The root is not on that list, and this is the one place a bass reads
 * differently from how it looks. Nothing is underneath a bass, so the
 * root matters more here than anywhere — but making it a *requirement*
 * on four strings is what produced the two-note answers: root and third,
 * over and over, on chords whose whole character is the seventh. A
 * seventh chord voiced as a bare tenth is not a Cmaj7, it is a C major
 * with the name of a Cmaj7. So the shell is what the search demands, and
 * the root is what the scoring wants badly — see bassVoicingEase, where
 * a grip that has the root under it beats one that only has it, and both
 * beat one without it. Where the neck has room for all three, all three
 * sound; where it doesn't, the tones that name the chord are the ones
 * that survive.
 *
 * A triad is the exception, because a triad has no seventh to build a
 * shell out of. There the root and the quality are the chord, and the
 * fifth is the tone that goes.
 *
 * `level` is how much of that to insist on when a neck won't hold it:
 * 0 asks for the shell whole, 1 lets a bent fifth go, and 2 gives up one
 * half of the shell — see bassCores for what that means.
 */
const BASS_LEVELS = 3;
function bassCore(degrees, { level = 0, keep = "both" } = {}) {
  const has = d => degrees.includes(d);
  const core = new Set();
  const quality = ["3", "b3", "4", "2"].find(has);
  if (quality && keep !== "seventh") core.add(quality);

  const seventh = ["7", "b7", "bb7", "6"].find(has);
  if (level >= 2) {
    core.add("1");
    if (seventh && keep === "seventh") core.add(seventh);
  } else if (seventh) {
    core.add(seventh);
  } else {
    // No seventh to carry the chord: it is a triad, and the root is
    // doing the work the seventh would have done.
    core.add("1");
  }

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
  if (level === 0 && bent && !seventh) core.add(bent);

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
  // What the chord is, when a window was too thin to hold even that: the
  // tone that says major or minor, or the bent fifth that says
  // diminished. A grip reduced to a root and a fifth is a power chord,
  // and calling it a C major without saying so would be the one lie this
  // board can tell. The root is not listed here because it is named
  // already — a grip without one is labelled rootless.
  for (const d of bassCore(degrees)) {
    if (d !== "1" && !sounded.has(d)) out.push(d);
  }
  for (const [degree, worth] of bassColour(degrees, type)) {
    if (worth >= 1.0 && !sounded.has(degree) && !out.includes(degree)) out.push(degree);
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
/**
 * What to ask a stretch of neck for at each level, in order.
 *
 * The first two levels want the shell, whole and then without a bent
 * fifth. The last one gives up half of it — and which half is not the
 * search's business to decide, because the neck decides. A window with
 * no third in it can still sound the root, the fifth and the seventh,
 * and a Cmaj7 played C-G-B is a Cmaj7 that a bassist would recognise
 * and play; a window with no seventh can still sound the triad. So both
 * are asked for and the results pooled, and the scoring picks between
 * them on what each one manages to carry — which is what it is for.
 * Asking for them in sequence instead would have let whichever came
 * first shut the other out of a window that had room for both.
 */
function bassCores(degrees, level) {
  if (level < 2) return [bassCore(degrees, { level })];
  return [
    bassCore(degrees, { level, keep: "quality" }),
    bassCore(degrees, { level, keep: "seventh" }),
  ];
}

function bassVoicings(root, type, { openAnywhere = false, relaxed = false } = {}) {
  const degrees = getScaleDegrees(type);
  // Asked for the shell first, and for less only where the neck cannot
  // hold it: an altered fifth that is nowhere reachable, and then the
  // seventh itself. Whatever a level leaves out is carried on the grip
  // and said out loud in the label, so a thin answer is never a silent
  // one. `relaxed` is the view asking for the last level directly, for a
  // window the fuller ones turned out to have nothing in.
  for (let level = relaxed ? BASS_LEVELS - 1 : 0; level < BASS_LEVELS; level++) {
    const found = [];
    const seen = new Set();
    for (const core of bassCores(degrees, level)) {
      for (const v of bassSearch(root, type, core, openAnywhere)) {
        const key = gripKey(v.cells);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(v);
      }
    }
    if (found.length) return found;
  }
  return [];
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
        for (const d of core) if (!sounded.has(d)) return;

        const stopped = cells.map(c => c.fret).filter(f => f > 0);
        if (stopped.length === 0) return;                  // all open is not a grip
        const lo = Math.min(...stopped), hi = Math.max(...stopped);
        if (hi - lo + 1 > chordSpan()) return;
        const inches = handReach(cells);
        if (inches > reach.max) return;                    // no hand is that wide

        // An open string rings wherever the hand is, but a grip mixing
        // the nut with the top of the neck is not one anybody plays. The
        // nut here is the capo when there is one — the reach is from
        // where the open note actually sounds.
        if (cells.some(c => c.fret === 0) && !openAnywhere && hi - capoFret > openReach) return;

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
      // Pruned as it descends rather than at the leaf. The test that
      // matters — voices rising across the strings — depends only on the
      // note just placed and the one before it, so a branch that fails
      // it can never recover further down, and cutting it there is what
      // keeps a dense chord's search from running into six figures.
      const prev = i > 0
        ? midiAt(strings[i - 1], chosen[i - 1])
        : null;
      for (const f of options[strings[i]]) {
        if (prev !== null && midiAt(strings[i], f) <= prev) continue;
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

  // Nothing here scores the register a grip sits in, or how much room
  // its closest pair has. The board's job is to show what the hand can
  // reach; how a close third down at the first fret sounds is something
  // the player hears the moment they play it, and does not need a
  // ranking to tell them. See the note at the top of this section on the
  // interval limit that used to live here.

  // The root. Nothing is underneath a bass, so whatever falls lowest
  // re-names the chord for everyone listening: root position leads by a
  // wide margin, an inversion waits behind it, and a grip with no root
  // in it at all waits behind that. This is where the root's importance
  // is paid for, now that the search no longer demands one — a rootless
  // shell is offered only where the neck could not hold the root as
  // well, which is exactly when a bassist would play one.
  // An inversion is a real voicing, though, not a last resort. Charged
  // at the weight this once was, a second-inversion grip sounding all
  // three tones lost to a two-note root-position one on the same two
  // frets, with a chord tone left ringing nowhere — and the answer to
  // "which of these is the C chord" is that both are, one of them more
  // completely. So it costs enough to keep root position first among
  // equals, and not enough to buy silence.
  const hasRoot = notes.some(n => n.degree === "1");
  score += voicing.bass === "1" ? 0 : hasRoot ? 1.5 : 4;

  // Four strings, four fingers, and a hand already in position: if the
  // notes are there, they are worth sounding. Three is the shell — the
  // root, the tone that says major or minor, and the seventh — and it
  // is what a bass chord reduces to when the fourth string has nothing
  // worth reaching on it; two is what is left when the neck had no room.
  //
  // What decides between them is the shape the hand has to make, and a
  // fret span alone does not describe it. Four frets is one finger per
  // fret and the hand does not move: anything inside that is four
  // fingers' work whatever order the notes fall in. Five is past where
  // the hand sits still, and then it matters whether the notes STAIRCASE
  // — whether the frets climb (or fall) steadily as they cross the
  // strings, so the hand can angle across the neck and each finger lands
  // where it already was. 5-6-7-9 climbing is a shape; 9-5-8-6 is the
  // same five frets and a scramble, and no fourth note is worth that.
  // There the answer is the three tones that make the chord and nothing
  // else, which is what a bassist would play.
  const byString = cells.map(c => c.fret);           // cells run low string to high
  const climbs = byString.every((f, i) => i === 0 || f >= byString[i - 1]);
  const falls  = byString.every((f, i) => i === 0 || f <= byString[i - 1]);
  const staircase = climbs || falls;
  const wide = voicing.span > chordComfort();
  score += cells.length === 4
    ? (wide && !staircase ? 1.4 : -2.6)
    : ({ 2: 1.6, 3: -1.4 }[cells.length] ?? 2);

  // The colour it manages to carry: the seventh above all, then the
  // alterations, then whatever the chord is named for.
  const sounded = new Set(notes.map(n => n.degree));
  const colour = bassColour(degrees, type);
  for (const [degree, worth] of colour) {
    if (!sounded.has(degree)) score += worth;
  }

  // And the tones the colour table has nothing to say about because the
  // search used to guarantee them: the third, and the root of a triad.
  // A grip that reaches this scorer without one has come from a window
  // too thin to hold the chord, and it should sit below every grip that
  // did manage it.
  for (const d of bassCore(degrees)) {
    if (!sounded.has(d) && !colour.has(d)) score += 3;
  }

  // What a doubled tone is worth, which on a bass is the opposite of the
  // guitar's answer.
  //
  // A doubling here is always an octave — two strings cannot sound the
  // same pitch when the voices have to rise — and an octave of the THIRD
  // is how a bass fills out a chord: low and again on top, the tone that
  // says major or minor stated twice, which is a grip a player would
  // recognise rather than a wasted string. The seventh doubles just as
  // well.
  //
  // The root is the waste. It is the one tone the instrument is
  // guaranteed to be heard playing — it is under everything, it names
  // the chord for the room — so a second one says nothing that was in
  // any doubt, on the only spare string there was. The fifth is nearly
  // as idle: it carries least of all the tones, which is why it is the
  // first one a bassist drops.
  for (const [degree, count] of notes.reduce((m, n) =>
    m.set(n.degree, (m.get(n.degree) ?? 0) + 1), new Map())) {
    if (count < 2) continue;
    score += (degree === "1" ? 1.2 : degree === "5" ? 0.8 : 0) * (count - 1);
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
  // guitarist would not think twice about is real work down here — but
  // how much work depends on how far the finger has to flatten, the
  // same as anywhere else. Two neighbouring strings under one fingertip
  // is what a hand does to play an octave; all four is the thing worth
  // charging for. A flat rate for both was silencing a string on the
  // sus chords, where one finger laid across three frets of the same
  // number is not just easy, it is the only sensible fingering.
  for (const barre of voicing.barres ?? []) {
    score += 1.2 + 0.8 * (barre.to - barre.from - 1);
  }

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
