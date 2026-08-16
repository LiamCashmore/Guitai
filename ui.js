/* ============================================================
   ui.js — chrome only.

   Everything here reads or drives controls that view.js already owns:
   the chips set the menus below them and let view.js react as it always
   did, the folds move nothing but their own panels. The board, the
   fretboard maths and the audio are untouched — nothing in this file
   knows a string from a fret.
   ============================================================ */

(() => {
  const $ = id => document.getElementById(id);

  // ---- Chips over a menu ------------------------------------
  // The menu stays the one place the choice lives; the chips are a way
  // of reaching it without opening a dropdown. Rebuilt whenever the menu
  // is refilled, since an instrument can change what is on offer.
  function chipsFor(select, host, className) {
    if (!select || !host) return;

    const build = () => {
      host.textContent = "";
      [...select.options].forEach(opt => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = className;
        b.textContent = opt.textContent;
        b.dataset.value = opt.value;
        b.setAttribute("aria-pressed", String(opt.value === select.value));
        b.addEventListener("click", () => {
          if (select.value === opt.value) return;
          select.value = opt.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        host.appendChild(b);
      });
    };

    const sync = () => {
      [...host.children].forEach(b => {
        const on = b.dataset.value === select.value;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    };

    build();
    sync();
    select.addEventListener("change", sync);
    // view.js refills these menus when the instrument changes.
    new MutationObserver(() => { build(); sync(); })
      .observe(select, { childList: true });
    return sync;
  }

  const syncKind = chipsFor($("kind"), $("kindChips"), "btn chip");
  const syncRoot = chipsFor($("root"), $("rootChips"), "btn chip chip-root");

  // ---- Labels ------------------------------------------------
  // view.js cycles the three modes and lights the button only when the
  // labels are hidden. Reading a label is the ordinary state and hiding
  // them is the trick, so it reads better the other way round: names and
  // degrees are on, nothing is off.
  const labelsBtn = $("labelsBtn");
  if (labelsBtn) {
    const sync = () => {
      const on = labelsBtn.textContent.trim() !== "Hidden";
      if (labelsBtn.classList.contains("active") !== on) labelsBtn.classList.toggle("active", on);
    };
    sync();
    new MutationObserver(sync).observe(labelsBtn, {
      childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"],
    });
  }

  // ---- One name for the position stepper ---------------------
  // CAGED, Voicings, Positions and Chords are four names for the same
  // control. It steps hand-positions whatever is on the board, so it
  // says so. (view.js still sets the tooltip, which is where the
  // difference between them belongs.)
  const cagedBtn = $("cagedBtn");
  if (cagedBtn) {
    const sync = () => {
      if (cagedBtn.textContent.trim() !== "Positions") cagedBtn.textContent = "Positions";
    };
    sync();
    new MutationObserver(sync).observe(cagedBtn, { childList: true, characterData: true, subtree: true });
  }

  // ---- String numbers on the pegs ----------------------------
  // Low string first, counted the way a player counts them: 6 down to 1.
  const pegs = $("pegs");
  if (pegs) {
    const number = () => {
      const rows = [...pegs.querySelectorAll(".peg")];
      rows.forEach((peg, i) => {
        let tag = peg.querySelector(".peg-num");
        if (!tag) {
          tag = document.createElement("span");
          tag.className = "peg-num";
          peg.insertBefore(tag, peg.firstChild);
        }
        tag.textContent = String(rows.length - i);
      });
    };
    number();
    new MutationObserver(number).observe(pegs, { childList: true });
  }

  // ---- Drawers -----------------------------------------------
  function drawer(btn, panel, { onOpen } = {}) {
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const open = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !open);
      btn.classList.toggle("active", open);
      btn.setAttribute("aria-expanded", String(open));
      if (open && onOpen) onOpen();
    });
  }

  drawer($("setupBtn"), $("setupPanel"));

  const practiceMore = $("practiceMore");
  const practiceExtra = $("practiceExtra");
  if (practiceMore && practiceExtra) {
    practiceMore.addEventListener("click", () => {
      const open = practiceExtra.hasAttribute("hidden");
      practiceExtra.toggleAttribute("hidden", !open);
      practiceMore.setAttribute("aria-expanded", String(open));
      practiceMore.textContent = open ? "Fewer" : "Bar, count-in, loop";
    });
  }

  // ---- Folding the choosers away (phone) ---------------------
  // A fretboard wants the screen. Once you have chosen what to look at,
  // the choosers can go, leaving one line that says what is on the board
  // and puts them back when tapped.
  const foldBtn = $("foldBtn");
  const whatPanel = $("whatPanel");
  const summary = $("foldSummary");

  function describe() {
    const root = $("root");
    const scale = $("scale");
    if (!root || !scale) return "";
    const rootText = root.value || "";
    const scaleText = scale.options[scale.selectedIndex]?.textContent ?? "";
    return `${rootText}||${scaleText}`;
  }

  function paintSummary() {
    if (!summary) return;
    const [root, scale] = describe().split("||");
    summary.innerHTML = "";
    const r = document.createElement("span");
    r.className = "fold-root";
    r.textContent = root;
    const s = document.createElement("span");
    s.className = "fold-scale";
    s.textContent = scale;
    const t = document.createElement("span");
    t.className = "fold-tap readout";
    // On a phone this line is the title of the screen, so it says what it
    // is with a chevron rather than a sentence.
    t.textContent = isPhone() ? "⌄" : "tap to change";
    summary.append(r, s, t);
  }

  function setFolded(folded) {
    if (!whatPanel || !summary || !foldBtn) return;
    whatPanel.toggleAttribute("hidden", folded);
    summary.toggleAttribute("hidden", !folded);
    foldBtn.setAttribute("aria-expanded", String(!folded));
    foldBtn.classList.toggle("folded", folded);
    if (folded) paintSummary();
  }

  foldBtn?.addEventListener("click", () => setFolded(!whatPanel.hasAttribute("hidden")));
  summary?.addEventListener("click", () => {
    if (isPhone()) openSheet($("sheetWhat"));
    else setFolded(false);
  });
  ["root", "scale", "kind"].forEach(id => $(id)?.addEventListener("change", () => {
    if (summary && !summary.hasAttribute("hidden")) paintSummary();
  }));

  /* ============================================================
     PHONE — the neck stood on end, everything else in a sheet

     Two things happen below 720px, and only there.

     The neck is turned a quarter turn: the SVG is rotated by CSS and the
     box around it given the height that rotation occupies. Nothing in
     view.js is told about it — the board is drawn exactly as it always
     was, and pointer coordinates come back through getScreenCTM, which
     already accounts for the turn. So the capo still drags, the position
     bar still slides, notes are still picked, and all of it now happens
     down the screen instead of across it.

     Everything that isn't the neck is MOVED — not copied — into one of
     four sheets behind the bar at the bottom, and moved back when the
     window grows. There is still one #playBtn, one #capoBtn, one of
     everything, held by the same listeners view.js bound to them.
     ============================================================ */

  const phoneQuery = window.matchMedia("(max-width: 720px)");
  function isPhone() { return document.body.classList.contains("phone"); }

  // Where a moved node came from, so it can go back exactly there.
  const homes = new Map();
  function park(node, host, before = null) {
    if (!node || !host) return;
    if (!homes.has(node)) homes.set(node, { parent: node.parentNode, next: node.nextSibling });
    host.insertBefore(node, before);
  }
  function unpark(node) {
    const home = homes.get(node);
    if (!home) return;
    home.parent.insertBefore(node, home.next);
    homes.delete(node);
  }

  // ---- The sheets ---------------------------------------------
  const scrim = $("scrim");
  let openedSheet = null;

  function closeSheet() {
    if (!openedSheet) return;
    openedSheet.setAttribute("hidden", "");
    openedSheet = null;
    scrim?.setAttribute("hidden", "");
    syncTabs();
  }

  function openSheet(sheet) {
    if (!sheet) return;
    if (openedSheet === sheet) { closeSheet(); return; }
    if (openedSheet) openedSheet.setAttribute("hidden", "");
    openedSheet = sheet;
    sheet.removeAttribute("hidden");
    scrim?.removeAttribute("hidden");
    sheet.querySelector(".sheet-body").scrollTop = 0;
    syncTabs();
  }

  scrim?.addEventListener("click", closeSheet);
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  const tabbar = $("tabbar");
  const sheetTabs = [...document.querySelectorAll(".tab[data-sheet]")];
  sheetTabs.forEach(tab => tab.addEventListener("click", () => openSheet($(tab.dataset.sheet))));

  function syncTabs() {
    sheetTabs.forEach(tab => {
      tab.classList.toggle("active", openedSheet === $(tab.dataset.sheet));
    });
  }

  // ---- Play, in the bar ----------------------------------------
  // A proxy rather than the button itself: which button it stands for
  // changes with what is on the neck — a run is played, a chord is
  // strummed — and view.js shows and hides those two as it decides.
  const tabPlay = $("tabPlay");
  const tabPlayName = $("tabPlayName");

  function liveSound() {
    // The inline display view.js sets, not the computed one — these live
    // inside a sheet, and a closed sheet computes everything to none.
    const strum = $("strumField"), run = $("pathNav");
    if (strum && strum.style.display !== "none") return $("strumBtn");
    if (run && run.style.display !== "none") return $("playBtn");
    return null;
  }

  function syncPlay() {
    if (!tabPlay || !isPhone()) return;
    const src = liveSound();
    tabPlay.disabled = !src || src.disabled;
    tabPlayName.textContent = src ? src.textContent.trim() : "Play";
  }

  tabPlay?.addEventListener("click", () => {
    const src = liveSound();
    if (src && !src.disabled) src.click();
    // The label flips to Stop the moment it is pressed.
    requestAnimationFrame(syncPlay);
  });

  // ---- Labels, in the bar --------------------------------------
  const tabLabels = $("tabLabels");
  const tabLabelsName = $("tabLabelsName");
  const LABEL_SHORT = { "Note names": "Names", "Scale degrees": "Degrees", "Hidden": "Off" };

  function syncLabelTab() {
    if (!tabLabels || !labelsBtn) return;
    const text = labelsBtn.textContent.trim();
    tabLabelsName.textContent = LABEL_SHORT[text] ?? text;
    tabLabels.classList.toggle("active", text !== "Hidden");
  }
  tabLabels?.addEventListener("click", () => labelsBtn?.click());

  // ---- The neck, turned --------------------------------------
  const boardWrap = $("boardWrap");
  const boardRot  = $("boardRot");
  const board     = $("board");
  let boardScale  = 1;

  function layoutBoard() {
    if (!board || !boardRot || !boardWrap) return;
    if (!isPhone()) {
      board.style.transform = "";
      boardRot.style.height = "";
      return;
    }
    // view.js sets these to the board's own size in board units.
    const w = parseFloat(board.getAttribute("width"));
    const h = parseFloat(board.getAttribute("height"));
    if (!w || !h) return;

    // Across the screen goes the board's height — the strings. Held
    // between limits: squeezed too far the strings are closer than a
    // fingertip, and stretched too far the neck is wider than the phone.
    boardScale = Math.max(0.75, Math.min(1.6, boardWrap.clientWidth / h));
    // Clockwise, so the nut lands at the top and the low string on the
    // left — a chord chart, and the view a player has of their own hand.
    board.style.transform =
      `translateX(${h * boardScale}px) rotate(90deg) scale(${boardScale})`;
    boardRot.style.height = `${w * boardScale}px`;
  }

  /**
   * Keep the stretch of neck being shown on the screen.
   *
   * A phone holds five or six frets at a time, so stepping to a position
   * eight frets up would otherwise move the notes somewhere you cannot
   * see. The band under the notes is the thing to follow — it is exactly
   * what the position is — and it is only scrolled to when it has
   * actually gone off the edge, so ordinary play never moves the neck.
   */
  function followBand() {
    if (!isPhone() || !boardWrap) return;
    const band = document.getElementById("posHighlight");
    if (!band || band.getAttribute("opacity") === "0") return;
    const x = parseFloat(band.getAttribute("x"));
    const w = parseFloat(band.getAttribute("width"));
    if (!isFinite(x) || !w) return;

    const top = x * boardScale, bottom = (x + w) * boardScale;
    const seen = boardWrap.clientHeight;
    if (top >= boardWrap.scrollTop + 12 && bottom <= boardWrap.scrollTop + seen - 12) return;
    boardWrap.scrollTo({
      top: Math.max(0, (top + bottom) / 2 - seen / 2),
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The board is rebuilt outright when the instrument changes — a
  // different number of strings is a different size of board — so the
  // turn is measured again, and the band watched again, whenever it is.
  let bandWatch = null;
  function watchBand() {
    bandWatch?.disconnect();
    const band = document.getElementById("posHighlight");
    if (!band) return;
    bandWatch = new MutationObserver(() => followBand());
    bandWatch.observe(band, { attributes: true, attributeFilter: ["x", "width", "opacity"] });
  }
  if (board) {
    new MutationObserver(() => { layoutBoard(); watchBand(); })
      .observe(board, { childList: true, attributes: true, attributeFilter: ["width", "height"] });
  }

  // ---- Moving in, and back out --------------------------------
  let instrumentBox = null;
  function instrumentField() {
    if (!instrumentBox) {
      instrumentBox = document.createElement("div");
      instrumentBox.className = "field wide setup-field";
      const label = document.createElement("label");
      label.setAttribute("for", "instrument");
      label.textContent = "Instrument";
      instrumentBox.appendChild(label);
    }
    $("bodySetup")?.prepend(instrumentBox);
    return instrumentBox;
  }

  function enterPhone() {
    document.body.classList.add("phone");

    // The title line goes up beside the mark and becomes the chooser.
    park(summary, document.querySelector(".masthead"), document.querySelector(".masthead-tools"));
    summary?.removeAttribute("hidden");
    whatPanel?.removeAttribute("hidden");

    park(whatPanel, $("bodyWhat"));
    park(document.querySelector(".board-tools"), $("bodyView"));
    park(document.querySelector(".board-foot"), $("bodyView"));
    park(document.querySelector(".panel-practice"), $("bodyPractice"));
    // The instrument menu loses the masthead it was labelled by, so it is
    // given one of its own down here.
    park(document.querySelector(".masthead-tools .select-compact"), instrumentField());
    park($("setupPanel"), $("bodySetup"));
    // Setup is a sheet of its own now, so its drawer is always open
    // inside it — there is nothing left for it to fold away from.
    $("setupPanel")?.removeAttribute("hidden");

    tabbar?.removeAttribute("hidden");
    paintSummary();
    syncPlay();
    syncLabelTab();
    requestAnimationFrame(() => { layoutBoard(); watchBand(); });
  }

  function exitPhone() {
    closeSheet();
    document.body.classList.remove("phone");
    tabbar?.setAttribute("hidden", "");

    [...homes.keys()].forEach(unpark);
    instrumentBox?.remove();
    // Back to how the desktop leaves them: setup folded, the choosers open.
    $("setupPanel")?.setAttribute("hidden", "");
    $("setupBtn")?.classList.remove("active");
    $("setupBtn")?.setAttribute("aria-expanded", "false");
    summary?.setAttribute("hidden", "");
    whatPanel?.removeAttribute("hidden");
    foldBtn?.setAttribute("aria-expanded", "true");
    foldBtn?.classList.remove("folded");
    layoutBoard();
  }

  function applyWidth() {
    if (phoneQuery.matches === isPhone()) { layoutBoard(); return; }
    phoneQuery.matches ? enterPhone() : exitPhone();
  }

  phoneQuery.addEventListener("change", applyWidth);
  window.addEventListener("resize", layoutBoard);
  window.addEventListener("orientationchange", () => setTimeout(layoutBoard, 200));

  // What the bar stands for changes as view.js changes the board.
  ["pathNav", "strumField", "playBtn", "strumBtn"].forEach(id => {
    const node = $(id);
    if (!node) return;
    new MutationObserver(syncPlay).observe(node, {
      attributes: true, childList: true, characterData: true, subtree: true,
    });
  });
  if (labelsBtn) {
    new MutationObserver(syncLabelTab).observe(labelsBtn, {
      childList: true, characterData: true, subtree: true,
    });
  }

  // The menus are filled by view.js after this file runs, so the chips
  // and the summary are brought up to date once everything is in place.
  requestAnimationFrame(() => {
    syncKind?.();
    syncRoot?.();
    applyWidth();
    paintSummary();
  });
})();
