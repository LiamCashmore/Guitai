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
  // view.js cycles the modes and lights the button only when the labels
  // are hidden. Reading a label is the ordinary state and hiding them is
  // the trick, so it reads better the other way round: names, degrees and
  // fingerings are on, nothing is off.
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

  // ---- Folding the choosers away (phone) ---------------------
  // A fretboard wants the screen. Once you have chosen what to look at,
  // the choosers can go, and the chevron in the masthead brings them
  // back.
  //
  // There used to be a line left behind saying which root and which
  // scale were on the board. It was the second place on the screen
  // saying so — the choosers themselves say it, in the menus you change
  // it with — and it cost the neck a row whichever way the fold was set,
  // since folded it was the summary and unfolded it was the choosers.
  // Folding now simply folds.
  const foldBtn = $("foldBtn");
  const whatPanel = $("whatPanel");

  function setFolded(folded) {
    if (!whatPanel || !foldBtn) return;
    whatPanel.toggleAttribute("hidden", folded);
    foldBtn.setAttribute("aria-expanded", String(!folded));
    foldBtn.classList.toggle("folded", folded);
    // Folded is a different mode of using the thing, not just the same
    // screen with a panel missing: the choosing is done and what is left
    // is playing. The stylesheet reads this to pull the masthead in —
    // see .choosers-folded in the phone block — so the neck gets the
    // room the wordmark was holding as well as the room the panel was.
    document.body.classList.toggle("choosers-folded", folded);
  }

  foldBtn?.addEventListener("click", () => setFolded(!whatPanel.hasAttribute("hidden")));

  // ============================================================
  // THE PHONE'S SHELL
  //
  // Same document, same controls, regrouped. Nothing below builds a
  // second Metronome button or a second Play: it picks the existing ones
  // up and puts them somewhere else, then puts them back. view.js goes
  // on holding them by id and never notices they moved — which is why
  // its display toggles, its labels and its disabled states all keep
  // working in the drawers exactly as they do in the cards.
  // ============================================================

  const phone = window.matchMedia("(max-width: 720px)");

  // Where each control lived before it was borrowed, so leaving the
  // phone layout puts the page back exactly as it was rather than
  // approximately as it was.
  const home = new Map();

  function borrow(host, selectors) {
    for (const sel of selectors) {
      const node = document.querySelector(sel);
      if (!node || !host) continue;
      if (!home.has(node)) home.set(node, { parent: node.parentNode, next: node.nextSibling });
      host.appendChild(node);
    }
  }

  function giveBack() {
    for (const [node, at] of home) at.parent.insertBefore(node, at.next);
    home.clear();
  }

  // Two buttons that belong together are wrapped so they sit side by
  // side in a drawer instead of stacking. The wrapper is ours, so it is
  // thrown away again when the controls go home.
  function pair(host, selectors) {
    const nodes = selectors.map(s => document.querySelector(s)).filter(Boolean);
    if (nodes.length < 2 || !host) return borrow(host, selectors);
    const row = document.createElement("div");
    row.className = "pair";
    row.dataset.uiPair = "1";
    host.appendChild(row);
    borrow(row, selectors);
  }

  function dropPairs() {
    document.querySelectorAll("[data-ui-pair]").forEach(row => row.remove());
  }

  // ---- The three drawers -------------------------------------
  const SHEETS = [
    { tab: "tabView",     sheet: "sheetView",     body: "sheetViewBody" },
    { tab: "tabPractice", sheet: "sheetPractice", body: "sheetPracticeBody" },
    { tab: "tabSetup",    sheet: "sheetSetup",    body: "sheetSetupBody" },
  ];

  // The neck is given the open drawer's room back, so nothing you are
  // reading ends up behind it. How much room that is, is however tall the
  // drawer actually came out: View holds four things and Setup holds a
  // peg per string, and a drawer grows while it is open — Pegs half
  // again — so it is measured rather than assumed. Guessing high is not
  // harmless: the padding is what the board scrolls into, and too much
  // of it lets you scroll the whole neck off the screen.
  function measureSheet() {
    const open = SHEETS.map(({ sheet }) => $(sheet))
      .find(el => el && !el.hasAttribute("hidden"));
    document.documentElement.style.setProperty(
      "--sheet-h", open ? `${Math.ceil(open.getBoundingClientRect().height)}px` : "0px");
  }

  if (window.ResizeObserver) {
    const watch = new ResizeObserver(measureSheet);
    SHEETS.forEach(({ sheet }) => { const el = $(sheet); if (el) watch.observe(el); });
  }

  function openSheet(which) {
    let any = false;
    SHEETS.forEach(({ tab, sheet }) => {
      const on = sheet === which;
      $(sheet)?.toggleAttribute("hidden", !on);
      $(tab)?.classList.toggle("active", on);
      $(tab)?.setAttribute("aria-expanded", String(on));
      if (on) any = true;
    });
    measureSheet();
    document.body.classList.toggle("sheet-open", any);
  }

  const closeSheets = () => openSheet(null);

  // ---- Two things to play at once ----------------------------
  // view.js shows the run's controls where there is a run and the
  // strum's where there is a grip, and a progression can have both. Four
  // controls will not sit on one line under a thumb, so the bar is told
  // when it is carrying both and the stylesheet drops the two that are
  // adjustments rather than actions.
  const primary = $("tabbarPrimary");
  const showing = el => !!el && getComputedStyle(el).display !== "none";

  function syncPrimary() {
    primary?.classList.toggle(
      "crowded", showing($("runControls")) && showing($("strumField")));
  }

  ["runControls", "strumField"].forEach(id => {
    const el = $(id);
    if (el) new MutationObserver(syncPrimary)
      .observe(el, { attributes: true, attributeFilter: ["style", "class"] });
  });
  syncPrimary();

  SHEETS.forEach(({ tab, sheet }) => {
    $(tab)?.addEventListener("click", () => {
      openSheet($(sheet)?.hasAttribute("hidden") ? sheet : null);
    });
  });
  document.querySelectorAll(".sheet-close")
    .forEach(btn => btn.addEventListener("click", closeSheets));

  // ---- Moving in and out -------------------------------------
  // The hidden menus behind the chips become the real controls here, so
  // they stop being hidden from assistive technology as well as from
  // sight — and go back to being a backing store on the way out.
  function exposeMenus(on) {
    [["kind", "Type"], ["root", "Root"]].forEach(([id, name]) => {
      const sel = $(id);
      if (!sel) return;
      sel.classList.toggle("visually-hidden", !on);
      if (on) {
        sel.removeAttribute("aria-hidden");
        sel.removeAttribute("tabindex");
        sel.setAttribute("aria-label", name);
      } else {
        sel.setAttribute("aria-hidden", "true");
        sel.setAttribute("tabindex", "-1");
        sel.removeAttribute("aria-label");
      }
    });
  }

  let onPhone = null;

  function layout() {
    const want = phone.matches;
    if (want === onPhone) return;
    onPhone = want;

    if (want) {
      exposeMenus(true);

      // What the markers say, what else is on the board, and what the
      // colours mean — everything about looking at it rather than
      // playing it.
      // Positions and Capo come off the strip over the neck and into the
      // choosers, where the rest of "what am I looking at" already is.
      // The strip is one line and never more than one — see .board-tools
      // in the phone block of styles.css — so those two buttons were
      // costing the position readout most of its room, and the readout
      // is the half of that strip you actually read while playing.
      borrow($("handRow"), ["#cagedBtn", "#capoBtn"]);

      borrow($("sheetViewBody"), ["#labelsBtn"]);
      pair($("sheetViewBody"), ["#ghostField", "#openField", "#shellField"]);
      borrow($("sheetViewBody"), ["#progEdit", ".board-foot .legend"]);

      // Tempo, and the bar it is counted in.
      borrow($("sheetPracticeBody"),
        ["#metroBtn", ".panel-practice .slider-wide", "#beatReadout", "#practiceExtra",
         // The strum's speed is a tempo like the metronome's, and it is
         // set once and left. Under the thumb it was competing with the
         // button it belongs to for a line that only fits one of them.
         "#strumSpeed"]);

      // Which instrument — at the head of the choosers, since it is the
      // one answer the rest of them hang off.
      borrow($("instrumentRow"), [".masthead .select-compact"]);

      // How it is tuned. Setup keeps the tuning and the pegs: that is
      // work done to an instrument, not a choice about which to look at.
      borrow($("sheetSetupBody"), [".panel-setup .field", "#tuningEdit"]);

      // Playing the board is the bar's whole job, so whichever of these
      // view.js has decided is showing takes the wide slot.
      borrow($("tabbarPrimary"), ["#runControls", "#strumField"]);

      $("sheets")?.removeAttribute("hidden");
      $("tabbar")?.removeAttribute("hidden");
    } else {
      closeSheets();
      $("sheets")?.setAttribute("hidden", "");
      $("tabbar")?.setAttribute("hidden", "");
      exposeMenus(false);
      giveBack();
      dropPairs();
    }
  }

  layout();
  phone.addEventListener("change", layout);

  // The menus are filled by view.js after this file runs, so the chips
  // are brought up to date once everything is in place.
  requestAnimationFrame(() => {
    syncKind?.();
    syncRoot?.();
  });
})();
