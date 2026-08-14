// ============================================================
// view.js — SVG RENDERING + CONTROLS  (the only DOM-aware file)
//
// Imports the pure model from music.js and draws it. Swapping this
// file for a React Native renderer later would leave music.js intact.
//
// The board is drawn once. Note markers persist between renders and are
// moved rather than rebuilt, so cycling positions slides them along the
// strings instead of blinking them in and out.
// ============================================================

import {
  rootOptions,
  groupsFor,
  MAJOR_SCALE,
  handReach,
  INSTRUMENTS,
  setInstrument,
  instrument,
  supportsKind,
  tuning,
  numFrets,
  numStrings,
  chromaticGrid,
  droneStrings,
  displayOrder,
  buildScaleGrid,
  getPositions,
  getShapeGrid,
  supportsCaged,
  findRun,
  runSegments,
  extendChain,
  pitchAt,
  chordVoicings,
  fragmentVoicings,
  rankVoicings,
  progressionVoicings,
  hasOpenVoicing,
  gripFingering,
} from "./music.js";

import { unlock, playSequence, playChord, playProgression, strumGap, clock } from "./audio.js";

// ---- Visual config ----------------------------------------
const markerFrets = [3, 5, 7, 9, 15, 17];   // single inlay dots
const doubleMarker = 12;

// The extra room up top is the window handle's lane.
const PAD_L = 70, PAD_T = 74, PAD_R = 30, PAD_B = 24;
const HANDLE_Y = 14, HANDLE_H = 24;
const FRET_W = 62, STR_GAP = 46, R = 15; // note-circle radius
// Recomputed rather than fixed, because the number of strings — and so
// the height of the board — is a property of the instrument, not of the
// app. `numFrets` and `numStrings` are live bindings from music.js, so
// these simply read whatever is currently mounted.
let boardW = 0, boardH = 0;
function sizeBoard() {
  boardW = PAD_L + numFrets * FRET_W + PAD_R;
  boardH = PAD_T + (numStrings - 1) * STR_GAP + PAD_B;
}
sizeBoard();

const FADE_MS  = 240;   // must match the opacity transition in styles.css
const SLIDE_MS = 360;   // must match the transform transition in styles.css

/**
 * The same easing curve the CSS uses, evaluated in JS. The run's line is
 * a list of points rather than a transform, so CSS can't move it — it has
 * to be stepped by hand, and it should travel exactly as the notes it
 * connects do.
 */
function cubicBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const atX = t => ((ax * t + bx) * t + cx) * t;
  const atY = t => ((ay * t + by) * t + cy) * t;
  const slope = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    let t = x;
    for (let i = 0; i < 5; i++) {
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (atX(t) - x) / d;
    }
    return atY(t);
  };
}
const ease = cubicBezier(0.45, 0.03, 0.25, 1);

const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Where a string's own nut sits. Ordinary strings all start at the
// board's nut; a drone string — a banjo's 5th — starts at its own,
// partway up the neck, so its whole neighbourhood shifts with it.
function stringNutX(s) {
  const nutFret = droneStrings.get(s);
  return nutFret ? PAD_L + nutFret * FRET_W : PAD_L;
}
// x-center of a note at a given fret (0 = open, sits left of the nut).
// `s` is only needed for fret 0, to find which nut "left of" means.
function fretX(f, s) {
  return f === 0 ? stringNutX(s) - 34 : PAD_L + (f - 0.5) * FRET_W;
}
// Row of a string, bottom to top — usually the string index itself, but
// an instrument can say otherwise (see fretboard.js's displayOrder).
function stringRow(i) {
  return displayOrder.indexOf(i);
}
// y-center of a row (row 0 drawn at the BOTTOM, top row highest).
function rowY(row) {
  return PAD_T + (numStrings - 1 - row) * STR_GAP;
}
function stringY(i) {
  return rowY(stringRow(i));
}
// The board's vertical extremes — the top and bottom ROWS, not whichever
// string happens to have the highest or lowest index. Only differ from
// stringY(numStrings-1)/stringY(0) when an instrument reorders its rows.
function boardTopY() { return PAD_T; }
function boardBotY() { return PAD_T + (numStrings - 1) * STR_GAP; }

/**
 * How far down a fret's wire reaches.
 *
 * Ordinarily to the bottom row, same as every other fret. But a fret a
 * drone string hasn't reached yet — a banjo's first five, up to and
 * including the one its own nut sits on — has no business drawing a
 * fretboard under a string that isn't there, so the wire stops short of
 * that row instead. The nut itself is the wood's edge, not a wire.
 */
function fretBottomY(f) {
  let cutRow = null;
  for (const [s, nutFret] of droneStrings) {
    if (f > nutFret) continue;
    const row = stringRow(s);
    cutRow = cutRow === null ? row : Math.max(cutRow, row);
  }
  return cutRow === null ? boardBotY() + 18 : rowY(cutRow) - STR_GAP / 2;
}

/**
 * The span of frets a position actually reaches: from its lowest played
 * fret to its highest. A box can start on a fret nothing is played on,
 * and that dead edge shouldn't be drawn. Empty frets *between* the two
 * ends stay inside the span — the hand still covers them.
 */
function playedSpan(grid, box) {
  let lo = null, hi = null;
  for (let f = box.lo; f <= box.hi; f++) {
    let used = false;
    for (let s = 0; s < numStrings; s++) if (grid[s][f]) { used = true; break; }
    if (!used) continue;
    if (lo === null) lo = f;
    hi = f;
  }
  return lo === null ? null : { lo, hi };
}

// ---- Persisted settings -------------------------------------
// What's remembered between visits: the instrument, what's shown on it,
// and the theme once someone has actually pressed the toggle. Nothing
// here is asked for up front — it only exists once a choice has been
// made, so a first visit behaves exactly as it always did.
const STORE_KEY = "guitai:settings";
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
  } catch {
    return {};   // private browsing, storage disabled, or corrupt JSON
  }
}
function saveSetting(key, value) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadSettings(), [key]: value }));
  } catch { /* storage unavailable — the choice just won't outlive the tab */ }
}
const saved = loadSettings();

// ---- Day and night ----------------------------------------
/**
 * The six bands hold up on either field, so the theme moves only the
 * chrome around them — and never the board, which stays ebony because a
 * fretboard is dark and inverting the one thing you are reading would
 * be a strange thing to do to it.
 *
 * The starting theme is whatever was chosen last time, or — nothing
 * chosen yet — whatever the machine already asks for.
 */
const prefersDay = window.matchMedia?.("(prefers-color-scheme: light)");
let theme = saved.theme ?? (prefersDay?.matches ? "day" : "night");

function applyTheme() {
  document.documentElement.setAttribute("data-theme", theme);

  const label = document.getElementById("themeLabel");
  const fill  = document.getElementById("themeSunFill");
  const btn   = document.getElementById("themeBtn");
  // The button names the field you would move to, not the one you are
  // standing in — a control says what happens when you press it.
  const going = theme === "night" ? "Day" : "Night";
  if (label) label.textContent = going;
  if (btn) btn.title = `Switch to ${going.toLowerCase()}`;
  // Sun up for day, sun down for night.
  if (fill) {
    fill.setAttribute("d", theme === "night"
      ? "M1 8 A7 7 0 0 0 15 8 Z"
      : "M1 8 A7 7 0 0 1 15 8 Z");
  }
}

// The displays, in the order they are offered. Which of them an
// instrument actually gets is INSTRUMENTS[id].kinds over in music.js.
const KIND_LABELS = [
  ["scale",       "Scales"],
  ["arpeggio",    "Arpeggios"],
  ["chord",       "Chords"],
  ["progression", "Progressions"],
];

// How many grips to offer for a chord in one stretch of neck. Three or
// four is what a teacher would show; past that they are variations on
// each other and the arrows stop meaning anything.
const GRIPS_SHOWN = 4;

// ---- View state -------------------------------------------
let cagedOn  = false;
let posIndex = 0;

/**
 * What each marker says. Cycled by one button rather than chosen from a
 * menu, because there are only three answers and the middle one — no
 * label at all — is the one a player wants when they are testing
 * themselves on the shape, so it should be a tap away and not buried.
 */
const LABEL_MODES = [
  { mode: "note",   text: "Note names",    hint: "Showing note names — tap for scale degrees" },
  { mode: "degree", text: "Scale degrees", hint: "Showing scale degrees — tap to hide labels" },
  { mode: "none",   text: "Hidden",        hint: "Labels hidden — tap for note names" },
];
let labelIndex = 0;
const labelMode = () => LABEL_MODES[labelIndex].mode;

// The stretch of neck being searched for grips. Chords are always shown
// one hand-position at a time, so this is simply where that hand is —
// dragged along the neck by the bar above it.
//
// How wide that hand is belongs to the instrument, not to the app: five
// frets is a guitarist's, and on a mandolin — where the frets sit half as
// far apart and the standard closed shapes are correspondingly wider —
// five frets is narrower than the hand really is, and hides grips.
// See INSTRUMENTS.mandolin.chords.windowFrets for the one that prompted it.
const windowWidth = () => instrument.chords.windowFrets ?? 5;
// The lowest fret the window may open on: any further up and it would
// hang off the end of the neck.
const lastWindowLo = () => Math.max(0, numFrets - windowWidth() + 1);
let winLo = 0;

// ---- Staying put ------------------------------------------
/**
 * Where the hand is, in frets — kept across a change of material.
 *
 * A player working at the fifth fret who switches from major to minor,
 * or to the arpeggio, or to the chord, has not moved their hand. They
 * are asking what else is available where they already are. So the fret
 * is the thing that persists and the shape is the thing that changes,
 * rather than the other way around.
 *
 * The two modes measure position differently — scales step between whole
 * shapes, chords slide a window — so the fret is what passes between
 * them, and each side reads it in its own terms when it takes over.
 */
let anchorFret = 0;
let seekAnchor = false;

// Ghosts: the chord's other tones, shown faintly around the grip so you
// can see what else was available to reach for.
let ghostOn = false;
let ghostCells = new Set();

// Open strings. Off, they belong to the nut: they appear only when the
// window has reached them, so the familiar shape for each part of the
// neck comes up first. On, any open chord tone may ring under a grip
// wherever the hand happens to be.
let openOn = false;

// Path mode. Not a setting any more: a scale or an arpeggio is something
// you travel through, so picking a start and a target is simply what the
// board does. A chord isn't travelled through, so it is off there.
let pathOn     = false;
/**
 * The notes picked, in the order they were picked.
 *
 * Two of them is a run from one to the other. A third hangs another leg
 * off the end: the note the run was landing on becomes the note the next
 * leg starts from, so the chain reads as a phrase — up to here, then down
 * to there, then back up to this — rather than as one straight climb.
 */
let pathChain  = [];     // [{ string, fret }, ...]
/**
 * Notes each leg is held through, as { string, fret, locked }.
 * pathHeld[i] shapes the leg from pathChain[i] to pathChain[i + 1].
 *
 * Sliding a note pins it: the run follows, but the pin gives way once one
 * of that leg's ends is moved, since it was only ever a way of shaping
 * this particular leg. Clicking a note locks it, and a lock is kept
 * through everything — move an end and the leg is re-routed to keep
 * visiting it, turning back on itself if that is what it takes.
 */
let pathHeld   = [];     // [[{ string, fret, locked }, ...], ...]
let pathResult = null;   // { legs, held, cells, cost } from findRun
// Where a newly hung leg begins in the run's cells, so its line can be
// drawn in rather than simply appearing. Consumed by the next render.
let growFrom   = null;
// Showing a position traces the whole shape by default. Clearing puts
// that aside so notes can be picked by hand instead.
let skipAutoPath = false;

// Playback. `soundingAt` holds the notes under the ear right now — as
// positions, so a re-render mid-play puts the highlight back where it
// was. A run lights one at a time; a strum piles them up.
let player     = null;
let playerKind = null;          // "run" | "chord"
let soundingAt = new Set();     // "string:fret"

// The grip on screen, and the one being strummed, so a strum can be cut
// short when the chord under it changes.
let currentBase    = null;   // the grip as computed
let currentVoicing = null;   // that grip as edited — what is actually shown
let playingSig = null;
const voicingSig = v => (v ? v.cells.map(cellId).join("|") : "");

/**
 * A grip the person has altered by hand, with GHOST on: notes switched off
 * into the faint background, or faint ones switched on in their place.
 *
 * Held as a plain list of cells rather than as a search result, because
 * the whole point is that nothing is re-searched — the notes that were
 * not touched stay exactly where they were. The edit belongs to the grip
 * it was made on and is dropped when a different one comes up.
 */
let gripEdit = null;   // { sig, cells: [{ string, fret }] }

// Live SVG layers, built once.
let noteLayer   = null;
let pathLayer   = null;
let chordLayer  = null;
let windowLayer = null;
let handleGroup = null;
let handleBar   = null;
let handleLabel = null;
let highlight   = null;
let winDrag     = null;   // { grabbedAt } while the handle is held

// The band the handle currently sits over, and — for scales and
// arpeggios — where each position starts, so dragging can scrub between
// them. Chords slide a fixed window instead, so they leave this null.
let activeBand  = null;   // { lo, hi }
let activeStops = null;   // [fret, ...] one per position
// key -> { group, circle, label }  for notes currently on screen. The key
// is `string:rank` — the nth note along that string — not the fret, which
// is what lets a marker slide to a new fret as positions change instead
// of being torn down and rebuilt.
const liveNotes = new Map();

// Which marker is sitting on a given `string:fret` right now. Anything
// wanting to find a note by where it is on the neck, rather than by which
// marker it happens to be, goes through here. Rebuilt every render.
const byPosition = new Map();

const cellId = c => `${c.string}:${c.fret}`;

// ============================================================
// STATIC BOARD  (drawn a single time)
// ============================================================

function drawBoard() {
  const svg = document.getElementById("board");
  sizeBoard();
  svg.setAttribute("viewBox", `0 0 ${boardW} ${boardH}`);
  svg.setAttribute("width", boardW);
  svg.setAttribute("height", boardH);
  svg.innerHTML = "";

  const topY = boardTopY();
  const botY = boardBotY();

  // Wood. Ordinarily one slab — but a drone string's row has no neck
  // under it before that string's own nut, so it's cut short there
  // rather than drawn as if a fretboard existed for a string that
  // hasn't started yet.
  const droneEntries = [...droneStrings.entries()];
  if (droneEntries.length === 0) {
    svg.appendChild(el("rect", {
      x: PAD_L, y: topY - 18, width: numFrets * FRET_W, height: (botY - topY) + 36,
      rx: 6, fill: "var(--wood)", stroke: "var(--wood-edge)", "stroke-width": 2
    }));
  } else {
    const cutY = fretBottomY(0);
    const notchLeft = Math.min(...droneEntries.map(([s]) => stringNutX(s)));
    svg.appendChild(el("rect", {
      x: PAD_L, y: topY - 18, width: numFrets * FRET_W, height: cutY - (topY - 18),
      rx: 6, fill: "var(--wood)", stroke: "var(--wood-edge)", "stroke-width": 2
    }));
    svg.appendChild(el("rect", {
      x: notchLeft, y: cutY, width: PAD_L + numFrets * FRET_W - notchLeft, height: botY + 18 - cutY,
      rx: 6, fill: "var(--wood)", stroke: "var(--wood-edge)", "stroke-width": 2
    }));
  }

  // Inlay markers
  const midY = (topY + botY) / 2;
  markerFrets.forEach(f => {
    if (f > numFrets) return;
    svg.appendChild(el("circle", { cx: PAD_L + (f - 0.5) * FRET_W, cy: midY, r: 6, fill: "var(--inlay)" }));
  });
  [-1, 1].forEach(off => {
    svg.appendChild(el("circle", {
      cx: PAD_L + (doubleMarker - 0.5) * FRET_W, cy: midY + off * STR_GAP, r: 6, fill: "var(--inlay)"
    }));
  });

  // The position highlight lives under the notes and slides with them.
  highlight = el("rect", {
    id: "posHighlight", x: 0, y: topY - 24, width: 0, height: (botY - topY) + 48,
    rx: 8, fill: "var(--root)", opacity: 0
  });
  svg.appendChild(highlight);

  // Fret wires + numbers
  for (let f = 0; f <= numFrets; f++) {
    const x = PAD_L + f * FRET_W;
    svg.appendChild(el("line", {
      // Stops short of a drone string's row until that string actually
      // reaches this fret — see fretBottomY.
      x1: x, y1: topY - 18, x2: x, y2: fretBottomY(f),
      stroke: f === 0 ? "var(--nut)" : "var(--wire)",
      "stroke-width": f === 0 ? 6 : 2
    }));
    if (f > 0) {
      const t = el("text", { x: PAD_L + (f - 0.5) * FRET_W, y: PAD_T - 20,
        "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" });
      t.textContent = f;
      svg.appendChild(t);
    }
  }

  // Strings, thicker toward the low one at the bottom.
  //
  // A mandolin sounds each note with two strings tuned together, so each
  // line is drawn as the pair it is. They are one note to everything
  // else — the model has no idea they exist — and drawing them apart
  // here is the whole of the difference: the marker still sits on the
  // course's centre, because that is where the note is.
  const perCourse = instrument.courses ?? 1;
  chromaticGrid.forEach((_, i) => {
    const y = stringY(i);
    const nutX = stringNutX(i);
    const weight = 1 + (numStrings - 1 - i) / Math.max(1, numStrings - 1) * 2;
    // Paired strings are each thinner than a single would be, and sit
    // either side of where the course runs.
    const each = perCourse > 1 ? weight * 0.62 : weight;
    for (let k = 0; k < perCourse; k++) {
      const offset = perCourse === 1 ? 0 : (k - (perCourse - 1) / 2) * 3;
      svg.appendChild(el("line", {
        // A drone string only exists from its own nut onward — drawing
        // it from the board's nut would show a string that isn't there.
        x1: nutX, y1: y + offset, x2: PAD_L + numFrets * FRET_W, y2: y + offset,
        stroke: "var(--string)", "stroke-width": each,
      }));
    }
    // A drone string's own peg, standing a little off the fretboard —
    // where a banjo's actually is — with a curl of string leading up
    // into the run proper, rather than the dead-straight nut edge every
    // other string gets.
    if (nutX !== PAD_L) {
      const pegX = nutX - 34, pegY = y + 15;
      svg.appendChild(el("path", {
        d: `M ${pegX} ${pegY} Q ${nutX - 16} ${pegY} ${nutX} ${y}`,
        fill: "none", stroke: "var(--string)", "stroke-width": each,
        "stroke-linecap": "round",
      }));
      svg.appendChild(el("circle", { cx: pegX, cy: pegY, r: 4.5, fill: "var(--wood-edge)" }));
    }
    // Sat exactly where the open-note marker goes, so the tuning shows
    // through when that note is out of the scale and is hidden beneath
    // the marker when it is in — the notes draw on top of the board.
    const lbl = el("text", {
      x: fretX(0, i), y: y + 4, "text-anchor": "middle",
      "font-size": 13, fill: "var(--muted)", "font-weight": 600,
    });
    lbl.textContent = tuning[i];
    svg.appendChild(lbl);
  });

  // Chord furniture: the barre, and crosses over strings left silent.
  chordLayer = el("g", { id: "chordLayer" });
  svg.appendChild(chordLayer);

  // The run's connecting line sits under the note markers. It is drawn as
  // one polyline per stretch of travel rather than as a single line,
  // because a run that turns around is two different things — climbing
  // and falling — and they are coloured apart. See renderPathLine.
  pathLayer = el("g", { id: "pathLayer" });
  pathRun = el("g", { id: "pathRun" });
  pathLayer.appendChild(pathRun);
  lineSegs = [];
  // Where the run lights up as it plays: one short piece per step, drawn
  // over the ghosted line beneath and left to fade behind the beat. Built
  // when playback starts and torn down when it ends — see startPlayhead.
  pathSpark = el("g", { id: "pathSpark" });
  pathLayer.appendChild(pathSpark);
  sparks = [];
  svg.appendChild(pathLayer);

  noteLayer = el("g", { id: "noteLayer" });
  svg.appendChild(noteLayer);

  // The window handle rides above everything so it stays grabbable. It is
  // built once and then moved, so it can glide and stretch between
  // positions rather than being redrawn in a new place each time.
  windowLayer = el("g", { id: "windowLayer" });
  handleGroup = el("g", { class: "win-handle" });
  handleBar = el("rect", {
    class: "bar", x: 0, y: HANDLE_Y, width: 0, height: HANDLE_H,
    rx: 2, fill: "var(--pos-bar)", opacity: 0.95,
  });
  handleGroup.appendChild(handleBar);
  handleLabel = el("text", {
    x: 12, y: HANDLE_Y + HANDLE_H / 2 + 4,
    "font-size": 12, "font-weight": 700, fill: "var(--pos-bar-ink)",
    "letter-spacing": 0.5,
  });
  handleGroup.appendChild(handleLabel);
  // Grip lines sit at a fixed spot near the left, so only the bar's width
  // has to change as the band grows or shrinks.
  [52, 58, 64].forEach(x => handleGroup.appendChild(el("line", {
    x1: x, y1: HANDLE_Y + 6, x2: x, y2: HANDLE_Y + HANDLE_H - 6,
    stroke: "var(--note-ring)", "stroke-width": 2, opacity: 0.55,
  })));
  handleGroup.addEventListener("pointerdown", e => {
    if (!activeBand) return;
    const { x1 } = bandEdges(activeBand.lo, activeBand.hi);
    winDrag = { grabbedAt: boardPoint(e).x - x1 };
    e.preventDefault();
    e.stopPropagation();
  });
  windowLayer.appendChild(handleGroup);
  svg.appendChild(windowLayer);
}

// Where a band from `lo` to `hi` sits in board coordinates.
function bandEdges(lo, hi) {
  return {
    x1: lo === 0 ? PAD_L - 52 : PAD_L + (lo - 1) * FRET_W,
    x2: PAD_L + Math.min(hi, numFrets) * FRET_W,
  };
}
const windowEdges = lo => {
  const hi = Math.min(lo + windowWidth() - 1, numFrets);
  return { ...bandEdges(lo, hi), hi };
};

/**
 * Slide the band under the notes to cover frets lo..hi, or take it away.
 *
 * `settle` jumps into place with the transition suppressed instead of
 * gliding, which is what the first reveal wants — there is nowhere for it
 * to glide from.
 */
function showBand(lo, hi, { settle = false } = {}) {
  const { x1, x2 } = bandEdges(lo, hi);
  const topY = boardTopY(), botY = boardBotY();
  if (settle && highlight.getAttribute("opacity") === "0") {
    highlight.style.transition = "none";
    requestAnimationFrame(() => { highlight.style.transition = ""; });
  }
  highlight.setAttribute("x", x1);
  highlight.setAttribute("width", x2 - x1);
  highlight.setAttribute("y", topY - 24);
  highlight.setAttribute("height", (botY - topY) + 48);
  highlight.setAttribute("opacity", 0.12);
}

function hideBand() {
  highlight.setAttribute("opacity", 0);
}

/**
 * Grey out the stepper arrows at the ends of a list of positions. An
 * empty list is both ends at once, so both go off.
 */
function syncArrows(index, count) {
  const prev = document.getElementById("prevPos");
  const next = document.getElementById("nextPos");
  if (prev) prev.disabled = count === 0 || index <= 0;
  if (next) next.disabled = index >= count - 1;
}

/**
 * A bar above the neck, dragged along it to move where you're looking.
 *
 * For chords it slides a fixed five-fret window. For scales and arpeggios
 * it rides the position itself, so it keeps each shape's own width — the
 * positions are four or five frets wide depending on what they contain,
 * and the bar reports that rather than flattening it.
 */
function renderWindowHandle() {
  if (!handleGroup) return;
  if (!activeBand) { handleGroup.style.display = "none"; return; }

  const { lo, hi } = activeBand;
  const { x1, x2 } = bandEdges(lo, hi);
  handleGroup.style.display = "";
  // Slid by transform and stretched by width, both of which CSS can ease,
  // so the bar travels and resizes instead of reappearing elsewhere.
  handleGroup.style.transform = `translate(${x1}px, 0px)`;
  handleBar.setAttribute("width", x2 - x1);
  handleLabel.textContent = `${lo}–${hi}`;
}

// ============================================================
// NOTES  (diffed against what is already on screen)
// ============================================================

function makeNote() {
  const group  = el("g", { class: "note" });
  const circle = el("circle", { class: "note-circle", cx: 0, cy: 0, r: R,
                                stroke: "var(--note-ring)", "stroke-width": 2 });
  const label  = el("text", { class: "note-label", x: 0, y: 4,
                              "text-anchor": "middle", "font-weight": 700 });
  group.appendChild(circle);
  group.appendChild(label);
  return { group, circle, label };
}

/**
 * Notes are keyed by string and by their order along that string, so a
 * position change moves each marker to the next fret on the same string
 * rather than destroying and recreating it. That is what produces the
 * slide; markers with no counterpart in the new position fade out.
 */
function renderNotes(grid, mode) {
  const wanted = new Map();
  grid.forEach((row, s) => {
    let rank = 0;
    row.forEach((cell, f) => {
      if (!cell) return;
      wanted.set(`${s}:${rank++}`, { cell, x: fretX(f, s), y: stringY(s), string: s, fret: f });
    });
  });

  // How each marker should look while a run is being built. A note the
  // run passes through is coloured by which way the hand was going when
  // it got there, the same as the line joining it — so climbing and
  // falling read apart on the markers as well as between them.
  const travel = pathDirections();
  const roleOf = (s, f) => {
    // A chord tone the grip doesn't use recedes, the same way notes off
    // the run do.
    if (ghostCells.has(`${s}:${f}`)) return "is-muted";
    if (!pathOn) return "";
    const id = `${s}:${f}`;

    const anchor = pathChain.findIndex(c => cellId(c) === id);
    if (anchor === 0) return "is-anchor is-start";
    if (anchor > 0) {
      // The last note picked is where the run finishes for now; the ones
      // in between are joints, where one leg hands over to the next.
      return anchor === pathChain.length - 1 ? "is-anchor is-target"
                                             : "is-anchor is-turn";
    }

    const stop = heldAt(id);
    if (stop) return stop.locked ? "is-locked" : "is-pinned";

    const dir = travel.get(id);
    if (dir) return `is-path ${dir > 0 ? "is-asc" : "is-desc"}`;
    return pathChain.length ? "is-muted" : "";
  };

  byPosition.clear();

  // Retire markers with nowhere to go.
  for (const [key, rec] of liveNotes) {
    if (wanted.has(key)) continue;
    liveNotes.delete(key);
    rec.group.style.opacity = "0";
    setTimeout(() => rec.group.remove(), FADE_MS);
  }

  // Place or move the rest.
  for (const [key, want] of wanted) {
    let rec = liveNotes.get(key);
    const isNew = !rec;
    if (isNew) {
      rec = makeNote();
      rec.group.style.opacity = "0";
      rec.group.addEventListener("click", () => {
        if (suppressClick) { suppressClick = false; return; }
        if (!rec.pos) return;
        // In chord mode a click edits the grip; elsewhere it builds a run.
        if (isChordMode()) toggleGripNote(rec.pos);
        else selectPathNote(rec.pos);
      });
      rec.group.addEventListener("pointerdown", e => {
        if (rec.pos) beginDrag(e, rec.pos);
      });
      rec.group.addEventListener("dblclick", () => {
        if (rec.pos) restartPathAt(rec.pos);
      });
      noteLayer.appendChild(rec.group);
      liveNotes.set(key, rec);
    }
    rec.pos = { string: want.string, fret: want.fret };
    const at = `${want.string}:${want.fret}`;
    byPosition.set(at, rec);
    const sounding = soundingAt.has(at) ? " is-sounding" : "";
    rec.group.setAttribute("class",
      `note ${roleOf(want.string, want.fret)}${sounding}`.trim());
    // A brand-new marker is placed without transition so it fades in
    // where it belongs instead of flying in from the corner.
    if (isNew) rec.group.style.transition = "none";
    rec.group.style.transform = `translate(${want.x}px, ${want.y}px)`;

    // Labels off leaves the marker itself, which is still the whole map:
    // where the notes fall and which of them is the root.
    const text = mode === "none" ? ""
               : mode === "degree" ? want.cell.degree
               : want.cell.name;
    rec.label.textContent = text;
    rec.label.setAttribute("font-size", text.length > 2 ? 10 : 12);
    rec.circle.setAttribute("fill", want.cell.isRoot ? "var(--root)" : "var(--note)");
    // Dark ink on the pale scale tone, light on the root: the two markers
    // are different colours, so one text colour can't serve both.
    rec.label.setAttribute("fill",
      want.cell.isRoot ? "var(--root-ink)" : "var(--note-ink)");

    if (isNew) {
      requestAnimationFrame(() => {
        // It can have been retired again before this frame arrived — two
        // changes inside one frame will do it, and holding an arrow key
        // is two changes inside one frame. Fading it in now would leave a
        // note on the board that nothing owns and nothing will move.
        if (liveNotes.get(key) !== rec) return;
        rec.group.style.transition = "";
        rec.group.style.opacity = "1";
      });
    } else {
      rec.group.style.opacity = "1";
    }
  }
}

// ============================================================
// PATH SELECTION
// ============================================================

// The notes currently on the board, as "string:fret" ids. When a
// position is showing, this is the shape the run must stay inside.
let visibleCells = null;

/** The held note sitting on a cell, whichever leg is holding it. */
function heldAt(id) {
  for (const stops of pathHeld) {
    const found = stops?.find(s => cellId(s) === id);
    if (found) return found;
  }
  return null;
}

/** Where a held note lives, as the leg holding it and its place in that leg. */
function findHeld(id) {
  for (let leg = 0; leg < pathHeld.length; leg++) {
    const at = pathHeld[leg]?.findIndex(s => cellId(s) === id) ?? -1;
    if (at >= 0) return { leg, at };
  }
  return null;
}

/** Which leg of the run passes through a cell. */
function legOfCell(id) {
  if (!pathResult) return -1;
  return pathResult.legs.findIndex(l => l.cells.some(c => cellId(c) === id));
}

/**
 * Which way the hand was travelling at each note of the run.
 *
 * A note reached twice — climbing past it and falling back through it —
 * can only be drawn one way, and it is drawn as the later visit, so the
 * marker agrees with wherever the run left off.
 */
function pathDirections() {
  const dirs = new Map();
  if (!pathResult) return dirs;
  for (const seg of runSegments(pathResult.cells)) {
    for (const c of seg.cells) dirs.set(cellId(c), seg.dir);
  }
  return dirs;
}

/** The stops held anywhere along the run, flattened. */
const allHeld = () => pathHeld.flatMap(s => s ?? []);

/**
 * Work out the run for the notes currently chosen.
 *
 * The chain says which pairs of notes have to be joined; findRun solves
 * each leg and stitches them. Held notes belong to the leg they were
 * taken from, and one that genuinely can't be honoured is let go there —
 * whatever survives comes back, so the rings on the board never outlive
 * the notes the run actually visits.
 */
function recomputePath({ force = false } = {}) {
  // The run is about to change under it, so whatever is sounding is no
  // longer what's on screen.
  stopSound();
  pathHeld.length = Math.max(0, pathChain.length - 1);
  if (pathChain.length < 2) { pathResult = null; return; }

  const root = document.getElementById("root").value;
  const type = document.getElementById("scale").value;
  const bounds = cagedOn ? visibleCells : null;

  // If the run on screen already calls at every note picked, in order,
  // and visits every stop, leave it exactly as it is. Holding a note the
  // run already passes through asks for nothing new, and re-solving would
  // reshuffle the rest of it for no reason — each leg is optimised on its
  // own, so a split can land on a different route of equal cost.
  if (!force && pathResult && visitsEverything()) return;

  const found = findRun(root, type, pathChain, pathHeld, bounds);
  pathHeld = found ? found.held : pathHeld.map(() => []);
  pathResult = found;
}

/** Does the run on screen still answer to the chain and the stops? */
function visitsEverything() {
  const ids = pathResult.cells.map(cellId);
  if (ids[0] !== cellId(pathChain[0])) return false;
  if (ids[ids.length - 1] !== cellId(pathChain[pathChain.length - 1])) return false;
  // The chain's notes have to appear in the order they were picked — the
  // same three notes in a different order is a different phrase.
  let from = 0;
  for (const anchor of pathChain) {
    const at = ids.indexOf(cellId(anchor), from);
    if (at < 0) return false;
    from = at;
  }
  return allHeld().every(s => ids.includes(cellId(s)));
}

// ---- Dragging any note of the run -------------------------
let drag = null;           // { role: "from" | "to" | "via", moved }
let suppressClick = false;

// Turn a pointer event into a coordinate inside the board.
function boardPoint(evt) {
  const svg = document.getElementById("board");
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// The scale note nearest the pointer, anywhere on the board. Snapping to
// notes rather than to coordinates means a dragged note only ever lands
// somewhere the scale actually goes.
function cellNearest(x, y) {
  let best = null, bestGap = Infinity;
  for (let s = 0; s < numStrings; s++) {
    for (let f = 0; f <= numFrets; f++) {
      if (!visibleCells || !visibleCells.has(`${s}:${f}`)) continue;
      const dx = fretX(f, s) - x, dy = stringY(s) - y;
      const gap = dx * dx + dy * dy;
      if (gap < bestGap) { bestGap = gap; best = { string: s, fret: f }; }
    }
  }
  return best;
}

// The nearest scale note along one string, for drags that stay on it.
function cellNearestOnString(string, x) {
  let best = null, bestGap = Infinity;
  for (let f = 0; f <= numFrets; f++) {
    if (!visibleCells || !visibleCells.has(`${string}:${f}`)) continue;
    const gap = Math.abs(fretX(f, string) - x);
    if (gap < bestGap) { bestGap = gap; best = { string, fret: f }; }
  }
  return best;
}

/**
 * What can be dragged, and how, differs by role on purpose.
 *
 * A note you picked sets how far its legs reach, so it moves freely
 * across the whole board. A note merely passed through only decides which
 * string one note is played on, so it keeps to its own string — easier to
 * steer, and the notes on either side redistribute around it.
 */
function beginDrag(evt, cell) {
  if (!pathOn || !pathChain.length) return;
  const id = cellId(cell);

  // One of the notes picked: dragging it moves that link of the chain.
  const anchor = pathChain.findIndex(c => cellId(c) === id);
  if (anchor >= 0) {
    drag = { role: "anchor", at: anchor, string: cell.string, moved: false };
    evt.preventDefault();
    return;
  }

  // Otherwise it has to be a note some leg goes through, and it is that
  // leg the note will be held on.
  const found = findHeld(id);
  const leg = found ? found.leg : legOfCell(id);
  if (leg < 0) return;

  // Sliding a note holds it — but only once it has actually slid. A press
  // that goes nowhere is a click, and a click means something else
  // entirely here (see selectPathNote), so nothing may be held yet.
  drag = {
    role: "via", leg, string: cell.string, moved: false,
    cell: { string: cell.string, fret: cell.fret },
    held: found ? pathHeld[found.leg][found.at] : null,
  };
  evt.preventDefault();
}

function onDragMove(evt) {
  // The handle slides along the neck. For chords that moves a fixed
  // window; for scales and arpeggios it steps to whichever position
  // starts nearest, so each shape keeps its own width.
  if (winDrag) {
    const x = boardPoint(evt).x - winDrag.grabbedAt;
    const fret = Math.round((x - PAD_L) / FRET_W) + 1;

    if (activeStops) {
      let nearest = 0;
      for (let i = 1; i < activeStops.length; i++) {
        if (Math.abs(activeStops[i] - fret) < Math.abs(activeStops[nearest] - fret)) nearest = i;
      }
      if (nearest !== posIndex) {
        posIndex = nearest;
        clearPath();
        // Animated, like the arrows. A position is a discrete step, and
        // crossing into a new one is the same event however it was asked
        // for — so the notes slide and the line slides with them. The bar
        // itself goes on easing under the pointer, which is what makes
        // the drag feel like moving a hand rather than scrubbing a value.
        render();
      }
    } else {
      const lo = Math.max(0, Math.min(lastWindowLo(), fret));
      if (lo !== winLo) {
        winLo = lo;
        posIndex = 0;
        render();
      }
    }
    return;
  }
  if (!drag) return;
  const p = boardPoint(evt);
  // Ends roam the board; a waypoint slides along the string it sits on.
  const cell = drag.role === "via"
    ? cellNearestOnString(drag.string, p.x)
    : cellNearest(p.x, p.y);
  if (!cell) return;

  const current = drag.role === "anchor" ? pathChain[drag.at] : (drag.held ?? drag.cell);
  if (current && cellId(current) === cellId(cell)) return;   // still on it

  if (drag.role === "via") {
    const leg = pathResult?.legs[drag.leg];
    const pitch = pitchAt(cell);
    // A stop must stay between its leg's ends while it's only a pin; a
    // lock is free to go anywhere, and the leg turns around to reach it.
    if (!drag.held?.locked && leg) {
      const lo = Math.min(pitchAt(leg.from), pitchAt(leg.to));
      const hi = Math.max(pitchAt(leg.from), pitchAt(leg.to));
      if (pitch <= lo || pitch >= hi) return;
    }
    // The note has genuinely moved, so now it is being held. A note taken
    // straight off the run becomes a pin; one already held keeps whatever
    // standing it had.
    if (!drag.held) {
      drag.held = { ...drag.cell, locked: false };
      (pathHeld[drag.leg] ??= []).push(drag.held);
    }
    // One stop per pitch on a leg: two would contradict each other.
    pathHeld[drag.leg] = pathHeld[drag.leg].filter(s => s === drag.held || pitchAt(s) !== pitch);
    drag.held.string = cell.string;
    drag.held.fret   = cell.fret;
  } else {
    // A link can't be dragged onto the one beside it — a leg from a note
    // to itself is no leg at all.
    const id = cellId(cell);
    if ([drag.at - 1, drag.at + 1].some(i => pathChain[i] && cellId(pathChain[i]) === id)) return;
    pathChain[drag.at] = { string: cell.string, fret: cell.fret };
    // Moving a link releases the pins on the legs either side of it,
    // which existed only to shape those legs as they were. Locks are kept
    // and the run re-routed to reach them.
    for (const i of [drag.at - 1, drag.at]) {
      if (pathHeld[i]) pathHeld[i] = pathHeld[i].filter(s => s.locked);
    }
  }

  drag.moved = true;
  skipAutoPath = true;
  // Moving a link re-solves outright: a joint dragged onto a note the run
  // already passed through still splits its two legs differently, even
  // though the run visits everything it did a moment ago.
  recomputePath({ force: drag.role === "anchor" });
  render({ animate: false });                   // follow the pointer exactly
}

function endDrag() {
  if (winDrag) { winDrag = null; return; }
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  // A drag that actually moved shouldn't also register as a click.
  if (moved) suppressClick = true;
}

/**
 * Clicking notes builds the run, one leg at a time.
 *
 * The first pick is where it starts and the second where it lands. Every
 * pick after that carries the run on from where it left off: the note it
 * was landing on becomes the note the next leg starts from, so the picks
 * chain rather than replacing each other, and the run grows into a phrase
 * that turns around wherever you asked it to.
 *
 * A note the run already passes through is no exception: picking it sends
 * the run back through territory it has covered, which is a phrase
 * doubling back on itself and exactly what the colours are there to show.
 *
 * Holding a note where it stands is a drag, not a click — sliding one
 * pins it — and clicking a pinned note then locks it for good. So the
 * click is free to mean the one thing it means everywhere: carry on to
 * here.
 *
 * The notes you picked stay put; drag them to move them. Double-click
 * anywhere starts over.
 */
function selectPathNote(cell) {
  if (!pathOn) return;
  const id = cellId(cell);

  // A note already being held: firm it up, or let it go.
  const found = findHeld(id);
  if (found) {
    const stops = pathHeld[found.leg];
    if (stops[found.at].locked) {
      stops.splice(found.at, 1);          // locked -> let it go entirely
      recomputePath({ force: true });     // freedom returns, so re-solve
    } else {
      stops[found.at].locked = true;      // pinned -> make it stick
    }
    render();
    return;
  }
  // Notes already picked are fixed; only dragging moves them.
  if (pathChain.some(c => cellId(c) === id)) return;

  // Otherwise it joins the chain. Where the run reached before this pick
  // is where the new leg will be drawn from, so the line can grow out of
  // it rather than the whole run reappearing a note longer.
  const reached = pathResult ? pathResult.cells.length : 0;
  pathChain = extendChain(pathChain, cell);
  skipAutoPath = true;                    // a pick of your own takes over
  recomputePath();
  if (reached > 0 && pathResult) growFrom = reached - 1;
  render();
  popNote(cell);
}

/** Double-click anywhere: drop the run and begin again from that note. */
function restartPathAt(cell) {
  if (!pathOn) return;
  clearPath();
  pathChain = [{ string: cell.string, fret: cell.fret }];
  skipAutoPath = true;
  render();
  popNote(cell);
}

function clearPath() {
  stopSound();
  pathChain = []; pathHeld = []; pathResult = null;
  skipAutoPath = false;
  growFrom = null;
}

/**
 * With a position on screen, the board starts by tracing the whole shape
 * — its lowest note up to its highest — since that is the run the position
 * exists to teach. Clicking any note replaces it with a run of your own.
 */
function autoPathForPosition(grid) {
  let lowest = null, highest = null;
  grid.forEach((row, s) => row.forEach((cell, f) => {
    if (!cell) return;
    const here = { string: s, fret: f, midi: cell.midi };
    if (!lowest  || here.midi < lowest.midi)  lowest  = here;
    if (!highest || here.midi > highest.midi) highest = here;
  }));
  if (!lowest || !highest || lowest.midi === highest.midi) return;

  pathChain = [{ string: lowest.string,  fret: lowest.fret },
               { string: highest.string, fret: highest.fret }];
  pathHeld = [];
  recomputePath();
}

/**
 * A note picked swells and settles, the way a plucked string does.
 *
 * Purely a confirmation that the click landed — with the run growing out
 * of the note at the same moment, the two together say where the new leg
 * came from. Driven straight on the marker rather than through a render,
 * since it is about this one click and nothing else on the board.
 */
function popNote(cell) {
  const rec = byPosition.get(cellId(cell));
  if (!rec || !wantsMotion()) return;
  rec.group.classList.remove("is-picked");
  void rec.group.getBoundingClientRect();   // let the animation restart
  rec.group.classList.add("is-picked");
  setTimeout(() => rec.group.classList.remove("is-picked"), 460);
}

// ---- The run's line ---------------------------------------
const LINE_OPACITY = 0.90;

let pathRun     = null;   // the <g> the run's stretches are drawn into
let pathSpark   = null;   // the <g> the lit pieces are drawn into, over it
let lineSegs    = [];     // [{ el, points, dir }] one per stretch, in order
let lineAnim    = null;   // in-flight animation handle
let lineShown   = false;  // is it currently visible?

const asPoints = pts => pts.map(p => `${p.x},${p.y}`).join(" ");

// Someone who has asked for less movement gets none of this.
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const wantsMotion = () => !reducedMotion?.matches;

/**
 * How far along the line each corner sits, as a fraction of its total
 * length. This is what lets two runs of different lengths be blended:
 * they are matched by distance travelled, not by note number.
 */
function arcFractions(points) {
  const at = [0];
  for (let i = 1; i < points.length; i++) {
    at.push(at[i - 1] + Math.hypot(points[i].x - points[i - 1].x,
                                   points[i].y - points[i - 1].y));
  }
  const total = at[at.length - 1];
  return { fracs: total === 0 ? at.map(() => 0) : at.map(v => v / total), total };
}

/** The point a given fraction of the way along a line. */
function pointAtFraction(points, fracs, t) {
  if (points.length === 1) return { ...points[0] };
  let i = 1;
  while (i < fracs.length - 1 && fracs[i] < t) i++;
  const span = fracs[i] - fracs[i - 1];
  const k = span === 0 ? 0 : (t - fracs[i - 1]) / span;
  const a = points[i - 1], b = points[i];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// Fallback for degenerate lines: hold the last point.
function padTo(points, length) {
  if (points.length >= length) return points.slice(0, length);
  const last = points[points.length - 1];
  return points.concat(Array.from({ length: length - points.length }, () => ({ ...last })));
}

/**
 * Re-cut both lines at the same set of distances along their length.
 * Every corner of both survives — the points added to each sit flat on a
 * segment, so neither shape changes — but the two lists now correspond
 * point for point and can be blended.
 *
 * Matching by note number instead would pin note 1 to note 1 and leave
 * the surplus to sprout from the tail, so a longer run would appear to
 * grow out of its own end. Matching by distance makes the whole line
 * stretch and travel together, which is how it reads as one shape moving
 * rather than a list of points being rewritten.
 */
function alignLines(a, b) {
  const A = arcFractions(a), B = arcFractions(b);
  if (A.total === 0 || B.total === 0) {
    const span = Math.max(a.length, b.length);
    return [padTo(a, span), padTo(b, span)];
  }
  const ts = [...new Set([...A.fracs, ...B.fracs])].sort((x, y) => x - y);
  return [ts.map(t => pointAtFraction(a, A.fracs, t)),
          ts.map(t => pointAtFraction(b, B.fracs, t))];
}

/** One stretch of the run: a polyline, coloured by which way it travels. */
function segmentClass(dir) {
  return `path-seg ${dir > 0 ? "is-asc" : "is-desc"}`;
}

function makeSegment(dir) {
  const line = el("polyline", {
    class: segmentClass(dir),
    points: "", fill: "none", "stroke-width": 3,
    "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0,
  });
  pathRun.appendChild(line);
  return { el: line, points: [], dir };
}

function retireSegment(rec) {
  rec.el.setAttribute("opacity", 0);
  setTimeout(() => rec.el.remove(), FADE_MS);
}

/**
 * Draw the run, in playing order, as one line per stretch of travel.
 *
 * Splitting it is what lets the two directions be told apart: a stretch
 * climbing is drawn in orange, one falling in the pale blue, and they
 * meet on the note the run turns on — which belongs to both, so the line
 * stays unbroken across the corner.
 *
 * Between positions each stretch slides on the same curve and over the
 * same time as the notes it connects, so the two read as one movement.
 * Appearing and disappearing is left to a CSS opacity fade — a run
 * arriving somewhere new shouldn't skate across the neck to get there.
 *
 * While a note is being dragged the line tracks the pointer outright,
 * since easing there would only lag behind the hand.
 *
 * `growFrom`, when a leg has just been hung off the end, is where in the
 * run the new geometry begins: everything before it is already on the
 * board and stays where it is, and the rest is drawn in from there.
 */
function renderPathLine({ animate = true } = {}) {
  if (lineAnim) { cancelAnimationFrame(lineAnim); lineAnim = null; }

  const grow = growFrom;
  growFrom = null;

  const target = (pathOn && pathResult)
    ? runSegments(pathResult.cells).map(seg => ({
        dir: seg.dir,
        from: seg.from,
        points: seg.cells.map(c => ({ x: fretX(c.fret, c.string), y: stringY(c.string) })),
      }))
    : [];

  // Stretches the new run has no use for. The shape is left in place
  // underneath as it fades, so nothing flickers through it.
  for (let i = target.length; i < lineSegs.length; i++) retireSegment(lineSegs[i]);
  lineSegs.length = Math.min(lineSegs.length, target.length);

  if (target.length === 0) {
    stopPlayhead();
    lineShown = false;
    return;
  }

  const blends = [];   // stretches sliding from where they were
  const draws  = [];   // stretches being drawn in

  target.forEach((want, i) => {
    let rec = lineSegs[i];
    const isNew = !rec;
    if (isNew) rec = lineSegs[i] = makeSegment(want.dir);
    // A stretch that has changed direction keeps its element and simply
    // changes colour, so its geometry can still slide rather than one
    // line vanishing and another appearing in the same place.
    if (rec.dir !== want.dir) {
      rec.dir = want.dir;
      rec.el.setAttribute("class", segmentClass(want.dir));
    }

    const slide = animate && lineShown && !isNew && rec.points.length > 0
                  && wantsMotion() && grow === null;
    if (slide) {
      const [a, b] = alignLines(rec.points, want.points);
      blends.push({ rec, a, b, end: want.points });
    } else {
      rec.points = want.points;
      rec.el.setAttribute("points", asPoints(want.points));
      const drawn = grow !== null && wantsMotion() ? beginDraw(rec, want, grow) : null;
      if (drawn) draws.push(drawn); else clearDraw(rec);
    }

    // A brand-new element needs a frame at zero before it can fade in.
    if (isNew) requestAnimationFrame(() => {
      if (lineSegs[i] === rec) rec.el.setAttribute("opacity", LINE_OPACITY);
    });
    else rec.el.setAttribute("opacity", LINE_OPACITY);
  });

  lineShown = true;
  if (blends.length || draws.length) stepLine(blends, draws);
}

/**
 * Set a stretch up to be drawn in, and say how much of it is new.
 *
 * A newly hung leg starts at the note the run had already reached, so the
 * stretch holding that note is part old and part new — the old part is
 * revealed straight away and only the rest is drawn. Returns null when
 * there is nothing new here, which is the usual case for every stretch
 * but the last.
 */
function beginDraw(rec, want, growAt) {
  const { at, total } = noteDistances(want.points);
  if (total === 0) return null;
  // How far into this stretch the new geometry starts. A stretch lying
  // entirely past the join is new from its first point.
  const kept = want.from >= growAt ? 0
             : at[Math.min(growAt - want.from, at.length - 1)];
  if (kept >= total) return null;
  rec.el.setAttribute("stroke-dasharray", `${total} ${total}`);
  rec.el.setAttribute("stroke-dashoffset", total - kept);
  return { rec, kept, total };
}

function clearDraw(rec) {
  rec.el.removeAttribute("stroke-dasharray");
  rec.el.removeAttribute("stroke-dashoffset");
}

/**
 * Step every moving stretch off one clock, so a run that is sliding in
 * one place and growing in another still reads as a single movement.
 */
function stepLine(blends, draws) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / SLIDE_MS);
    const e = ease(k);

    for (const { rec, a, b } of blends) {
      const at = a.map((p, i) => ({
        x: p.x + (b[i].x - p.x) * e,
        y: p.y + (b[i].y - p.y) * e,
      }));
      // Remember where the line actually is, so a move interrupted midway
      // — holding down the arrow key, say — carries on from here instead
      // of snapping back to where this one began.
      rec.points = at;
      rec.el.setAttribute("points", asPoints(at));
    }
    for (const { rec, kept, total } of draws) {
      rec.el.setAttribute("stroke-dashoffset", (total - kept) * (1 - e));
    }

    if (k < 1) { lineAnim = requestAnimationFrame(step); return; }
    lineAnim = null;
    for (const { rec, end } of blends) {
      rec.points = end;
      rec.el.setAttribute("points", asPoints(end));
    }
    for (const { rec } of draws) clearDraw(rec);
  };
  lineAnim = requestAnimationFrame(step);
}

// ---- The playhead -----------------------------------------
/**
 * A light that travels the run as it plays, arriving at each note exactly
 * as that note sounds.
 *
 * The whole run recedes first, line and markers together, so that what is
 * at full strength on the board is only ever what is under the ear right
 * now. Each note comes back as it is struck and dims again behind the
 * beat; the stretch of line leading to it draws itself in as the run
 * crosses it and starts to go once the far note is reached. What is left
 * is a moving point of light with a tail — which is what a phrase
 * actually is, rather than a static picture with one note flashing in it.
 *
 * The notes are evenly spaced in time, but the segments joining them are
 * not evenly spaced on the neck — a run crossing four frets to the next
 * note has further to travel than one moving to its neighbour, in the
 * same eighth note. So the light cannot advance at a constant speed along
 * the line. It advances by note: the whole of segment k is covered in the
 * whole of note k's duration, whatever that segment's length, which is
 * what makes arrival and strike coincide instead of drifting apart over a
 * long run.
 *
 * Position comes from the audio clock rather than a wall clock, for the
 * same reason. The two run at slightly different rates, and half a beat
 * of accumulated drift is obvious when you can see it against the note
 * lighting up.
 */
let playAnim  = null;
let sparks    = [];   // [{ el, len }] one lit piece per step of the run
let glowNotes = [];   // [{ id, rec, strikes }] markers the run lights up

// How far the run recedes while it plays, and how long the light lingers
// — in notes, not in milliseconds, so the tail keeps its shape at any
// tempo. A slow run should leave a long trail on the board for the same
// reason it leaves a long one in the ear.
const PLAY_GHOST = 0.18;   // must match --play-ghost in styles.css
// A note outlasts the line that reached it, and by some way. The line is
// saying where the run went, which stops being news once it has gone;
// the note is still ringing, and half a dozen of them ringing together is
// what a phrase sounds like. So the board holds the notes long enough for
// the shape of the phrase to be visible all at once.
const NOTE_DECAY = 9;
const LINE_DECAY = 2.0;

/** The line going out behind the run: gone quickest where it is oldest. */
const decay = t => (t >= 1 ? 0 : (1 - t) ** 1.7);

/**
 * A note dying away.
 *
 * How long it takes matters less than where it spends that time. A curve
 * that falls fastest the instant it is struck reads as quick however far
 * it is stretched — most of the brightness is gone while the note is
 * still obviously the one being played, and the rest is a long faint
 * nothing. So this holds full for a moment and then eases off on a cosine,
 * which is gentle at both ends: slow to leave, and settling into the
 * ghost rather than arriving at it.
 */
const NOTE_HOLD = 0.12;   // of the fall spent at full, before any of it
const noteGlow = t => {
  if (t >= 1) return 0;
  if (t <= NOTE_HOLD) return 1;
  const k = (t - NOTE_HOLD) / (1 - NOTE_HOLD);
  return (1 + Math.cos(Math.PI * k)) / 2;
};

/** Distance along the line to each note, and the total. */
function noteDistances(points) {
  const at = [0];
  for (let i = 1; i < points.length; i++) {
    at.push(at[i - 1] + Math.hypot(points[i].x - points[i - 1].x,
                                   points[i].y - points[i - 1].y));
  }
  return { at, total: at[at.length - 1] };
}

/**
 * Put the board back the way it was.
 *
 * The markers are only restored where they are still the marker sitting
 * at that spot — a render during the tail may have retired them, and
 * pushing one back to full opacity mid-fade would leave a note on the
 * board that nothing owns.
 */
function stopPlayhead() {
  if (playAnim) { cancelAnimationFrame(playAnim); playAnim = null; }
  for (const { id, rec } of glowNotes) {
    if (byPosition.get(id) === rec) rec.group.style.opacity = "1";
  }
  glowNotes = [];
  sparks = [];
  if (pathSpark) pathSpark.innerHTML = "";
  document.getElementById("board")?.classList.remove("playing");
}

/**
 * @param cells    the run's notes, in playing order
 * @param startsAt when the first note lands, on the audio clock
 * @param gap      seconds between notes
 */
function startPlayhead(cells, startsAt, gap) {
  stopPlayhead();
  if (!pathSpark || cells.length < 2 || !gap) return;

  const points = cells.map(c => ({ x: fretX(c.fret, c.string), y: stringY(c.string) }));

  // Which way each step travels, taken from the same split that coloured
  // the line underneath — so what lights up is that line at full strength
  // rather than a differently-coloured marker laid over it.
  const stepDir = new Array(points.length - 1).fill(1);
  for (const seg of runSegments(cells)) {
    for (let k = seg.from; k < seg.to; k++) stepDir[k] = seg.dir;
  }

  for (let k = 0; k + 1 < points.length; k++) {
    const len = Math.hypot(points[k + 1].x - points[k].x, points[k + 1].y - points[k].y);
    const line = el("polyline", {
      class: `path-spark ${stepDir[k] > 0 ? "is-asc" : "is-desc"}`,
      points: asPoints([points[k], points[k + 1]]),
      fill: "none", "stroke-width": 4,
      "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0,
    });
    // Two notes on the same spot — the same pitch found twice on the neck
    // — have no line between them to draw.
    if (len > 0) {
      line.setAttribute("stroke-dasharray", `${len} ${len}`);
      line.setAttribute("stroke-dashoffset", len);
    }
    pathSpark.appendChild(line);
    sparks.push({ el: line, len });
  }

  // The markers the run lights, and when each is struck. A run that
  // doubles back sounds the same spot more than once, so a marker keeps
  // every strike that belongs to it and takes the brightest.
  const seen = new Map();
  cells.forEach((c, i) => {
    const id = cellId(c);
    let entry = seen.get(id);
    if (!entry) {
      const rec = byPosition.get(id);
      if (!rec) return;
      entry = { id, rec, strikes: [] };
      seen.set(id, entry);
      glowNotes.push(entry);
    }
    entry.strikes.push(i);
  });

  document.getElementById("board").classList.add("playing");
  for (const { rec } of glowNotes) rec.group.style.opacity = PLAY_GHOST;

  const last = points.length - 1;
  const tail = Math.max(NOTE_DECAY, LINE_DECAY);
  const step = () => {
    // Where we are in notes, not in pixels: 2.5 means halfway from the
    // third note to the fourth.
    let pos = Math.max(0, (clock() - startsAt) / gap);
    // Asked for less movement: the light steps from note to note instead
    // of sliding between them, so it still says where the run is up to
    // without anything gliding.
    if (!wantsMotion()) pos = Math.floor(pos);

    for (let k = 0; k < sparks.length; k++) {
      const { el: line, len } = sparks[k];
      if (pos <= k) { line.setAttribute("opacity", 0); continue; }
      // Drawn in over the whole of note k's duration, then let go once
      // the note at its far end has landed.
      if (len > 0) line.setAttribute("stroke-dashoffset", len * (1 - Math.min(1, pos - k)));
      line.setAttribute("opacity", pos <= k + 1 ? 1 : decay((pos - k - 1) / LINE_DECAY));
    }

    for (const { rec, strikes } of glowNotes) {
      let glow = 0;
      for (const i of strikes) {
        if (pos < i) break;
        glow = Math.max(glow, noteGlow((pos - i) / NOTE_DECAY));
      }
      rec.group.style.opacity = PLAY_GHOST + (1 - PLAY_GHOST) * glow;
    }

    // Kept alive past the last note so the tail can finish. Nothing is
    // sounding by then; this is the run dying away on the board the way
    // it is dying away in the ear.
    if (pos < last + tail) { playAnim = requestAnimationFrame(step); return; }
    playAnim = null;
    stopPlayhead();
  };
  playAnim = requestAnimationFrame(step);
}

// ---- Hearing it -------------------------------------------

/**
 * Light exactly the notes being heard, and let the rest go dark.
 *
 * Looked up by where a note is on the neck, not by which marker it is —
 * markers are identified by their order along a string so that they can
 * slide between frets, which is a different thing entirely.
 */
function showSounding(next) {
  for (const at of soundingAt) {
    if (!next.has(at)) byPosition.get(at)?.group.classList.remove("is-sounding");
  }
  for (const at of next) {
    if (!soundingAt.has(at)) byPosition.get(at)?.group.classList.add("is-sounding");
  }
  soundingAt = next;
}

/** Stop whatever is playing, whichever kind it was. */
function stopSound() {
  const p = player;
  player = null;
  playerKind = null;
  playingSig = null;
  p?.stop();
  stopPlayhead();
  showSounding(new Set());
  syncPlayButton();
  syncStrumButton();
}

/**
 * Play the run as it stands, start to target.
 *
 * The notes are already in playing order and already carry their pitch,
 * so there is nothing to work out here — this is only the hand-off.
 */
async function playRun() {
  if (!pathResult || pathResult.cells.length < 2) return;
  // Has to happen inside the click that called this, or the browser
  // leaves the context suspended and nothing sounds.
  if (!(await unlock())) return;

  const bpm = Number(document.getElementById("bpm")?.value) || 80;
  const notes = pathResult.cells.map(c => ({
    midi: c.midi ?? pitchAt(c),
    string: c.string,
    key: cellId(c),
  }));

  player = playSequence(notes, {
    bpm,
    onNote: n => showSounding(n ? new Set([n.key]) : new Set()),
    onEnd: () => {
      player = null; playerKind = null;
      // The light is left to finish. The last note is still ringing when
      // the schedule runs out, and cutting the board to full brightness
      // on that beat would end the run before it has ended. It tidies
      // itself up when the tail is spent — and a Stop, which really is an
      // end, goes through stopSound and takes it down at once.
      syncPlayButton();
    },
  });

  // Drawn against the same schedule the notes were scheduled on, so the
  // light and the sound are two readings of one clock rather than two
  // timers that happen to have been started together.
  startPlayhead(pathResult.cells, player.startsAt, player.gap);
  playerKind = "run";
  syncPlayButton();
}

/**
 * There is nothing to play until a run exists, so rather than a dead
 * button sitting there greyed out, the whole group — play, tempo, clear —
 * appears the moment the run does and goes away with it. The line of text
 * beside it stays either way: with no run it is the instruction for
 * making one.
 */
function syncPlayButton() {
  const btn = document.getElementById("playBtn");
  if (!btn) return;
  const on = playerKind === "run";
  const can = !!pathResult && pathResult.cells.length > 1;

  const group = document.getElementById("runControls");
  if (group) group.style.display = can ? "flex" : "none";

  btn.disabled = !can;
  btn.textContent = on ? "Stop" : "Play";
  btn.classList.toggle("active", on);
  btn.title = on ? "Stop" : "Hear the run, start to target";
}

/**
 * Strum the grip on screen, low string to high.
 *
 * Which is a downstroke — the bass of the chord arrives first and the
 * top note last, which is why a strummed chord has a shape to it rather
 * than being a block of sound.
 */
async function strumChord() {
  const v = currentVoicing;
  if (!v || !v.cells.length) return;
  if (!(await unlock())) return;

  const t = Number(document.getElementById("spread")?.value ?? 60) / 100;
  const notes = v.cells.slice()
    .sort((a, b) => stringRow(a.string) - stringRow(b.string))   // bottom row first
    .map(c => ({ midi: pitchAt(c), string: c.string, key: cellId(c) }));

  // The strum builds up rather than moving along, so the lit notes
  // accumulate and clear together at the end.
  const lit = new Set();
  player = playChord(notes, {
    gap: strumGap(t),
    onStrike: n => { lit.add(n.key); showSounding(new Set(lit)); },
    onEnd: () => {
      player = null; playerKind = null; playingSig = null;
      showSounding(new Set());
      syncStrumButton();
    },
  });
  playerKind = "chord";
  playingSig = voicingSig(v);
  syncStrumButton();
}

/**
 * Play a progression through, chord after chord.
 *
 * The board follows the sound: each chord is shown as it arrives, so the
 * grip on screen is the grip being heard. That is the point of choosing
 * them as a sequence — the movement between them is the thing worth
 * watching, and it can only be watched if the board keeps up.
 */
async function playProgressionThrough() {
  // Whatever route is on the board — the cache holds the one the current
  // window asked for, so this cannot drift out of step with the display.
  const chords = progressionCache.chords;
  if (!chords.length) return;
  if (!(await unlock())) return;

  const t = Number(document.getElementById("spread")?.value ?? 60) / 100;
  const groups = chords.map(v => v.cells.slice()
    .sort((a, b) => stringRow(a.string) - stringRow(b.string))   // bottom row first
    .map(c => ({ midi: pitchAt(c), string: c.string, key: cellId(c) })));

  player = playProgression(groups, {
    gap: strumGap(t),
    onChord: c => {
      posIndex = c;
      render();
      showSounding(new Set(groups[c].map(n => n.key)));
    },
    onEnd: () => {
      player = null; playerKind = null; playingSig = null;
      showSounding(new Set());
      syncStrumButton();
    },
  });
  playerKind = "progression";
  syncStrumButton();
}

function syncStrumButton() {
  const btn = document.getElementById("strumBtn");
  if (!btn) return;
  const walk = isProgressionMode();
  const on = playerKind === "chord" || playerKind === "progression";
  const can = !!currentVoicing && (isChordMode() || walk);
  btn.disabled = !can;
  btn.textContent = on ? "Stop" : walk ? "Play" : "Strum";
  btn.classList.toggle("active", on);
  btn.title = !can ? "No grip to play" : on ? "Stop"
    : walk ? "Play the progression through" : "Strum this grip";
}

// ============================================================
// CHORDS
// ============================================================

const isChordMode = () => document.getElementById("kind").value === "chord";
const isProgressionMode = () =>
  document.getElementById("kind").value === "progression";

// A progression is solved whole, so it is worked out once per key and
// preset rather than per render — the search is cheap but not free, and
// nothing about it changes while you step through the chords.
let progressionCache = { key: null, chords: [] };
function progressionFor(key, name, window = null) {
  const cacheKey = `${key}|${name}|${window ? window.lo : "free"}`;
  if (progressionCache.key !== cacheKey) {
    progressionCache = { key: cacheKey, chords: progressionVoicings(key, name, { window }) };
  }
  return progressionCache.chords;
}

/**
 * The grip as it should be shown: the computed one, unless it has been
 * edited by hand, in which case everything about it — its degrees, its
 * fingering, which strings fall silent — is worked out again from the
 * notes that are actually held. Nothing is searched for; the notes not
 * touched are the same objects in the same order.
 */
function effectiveVoicing(root, type, voicing) {
  if (!voicing) return null;
  if (!gripEdit || gripEdit.sig !== voicingSig(voicing)) return voicing;

  const cells = gripEdit.cells;
  if (!cells.length) return voicing;

  const full  = buildScaleGrid(root, type);
  const notes = cells.map(c => full[c.string][c.fret]);
  const stopped = cells.map(c => c.fret).filter(f => f > 0);
  const lo = stopped.length ? Math.min(...stopped) : 0;
  const hi = stopped.length ? Math.max(...stopped) : 0;
  const span = stopped.length ? hi - lo + 1 : 0;
  // An edit is allowed to produce something no hand can hold — you are
  // choosing the notes, and being refused with no explanation would be
  // worse than being told. So the fingering is worked out and, when there
  // isn't one, that is said out loud rather than left blank.
  const grip = gripFingering(cells);
  const lowest = cells.reduce((low, c) => pitchAt(c) < pitchAt(low) ? c : low, cells[0]);

  return {
    ...voicing,
    cells, notes, lo, hi, span,
    strings: cells.map(c => c.string),   // gaps here become muted strings
    stretch: span > 4,
    fingers: grip?.fingers,
    barre: grip?.barre,
    fingerable: !!grip,
    order: notes.map(n => n.degree).join("-"),
    bass: full[lowest.string][lowest.fret].degree,
    // The names belonged to the grip as it was searched for. Once notes
    // have been moved by hand they describe something that is no longer
    // on the board, so they go rather than mislead — the label says
    // "edited" in their place.
    shape: null, grip: null, omits: [],
    reach: handReach(cells),
    edited: true,
  };
}

/**
 * Can a hand sitting at frets lo..hi hold this grip?
 *
 * Everything the fingers do has to be inside the window — that is what
 * the window means, and it is why the open shapes appear as it reaches
 * the nut and not before. Two things are exempt from it:
 *
 *   - an open string, when OPEN is on. It needs no finger, so it can ring
 *     wherever the hand happens to be.
 *   - a drone string, always. A banjo's 5th string has no fret under the
 *     hand at all: it rings open from its own short nut regardless of
 *     where the hand is, so asking whether it is "inside the window" is
 *     asking the wrong question. The ghost layer and the open-reach cap
 *     in the voicing search already treat it this way; this is the last
 *     place that didn't, and it was quietly throwing away most of the
 *     grips on the instrument — every one that lets the 5th string ring.
 */
function cellFitsWindow(c, lo, hi) {
  return (c.fret === 0 && (openOn || droneStrings.has(c.string))) ||
         (c.fret >= lo && c.fret <= hi);
}

function gripFitsWindow(voicing, lo, hi) {
  return voicing.cells.every(c => cellFitsWindow(c, lo, hi));
}

/**
 * Where to open the window when the chord under it changes.
 *
 * At the hand's last position if a grip lives there, and otherwise at the
 * nearest stretch of neck that holds one. Dragging the window is left
 * alone: every stretch of neck answers with something now, down to the
 * fragment of the chord it can reach, so a drag is never refused — but
 * arriving somewhere by accident that only holds a fragment, when the
 * whole chord sits two frets away, is not what anyone meant to ask for.
 *
 * This matters far more on a bass than on a guitar. A guitar plays most
 * chords almost anywhere; a bass has no C at all below the eighth fret,
 * so a window left where the scale was would frequently hold nothing.
 */
function seekWindow(voicings, type, anchor) {
  const last = lastWindowLo();
  const want = Math.max(0, Math.min(last, anchor));
  if (!voicings.length) return want;

  const within = lo =>
    voicings.filter(v => gripFitsWindow(v, lo, lo + windowWidth() - 1));
  if (within(want).length) return want;

  // The hand has to move, so it may as well move somewhere worth being.
  // Nearest is the wrong question once staying put is impossible: it
  // lands on whatever scrap of a chord happens to be closest, which on a
  // bass is usually an inversion nobody asked for. So each stretch of
  // neck is judged by the best grip in it, with distance only breaking
  // ties between places that are otherwise as good as each other.
  let best = want, bestCost = Infinity;
  for (let lo = 0; lo <= last; lo++) {
    const here = within(lo);
    if (!here.length) continue;
    const top = rankVoicings(here, type, { limit: 1 })[0];
    const cost = top.ease + Math.abs(lo - want) * 0.35;
    if (cost < bestCost) { bestCost = cost; best = lo; }
  }
  return best;
}

/**
 * What to call the grip on screen.
 *
 * A guitar names it after the CAGED shape it is; a bass names it after
 * the interval it spans, because that is what a bass player calls it —
 * a tenth, a shell, a fifth. And where the grip cannot carry a tone the
 * chord is named for, it says so: nearly every bass voicing leaves
 * something out, and a Cm7b5 that is really sounding C, Eb and Bb should
 * admit it rather than let the player believe the flat fifth is there.
 */
function gripName(voicing) {
  const named = voicing.shape ? ` · ${voicing.shape} shape`
              : voicing.grip  ? ` · ${voicing.grip}`
              : "";
  const omits = voicing.omits?.length ? ` · omits ${voicing.omits.join(", ")}` : "";
  return named + omits;
}

/**
 * What the hand is doing to hold it — the same sentence wherever a grip
 * is named, a chord on its own or a chord inside a progression.
 */
function handName(voicing) {
  return voicing.barre ? " · barre"
       : voicing.cells.some(c => c.fret === 0) ? " · open" : "";
}

/**
 * Switch a note in or out of the grip.
 *
 * A note that is sounding goes quiet, and its string with it. A faint one
 * starts sounding, and whatever was on that string steps back — a string
 * can only hold one note, so putting a finger somewhere new necessarily
 * takes it off wherever it was.
 *
 * The rest of the grip is untouched. This is not a search for the nearest
 * playable chord; it is the chord on screen, with one note changed.
 */
function toggleGripNote(pos) {
  if (!ghostOn || !isChordMode() || !currentBase || !currentVoicing) return;

  const id = cellId(pos);
  const cells = currentVoicing.cells.map(c => ({ string: c.string, fret: c.fret }));
  const at = cells.findIndex(c => cellId(c) === id);

  if (at >= 0) {
    if (cells.length <= 1) return;          // something has to sound
    cells.splice(at, 1);
  } else {
    const onString = cells.findIndex(c => c.string === pos.string);
    if (onString >= 0) cells.splice(onString, 1);
    cells.push({ string: pos.string, fret: pos.fret });
    // Back into strum order, which only moves the note just added — the
    // others were already in it, and the strum crosses the strings in
    // this order (bottom row to top, not string number — see stringRow).
    cells.sort((a, b) => stringRow(a.string) - stringRow(b.string));
  }

  gripEdit = { sig: voicingSig(currentBase), cells };
  render();
}

/**
 * The grips for a chord, worked out once and kept.
 *
 * Enumerating them means walking the whole neck, which for a dense chord
 * like a major 13th runs to a tenth of a second. Dragging the window
 * re-renders on every pointer move but doesn't change the chord, so
 * without this the neck would be searched afresh dozens of times a second
 * for an answer that never changes. Only one chord is on screen at a
 * time, so remembering the last one is enough.
 */
let voicingCache = { key: null, whole: null, shell: null };
function voicingsFor(root, type, openAnywhere, { relaxed = false } = {}) {
  const key = `${root}|${type}|${openAnywhere}`;
  if (voicingCache.key !== key) voicingCache = { key, whole: null, shell: null };
  const slot = relaxed ? "shell" : "whole";
  // The shell search is a second walk of the whole neck, so it is only
  // paid for when a window turns out to need it — which for most chords
  // is never.
  voicingCache[slot] ??= chordVoicings(root, type, { stacked: false, openAnywhere, relaxed });
  return voicingCache[slot];
}

/**
 * The same, for the fragments a single window can hold.
 *
 * This one is keyed by the window as well, because that is what it is
 * about — but it is still worth keeping, for the same reason: a drag
 * re-renders on every pointer move, and a window that needs fragments at
 * all is one where they are the whole answer, worked out afresh each
 * time. On a dense chord that search runs into tens of milliseconds,
 * which is a stutter under the finger rather than a slow load.
 */
let fragmentCache = { key: null, list: [] };
function fragmentsFor(root, type, lo, hi, openAnywhere) {
  const key = `${root}|${type}|${openAnywhere}|${lo}|${hi}`;
  if (fragmentCache.key !== key) {
    fragmentCache = { key, list: fragmentVoicings(root, type, { lo, hi, openAnywhere }) };
  }
  return fragmentCache.list;
}

/**
 * Reduce the grid to the notes a grip actually holds, and draw the
 * furniture that only chords need: the barre, and a cross above every
 * string left silent.
 */
function renderChord(root, type, voicing, ghostRange) {
  const full = buildScaleGrid(root, type);
  const grid = full.map(row => row.map(() => null));

  // Ghosts first: every chord tone in reach, faint. The grip is then laid
  // over the top, so its own notes read normally.
  ghostCells = new Set();
  if (ghostRange) {
    // Whatever the hand can reach — and, when open strings are in play,
    // the nut as well, since those tones are on offer from anywhere.
    const frets = ghostRange.open ? [0] : [];
    for (let f = Math.max(ghostRange.lo, 1); f <= ghostRange.hi; f++) frets.push(f);
    if (ghostRange.lo === 0 && !ghostRange.open) frets.unshift(0);
    for (let s = 0; s < numStrings; s++) {
      for (const f of frets) {
        if (!full[s][f]) continue;
        grid[s][f] = full[s][f];
        ghostCells.add(`${s}:${f}`);
      }
      // A drone string's open note doesn't wait on the window reaching
      // a nut — it isn't near the nut to begin with, and it's ringing
      // regardless of where the hand is. So it's always on offer here,
      // window or no.
      if (droneStrings.has(s) && full[s][0]) {
        grid[s][0] = full[s][0];
        ghostCells.add(`${s}:0`);
      }
    }
  }
  for (const { string, fret } of voicing.cells) {
    grid[string][fret] = full[string][fret];
    ghostCells.delete(`${string}:${fret}`);
  }

  chordLayer.innerHTML = "";

  // A barre, drawn as the bar it is: one finger lying across the fret,
  // as wide as the markers it joins so it reads as the same object
  // running under them rather than a line drawn between them.
  //
  // Taken from the fingering rather than from the frets, so it only
  // appears where one finger really is covering several strings — two
  // notes that happen to share a fret under two different fingers are
  // not a barre, and drawing them joined would teach the wrong grip.
  // It sits in this layer, under the note markers, which is also where
  // the finger sits under the strings.
  for (const barre of gripFingering(voicing.cells)?.barres ?? []) {
    const x = fretX(barre.fret);
    // Drawn by row, not by the two string numbers at its ends — a barre
    // covers every string between them, and on an instrument whose rows
    // aren't in string-number order (a banjo's drone sits apart from
    // where its pitch would put it) those rows aren't necessarily
    // contiguous. Split into one rectangle per contiguous run of rows,
    // so a barre that's visually broken by the drone draws as the two
    // separate pieces it actually is, rather than one bar sweeping over
    // strings that aren't part of it.
    const rows = [];
    for (let s = barre.from; s <= barre.to; s++) rows.push(stringRow(s));
    rows.sort((a, b) => a - b);
    let segStart = 0;
    for (let i = 1; i <= rows.length; i++) {
      if (i < rows.length && rows[i] === rows[i - 1] + 1) continue;
      const from = rowY(rows[segStart]), to = rowY(rows[i - 1]);
      chordLayer.appendChild(el("rect", {
        class: "barre",
        x: x - R, y: Math.min(from, to) - R,
        width: R * 2, height: Math.abs(to - from) + R * 2,
        rx: R, ry: R,
      }));
      segStart = i;
    }
  }

  // Strings the grip leaves out, crossed through beyond the nut.
  for (let s = 0; s < numStrings; s++) {
    if (voicing.strings.includes(s)) continue;
    const y = stringY(s), x = fretX(0, s), r = 5;
    [1, -1].forEach(dir => {
      chordLayer.appendChild(el("line", {
        x1: x - r, y1: y - r * dir, x2: x + r, y2: y + r * dir,
        stroke: "var(--muted)", "stroke-width": 2, "stroke-linecap": "round",
      }));
    });
  }
  return grid;
}

// ============================================================
// RENDER
// ============================================================

function render({ animate = true } = {}) {
  const root = document.getElementById("root").value;
  const type = document.getElementById("scale").value;
  const mode = labelMode();

  // Chords take their own route: a grip is a set of notes held at once,
  // not a shape to run through, so positions cycle voicings instead.
  // ---- A progression ---------------------------------------
  // The grips are already decided — chosen together, so that the hand
  // moves as little as possible getting through them — so there is
  // nothing to search here. Stepping forward is stepping along the route
  // the search found.
  if (isProgressionMode()) {
    // Coming from a scale, the progression opens where the hand was left.
    if (seekAnchor) {
      winLo = Math.max(0, Math.min(lastWindowLo(), anchorFret));
      seekAnchor = false;
    }
    const winHi = winLo + windowWidth() - 1;

    // A new key, preset or stretch of neck is a new route; show it from
    // its first chord.
    if (progressionCache.key !== `${root}|${type}|${winLo}`) posIndex = 0;
    const chords = progressionFor(root, type, { lo: winLo, hi: winHi });
    // Nothing but the grip is drawn, so the board starts empty rather
    // than from a scale: the progression's name is not a chord type and
    // there is no grid to build from it.
    let grid = Array.from({ length: numStrings }, () => Array(numFrets + 1).fill(null));
    let voicing = null;

    if (chords.length) {
      posIndex = Math.max(0, Math.min(posIndex, chords.length - 1));
      voicing = chords[posIndex];
      grid = renderChord(voicing.root, voicing.type, voicing, null);
    } else {
      chordLayer.innerHTML = "";
      ghostCells = new Set();
    }
    currentBase = voicing;
    currentVoicing = voicing;
    if (playerKind === "chord" && voicingSig(voicing) !== playingSig) stopSound();
    syncStrumButton();

    // The handle slides the neck exactly as it does for chords: it says
    // where the hand is, and the progression is solved to sit there. It
    // is not a stepper through the chords — the arrows are that — because
    // a progression has no positions of its own to stop at.
    activeStops = null;
    activeBand = { lo: winLo, hi: Math.min(winHi, numFrets) };
    anchorFret = winLo;
    showBand(activeBand.lo, activeBand.hi);
    renderWindowHandle();
    renderNotes(grid, mode);
    renderPathLine({ animate: false });

    const posLabel = document.getElementById("posLabel");
    if (posLabel) {
      posLabel.classList.remove("unplayable");
      // The numeral says what the chord is doing, the symbol says what to
      // call it, and the rest is what the hand has to do — which is the
      // whole reason these particular grips were chosen.
      posLabel.textContent = voicing
        ? `${posIndex + 1}/${chords.length} · ${voicing.numeral} · ${voicing.symbol}`
          + gripName(voicing) + handName(voicing)
        : "no grips found for this progression";
    }
    syncArrows(posIndex, chords.length);
    return;
  }

  if (isChordMode()) {
    // Full grips: every string sounds and notes may double, which is what
    // the open and barre shapes a guitarist actually plays are made of.
    // On a bass this is the bass search instead — a different set of
    // rules producing the same kind of answer.
    const all = voicingsFor(root, type, openOn);
    // Coming from a scale, the window opens where the hand was left — or
    // at the nearest stretch of neck that can actually hold the chord.
    if (seekAnchor) {
      winLo = seekWindow(all, type, anchorFret);
      seekAnchor = false;
    }
    const winHi = winLo + windowWidth() - 1;
    let voicings = all;
    // Keep only grips a hand at this stretch of neck can hold — see
    // gripFitsWindow for what that means and what escapes it.
    {
      let inWindow = all.filter(v => gripFitsWindow(v, winLo, winHi));
      // Nothing fits. That is almost never the truth about the neck —
      // the tones are simply not all reachable at once here. A banjo's
      // G13 between frets 4 and 8 has its seventh and its thirteenth on
      // the same string and nowhere else, and what a player does there
      // is play the shell and let the extension go. So ask again for the
      // shell, and let the label admit what is missing.
      if (!inWindow.length) {
        inWindow = voicingsFor(root, type, openOn, { relaxed: true })
          .filter(v => gripFitsWindow(v, winLo, winHi));
      }
      // Still nothing, which happens where even the shell is split
      // across one string: G major between the 4th and 8th frets of a
      // banjo has its B and its D nowhere but the third string. A blank
      // board is the one answer that teaches nothing, and it isn't true
      // either — the hand can still sound G and B there, which is the
      // chord without its fifth. So the last question asked of a window
      // is simply what it CAN hold, and the label names what it can't.
      if (!inWindow.length) {
        inWindow = fragmentsFor(root, type, winLo, winHi, openOn);
      }
      // A chord has hundreds of correct fingerings in any given stretch
      // of neck and a player wants three or four of them: the ones they
      // would actually be taught. So the list is ranked by how the hand
      // takes it — CAGED shapes first, then reach, barre, open strings,
      // root in the bass, how much of the chord is sounding — and cut
      // there. Cycling through every doubling of every inversion buries
      // the grips that matter.
      voicings = rankVoicings(inWindow, type, { limit: GRIPS_SHOWN });
    }

    let grid = buildScaleGrid(root, type);
    let voicing = null;
    if (voicings.length) {
      posIndex = Math.max(0, Math.min(posIndex, voicings.length - 1));
      voicing = voicings[posIndex];
      // An edit belongs to the grip it was made on, and to the hand
      // position it was made at. A different grip has come up, so it no
      // longer describes anything — and neither does a note the hand has
      // since moved away from.
      //
      // The second half is not covered by the first. A grip often stays
      // the best answer over several positions of the window — a banjo's
      // barred C is the top choice from the first fret to the fifth — so
      // the signature can match while the window has slid clean past the
      // note that was picked. The board then went on drawing a note the
      // hand it is describing could not reach, outside the very band it
      // was highlighting.
      if (gripEdit && (gripEdit.sig !== voicingSig(voicing) ||
          !gripEdit.cells.every(c => cellFitsWindow(c, winLo, winHi)))) {
        gripEdit = null;
      }
      voicing = effectiveVoicing(root, type, voicing) ?? voicing;
      // Ghosts follow the window when there is one, else the whole neck.
      const ghostRange = ghostOn
        ? { lo: winLo, hi: Math.min(winHi, numFrets), open: openOn }
        : null;
      grid = renderChord(root, type, voicing, ghostRange);
    } else {
      chordLayer.innerHTML = "";
      ghostCells = new Set();
    }
    currentBase = voicings.length ? voicings[posIndex] : null;
    currentVoicing = voicing;
    // A strum belongs to the grip it started on; if that grip has moved
    // out from under it, it is no longer describing what's on screen.
    if (playerKind === "chord" && voicingSig(voicing) !== playingSig) stopSound();
    syncStrumButton();

    // Show the stretch being searched, the same band the positions use.
    activeStops = null;                    // chords slide a window instead
    activeBand = { lo: winLo, hi: Math.min(winHi, numFrets) };
    anchorFret = winLo;
    showBand(activeBand.lo, activeBand.hi);
    renderWindowHandle();
    renderNotes(grid, mode);
    renderPathLine({ animate: false });

    const posLabel = document.getElementById("posLabel");
    if (posLabel) {
      if (!voicing) {
        // Three tiers deep — the chord, its shell, and then whatever
        // fragment of it the window holds — so this only happens where
        // the window has fewer than two chord tones in it at all, which
        // takes a one-note chord or a stretch of neck the instrument
        // doesn't have.
        posLabel.textContent = `no grip fits frets ${winLo}–${winHi}`;
        posLabel.classList.remove("unplayable");
      } else {
        // The strings it uses, the frets it spans and the order of its
        // intervals are all on the board already — printing them again
        // just made the line long enough to stop being read. What is left
        // is what the board can't say: which of the shapes this is, and
        // what the hand has to do to hold it.
        // An edit can ask for a hand nobody has. Still shown, still played
        // — but flagged, so the note to take back off is obvious.
        posLabel.classList.toggle("unplayable",
          voicing.edited && voicing.fingerable === false);
        // Root position is the assumed case, so only the others are named.
        // An edited grip is named for what it is instead: the inversion it
        // started as no longer describes it.
        const inv = voicing.edited ? " · edited"
          : voicing.label && voicing.label !== "root position" ? ` · ${voicing.label}` : "";
        posLabel.textContent =
          `${posIndex + 1}/${voicings.length}${gripName(voicing)}${inv}${handName(voicing)}` +
          (voicing.stretch ? " · stretch" : "");
      }
    }
    syncArrows(posIndex, voicings.length);
    return;
  }
  chordLayer.innerHTML = "";
  ghostCells = new Set();


  // 1) Build the scale's own grid.
  let grid = buildScaleGrid(root, type);

  // 2) If position mode is active, reduce the grid to the current box.
  //    CAGED shapes for the natural modes, searched positions otherwise.
  //    A run is then confined to whatever this box holds.
  let box = null, boxCount = 0;
  activeStops = null;
  if (cagedOn) {
    const found = getPositions(root, type);
    boxCount = found.boxes.length;
    // Where each position begins, so the handle can be dragged between
    // them. Trimmed to the frets actually played, matching the band.
    activeStops = found.boxes.map(b => {
      const trimmed = playedSpan(getShapeGrid(root, type, b), b);
      return trimmed ? trimmed.lo : b.lo;
    });
    if (boxCount > 0) {
      // Material has changed underneath: find the shape sitting where the
      // hand already is. Which shape it is by number means nothing across
      // the change — a scale has seven positions and its arpeggio has
      // five — but the fret means the same thing to both.
      if (seekAnchor) {
        posIndex = activeStops.reduce((best, stop, i) =>
          Math.abs(stop - anchorFret) < Math.abs(activeStops[best] - anchorFret) ? i : best, 0);
        seekAnchor = false;
      }
      posIndex = Math.max(0, Math.min(posIndex, boxCount - 1));
      box = found.boxes[posIndex];
      grid = getShapeGrid(root, type, box);
    }
  }

  // 3) Slide the highlight to the frets in play.
  const span = box ? playedSpan(grid, box) : null;
  // The handle rides this band, keeping each position's own width.
  activeBand = span ? { lo: span.lo, hi: span.hi } : null;
  // Only a position on screen says where the hand is. Looking at the
  // whole neck it is nowhere in particular, so the last real answer
  // stands until there is a new one.
  if (span) anchorFret = span.lo;
  if (!span) activeStops = null;
  // First reveal jumps into place; later moves glide.
  if (span) showBand(span.lo, span.hi, { settle: true });
  else hideBand();

  // 4) Remember what's on the board — a run may only use these notes.
  visibleCells = new Set();
  grid.forEach((row, s) => row.forEach((cell, f) => {
    if (cell) visibleCells.add(`${s}:${f}`);
  }));
  // A run drawn before the position moved may no longer be playable here.
  // Whichever links of the chain the new shape still holds are kept, so
  // stepping between positions trims the phrase rather than wiping it.
  if (pathOn && pathChain.length) {
    const kept = pathChain.filter(c => visibleCells.has(cellId(c)));
    if (kept.length !== pathChain.length) {
      pathChain = kept;
      pathHeld = [];
      growFrom = null;
      recomputePath({ force: true });
    } else {
      const held = pathHeld.map(stops => (stops ?? []).filter(s => visibleCells.has(cellId(s))));
      if (held.some((stops, i) => stops.length !== (pathHeld[i]?.length ?? 0))) {
        pathHeld = held;
        recomputePath({ force: true });
      }
    }
  }

  // Nothing picked yet, and a shape is on screen: trace all of it.
  if (pathOn && box && !pathChain.length && !skipAutoPath) {
    autoPathForPosition(grid);
  }

  // 5) Move the notes, then trace the run over them.
  renderNotes(grid, mode);
  renderPathLine({ animate });
  renderWindowHandle();

  const pathLabel = document.getElementById("pathLabel");
  if (pathLabel) {
    if (!pathOn) pathLabel.textContent = "";
    else if (!pathChain.length) pathLabel.textContent = "Click a note to start a run";
    else if (pathChain.length === 1) pathLabel.textContent = "Now click the note to finish on";
    else if (!pathResult) pathLabel.textContent = "No playable run through those notes";
    // The run is on the board and the one thing not visible about it is
    // that it can be carried on. Said once, on the first complete run,
    // and then dropped — by the third note it has been discovered, and
    // how many notes the run holds and how far it reaches are both
    // plainly visible anyway.
    else if (pathChain.length === 2) pathLabel.textContent = "Click another note to carry the run on";
    else pathLabel.textContent = "";
  }
  syncPlayButton();

  // 5) Readout + arrow availability.
  const posLabel = document.getElementById("posLabel");
  if (posLabel) {
    if (!box) {
      posLabel.textContent = cagedOn ? "no playable position found" : "";
    } else {
      // The handle above the neck already prints the frets this position
      // covers, so naming them again here says nothing new. The shape's
      // name does — and where there isn't one, the frets are all there is
      // to give.
      const lo = span ? span.lo : box.lo;
      const hi = span ? span.hi : box.hi;
      posLabel.textContent = box.shape
        ? `${posIndex + 1}/${boxCount} · ${box.shape} shape`
        : `${posIndex + 1}/${boxCount} · frets ${lo}–${hi}`;
    }
  }
  // No position on screen means nothing to step between, which reads as
  // a list of zero — both arrows off.
  syncArrows(posIndex, box ? boxCount : 0);
}

// ============================================================
// CONTROLS
// ============================================================

// The button names whichever system applies to the current scale:
// CAGED for the natural modes, positions for everything else. A toggle
// that is on is filled rather than relabelled, so the button goes on
// saying what it does.
function syncCagedControls() {
  const type   = document.getElementById("scale").value;
  const chords = isChordMode();
  // A progression is a series of grips, so it steps like chords do — but
  // the grips are chosen by the progression, not by the player, so there
  // is nothing here to edit or open up.
  const walk   = isProgressionMode();
  const caged  = supportsCaged(type);
  const btn    = document.getElementById("cagedBtn");
  const nav    = document.getElementById("cagedNav");

  // A chord is only ever one grip, so voicing cycling is always on.
  btn.disabled = chords || walk;
  btn.title = walk
    ? "The progression picks its own grips — step through them with the arrows"
    : chords
      ? "Chords are shown one grip at a time — step through them with the arrows"
      : caged
        ? "Show one CAGED shape at a time"
        : "CAGED doesn't apply to this scale — showing playable hand positions";
  btn.classList.toggle("active", chords || walk || cagedOn);
  btn.textContent = walk ? "Chords" : chords ? "Voicings" : caged ? "CAGED" : "Positions";
  nav.style.display = (chords || walk || cagedOn) ? "flex" : "none";

  // A scale or an arpeggio is something you travel through, so picking a
  // run is simply what the board does — there is nothing to switch on. A
  // chord is held rather than travelled through, so it is off there.
  const wasOn = pathOn;
  pathOn = !chords && !walk;
  if (!pathOn && wasOn) clearPath();
  document.getElementById("pathNav").style.display = pathOn ? "flex" : "none";
  document.getElementById("board").classList.toggle("picking", pathOn);

  const ghostField = document.getElementById("ghostField");
  const ghostBtn   = document.getElementById("ghostBtn");
  ghostField.style.display = chords ? "flex" : "none";
  ghostBtn.classList.toggle("active", ghostOn);
  ghostBtn.title = chords && ghostOn
    ? "Click a note to silence it, or a faint one to play it instead"
    : "Show the chord's other tones faintly, wherever they fall";
  // With ghosts up, the notes are editable, so they should look it.
  document.getElementById("board").classList.toggle("editing", chords && ghostOn);

  // Open strings, likewise — but only where the chord has one to ring.
  // A chord with no open tone can't be opened, so the button stays off
  // rather than turning on and changing nothing.
  const openField = document.getElementById("openField");
  const openBtn   = document.getElementById("openBtn");
  const canOpen   = chords && hasOpenVoicing(
    document.getElementById("root").value,
    document.getElementById("scale").value);
  if (!canOpen) openOn = false;
  openField.style.display = chords ? "flex" : "none";
  openBtn.disabled = !canOpen;
  openBtn.classList.toggle("active", openOn);
  openBtn.title = !canOpen
    ? "No open string belongs to this chord"
    : openOn
      ? "Open strings may ring under a grip anywhere on the neck"
      : "Open strings only where the window reaches the nut";

  // The legend names what is actually on the board, and says what the
  // board does when you touch it — which is a different thing in each
  // mode, so it can't be printed once and left there.
  const tone = document.getElementById("legendTone");
  const tip  = document.getElementById("legendTip");
  const runLegend = document.getElementById("runLegend");
  if (tone) tone.textContent = (chords || walk) ? "Chord tone" : "Scale tone";
  // The two run colours mean nothing where there is no run to colour.
  if (runLegend) runLegend.style.display = pathOn ? "flex" : "none";
  if (tip) {
    tip.textContent = walk
      ? "Step through the progression · the grips are chosen to keep the hand still"
      : chords
        ? (ghostOn ? "Click a note to silence it, or a faint one to play it instead"
                   : "Step through the grips, or drag the bar along the neck")
        : "Click notes to chain a run · drag one to hold the run through it";
  }

  // Strumming is a chord idea too. Leaving chord mode leaves no grip to
  // play, so the button has nothing to refer to.
  document.getElementById("strumField").style.display = (chords || walk) ? "flex" : "none";
  if (!chords) currentVoicing = null;
  syncStrumButton();
}

/**
 * Offer only the displays this instrument has. A bass carries scales and
 * arpeggios; chords and progressions are grip searches written around a
 * six-string hand, so they are not on the menu until the bass has
 * voicing rules of its own.
 */
function fillKindMenu() {
  const sel = document.getElementById("kind");
  const wanted = sel.value;
  sel.innerHTML = "";
  KIND_LABELS.forEach(([value, label]) => {
    if (supportsKind(value)) sel.appendChild(new Option(label, value));
  });
  // Hold the current display across the change where the new instrument
  // has it — moving from a guitar scale to a bass scale should land on
  // the scale — and fall back to the first one it does have where it
  // doesn't.
  sel.value = supportsKind(wanted) ? wanted : sel.options[0].value;
  return sel.value;
}

/**
 * Mount another instrument.
 *
 * music.js recomputes the whole fretboard from the new open pitches, so
 * nothing here has to know what changed. What this does is throw away
 * everything measured in strings and frets — every position index, every
 * cached grip, every marker on screen — because none of it means the
 * same thing on a board of a different size, and then rebuild.
 */
function switchInstrument(id) {
  stopSound();
  setInstrument(id);

  // Anything holding a string or a fret is now nonsense.
  clearPath();
  visibleCells = null;
  gripEdit = null;
  ghostCells = new Set();
  currentBase = null;
  currentVoicing = null;
  voicingCache = { key: null, whole: null, shell: null };
  progressionCache = { key: null, chords: [] };
  posIndex = 0;
  winLo = 0;
  anchorFret = 0;
  cagedOn = false;
  activeBand = null;
  activeStops = null;

  // The board is rebuilt from scratch, so every marker on it is gone —
  // including the ones the diffing renderer thinks it still owns.
  liveNotes.clear();
  byPosition.clear();
  lineSegs = [];
  lineShown = false;

  drawBoard();
  const kind = fillKindMenu();
  fillMaterialMenu(kind);
  syncMasthead();
  syncCagedControls();
  render({ animate: false });
}

/** The header names what is under the hands. */
function syncMasthead() {
  const h1 = document.querySelector(".masthead h1");
  const sub = document.querySelector(".masthead p");
  if (h1) h1.textContent = instrument.name;
  if (sub) {
    sub.textContent = instrument.kinds
      .map(k => KIND_LABELS.find(([v]) => v === k)?.[1] ?? k)
      .join(" · ");
  }
  document.title = `Guitai — ${instrument.name}`;
}

/**
 * Load the second dropdown with scales or with arpeggios. Both are just
 * note sets to everything downstream, so switching between them needs no
 * more than a different menu.
 */
function fillMaterialMenu(kind) {
  const sel = document.getElementById("scale");
  sel.innerHTML = "";
  const groups = groupsFor(kind);
  Object.entries(groups).forEach(([group, names]) => {
    const og = document.createElement("optgroup");
    og.label = group;
    names.forEach(n => og.appendChild(new Option(n, n)));
    sel.appendChild(og);
  });
  sel.value = kind === "scale" ? MAJOR_SCALE : Object.values(groups)[0][0];
  document.getElementById("scaleLabel").textContent =
    kind === "arpeggio" ? "Arpeggio" : kind === "chord" ? "Chord"
    : kind === "progression" ? "Progression" : "Scale";
}

function initControls() {
  const instSel = document.getElementById("instrument");
  Object.values(INSTRUMENTS).forEach(i =>
    instSel.appendChild(new Option(i.name, i.id)));
  // The instrument itself was already mounted before the board's first
  // draw (see the bottom of this file), so this just names what's
  // already true rather than switching anything.
  instSel.value = instrument.id;
  instSel.addEventListener("change", e => {
    switchInstrument(e.target.value);
    saveSetting("instrument", e.target.value);
  });

  const rootSel = document.getElementById("root");
  rootOptions.forEach(n => rootSel.appendChild(new Option(n, n)));
  rootSel.value = rootOptions.includes(saved.root) ? saved.root : "G";

  document.getElementById("kind").value = saved.kind ?? "scale";
  const startKind = fillKindMenu();
  fillMaterialMenu(startKind);
  if (saved.scale) {
    const scaleSel = document.getElementById("scale");
    if ([...scaleSel.options].some(o => o.value === saved.scale)) scaleSel.value = saved.scale;
  }
  syncMasthead();

  // Switching between scales and arpeggios reloads the menu beneath it.
  document.getElementById("kind").addEventListener("change", e => {
    fillMaterialMenu(e.target.value);
    saveSetting("kind", e.target.value);
    saveSetting("scale", document.getElementById("scale").value);
    seekAnchor = true;
    clearPath();
    syncCagedControls();
    render();
  });

  // Changing the root or the quality holds the hand where it is and
  // shows what the new material looks like there. Any run is still
  // voided — its notes may not exist in the new scale.
  ["root", "scale"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => {
      saveSetting(id, document.getElementById(id).value);
      seekAnchor = true;
      clearPath();
      syncCagedControls();
      render();
    }));
  // Note names -> scale degrees -> nothing, and round again.
  const labelsBtn = document.getElementById("labelsBtn");
  const syncLabelsBtn = () => {
    const { text, hint } = LABEL_MODES[labelIndex];
    labelsBtn.textContent = text;
    labelsBtn.title = hint;
    // Hidden is the only one of the three that changes the board rather
    // than what it says, so it is the only one that reads as switched on.
    labelsBtn.classList.toggle("active", labelMode() === "none");
  };
  labelsBtn.addEventListener("click", () => {
    labelIndex = (labelIndex + 1) % LABEL_MODES.length;
    syncLabelsBtn();
    render();
  });
  syncLabelsBtn();

  // Following the machine holds only until you say otherwise: once the
  // button is pressed, that choice stands from then on, on every visit.
  let chosen = saved.theme != null;
  document.getElementById("themeBtn").addEventListener("click", () => {
    chosen = true;
    theme = theme === "night" ? "day" : "night";
    applyTheme();
    saveSetting("theme", theme);
  });
  prefersDay?.addEventListener?.("change", e => {
    if (chosen) return;
    theme = e.matches ? "day" : "night";
    applyTheme();
  });

  document.getElementById("cagedBtn").addEventListener("click", () => {
    cagedOn = !cagedOn;
    // Turning positions on frames the part of the neck already in view,
    // rather than throwing the hand back to the nut.
    seekAnchor = true;
    clearPath();
    syncCagedControls();
    render();
  });
  document.getElementById("ghostBtn").addEventListener("click", () => {
    ghostOn = !ghostOn;
    syncCagedControls();
    render();
  });
  document.getElementById("playBtn").addEventListener("click", () => {
    if (playerKind === "run") stopSound(); else playRun();
  });
  const bpm = document.getElementById("bpm");
  bpm.addEventListener("input", () => {
    document.getElementById("bpmLabel").textContent = bpm.value;
  });

  document.getElementById("strumBtn").addEventListener("click", () => {
    if (playerKind === "chord" || playerKind === "progression") stopSound();
    else if (isProgressionMode()) playProgressionThrough();
    else strumChord();
  });
  const spread = document.getElementById("spread");
  const showSpread = () => {
    const ms = Math.round(strumGap(Number(spread.value) / 100) * 1000);
    document.getElementById("spreadLabel").textContent = `${ms} ms`;
  };
  spread.addEventListener("input", showSpread);
  showSpread();

  document.getElementById("openBtn").addEventListener("click", () => {
    openOn = !openOn;
    posIndex = 0;   // a different set of grips — start at the top of it
    syncCagedControls();
    render();
  });


  document.getElementById("clearPath").addEventListener("click", () => {
    clearPath();
    skipAutoPath = true;      // leave the board empty for hand-picking
    render();
  });

  // Moving to another shape starts the run over.
  document.getElementById("prevPos").addEventListener("click", () => {
    if (posIndex > 0) { posIndex--; clearPath(); render(); }
  });
  document.getElementById("nextPos").addEventListener("click", () => {
    posIndex++; clearPath(); render();
  });

  // Arrow keys cycle shapes when position mode is on.
  document.addEventListener("keydown", e => {
    if (!cagedOn) return;
    if (document.activeElement && document.activeElement.tagName === "SELECT") return;
    if (e.key === "ArrowRight") { posIndex++; render(); }
    else if (e.key === "ArrowLeft") { if (posIndex > 0) { posIndex--; render(); } }
  });

  // Dragging is tracked on the document so the pointer can stray off the
  // note without the drag breaking.
  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  applyTheme();
  syncCagedControls();
  render();
}

// Mount whatever instrument was last chosen before the board's first
// draw, so it's sized right from the start instead of drawing as a
// guitar and immediately redrawing as something else.
if (saved.instrument && saved.instrument !== instrument.id && INSTRUMENTS[saved.instrument]) {
  setInstrument(saved.instrument);
}

drawBoard();
initControls();