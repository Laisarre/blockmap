// DOM chrome: palettes, legend, sprite list, popovers, modal. Dynamic lists
// use event delegation (one listener on the stable parent container) rather
// than a per-row listener recreated on every refresh, so repeated UI
// rebuilds never accumulate listeners/closures.

import { usedPaletteEntries } from "./legend.js";

// ---------------------------------------------------------------- popover

const popoverLayer = document.getElementById("popover-layer");
let activePopover = null;
let activeAnchor = null;

export function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
    activeAnchor = null;
  }
}

/**
 * anchor: an HTMLElement (positioned below it) or {x,y} screen coords.
 * buildFn(body, close) fills in the popover's content.
 */
export function openPopover(anchor, buildFn) {
  const sameAnchor = activeAnchor === anchor;
  closePopover();
  if (sameAnchor) return; // clicking the same anchor again just closes it

  const popover = document.createElement("div");
  popover.className = "popover";
  const body = document.createElement("div");
  body.className = "popover-body";
  popover.appendChild(body);
  popoverLayer.appendChild(popover);

  let x, y;
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom + 4;
  } else {
    ({ x, y } = anchor);
  }
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;

  activePopover = popover;
  activeAnchor = anchor;
  const close = () => closePopover();
  buildFn(body, close);

  // Keep it on screen.
  requestAnimationFrame(() => {
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth) popover.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    if (rect.bottom > window.innerHeight) popover.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePopover();
});
document.addEventListener("mousedown", (e) => {
  if (activePopover && !activePopover.contains(e.target) && e.target !== activeAnchor) {
    // Clicking elsewhere closes the popover, same as the desktop app losing focus —
    // but don't swallow the click that's opening a *different* popover/anchor.
    if (!(e.target.closest && e.target.closest("[data-popover-anchor]"))) closePopover();
  }
});

export function popoverStepperRow(parent, label, value, onChange, { min = 1, max = 60 } = {}) {
  const row = document.createElement("div");
  row.className = "row";
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("change", () => {
    const v = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
    input.value = String(v);
    onChange(v);
  });
  row.append(span, input);
  parent.appendChild(row);
  return input;
}

export function popoverButtons(parent, { applyLabel = "Apply", onApply, onCancel, singleLabel }) {
  const row = document.createElement("div");
  row.className = "popover-buttons";
  if (singleLabel) {
    const btn = document.createElement("button");
    btn.textContent = singleLabel;
    btn.addEventListener("click", onCancel);
    row.appendChild(btn);
  } else {
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", onCancel);
    const apply = document.createElement("button");
    apply.textContent = applyLabel;
    apply.addEventListener("click", onApply);
    row.append(cancel, apply);
  }
  parent.appendChild(row);
}

// ------------------------------------------------------------------ modal

const modalLayer = document.getElementById("modal-layer");

export function showModal(buildFn) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  backdrop.appendChild(modal);
  const close = () => backdrop.remove();
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  buildFn(modal, close);
  modalLayer.appendChild(backdrop);
  return close;
}

// ---------------------------------------------------------------- palette

/**
 * Renders a swatch list into `container` for `palette` (array of
 * {color,name}), highlighting `selectedColor`. Click handling is delegated
 * once to `container` itself via `container.dataset.delegated`.
 */
export function renderSwatchList(container, palette, selectedColor, onSelect) {
  container.replaceChildren();
  palette.forEach((entry, idx) => {
    const row = document.createElement("div");
    row.className = "swatch-row" + (entry.color === selectedColor ? " selected" : "");
    row.dataset.index = String(idx);
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = entry.color;
    const label = document.createElement("span");
    label.textContent = entry.name;
    row.append(swatch, label);
    container.appendChild(row);
  });
  if (!container.dataset.delegated) {
    container.dataset.delegated = "1";
    container.addEventListener("click", (e) => {
      const row = e.target.closest(".swatch-row");
      if (!row) return;
      const idx = parseInt(row.dataset.index, 10);
      container._onSelect?.(idx);
    });
  }
  container._onSelect = onSelect;
}

// ----------------------------------------------------------------- legend

export function renderLegend(container, state) {
  container.replaceChildren();
  const layer = state.activeLayer;
  const palette = layer === "zone" ? state.zonePalette : state.settingPalette;
  const counts = state.counts[layer];

  for (const entry of palette) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const swatch = document.createElement("div");
    swatch.className = "legend-swatch";
    swatch.style.background = entry.color;
    const label = document.createElement("span");
    label.textContent = `${entry.name}: ${counts.get(entry.color) || 0}`;
    row.append(swatch, label);
    container.appendChild(row);
  }

  const total = state.rows * state.cols;
  const painted = [...counts.values()].reduce((a, b) => a + b, 0);
  const unpaintedRow = document.createElement("div");
  unpaintedRow.className = "legend-row legend-muted";
  unpaintedRow.textContent = `Unpainted: ${total - painted}`;
  container.appendChild(unpaintedRow);
  const totalRow = document.createElement("div");
  totalRow.className = "legend-row legend-muted";
  totalRow.textContent = `Total cells: ${total}`;
  container.appendChild(totalRow);

  const arrowEntries = state.usedArrowPaletteEntries();
  if (arrowEntries.length) {
    const heading = document.createElement("div");
    heading.className = "legend-heading";
    heading.textContent = "Arrows";
    container.appendChild(heading);
    for (const entry of arrowEntries) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("div");
      swatch.className = "legend-swatch";
      swatch.style.background = entry.color;
      const label = document.createElement("span");
      label.textContent = `${entry.name}: ${entry.count}`;
      row.append(swatch, label);
      container.appendChild(row);
    }
  }
}

// ----------------------------------------------------------- sprite list

export function renderSpriteList(container, sprites, selectedId, onSelect, onRemove) {
  container.replaceChildren();
  sprites.forEach((sp) => {
    const row = document.createElement("div");
    row.className = "sprite-row" + (sp.id === selectedId ? " selected" : "");
    row.dataset.id = String(sp.id);
    const img = document.createElement("img");
    img.src = sp.dataUrl;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = sp.name;
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "✕";
    removeBtn.dataset.action = "remove";
    row.append(img, name, removeBtn);
    container.appendChild(row);
  });
  if (!container.dataset.delegated) {
    container.dataset.delegated = "1";
    container.addEventListener("click", (e) => {
      const row = e.target.closest(".sprite-row");
      if (!row) return;
      const id = parseInt(row.dataset.id, 10);
      if (e.target.dataset.action === "remove") container._onRemove?.(id);
      else container._onSelect?.(id);
    });
  }
  container._onSelect = onSelect;
  container._onRemove = onRemove;
}
