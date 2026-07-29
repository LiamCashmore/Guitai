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
  scaleGroups,
  MAJOR_SCALE,
  tuning,
  numFrets,
  numStrings,
  chromaticGrid,
  buildScaleGrid,
  getPositions,
  getShapeGrid,
  supportsCaged,
} from "./music.js";

// ---- Visual config ----------------------------------------
const markerFrets = [3, 5, 7, 9, 15, 17];   // single inlay dots
const doubleMarker = 12;

const PAD_L = 70, PAD_T = 44, PAD_R = 30, PAD_B = 24;
const FRET_W = 62, STR_GAP = 46, R = 15; // note-circle radius
const boardW = PAD_L + numFrets * FRET_W + PAD_R;
const boardH = PAD_T + (numStrings - 1) * STR_GAP + PAD_B;

const FADE_MS = 240;   // must match the opacity transition in styles.css

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

// Live SVG layers, built once.
let noteLayer = null;
let highlight = null;
// key -> { group, circle, label }  for notes currently on screen
const liveNotes = new Map();

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
    const lbl = el("text", { x: PAD_L - 52, y: y + 4, "font-size": 13, fill: "#666", "font-weight": 600 });
    lbl.textContent = tuning[i];
    svg.appendChild(lbl);
  });

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
      wanted.set(`${s}:${rank++}`, { cell, x: fretX(f), y: stringY(s) });
    });
  });

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
      noteLayer.appendChild(rec.group);
      liveNotes.set(key, rec);
    }
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
// RENDER
// ============================================================

function render() {
  const root = document.getElementById("root").value;
  const type = document.getElementById("scale").value;
  const mode = document.getElementById("labels").value;

  // 1) Build the scale's own grid.
  let grid = buildScaleGrid(root, type);

  // 2) If position mode is active, reduce the grid to the current box.
  //    CAGED shapes for the natural modes, searched positions otherwise.
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

  // 4) Move the notes.
  renderNotes(grid, mode);

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
}

function initControls() {
  const rootSel = document.getElementById("root");
  rootOptions.forEach(n => rootSel.appendChild(new Option(n, n)));
  rootSel.value = "G";

  const scaleSel = document.getElementById("scale");
  Object.entries(scaleGroups).forEach(([group, names]) => {
    const og = document.createElement("optgroup");
    og.label = group;
    names.forEach(n => og.appendChild(new Option(n, n)));
    scaleSel.appendChild(og);
  });
  scaleSel.value = MAJOR_SCALE;

  // Changing root or scale restarts at the lowest shape.
  ["root", "scale"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => {
      posIndex = 0;
      syncCagedControls();
      render();
    }));
  document.getElementById("labels").addEventListener("change", render);

  document.getElementById("cagedBtn").addEventListener("click", () => {
    cagedOn = !cagedOn;
    posIndex = 0;
    syncCagedControls();
    render();
  });
  document.getElementById("prevPos").addEventListener("click", () => {
    if (posIndex > 0) { posIndex--; render(); }
  });
  document.getElementById("nextPos").addEventListener("click", () => {
    posIndex++; render();
  });

  // Arrow keys cycle shapes when position mode is on.
  document.addEventListener("keydown", e => {
    if (!cagedOn) return;
    if (document.activeElement && document.activeElement.tagName === "SELECT") return;
    if (e.key === "ArrowRight") { posIndex++; render(); }
    else if (e.key === "ArrowLeft") { if (posIndex > 0) { posIndex--; render(); } }
  });

  syncCagedControls();
  render();
}

drawBoard();
initControls();