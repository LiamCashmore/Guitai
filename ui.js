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
    t.textContent = "tap to change";
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
  summary?.addEventListener("click", () => setFolded(false));
  ["root", "scale", "kind"].forEach(id => $(id)?.addEventListener("change", () => {
    if (summary && !summary.hasAttribute("hidden")) paintSummary();
  }));

  // The menus are filled by view.js after this file runs, so the chips
  // and the summary are brought up to date once everything is in place.
  requestAnimationFrame(() => {
    syncKind?.();
    syncRoot?.();
    paintSummary();
  });
})();
