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
} from "./music.js";

// ---- Visual config ----------------------------------------
const markerFrets = [3, 5, 7, 9, 15, 17];   // single inlay dots
const doubleMarker = 12;

const PAD_L = 70, PAD_T = 44, PAD_R = 30, PAD_B = 24;
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

// ---- View state -------------------------------------------
let cagedOn  = false;
let posIndex = 0;

// Path mode: pick a note to start on, then one to finish on.
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
// Showing a position with PATH on traces the whole shape by default.
// Clearing puts that aside so notes can be picked by hand instead.
let skipAutoPath = false;

// Live SVG layers, built once.
let noteLayer = null;
let pathLayer = null;
let highlight = null;
// key -> { group, circle, label }  for notes currently on screen
const liveNotes = new Map();

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
    svg.appendChild(el("circle", { cx: PAD_L + (f - 0.5) * FRET_W, cy: midY, r: 6, fill: "#d8bd90" }));
  });
  [-1, 1].forEach(off => {
    svg.appendChild(el("circle", {
      cx: PAD_L + (doubleMarker - 0.5) * FRET_W, cy: midY + off * STR_GAP, r: 6, fill: "#d8bd90"
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
        "text-anchor": "middle", "font-size": 12, fill: "#888" });
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
      "font-size": 13, fill: "#666", "font-weight": 600,
    });
    lbl.textContent = tuning[i];
    svg.appendChild(lbl);
  });

  // The run's connecting line sits under the note markers.
  pathLayer = el("g", { id: "pathLayer" });
  pathLine = el("polyline", {
    points: "", fill: "none", stroke: "var(--root)", "stroke-width": 3,
    "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0,
  });
  pathLayer.appendChild(pathLine);
  svg.appendChild(pathLayer);

  noteLayer = el("g", { id: "noteLayer" });
  svg.appendChild(noteLayer);
}

// ============================================================
// NOTES  (diffed against what is already on screen)
// ============================================================

function makeNote() {
  const group  = el("g", { class: "note" });
  const circle = el("circle", { class: "note-circle", cx: 0, cy: 0, r: R,
                                stroke: "#fff", "stroke-width": 2 });
  const label  = el("text", { class: "note-label", x: 0, y: 4,
                              "text-anchor": "middle", "font-weight": 700, fill: "#fff" });
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
    if (!pathOn) return "";
    const id = `${s}:${f}`;
    if (pathFrom && cellId(pathFrom) === id) return "is-start";
    if (pathTo   && cellId(pathTo)   === id) return "is-target";
    const stop = pathStops.find(s => cellId(s) === id);
    if (stop) return stop.locked ? "is-locked" : "is-pinned";
    if (onPath.has(id)) return "is-path";
    return pathFrom ? "is-muted" : "";
  };

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
        if (rec.pos) selectPathNote(rec.pos);
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
    rec.group.setAttribute("class", `note ${roleOf(want.string, want.fret)}`.trim());
    // A brand-new marker is placed without transition so it fades in
    // where it belongs instead of flying in from the corner.
    if (isNew) rec.group.style.transition = "none";
    rec.group.style.transform = `translate(${want.x}px, ${want.y}px)`;

    const text = mode === "degree" ? want.cell.degree : want.cell.name;
    rec.label.textContent = text;
    rec.label.setAttribute("font-size", text.length > 2 ? 10 : 12);
    rec.circle.setAttribute("fill", want.cell.isRoot ? "var(--root)" : "var(--note)");

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
  pathFrom = null; pathTo = null; pathStops = []; pathResult = null;
  skipAutoPath = false;
}

/**
 * With a position on screen, PATH starts by tracing the whole shape —
 * its lowest note up to its highest — since that is the run the position
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
let pathLine    = null;   // the <polyline>
let linePoints  = [];     // where it is drawn right now
let lineAnim    = null;   // in-flight animation handle

const asPoints = pts => pts.map(p => `${p.x},${p.y}`).join(" ");

// Line up two point lists so they can be blended. The shorter run holds
// its last point, so the line grows or retracts from its far end rather
// than every point scrambling at once.
function padTo(points, length) {
  if (points.length >= length) return points.slice(0, length);
  const last = points[points.length - 1];
  return points.concat(Array.from({ length: length - points.length }, () => ({ ...last })));
}

/**
 * Draw the line joining the run, in playing order. Between positions it
 * slides on the same curve as the notes; while a note is being dragged
 * it tracks the pointer directly, with no easing to lag behind.
 */
function renderPathLine({ animate = true } = {}) {
  if (!pathLine) {
    pathLine = el("polyline", {
      fill: "none", stroke: "var(--root)", "stroke-width": 3,
      "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0,
    });
    pathLayer.appendChild(pathLine);
  }
  if (lineAnim) { cancelAnimationFrame(lineAnim); lineAnim = null; }

  const target = (pathOn && pathResult)
    ? pathResult.cells.map(c => ({ x: fretX(c.fret), y: stringY(c.string) }))
    : [];

  if (target.length === 0) {
    pathLine.setAttribute("opacity", 0);
    linePoints = [];
    return;
  }
  pathLine.setAttribute("opacity", 0.55);

  // Nothing to slide from, or sliding not wanted: place it outright.
  if (!animate || linePoints.length === 0) {
    linePoints = target;
    pathLine.setAttribute("points", asPoints(target));
    return;
  }

  const span = Math.max(linePoints.length, target.length);
  const start = padTo(linePoints, span);
  const end   = padTo(target, span);
  const t0 = performance.now();

  const step = now => {
    const k = Math.min(1, (now - t0) / SLIDE_MS);
    const e = ease(k);
    const at = start.map((p, i) => ({
      x: p.x + (end[i].x - p.x) * e,
      y: p.y + (end[i].y - p.y) * e,
    }));
    pathLine.setAttribute("points", asPoints(at));
    if (k < 1) lineAnim = requestAnimationFrame(step);
    else { lineAnim = null; linePoints = target; pathLine.setAttribute("points", asPoints(target)); }
  };
  lineAnim = requestAnimationFrame(step);
}

// ============================================================
// RENDER
// ============================================================

function render({ animate = true } = {}) {
  const root = document.getElementById("root").value;
  const type = document.getElementById("scale").value;
  const mode = document.getElementById("labels").value;

  // 1) Build the scale's own grid.
  let grid = buildScaleGrid(root, type);

  // 2) If position mode is active, reduce the grid to the current box.
  //    CAGED shapes for the natural modes, searched positions otherwise.
  //    With PATH also on, the run is confined to whatever this box holds.
  let box = null, boxCount = 0;
  if (cagedOn) {
    const found = getPositions(root, type);
    boxCount = found.boxes.length;
    if (boxCount > 0) {
      posIndex = Math.max(0, Math.min(posIndex, boxCount - 1));
      box = found.boxes[posIndex];
      grid = getShapeGrid(root, type, box);
    }
  }

  // 3) Slide the highlight to the frets in play.
  const span = box ? playedSpan(grid, box) : null;
  if (span) {
    const x1 = span.lo === 0 ? PAD_L - 52 : PAD_L + (span.lo - 1) * FRET_W;
    const x2 = PAD_L + span.hi * FRET_W;
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

  const pathLabel = document.getElementById("pathLabel");
  if (pathLabel) {
    if (!pathOn) pathLabel.textContent = "";
    else if (!pathFrom) pathLabel.textContent = "click a note to start";
    else if (!pathTo) pathLabel.textContent = "now click the note to reach";
    else if (!pathResult) pathLabel.textContent = "no playable run between those";
    else {
      const frets = pathResult.cells.map(c => c.fret);
      const locked = pathStops.filter(s => s.locked).length;
      const pinned = pathStops.length - locked;
      const held = (locked ? ` · ${locked} locked` : "") +
                   (pinned ? ` · ${pinned} pinned` : "");
      pathLabel.textContent =
        `${pathResult.cells.length} notes · frets ${Math.min(...frets)}–${Math.max(...frets)}${held}`;
    }
  }

  // 5) Readout + arrow availability.
  const posLabel = document.getElementById("posLabel");
  if (posLabel) {
    if (!box) {
      posLabel.textContent = cagedOn ? "no playable position found" : "";
    } else {
      const shape = box.shape ? `${box.shape} shape · ` : "";
      const lo = span ? span.lo : box.lo;
      const hi = span ? span.hi : box.hi;
      posLabel.textContent =
        `${posIndex + 1}/${boxCount} · ${shape}frets ${lo}–${hi}`;
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
// CAGED for the natural modes, POSITION for everything else.
function syncCagedControls() {
  const type  = document.getElementById("scale").value;
  const caged = supportsCaged(type);
  const name  = caged ? "CAGED" : "POSITION";
  const btn   = document.getElementById("cagedBtn");
  const nav   = document.getElementById("cagedNav");

  btn.title = caged
    ? "Show one CAGED shape at a time"
    : "CAGED doesn't apply to this scale — showing playable hand positions";
  btn.classList.toggle("active", cagedOn);
  btn.textContent = cagedOn ? `${name}: on` : name;
  nav.style.display = cagedOn ? "flex" : "none";

  const pathBtn = document.getElementById("pathBtn");
  const pathNav = document.getElementById("pathNav");
  pathBtn.classList.toggle("active", pathOn);
  pathBtn.textContent = pathOn ? "PATH: on" : "PATH";
  pathBtn.title = cagedOn
    ? "Trace a run inside the position on screen"
    : "Pick a starting note and a target note to build a run";
  pathNav.style.display = pathOn ? "flex" : "none";
  document.getElementById("board").classList.toggle("picking", pathOn);
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
  sel.value = kind === "arpeggio"
    ? Object.values(groups)[0][0]      // first triad
    : MAJOR_SCALE;
  document.getElementById("scaleLabel").textContent =
    kind === "arpeggio" ? "Arpeggio" : "Scale";
}

function initControls() {
  const rootSel = document.getElementById("root");
  rootOptions.forEach(n => rootSel.appendChild(new Option(n, n)));
  rootSel.value = "G";

  fillMaterialMenu("scale");

  // Switching between scales and arpeggios reloads the menu beneath it.
  document.getElementById("kind").addEventListener("change", e => {
    fillMaterialMenu(e.target.value);
    posIndex = 0;
    clearPath();
    syncCagedControls();
    render();
  });

  // Changing root or scale restarts at the lowest shape, and voids any
  // run — its notes may not exist in the new scale.
  ["root", "scale"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => {
      posIndex = 0;
      clearPath();
      syncCagedControls();
      render();
    }));
  document.getElementById("labels").addEventListener("change", render);

  document.getElementById("cagedBtn").addEventListener("click", () => {
    cagedOn = !cagedOn;
    posIndex = 0;
    clearPath();
    syncCagedControls();
    render();
  });
  document.getElementById("pathBtn").addEventListener("click", () => {
    pathOn = !pathOn;
    clearPath();
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

  syncCagedControls();
  render();
}

drawBoard();
initControls();