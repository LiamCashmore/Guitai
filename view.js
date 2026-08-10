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
  tuning,
  numFrets,
  numStrings,
  chromaticGrid,
  buildScaleGrid,
  getPositions,
  getShapeGrid,
  supportsCaged,
  findPathThrough,
  pitchAt,
  chordVoicings,
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
const boardW = PAD_L + numFrets * FRET_W + PAD_R;
const boardH = PAD_T + (numStrings - 1) * STR_GAP + PAD_B;

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

// x-center of a note at a given fret (0 = open, sits left of the nut)
function fretX(f) {
  return f === 0 ? PAD_L - 34 : PAD_L + (f - 0.5) * FRET_W;
}
// y-center of a string (index 0 = low E -> drawn at the BOTTOM, high E on top)
function stringY(i) {
  return PAD_T + (numStrings - 1 - i) * STR_GAP;
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

// ---- Day and night ----------------------------------------
/**
 * The six bands hold up on either field, so the theme moves only the
 * chrome around them — and never the board, which stays ebony because a
 * fretboard is dark and inverting the one thing you are reading would
 * be a strange thing to do to it.
 *
 * The starting theme is whatever the machine already asked for. Nothing
 * is remembered between visits: this is a preference the operating
 * system already holds, and asking twice would be asking twice.
 */
const prefersDay = window.matchMedia?.("(prefers-color-scheme: light)");
let theme = prefersDay?.matches ? "day" : "night";

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
const WINDOW_WIDTH = 5;
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
let pathFrom   = null;   // { string, fret }
let pathTo     = null;
/**
 * Notes the run is held through, as { string, fret, locked }.
 *
 * Sliding a note pins it: the run follows, but the pin gives way once an
 * end is moved, since it was only ever a way of shaping this particular
 * run. Clicking a note locks it, and a lock is kept through everything —
 * move an end and the run is re-routed to keep visiting it, turning back
 * on itself if that is what it takes.
 */
let pathStops  = [];
let pathResult = null;   // { cells, cost } from findPathThrough
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
  svg.setAttribute("viewBox", `0 0 ${boardW} ${boardH}`);
  svg.setAttribute("width", boardW);
  svg.setAttribute("height", boardH);
  svg.innerHTML = "";

  const topY = stringY(numStrings - 1);
  const botY = stringY(0);

  // Wood
  svg.appendChild(el("rect", {
    x: PAD_L, y: topY - 18, width: numFrets * FRET_W, height: (botY - topY) + 36,
    rx: 6, fill: "var(--wood)", stroke: "var(--wood-edge)", "stroke-width": 2
  }));

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
      x1: x, y1: topY - 18, x2: x, y2: botY + 18,
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

  // Strings (thicker toward the low E at the bottom)
  chromaticGrid.forEach((_, i) => {
    const y = stringY(i);
    svg.appendChild(el("line", {
      x1: PAD_L, y1: y, x2: PAD_L + numFrets * FRET_W, y2: y,
      stroke: "var(--string)", "stroke-width": 1 + (numStrings - 1 - i) * 0.4
    }));
    // Sat exactly where the open-note marker goes, so the tuning shows
    // through when that note is out of the scale and is hidden beneath
    // the marker when it is in — the notes draw on top of the board.
    const lbl = el("text", {
      x: fretX(0), y: y + 4, "text-anchor": "middle",
      "font-size": 13, fill: "var(--muted)", "font-weight": 600,
    });
    lbl.textContent = tuning[i];
    svg.appendChild(lbl);
  });

  // Chord furniture: the barre, and crosses over strings left silent.
  chordLayer = el("g", { id: "chordLayer" });
  svg.appendChild(chordLayer);

  // The run's connecting line sits under the note markers.
  pathLayer = el("g", { id: "pathLayer" });
  pathLine = el("polyline", {
    points: "", fill: "none", "stroke-width": 3,
    "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0,
  });
  pathLayer.appendChild(pathLine);
  // The playhead: the same line again, drawn over the top and revealed
  // from the start as the run plays. Butt caps, so the growing end is a
  // clean edge rather than a bead — and so nothing shows at all before
  // the first note, where a round cap would leave a dot sitting on the
  // board.
  pathPlay = el("polyline", {
    class: "path-play", points: "", fill: "none", "stroke-width": 4,
    "stroke-linecap": "butt", "stroke-linejoin": "round", opacity: 0,
  });
  pathLayer.appendChild(pathPlay);
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
  const hi = Math.min(lo + WINDOW_WIDTH - 1, numFrets);
  return { ...bandEdges(lo, hi), hi };
};

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
      wanted.set(`${s}:${rank++}`, { cell, x: fretX(f), y: stringY(s), string: s, fret: f });
    });
  });

  // How each marker should look while a run is being built.
  const onPath = new Set(pathResult ? pathResult.cells.map(cellId) : []);
  const roleOf = (s, f) => {
    // A chord tone the grip doesn't use recedes, the same way notes off
    // the run do.
    if (ghostCells.has(`${s}:${f}`)) return "is-muted";
    if (!pathOn) return "";
    const id = `${s}:${f}`;
    if (pathFrom && cellId(pathFrom) === id) return "is-start";
    if (pathTo   && cellId(pathTo)   === id) return "is-target";
    const stop = pathStops.find(s => cellId(s) === id);
    if (stop) return stop.locked ? "is-locked" : "is-pinned";
    if (onPath.has(id)) return "is-path";
    return pathFrom ? "is-muted" : "";
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

const stopIndex = cell => pathStops.findIndex(s => cellId(s) === cellId(cell));
const isLocked  = cell => { const i = stopIndex(cell); return i >= 0 && pathStops[i].locked; };

/**
 * Work out the run for the notes currently chosen.
 *
 * Held notes become stops along the way, ordered by pitch in the
 * direction of travel. Nothing is discarded for sitting outside the two
 * ends — a stop beyond them just turns the run around there.
 *
 * If a set of stops genuinely can't be joined, one is let go and the
 * search retried: pins first, then the oldest locks last, so a
 * deliberate lock outlives an incidental pin.
 */
function recomputePath({ force = false } = {}) {
  // The run is about to change under it, so whatever is sounding is no
  // longer what's on screen.
  stopSound();
  if (!pathFrom || !pathTo) { pathResult = null; return; }
  const root = document.getElementById("root").value;
  const type = document.getElementById("scale").value;
  const bounds = cagedOn ? visibleCells : null;

  // A stop landing on an end is redundant.
  pathStops = pathStops.filter(s =>
    cellId(s) !== cellId(pathFrom) && cellId(s) !== cellId(pathTo));

  // If the run on screen already visits every stop and both ends, leave
  // it exactly as it is. Holding a note the run already passes through
  // asks for nothing new, and re-solving would reshuffle the rest of it
  // for no reason — each leg is optimised on its own, so a split can land
  // on a different route of equal cost.
  if (!force && pathResult) {
    const cells = pathResult.cells;
    const endsHold = cellId(cells[0]) === cellId(pathFrom) &&
                     cellId(cells[cells.length - 1]) === cellId(pathTo);
    const stopsHold = pathStops.every(s => cells.some(c => cellId(c) === cellId(s)));
    if (endsHold && stopsHold) return;
  }

  const ascending = pitchAt(pathTo) >= pitchAt(pathFrom);
  const inOrder = () => pathStops.slice().sort((a, b) =>
    ascending ? pitchAt(a) - pitchAt(b) : pitchAt(b) - pitchAt(a));

  while (true) {
    const found = findPathThrough(root, type, [pathFrom, ...inOrder(), pathTo], bounds);
    if (found) { pathResult = found; return; }
    if (pathStops.length === 0) { pathResult = null; return; }
    // Give up a pin before a lock.
    const loosest = pathStops.map((s, i) => [s, i]).filter(([s]) => !s.locked).pop()
                 ?? pathStops.map((s, i) => [s, i]).pop();
    pathStops.splice(loosest[1], 1);
  }
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
      const dx = fretX(f) - x, dy = stringY(s) - y;
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
    const gap = Math.abs(fretX(f) - x);
    if (gap < bestGap) { bestGap = gap; best = { string, fret: f }; }
  }
  return best;
}

/**
 * What can be dragged, and how, differs by role on purpose.
 *
 * The two ends set how far the run reaches, so they move freely across
 * the whole board. A locked note only decides which string one note is
 * played on, so it keeps to its own string — easier to steer, and the
 * notes on either side redistribute around it. Unlocked notes don't drag
 * at all; click one first to hold it.
 */
function beginDrag(evt, cell) {
  if (!pathOn || !pathFrom) return;
  const id = cellId(cell);

  let role = null;
  if (pathFrom && cellId(pathFrom) === id) role = "from";
  else if (pathTo && cellId(pathTo) === id) role = "to";
  else if (stopIndex(cell) >= 0) role = "via";
  else if (pathResult && pathResult.cells.some(c => cellId(c) === id)) role = "via";
  if (!role) return;

  drag = { role, string: cell.string, moved: false, held: null };
  if (role === "via") {
    // Sliding a note holds it. An existing stop keeps whatever standing
    // it had; a note taken straight off the run becomes a pin.
    const at = stopIndex(cell);
    drag.held = at >= 0 ? pathStops[at] : { ...cell, locked: false };
    if (at < 0) pathStops.push(drag.held);
  }
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
      const lo = Math.max(0, Math.min(numFrets - WINDOW_WIDTH + 1, fret));
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

  const current = drag.role === "from" ? pathFrom
                : drag.role === "to"   ? pathTo
                : drag.held;
  if (current && cellId(current) === cellId(cell)) return;   // still on it

  if (drag.role === "via") {
    const pitch = pitchAt(cell);
    // A stop must stay between the ends while it's only a pin; a lock is
    // free to go anywhere, and the run turns around to reach it.
    if (!drag.held.locked) {
      const lo = Math.min(pitchAt(pathFrom), pitchAt(pathTo));
      const hi = Math.max(pitchAt(pathFrom), pitchAt(pathTo));
      if (pitch <= lo || pitch >= hi) return;
    }
    // One stop per pitch: two would contradict each other.
    pathStops = pathStops.filter(s => s === drag.held || pitchAt(s) !== pitch);
    drag.held.string = cell.string;
    drag.held.fret   = cell.fret;
  } else {
    // Moving an end releases the pins, which existed only to shape the
    // run as it was. Locks are kept and the run re-routed to reach them.
    pathStops = pathStops.filter(s => s.locked);
    if (drag.role === "from") pathFrom = cell; else pathTo = cell;
  }

  drag.moved = true;
  skipAutoPath = true;
  recomputePath();
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
 * Clicking notes builds the run: the first pick is where it starts, the
 * second where it ends. A third click begins a new run from there.
 */
/**
 * Clicking a note along the run locks it where it stands; clicking it
 * again lets it go. Locking is deliberate, so nothing gets pinned by
 * accident — and a locked note can then be dragged along its string to
 * place it, with the rest of the run rearranging around it.
 *
 * The ends stay put once placed; drag them to move them. Double-click
 * anywhere starts over.
 */
function selectPathNote(cell) {
  if (!pathOn) return;
  const id = cellId(cell);

  const at = stopIndex(cell);
  if (at >= 0) {
    if (pathStops[at].locked) {
      pathStops.splice(at, 1);            // locked -> let it go entirely
      recomputePath({ force: true });     // freedom returns, so re-solve
    } else {
      pathStops[at].locked = true;        // pinned -> make it stick
    }
    render();
    return;
  }
  // Placed ends are fixed; only dragging moves them.
  if (pathFrom && cellId(pathFrom) === id) return;
  if (pathTo   && cellId(pathTo)   === id) return;

  // A note the run passes through -> lock it right here.
  if (pathResult && pathResult.cells.some(c => cellId(c) === id)) {
    pathStops.push({ ...cell, locked: true });
    recomputePath();
    render();
    return;
  }

  if (!pathFrom) {
    pathFrom = cell;
    skipAutoPath = true;                  // a pick of your own takes over
  } else if (!pathTo) {
    pathTo = cell;
    recomputePath();
  } else {
    return;                               // run is complete; leave it be
  }
  render();
}

/** Double-click anywhere: drop the run and begin again from that note. */
function restartPathAt(cell) {
  if (!pathOn) return;
  clearPath();
  pathFrom = cell;
  skipAutoPath = true;
  render();
}

function clearPath() {
  stopSound();
  pathFrom = null; pathTo = null; pathStops = []; pathResult = null;
  skipAutoPath = false;
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

  pathFrom = { string: lowest.string,  fret: lowest.fret };
  pathTo   = { string: highest.string, fret: highest.fret };
  pathStops = [];
  recomputePath();
}

// ---- The run's line ---------------------------------------
const LINE_OPACITY = 0.90;

let pathLine    = null;   // the <polyline>
let pathPlay    = null;   // the playhead drawn over it
let linePoints  = [];     // where it is drawn at this instant
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

/**
 * Draw the line joining the run, in playing order.
 *
 * Between positions it slides on the same curve and over the same time as
 * the notes it connects, so the two read as one movement. Appearing and
 * disappearing is left to a CSS opacity fade — a run arriving somewhere
 * new shouldn't skate across the neck to get there.
 *
 * While a note is being dragged the line tracks the pointer outright,
 * since easing there would only lag behind the hand.
 */
function renderPathLine({ animate = true } = {}) {
  if (lineAnim) { cancelAnimationFrame(lineAnim); lineAnim = null; }

  const target = (pathOn && pathResult)
    ? pathResult.cells.map(c => ({ x: fretX(c.fret), y: stringY(c.string) }))
    : [];

  // No run to show: fade out. The shape is left in place underneath so
  // nothing flickers through the fade.
  if (target.length === 0) {
    stopPlayhead();
    pathLine.setAttribute("opacity", 0);
    lineShown = false;
    return;
  }

  // Arriving from hidden, or sliding not wanted: place it outright and
  // let opacity carry it in.
  if (!animate || !lineShown || linePoints.length === 0 || !wantsMotion()) {
    linePoints = target;
    pathLine.setAttribute("points", asPoints(target));
    pathLine.setAttribute("opacity", LINE_OPACITY);
    lineShown = true;
    return;
  }

  const [start, end] = alignLines(linePoints, target);
  const t0 = performance.now();

  const step = now => {
    const k = Math.min(1, (now - t0) / SLIDE_MS);
    const e = ease(k);
    const at = start.map((p, i) => ({
      x: p.x + (end[i].x - p.x) * e,
      y: p.y + (end[i].y - p.y) * e,
    }));
    // Remember where the line actually is, so a move interrupted midway —
    // holding down the arrow key, say — carries on from here instead of
    // snapping back to where this one began.
    linePoints = at;
    pathLine.setAttribute("points", asPoints(at));
    if (k < 1) lineAnim = requestAnimationFrame(step);
    else {
      lineAnim = null;
      linePoints = target;
      pathLine.setAttribute("points", asPoints(target));
    }
  };
  lineAnim = requestAnimationFrame(step);
}

// ---- The playhead -----------------------------------------
/**
 * A line that travels the run as it plays, arriving at each note exactly
 * as that note sounds.
 *
 * The notes are evenly spaced in time, but the segments joining them are
 * not evenly spaced on the neck — a run crossing four frets to the next
 * note has further to travel than one moving to its neighbour, in the
 * same eighth note. So the line cannot advance at a constant speed along
 * its own length. It advances by note: the whole of segment k is covered
 * in the whole of note k's duration, whatever that segment's length,
 * which is what makes arrival and strike coincide instead of drifting
 * apart over a long run.
 *
 * Position comes from the audio clock rather than a wall clock, for the
 * same reason. The two run at slightly different rates, and half a beat
 * of accumulated drift is obvious when you can see it against the note
 * lighting up.
 */
let playAnim = null;

/** Distance along the line to each note, and the total. */
function noteDistances(points) {
  const at = [0];
  for (let i = 1; i < points.length; i++) {
    at.push(at[i - 1] + Math.hypot(points[i].x - points[i - 1].x,
                                   points[i].y - points[i - 1].y));
  }
  return { at, total: at[at.length - 1] };
}

function stopPlayhead() {
  if (playAnim) { cancelAnimationFrame(playAnim); playAnim = null; }
  if (pathPlay) pathPlay.setAttribute("opacity", 0);
}

/**
 * @param points   where each note sits, in playing order
 * @param startsAt when the first note lands, on the audio clock
 * @param gap      seconds between notes
 */
function startPlayhead(points, startsAt, gap) {
  stopPlayhead();
  if (!pathPlay || points.length < 2 || !gap) return;

  const { at, total } = noteDistances(points);
  if (total === 0) return;

  pathPlay.setAttribute("points", asPoints(points));
  // Drawn as one dash the length of the whole line, pushed out of sight
  // and then pulled back in — which is cheaper than rewriting the points
  // sixty times a second, and keeps the corners mitred as it grows.
  pathPlay.setAttribute("stroke-dasharray", `${total} ${total}`);
  pathPlay.setAttribute("stroke-dashoffset", total);
  pathPlay.setAttribute("opacity", 1);

  const last = points.length - 1;
  const step = () => {
    // Where we are in notes, not in pixels: 2.5 means halfway from the
    // third note to the fourth.
    let pos = (clock() - startsAt) / gap;
    pos = Math.min(last, Math.max(0, pos));
    // Asked for less movement: the line steps from note to note instead
    // of sliding between them, so it still says where the run is up to
    // without anything gliding.
    if (!wantsMotion()) pos = Math.floor(pos);

    const i = Math.min(last - 1, Math.floor(pos));
    const drawn = at[i] + (at[i + 1] - at[i]) * (pos - i);
    pathPlay.setAttribute("stroke-dashoffset", total - drawn);

    if (pos < last) playAnim = requestAnimationFrame(step);
    else playAnim = null;
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
      stopPlayhead();
      syncPlayButton();
    },
  });

  // Drawn against the same schedule the notes were scheduled on, so the
  // line and the sound are two readings of one clock rather than two
  // timers that happen to have been started together.
  startPlayhead(pathResult.cells.map(c => ({ x: fretX(c.fret), y: stringY(c.string) })),
                player.startsAt, player.gap);
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
    .sort((a, b) => a.string - b.string)     // string 0 is the low E
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
    .sort((a, b) => a.string - b.string)      // string 0 is the low E
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
    edited: true,
  };
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
    // Back into string order, which only moves the note just added — the
    // others were already in it, and the strum crosses the strings in
    // this order.
    cells.sort((a, b) => a.string - b.string);
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
let voicingCache = { key: null, list: null };
function voicingsFor(root, type, openAnywhere) {
  const key = `${root}|${type}|${openAnywhere}`;
  if (voicingCache.key !== key) {
    voicingCache = { key, list: chordVoicings(root, type, { stacked: false, openAnywhere }) };
  }
  return voicingCache.list;
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
    const from = stringY(barre.from), to = stringY(barre.to);
    chordLayer.appendChild(el("rect", {
      class: "barre",
      x: x - R, y: Math.min(from, to) - R,
      width: R * 2, height: Math.abs(to - from) + R * 2,
      rx: R, ry: R,
    }));
  }

  // Strings the grip leaves out, crossed through beyond the nut.
  for (let s = 0; s < numStrings; s++) {
    if (voicing.strings.includes(s)) continue;
    const y = stringY(s), x = PAD_L - 34, r = 5;
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
      winLo = Math.max(0, Math.min(numFrets - WINDOW_WIDTH + 1, anchorFret));
      seekAnchor = false;
    }
    const winHi = winLo + WINDOW_WIDTH - 1;

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
    if (activeBand) {
      const { x1, x2 } = bandEdges(activeBand.lo, activeBand.hi);
      const topY = stringY(numStrings - 1), botY = stringY(0);
      highlight.setAttribute("x", x1);
      highlight.setAttribute("width", x2 - x1);
      highlight.setAttribute("y", topY - 24);
      highlight.setAttribute("height", (botY - topY) + 48);
      highlight.setAttribute("opacity", 0.12);
    } else {
      highlight.setAttribute("opacity", 0);
    }
    renderWindowHandle();
    renderNotes(grid, mode);
    renderPathLine({ animate: false });

    const posLabel = document.getElementById("posLabel");
    if (posLabel) {
      posLabel.classList.remove("unplayable");
      if (!voicing) {
        posLabel.textContent = "no grips found for this progression";
      } else {
        // The numeral says what the chord is doing, the symbol says what
        // to call it, and the rest is what the hand has to do — which is
        // the whole reason these particular grips were chosen.
        const shape = voicing.shape ? ` · ${voicing.shape} shape` : "";
        const hand = voicing.barre ? " · barre"
          : voicing.cells.some(c => c.fret === 0) ? " · open" : "";
        posLabel.textContent =
          `${posIndex + 1}/${chords.length} · ${voicing.numeral} · ${voicing.symbol}` +
          shape + hand;
      }
    }
    const prevB = document.getElementById("prevPos");
    const nextB = document.getElementById("nextPos");
    if (prevB) prevB.disabled = posIndex <= 0;
    if (nextB) nextB.disabled = posIndex >= chords.length - 1;
    return;
  }

  if (isChordMode()) {
    // Coming from a scale, the window opens where the hand was left.
    if (seekAnchor) {
      winLo = Math.max(0, Math.min(numFrets - WINDOW_WIDTH + 1, anchorFret));
      seekAnchor = false;
    }
    const winHi = winLo + WINDOW_WIDTH - 1;
    // Full grips: every string sounds and notes may double, which is what
    // the open and barre shapes a guitarist actually plays are made of.
    let voicings = voicingsFor(root, type, openOn);
    // Keep only grips that fall inside the chosen stretch. With OPEN off,
    // an open string counts as fret 0 and so has to be inside it too —
    // the open shapes appear when the window reaches the nut and not
    // before, which is what makes the familiar chord for each part of the
    // neck show first. With OPEN on, an open string is exempt: it needs
    // no finger, so it can ring wherever the hand is.
    {
      const inWindow = voicings.filter(v => v.cells.every(c =>
        (openOn && c.fret === 0) || (c.fret >= winLo && c.fret <= winHi)));
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
      // An edit belongs to the grip it was made on. A different grip has
      // come up, so it no longer describes anything.
      if (gripEdit && gripEdit.sig !== voicingSig(voicing)) gripEdit = null;
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
    {
      const { x1, x2 } = bandEdges(activeBand.lo, activeBand.hi);
      const topY = stringY(numStrings - 1), botY = stringY(0);
      highlight.setAttribute("x", x1);
      highlight.setAttribute("width", x2 - x1);
      highlight.setAttribute("y", topY - 24);
      highlight.setAttribute("height", (botY - topY) + 48);
      highlight.setAttribute("opacity", 0.12);
    }
    renderWindowHandle();
    renderNotes(grid, mode);
    renderPathLine({ animate: false });

    const posLabel = document.getElementById("posLabel");
    if (posLabel) {
      if (!voicing) {
        // Full grips reach everywhere, so an empty window means stacking
        // is the constraint, not the neck.
        posLabel.textContent = `no grip fits frets ${winLo}–${winHi}`;
        posLabel.classList.remove("unplayable");
      } else {
        // The strings it uses, the frets it spans and the order of its
        // intervals are all on the board already — printing them again
        // just made the line long enough to stop being read. What is left
        // is what the board can't say: which of the shapes this is, and
        // what the hand has to do to hold it.
        const shape = voicing.shape ? ` · ${voicing.shape} shape` : "";
        const hand = voicing.barre ? " · barre"
          : voicing.cells.some(c => c.fret === 0) ? " · open" : "";
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
          `${posIndex + 1}/${voicings.length}${shape}${inv}${hand}` +
          (voicing.stretch ? " · stretch" : "");
      }
    }
    const prevB = document.getElementById("prevPos");
    const nextB = document.getElementById("nextPos");
    if (prevB && nextB) {
      prevB.disabled = posIndex === 0;
      nextB.disabled = posIndex >= voicings.length - 1;
    }
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
  if (span) {
    const { x1, x2 } = bandEdges(span.lo, span.hi);
    // First reveal jumps into place; later moves glide.
    if (highlight.getAttribute("opacity") === "0") {
      highlight.style.transition = "none";
      highlight.setAttribute("x", x1);
      highlight.setAttribute("width", x2 - x1);
      requestAnimationFrame(() => { highlight.style.transition = ""; });
    } else {
      highlight.setAttribute("x", x1);
      highlight.setAttribute("width", x2 - x1);
    }
    highlight.setAttribute("opacity", 0.12);
  } else {
    highlight.setAttribute("opacity", 0);
  }

  // 4) Remember what's on the board — a run may only use these notes.
  visibleCells = new Set();
  grid.forEach((row, s) => row.forEach((cell, f) => {
    if (cell) visibleCells.add(`${s}:${f}`);
  }));
  // A run drawn before the position moved may no longer be playable here.
  if (pathOn && pathFrom && !visibleCells.has(cellId(pathFrom))) clearPath();
  if (pathOn && pathTo && !visibleCells.has(cellId(pathTo))) { pathTo = null; pathStops = []; pathResult = null; }
  if (pathOn && pathStops.length) {
    const kept = pathStops.filter(s => visibleCells.has(cellId(s)));
    if (kept.length !== pathStops.length) { pathStops = kept; recomputePath({ force: true }); }
  }

  // Nothing picked yet, and a shape is on screen: trace all of it.
  if (pathOn && box && !pathFrom && !pathTo && !skipAutoPath) {
    autoPathForPosition(grid);
  }

  // 5) Move the notes, then trace the run over them.
  renderNotes(grid, mode);
  renderPathLine({ animate });
  renderWindowHandle();

  const pathLabel = document.getElementById("pathLabel");
  if (pathLabel) {
    if (!pathOn) pathLabel.textContent = "";
    else if (!pathFrom) pathLabel.textContent = "Click a note to start a run";
    else if (!pathTo) pathLabel.textContent = "Now click the note to finish on";
    else if (!pathResult) pathLabel.textContent = "No playable run between those two";
    // Once the run is on the board there is nothing to add: how many
    // notes it holds and how far it reaches are both plainly visible,
    // and the held notes say so themselves with their rings.
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
  const prev = document.getElementById("prevPos");
  const next = document.getElementById("nextPos");
  if (prev && next) {
    prev.disabled = !box || posIndex === 0;
    next.disabled = !box || posIndex >= boxCount - 1;
  }
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
  if (tone) tone.textContent = (chords || walk) ? "Chord tone" : "Scale tone";
  if (tip) {
    tip.textContent = walk
      ? "Step through the progression · the grips are chosen to keep the hand still"
      : chords
        ? (ghostOn ? "Click a note to silence it, or a faint one to play it instead"
                   : "Step through the grips, or drag the bar along the neck")
        : "Click two notes to trace a run · drag any note to reshape it";
  }

  // Strumming is a chord idea too. Leaving chord mode leaves no grip to
  // play, so the button has nothing to refer to.
  document.getElementById("strumField").style.display = (chords || walk) ? "flex" : "none";
  if (!chords) currentVoicing = null;
  syncStrumButton();
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
  const rootSel = document.getElementById("root");
  rootOptions.forEach(n => rootSel.appendChild(new Option(n, n)));
  rootSel.value = "G";

  fillMaterialMenu("scale");

  // Switching between scales and arpeggios reloads the menu beneath it.
  document.getElementById("kind").addEventListener("change", e => {
    fillMaterialMenu(e.target.value);
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
  // button is pressed, that choice stands for the rest of the session.
  let chosen = false;
  document.getElementById("themeBtn").addEventListener("click", () => {
    chosen = true;
    theme = theme === "night" ? "day" : "night";
    applyTheme();
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

drawBoard();
initControls();