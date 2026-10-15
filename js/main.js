// Bootstrap + canvas interaction state machine + wiring. This is the one
// module allowed to know about both app state AND the DOM/canvas at once;
// everything else (state.js, render.js, export.js, persistence.js, ui.js)
// stays decoupled so it's independently testable.

import { HANDLE_SIZE, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, STAIR_DIRECTIONS, STAIR_DIRECTION_LABELS, GRID_MIN, GRID_MAX } from "./constants.js";
import { cellCenter, worldToCell } from "./geometry.js";
import { AppState, Sprite, Note, ArrowShape, allocId } from "./state.js";
import { Stair } from "./stairs.js";
import { drawScene, loadSpriteImage } from "./render.js";
import { exportAllPngs, renderPreviewCanvas } from "./export.js";
import { downloadProjectJson, readProjectFile, scheduleAutosave, loadAutosave, clearAutosave } from "./persistence.js";
import {
  openPopover,
  closePopover,
  popoverStepperRow,
  popoverButtons,
  showModal,
  renderSwatchList,
  renderLegend,
  renderSpriteList,
} from "./ui.js";

let state = loadAutosave() ?? new AppState();

// ------------------------------------------------------------ canvas setup

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const canvasWrap = canvas.parentElement;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  markDirty();
}

// ------------------------------------------------------- dirty-gated redraw

let frameScheduled = false;
function markDirty() {
  if (frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(() => {
    frameScheduled = false;
    renderFrame();
  });
}

function worldToScreen(wx, wy) {
  return [wx * state.zoom + state.panX, wy * state.zoom + state.panY];
}
function screenToWorld(sx, sy) {
  return [(sx - state.panX) / state.zoom, (sy - state.panY) / state.zoom];
}
function pixelToCell(px, py) {
  const [wx, wy] = screenToWorld(px, py);
  return worldToCell(wx, wy, state.originX, state.originY);
}

function renderFrame() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  drawScene(ctx, state, {
    transform: worldToScreen,
    scale: state.zoom,
    layer: state.activeLayer,
    includeGrid: true,
    includeMarkers: true,
  });
  drawSelectionOverlay();
  const label = document.getElementById("zoom-label");
  if (label) label.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
}

function requestSave() {
  scheduleAutosave(state);
}

// --------------------------------------------------------------- selection

let selectedSprite = null;
let selectedNote = null;
let selectedArrow = null;
let selectedStair = null;

function deselectAll() {
  selectedSprite = null;
  selectedNote = null;
  selectedArrow = null;
  selectedStair = null;
}

function drawSelectionOverlay() {
  const r = HANDLE_SIZE / 2;
  if (selectedSprite) {
    const [sx, sy] = worldToScreen(selectedSprite.x, selectedSprite.y);
    const w = selectedSprite.w * state.zoom;
    const h = selectedSprite.h * state.zoom;
    ctx.save();
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = "#2d6cdf";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx, sy, w, h);
    ctx.restore();
    ctx.fillStyle = "#2d6cdf";
    ctx.fillRect(sx + w - r, sy + h - r, r * 2, r * 2);
  }
  if (selectedArrow) {
    for (const [wx, wy] of [
      [selectedArrow.x1, selectedArrow.y1],
      [selectedArrow.x2, selectedArrow.y2],
    ]) {
      const [sx, sy] = worldToScreen(wx, wy);
      ctx.fillStyle = "#2d6cdf";
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
  }
  if (selectedStair) {
    const [r0, r1, c0, c1] = selectedStair.cellRange();
    const corners = [
      [r0, c0],
      [r0, c1],
      [r1, c1],
      [r1, c0],
    ];
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#2d6cdf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach(([rr, cc], i) => {
      const [wx, wy] = cellCenter(rr, cc, state.originX, state.originY);
      const [sx, sy] = worldToScreen(wx, wy);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  if (drag && drag.mode === "draw_arrow") {
    const [sx1, sy1] = worldToScreen(drag.x1, drag.y1);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(drag.cx, drag.cy);
    ctx.stroke();
    ctx.restore();
  }
}

// ----------------------------------------------------------------- hit-tests

function nearPoint(px, py, x, y, radius) {
  return (px - x) ** 2 + (py - y) ** 2 <= radius ** 2;
}
function pointNearSegment(px, py, x1, y1, x2, y2, tol) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return nearPoint(px, py, x1, y1, tol);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return (px - nx) ** 2 + (py - ny) ** 2 <= tol ** 2;
}

function hitSprite(cx, cy) {
  for (let i = state.sprites.length - 1; i >= 0; i--) {
    const sp = state.sprites[i];
    const [sx, sy] = worldToScreen(sp.x, sp.y);
    const w = sp.w * state.zoom;
    const h = sp.h * state.zoom;
    const r = HANDLE_SIZE;
    if (nearPoint(cx, cy, sx + w, sy + h, r)) return { sprite: sp, part: "resize" };
    if (cx >= sx && cx <= sx + w && cy >= sy && cy <= sy + h) return { sprite: sp, part: "move" };
  }
  return null;
}

function hitNote(cx, cy) {
  const ctx2 = ctx;
  ctx2.font = '13px "Segoe UI", sans-serif';
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const note = state.notes[i];
    const [sx, sy] = worldToScreen(note.x, note.y);
    const lines = note.text.split("\n");
    const lineH = 13 * 1.25;
    const textW = Math.max(...lines.map((l) => ctx2.measureText(l).width));
    const textH = lines.length * lineH;
    const pad = 6;
    const x0 = sx + 6 - pad;
    const y0 = sy + 6 - pad;
    const x1 = x0 + textW + pad * 2;
    const y1 = y0 + textH + pad * 2;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return note;
  }
  return null;
}

function hitArrow(cx, cy) {
  const r = HANDLE_SIZE;
  for (let i = state.arrows.length - 1; i >= 0; i--) {
    const arrow = state.arrows[i];
    const [sx1, sy1] = worldToScreen(arrow.x1, arrow.y1);
    const [sx2, sy2] = worldToScreen(arrow.x2, arrow.y2);
    if (nearPoint(cx, cy, sx1, sy1, r)) return { arrow, part: "endpoint1" };
    if (nearPoint(cx, cy, sx2, sy2, r)) return { arrow, part: "endpoint2" };
    if (pointNearSegment(cx, cy, sx1, sy1, sx2, sy2, 6)) return { arrow, part: "move" };
  }
  return null;
}

function hitStair(cx, cy) {
  const [row, col] = pixelToCell(cx, cy);
  for (let i = state.stairs.length - 1; i >= 0; i--) {
    if (state.stairs[i].containsCell(row, col)) return state.stairs[i];
  }
  return null;
}

// --------------------------------------------------------------- dragging

let drag = null; // { mode, ...modeSpecificFields }
let lastPaintedCell = null;
let lastHeightCell = null;

function paintAt(cx, cy, erasing) {
  const [row, col] = pixelToCell(cx, cy);
  if (!state.inBounds(row, col)) return;
  const key = `${row},${col}`;
  if (lastPaintedCell === key) return;
  lastPaintedCell = key;
  const newColor = erasing ? null : state.currentColor[state.activeLayer];
  if (state.setCellColor(row, col, state.activeLayer, newColor)) markDirty();
}

function stampHeightAt(cx, cy) {
  const [row, col] = pixelToCell(cx, cy);
  if (!state.inBounds(row, col)) return;
  const key = `${row},${col}`;
  if (lastHeightCell === key) return;
  lastHeightCell = key;
  if (state.heightApplyToZone) {
    const fill = state.floodFillZone(row, col, state.activeLayer);
    if (fill) for (const [r, c] of fill.cells) state.setCellHeight(r, c, state.brushHeight);
    else state.setCellHeight(row, col, state.brushHeight);
  } else {
    state.setCellHeight(row, col, state.brushHeight);
  }
  markDirty();
}

function startZoneDrag(row, col, layer) {
  const fill = state.floodFillZone(row, col, layer);
  if (!fill) return null;
  const shape = fill.cells.map(([r, c]) => [r - row, c - col]);
  return { layer, color: fill.color, shape, startRow: row, startCol: col, lastDr: 0, lastDc: 0 };
}

function applyZoneShift(zd, dr, dc) {
  const oldCells = new Set(zd.shape.map(([rr, cc]) => `${zd.startRow + rr + zd.lastDr},${zd.startCol + cc + zd.lastDc}`));
  const newCells = new Set(zd.shape.map(([rr, cc]) => `${zd.startRow + rr + dr},${zd.startCol + cc + dc}`));
  for (const key of oldCells) {
    if (!newCells.has(key)) {
      const [r, c] = key.split(",").map(Number);
      state.setCellColor(r, c, zd.layer, null);
    }
  }
  for (const key of newCells) {
    const [r, c] = key.split(",").map(Number);
    if (state.inBounds(r, c)) state.setCellColor(r, c, zd.layer, zd.color);
  }
  zd.lastDr = dr;
  zd.lastDc = dc;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  if (e.button === 1) {
    // middle mouse: pan
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
    return;
  }
  if (e.button !== 0) return;

  const tool = state.tool;
  if (tool === "place_sprite") {
    const [wx, wy] = screenToWorld(cx, cy);
    placeSprite(state.pendingSpritePath, wx, wy);
    state.tool = "select";
    syncToolRadios();
    return;
  }

  if (tool === "paint" || tool === "erase") {
    canvas.setPointerCapture(e.pointerId);
    lastPaintedCell = null;
    drag = { mode: tool };
    paintAt(cx, cy, tool === "erase");
    return;
  }

  if (tool === "height") {
    canvas.setPointerCapture(e.pointerId);
    lastHeightCell = null;
    drag = { mode: "height" };
    stampHeightAt(cx, cy);
    return;
  }

  if (tool === "note") {
    const [wx, wy] = screenToWorld(cx, cy);
    const text = window.prompt("Note text:", "");
    if (text) {
      state.notes.push(new Note({ id: allocId(), x: wx, y: wy, text }));
      markDirty();
      requestSave();
    }
    state.tool = "select";
    syncToolRadios();
    return;
  }

  if (tool === "arrow") {
    canvas.setPointerCapture(e.pointerId);
    const [wx, wy] = screenToWorld(cx, cy);
    drag = { mode: "draw_arrow", x1: wx, y1: wy, cx, cy };
    return;
  }

  if (tool === "stair") {
    const [row, col] = pixelToCell(cx, cy);
    if (state.inBounds(row, col)) {
      state.stairs.push(new Stair(row, col, state.stairWidth, state.stairLength, state.stairHeight, state.stairDirection));
      markDirty();
      requestSave();
    }
    return;
  }

  if (tool === "select") {
    const sHit = hitSprite(cx, cy);
    if (sHit) {
      deselectAll();
      selectedSprite = sHit.sprite;
      canvas.setPointerCapture(e.pointerId);
      const [wx, wy] = screenToWorld(cx, cy);
      drag = sHit.part === "resize" ? { mode: "sprite_resize", sprite: sHit.sprite } : { mode: "sprite_move", sprite: sHit.sprite, startX: wx, startY: wy, origX: sHit.sprite.x, origY: sHit.sprite.y };
      markDirty();
      return;
    }
    const nHit = hitNote(cx, cy);
    if (nHit) {
      deselectAll();
      selectedNote = nHit;
      canvas.setPointerCapture(e.pointerId);
      const [wx, wy] = screenToWorld(cx, cy);
      drag = { mode: "note_move", note: nHit, startX: wx, startY: wy, origX: nHit.x, origY: nHit.y };
      markDirty();
      return;
    }
    const aHit = hitArrow(cx, cy);
    if (aHit) {
      deselectAll();
      selectedArrow = aHit.arrow;
      canvas.setPointerCapture(e.pointerId);
      const [wx, wy] = screenToWorld(cx, cy);
      drag = { mode: `arrow_${aHit.part}`, arrow: aHit.arrow, startX: wx, startY: wy, orig: { x1: aHit.arrow.x1, y1: aHit.arrow.y1, x2: aHit.arrow.x2, y2: aHit.arrow.y2 } };
      markDirty();
      return;
    }
    const stHit = hitStair(cx, cy);
    if (stHit) {
      deselectAll();
      selectedStair = stHit;
      canvas.setPointerCapture(e.pointerId);
      const [row, col] = pixelToCell(cx, cy);
      drag = { mode: "stair_move", stair: stHit, startRow: row, startCol: col, origRow: stHit.row, origCol: stHit.col };
      markDirty();
      return;
    }
    const [row, col] = pixelToCell(cx, cy);
    if (state.inBounds(row, col) && state.getCell(row, col)[state.activeLayer]) {
      const zd = startZoneDrag(row, col, state.activeLayer);
      if (zd) {
        canvas.setPointerCapture(e.pointerId);
        drag = { mode: "zone_move", zd };
        return;
      }
    }
    deselectAll();
    markDirty();
  }
});

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  if (!drag) return;

  switch (drag.mode) {
    case "pan": {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      state.panX += dx;
      state.panY += dy;
      markDirty();
      break;
    }
    case "paint":
      paintAt(cx, cy, false);
      break;
    case "erase":
      paintAt(cx, cy, true);
      break;
    case "height":
      stampHeightAt(cx, cy);
      break;
    case "draw_arrow":
      drag.cx = cx;
      drag.cy = cy;
      markDirty();
      break;
    case "sprite_move": {
      const [wx, wy] = screenToWorld(cx, cy);
      drag.sprite.x = drag.origX + (wx - drag.startX);
      drag.sprite.y = drag.origY + (wy - drag.startY);
      markDirty();
      break;
    }
    case "sprite_resize": {
      const [wx, wy] = screenToWorld(cx, cy);
      drag.sprite.w = Math.max(10, wx - drag.sprite.x);
      drag.sprite.h = Math.max(10, wy - drag.sprite.y);
      markDirty();
      break;
    }
    case "note_move": {
      const [wx, wy] = screenToWorld(cx, cy);
      drag.note.x = drag.origX + (wx - drag.startX);
      drag.note.y = drag.origY + (wy - drag.startY);
      markDirty();
      break;
    }
    case "arrow_endpoint1": {
      const [wx, wy] = screenToWorld(cx, cy);
      drag.arrow.x1 = wx;
      drag.arrow.y1 = wy;
      markDirty();
      break;
    }
    case "arrow_endpoint2": {
      const [wx, wy] = screenToWorld(cx, cy);
      drag.arrow.x2 = wx;
      drag.arrow.y2 = wy;
      markDirty();
      break;
    }
    case "arrow_move": {
      const [wx, wy] = screenToWorld(cx, cy);
      const dx = wx - drag.startX;
      const dy = wy - drag.startY;
      drag.arrow.x1 = drag.orig.x1 + dx;
      drag.arrow.y1 = drag.orig.y1 + dy;
      drag.arrow.x2 = drag.orig.x2 + dx;
      drag.arrow.y2 = drag.orig.y2 + dy;
      markDirty();
      break;
    }
    case "stair_move": {
      const [row, col] = pixelToCell(cx, cy);
      const dr = row - drag.startRow;
      const dc = col - drag.startCol;
      drag.stair.row = drag.origRow + dr;
      drag.stair.col = drag.origCol + dc;
      markDirty();
      break;
    }
    case "zone_move": {
      const [row, col] = pixelToCell(cx, cy);
      const dr = row - drag.zd.startRow;
      const dc = col - drag.zd.startCol;
      if (dr !== drag.zd.lastDr || dc !== drag.zd.lastDc) {
        applyZoneShift(drag.zd, dr, dc);
        markDirty();
      }
      break;
    }
  }
});

function finishDrag(e) {
  if (!drag) return;
  const mode = drag.mode;
  if (mode === "draw_arrow") {
    const [wx1, wy1] = [drag.x1, drag.y1];
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [wx2, wy2] = screenToWorld(cx, cy);
    if (Math.abs(wx2 - wx1) >= 4 || Math.abs(wy2 - wy1) >= 4) {
      state.arrows.push(new ArrowShape({ id: allocId(), x1: wx1, y1: wy1, x2: wx2, y2: wy2, color: state.currentArrowColor }));
      requestSave();
    }
  } else if (["paint", "erase", "zone_move"].includes(mode)) {
    renderLegend(document.getElementById("legend"), state);
    requestSave();
  } else if (["sprite_move", "sprite_resize", "note_move", "arrow_move", "arrow_endpoint1", "arrow_endpoint2", "stair_move"].includes(mode)) {
    requestSave();
  } else if (mode === "height") {
    renderLegend(document.getElementById("legend"), state);
    requestSave();
  }
  drag = null;
  markDirty();
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);

canvas.addEventListener("dblclick", (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const note = hitNote(cx, cy);
  if (note) {
    const text = window.prompt("Edit note:", note.text);
    if (text === null) return;
    if (text === "") {
      state.notes = state.notes.filter((n) => n !== note);
      selectedNote = null;
    } else {
      note.text = text;
    }
    markDirty();
    requestSave();
    return;
  }
  const aHit = hitArrow(cx, cy);
  if (aHit) {
    showArrowTypePopover(aHit.arrow, { x: e.clientX, y: e.clientY });
    return;
  }
  const stair = hitStair(cx, cy);
  if (stair) {
    showStairSettingsPopover(stair, { x: e.clientX, y: e.clientY });
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const sHit = hitSprite(cx, cy);
  if (sHit) {
    state.sprites = state.sprites.filter((s) => s !== sHit.sprite);
    if (selectedSprite === sHit.sprite) selectedSprite = null;
    markDirty();
    requestSave();
    return;
  }
  const note = hitNote(cx, cy);
  if (note) {
    state.notes = state.notes.filter((n) => n !== note);
    if (selectedNote === note) selectedNote = null;
    markDirty();
    requestSave();
    return;
  }
  const aHit = hitArrow(cx, cy);
  if (aHit) {
    state.arrows = state.arrows.filter((a) => a !== aHit.arrow);
    if (selectedArrow === aHit.arrow) selectedArrow = null;
    markDirty();
    requestSave();
    return;
  }
  const stair = hitStair(cx, cy);
  if (stair) {
    state.stairs = state.stairs.filter((s) => s !== stair);
    if (selectedStair === stair) selectedStair = null;
    markDirty();
    requestSave();
    return;
  }

  const [row, col] = pixelToCell(cx, cy);
  if (state.inBounds(row, col)) {
    if (state.tool === "height") state.setCellHeight(row, col, 0);
    else state.setCellColor(row, col, state.activeLayer, null);
    renderLegend(document.getElementById("legend"), state);
    markDirty();
    requestSave();
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const [wxBefore, wyBefore] = screenToWorld(cx, cy);
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom * factor));
    // Keep the point under the cursor fixed (zoom-to-cursor).
    state.panX = cx - wxBefore * state.zoom;
    state.panY = cy - wyBefore * state.zoom;
    markDirty();
  },
  { passive: false }
);

// ------------------------------------------------------------- sprite ops

function placeSprite(spriteDefId, wx, wy) {
  const def = spritePalette.find((d) => d.id === spriteDefId);
  if (!def) return;
  const aspect = def.h / def.w;
  const w = 80;
  const h = Math.round(w * aspect);
  const sp = new Sprite({ id: allocId(), name: def.name, dataUrl: def.dataUrl, x: wx - w / 2, y: wy - h / 2, w, h });
  state.sprites.push(sp);
  loadSpriteImage(sp).then(markDirty);
  deselectAll();
  selectedSprite = sp;
  markDirty();
  requestSave();
}

// sprite palette (import list) — distinct from placed sprites on the board
const spritePalette = []; // {id, name, dataUrl, w, h}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function importSpriteFiles(fileList) {
  for (const file of fileList) {
    const dataUrl = await readFileAsDataUrl(file);
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    spritePalette.push({ id: allocId(), name: file.name, dataUrl, w: img.naturalWidth, h: img.naturalHeight });
  }
  refreshSpriteList();
}

function refreshSpriteList() {
  renderSpriteList(
    document.getElementById("sprite-list"),
    spritePalette,
    state.pendingSpritePath,
    (id) => {
      state.pendingSpritePath = id;
      state.tool = "place_sprite";
      refreshSpriteList();
    },
    (id) => {
      const idx = spritePalette.findIndex((d) => d.id === id);
      if (idx >= 0) spritePalette.splice(idx, 1);
      if (state.pendingSpritePath === id) state.pendingSpritePath = null;
      refreshSpriteList();
    }
  );
}

// ------------------------------------------------------------- tool list

function syncToolRadios() {
  const name = state.tool === "place_sprite" ? "select" : state.tool;
  document.querySelectorAll('input[name="tool"]').forEach((r) => (r.checked = r.value === name));
  refreshToolOptions();
}

// Tools with their own options panel don't need an entry here; every other
// tool falls back to "options-plain" with a short reminder of how to use
// it instead of a flat "no settings" message.
const PLAIN_TOOL_HINTS = {
  erase: "Click or drag on the canvas to erase paint on the active layer.",
  select: "Click a sprite, note, arrow, stair, or painted zone to select and drag it. Right-click most things to delete them.",
  note: "Click anywhere on the canvas to drop a note. Double-click a note to edit its text; right-click to delete it.",
};

function refreshToolOptions() {
  const tool = state.tool === "place_sprite" ? "select" : state.tool;
  const map = { paint: "options-paint", height: "options-height", stair: "options-stair", arrow: "options-arrow" };
  for (const id of ["options-paint", "options-height", "options-stair", "options-arrow", "options-plain"]) {
    document.getElementById(id).hidden = true;
  }
  document.getElementById(map[tool] ?? "options-plain").hidden = false;
  if (!map[tool]) {
    document.getElementById("plain-hint").textContent = PLAIN_TOOL_HINTS[tool] ?? "No extra settings for this tool.";
  }
}

document.querySelectorAll('input[name="tool"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      state.tool = radio.value;
      refreshToolOptions();
    }
  });
});

// ------------------------------------------------------------- palette UI

let selectedSwatchIndex = null;
let selectedArrowSwatchIndex = null;

function activePalette() {
  return state.activeLayer === "zone" ? state.zonePalette : state.settingPalette;
}

function refreshPaletteUI() {
  document.getElementById("palette-label").textContent = state.activeLayer === "zone" ? "Zone colors" : "Setting colors";
  renderSwatchList(document.getElementById("palette-list"), activePalette(), state.currentColor[state.activeLayer], (idx) => {
    const entry = activePalette()[idx];
    state.currentColor[state.activeLayer] = entry.color;
    selectedSwatchIndex = idx;
    state.tool = "paint";
    syncToolRadios();
    refreshPaletteUI();
    setStatus(`Selected color: ${entry.name}`);
  });
}

function refreshArrowPaletteUI() {
  renderSwatchList(document.getElementById("arrow-palette-list"), state.arrowPalette, state.currentArrowColor, (idx) => {
    const entry = state.arrowPalette[idx];
    state.currentArrowColor = entry.color;
    selectedArrowSwatchIndex = idx;
    state.tool = "arrow";
    syncToolRadios();
    refreshArrowPaletteUI();
    setStatus(`Selected arrow type: ${entry.name}`);
  });
}

function pickColorAsync(initial) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = initial || "#808080";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    let resolved = false;
    input.addEventListener("change", () => {
      resolved = true;
      resolve(input.value);
      input.remove();
    });
    input.addEventListener(
      "blur",
      () => {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
            input.remove();
          }
        }, 300);
      },
      { once: true }
    );
    input.click();
  });
}

document.getElementById("btn-add-color").addEventListener("click", async () => {
  const name = window.prompt("Name for this color:", "New zone") || "Unnamed";
  const color = await pickColorAsync("#808080");
  if (!color) return;
  activePalette().push({ color, name });
  state.currentColor[state.activeLayer] = color;
  refreshPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  requestSave();
});

document.getElementById("btn-edit-color").addEventListener("click", async () => {
  const palette = activePalette();
  if (selectedSwatchIndex === null || selectedSwatchIndex >= palette.length) {
    window.alert("Click a swatch first to select it.");
    return;
  }
  const entry = palette[selectedSwatchIndex];
  const oldColor = entry.color;
  const color = await pickColorAsync(oldColor);
  if (color) entry.color = color;
  const name = window.prompt("Name for this color:", entry.name);
  if (name) entry.name = name;
  if (entry.color !== oldColor) {
    const layer = state.activeLayer;
    for (const cell of state.grid.values()) {
      if (cell[layer] === oldColor) cell[layer] = entry.color;
    }
    if (state.currentColor[layer] === oldColor) state.currentColor[layer] = entry.color;
    state.recomputeCounts();
    markDirty();
  }
  refreshPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  requestSave();
});

document.getElementById("btn-remove-color").addEventListener("click", () => {
  const palette = activePalette();
  if (selectedSwatchIndex === null || selectedSwatchIndex >= palette.length) {
    window.alert("Click a swatch first to select it.");
    return;
  }
  const [removed] = palette.splice(selectedSwatchIndex, 1);
  const layer = state.activeLayer;
  for (const cell of state.grid.values()) {
    if (cell[layer] === removed.color) cell[layer] = null;
  }
  selectedSwatchIndex = null;
  state.recomputeCounts();
  refreshPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  markDirty();
  requestSave();
});

document.getElementById("btn-add-arrow-type").addEventListener("click", async () => {
  const name = window.prompt("Name for this arrow type:", "New type") || "Unnamed";
  const color = await pickColorAsync("#808080");
  if (!color) return;
  state.arrowPalette.push({ color, name });
  state.currentArrowColor = color;
  refreshArrowPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  requestSave();
});

document.getElementById("btn-edit-arrow-type").addEventListener("click", async () => {
  if (selectedArrowSwatchIndex === null || selectedArrowSwatchIndex >= state.arrowPalette.length) {
    window.alert("Click a swatch first to select it.");
    return;
  }
  const entry = state.arrowPalette[selectedArrowSwatchIndex];
  const oldColor = entry.color;
  const color = await pickColorAsync(oldColor);
  if (color) entry.color = color;
  const name = window.prompt("Name for this arrow type:", entry.name);
  if (name) entry.name = name;
  if (entry.color !== oldColor) {
    for (const arrow of state.arrows) if (arrow.color === oldColor) arrow.color = entry.color;
    if (state.currentArrowColor === oldColor) state.currentArrowColor = entry.color;
    markDirty();
  }
  refreshArrowPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  requestSave();
});

document.getElementById("btn-remove-arrow-type").addEventListener("click", () => {
  if (selectedArrowSwatchIndex === null || selectedArrowSwatchIndex >= state.arrowPalette.length) {
    window.alert("Click a swatch first to select it.");
    return;
  }
  state.arrowPalette.splice(selectedArrowSwatchIndex, 1);
  selectedArrowSwatchIndex = null;
  refreshArrowPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  requestSave();
});

function showArrowTypePopover(arrow, pos) {
  openPopover(pos, (body) => {
    const h = document.createElement("h4");
    h.textContent = "Arrow type";
    body.appendChild(h);
    state.arrowPalette.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "type-pick-row" + (entry.color === arrow.color ? " selected" : "");
      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.background = entry.color;
      const label = document.createElement("span");
      label.textContent = entry.name;
      row.append(swatch, label);
      row.addEventListener("click", () => {
        arrow.color = entry.color;
        markDirty();
        renderLegend(document.getElementById("legend"), state);
        requestSave();
        closePopover();
      });
      body.appendChild(row);
    });
    popoverButtons(body, { singleLabel: "Cancel", onCancel: closePopover });
  });
}

function showStairSettingsPopover(stair, pos) {
  openPopover(pos, (body) => {
    const h = document.createElement("h4");
    h.textContent = "Stair settings";
    body.appendChild(h);
    let width = stair.width;
    let length = stair.length;
    let height = stair.height;
    let direction = stair.direction;
    popoverStepperRow(body, "Width", width, (v) => (width = v), { min: 1, max: 10 });
    popoverStepperRow(body, "Length", length, (v) => (length = v), { min: 1, max: 20 });
    popoverStepperRow(body, "Height", height, (v) => (height = v), { min: 1, max: 20 });
    const p = document.createElement("p");
    p.textContent = "Direction";
    body.appendChild(p);
    const dirGrid = document.createElement("div");
    dirGrid.className = "dir-grid";
    STAIR_DIRECTIONS.forEach((dir) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "popover-stair-dir";
      input.value = dir;
      input.checked = dir === direction;
      input.addEventListener("change", () => (direction = dir));
      label.append(input, ` ${STAIR_DIRECTION_LABELS[dir]}`);
      dirGrid.appendChild(label);
    });
    body.appendChild(dirGrid);
    popoverButtons(body, {
      onApply: () => {
        stair.width = width;
        stair.length = length;
        stair.height = height;
        stair.direction = direction;
        markDirty();
        requestSave();
        closePopover();
      },
      onCancel: closePopover,
    });
  });
}

// ----------------------------------------------------------- export UI

document.getElementById("btn-export-settings").addEventListener("click", (e) => {
  openPopover(e.currentTarget, (body) => {
    const h = document.createElement("h4");
    h.textContent = "Export settings";
    body.appendChild(h);

    const mkCheck = (label, value, onChange) => {
      const row = document.createElement("label");
      row.className = "row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = value;
      input.addEventListener("change", () => onChange(input.checked));
      row.append(input, ` ${label}`);
      body.appendChild(row);
    };
    mkCheck("Show counts in legend", state.exportShowCounts, (v) => {
      state.exportShowCounts = v;
      requestSave();
    });
    mkCheck("Include height walls in plain export", state.exportPlainWalls, (v) => {
      state.exportPlainWalls = v;
      requestSave();
    });
    popoverStepperRow(body, "Legend font size", state.exportLegendFontSize, (v) => {
      state.exportLegendFontSize = v;
      requestSave();
    }, { min: 8, max: 40 });
    popoverStepperRow(body, "Note font size", state.exportNoteFontSize, (v) => {
      state.exportNoteFontSize = v;
      requestSave();
    }, { min: 8, max: 60 });

    const headingRow = document.createElement("div");
    headingRow.className = "row";
    const headingLabel = document.createElement("span");
    headingLabel.textContent = "Arrows heading text";
    const headingInput = document.createElement("input");
    headingInput.type = "text";
    headingInput.value = state.exportArrowsHeadingText;
    headingInput.style.width = "100px";
    headingInput.addEventListener("change", () => {
      state.exportArrowsHeadingText = headingInput.value;
      requestSave();
    });
    headingRow.append(headingLabel, headingInput);
    body.appendChild(headingRow);
    popoverStepperRow(body, "Arrows heading font size", state.exportArrowsHeadingFontSize, (v) => {
      state.exportArrowsHeadingFontSize = v;
      requestSave();
    }, { min: 8, max: 40 });

    popoverButtons(body, { singleLabel: "Close", onCancel: closePopover });
  });
});

document.getElementById("btn-grid-size").addEventListener("click", (e) => {
  openPopover(e.currentTarget, (body) => {
    const h = document.createElement("h4");
    h.textContent = "Grid size";
    body.appendChild(h);
    let rows = state.rows;
    let cols = state.cols;
    popoverStepperRow(body, "Rows", rows, (v) => (rows = v), { min: GRID_MIN, max: GRID_MAX });
    popoverStepperRow(body, "Columns", cols, (v) => (cols = v), { min: GRID_MIN, max: GRID_MAX });
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Painted cells outside the new size are dropped; sprites, arrows, and stairs are kept, just out of view until you grow it back.";
    body.appendChild(note);
    popoverButtons(body, {
      onApply: () => {
        state.applyGridSize(rows, cols);
        renderLegend(document.getElementById("legend"), state);
        markDirty();
        requestSave();
        closePopover();
      },
      onCancel: closePopover,
    });
  });
});

document.getElementById("btn-reset-view").addEventListener("click", () => {
  state.panX = 0;
  state.panY = 0;
  state.zoom = 1;
  markDirty();
});

document.getElementById("btn-preview").addEventListener("click", async () => {
  setStatus("Rendering preview...");
  const maxW = window.innerWidth * 0.85;
  const maxH = window.innerHeight * 0.8;
  const { canvas: previewCanvas, scale } = await renderPreviewCanvas(state, state.activeLayer, maxW, maxH);
  showModal((modal, close) => {
    modal.appendChild(previewCanvas);
    const caption = document.createElement("div");
    caption.className = "modal-caption";
    const full = `${Math.round(previewCanvas.width / scale)} x ${Math.round(previewCanvas.height / scale)}px`;
    caption.textContent = scale < 1 ? `${full} (shown at ${Math.round(scale * 100)}%)` : full;
    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    modal.append(caption, closeBtn);
  });
  setStatus("Ready.");
});

document.getElementById("btn-export").addEventListener("click", async () => {
  const base = window.prompt("File name (without extension):", state.projectName || "location-blockmap");
  if (!base) return;
  setStatus("Exporting...");
  const saved = await exportAllPngs(state, base);
  setStatus(`Exported ${saved.length} images: ${saved.join(", ")}`);
});

// ------------------------------------------------------------ file I/O

function setStatus(text) {
  document.getElementById("status-bar").textContent = text;
}

document.getElementById("btn-new").addEventListener("click", () => {
  if (!window.confirm("Discard current board and start a new one?")) return;
  state = new AppState();
  clearAutosave();
  deselectAll();
  rebuildAllUi();
  markDirty();
});

document.getElementById("btn-save").addEventListener("click", () => {
  const name = state.projectName || "location-blockmap";
  downloadProjectJson(state, name);
  state.projectName = name;
  setStatus(`Saved: ${name}.json`);
});

document.getElementById("btn-save-as").addEventListener("click", () => {
  const name = window.prompt("File name (without extension):", state.projectName || "location-blockmap");
  if (!name) return;
  downloadProjectJson(state, name);
  state.projectName = name;
  setStatus(`Saved: ${name}.json`);
});

document.getElementById("btn-open").addEventListener("click", () => {
  document.getElementById("file-open").click();
});
document.getElementById("file-open").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    state = await readProjectFile(file);
    deselectAll();
    rebuildAllUi();
    markDirty();
    setStatus(`Opened: ${file.name}`);
  } catch (err) {
    window.alert(`Could not open project: ${err.message}`);
  }
});

document.getElementById("btn-import-sprites").addEventListener("click", () => {
  document.getElementById("file-sprites").click();
});
document.getElementById("file-sprites").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await importSpriteFiles(files);
});

// Drag-and-drop a .json onto the page as an alternate Open.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.name.endsWith(".json"));
  if (!file) return;
  try {
    state = await readProjectFile(file);
    deselectAll();
    rebuildAllUi();
    markDirty();
    setStatus(`Opened: ${file.name}`);
  } catch (err) {
    window.alert(`Could not open project: ${err.message}`);
  }
});

document.getElementById("layer-zone").addEventListener("change", onLayerChanged);
document.getElementById("layer-setting").addEventListener("change", onLayerChanged);
function onLayerChanged(e) {
  if (!e.target.checked) return;
  state.activeLayer = e.target.value;
  selectedSwatchIndex = null;
  refreshPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  markDirty();
}

document.getElementById("brush-height").addEventListener("change", (e) => {
  state.brushHeight = parseInt(e.target.value, 10) || 0;
});
document.getElementById("height-apply-zone").addEventListener("change", (e) => {
  state.heightApplyToZone = e.target.checked;
});
document.getElementById("stair-width").addEventListener("change", (e) => (state.stairWidth = parseInt(e.target.value, 10) || 1));
document.getElementById("stair-length").addEventListener("change", (e) => (state.stairLength = parseInt(e.target.value, 10) || 1));
document.getElementById("stair-height").addEventListener("change", (e) => (state.stairHeight = parseInt(e.target.value, 10) || 1));
document.querySelectorAll('input[name="stair-dir"]').forEach((r) =>
  r.addEventListener("change", () => {
    if (r.checked) state.stairDirection = r.value;
  })
);

// ------------------------------------------------------------- bootstrap

function rebuildAllUi() {
  refreshPaletteUI();
  refreshArrowPaletteUI();
  renderLegend(document.getElementById("legend"), state);
  syncToolRadios();
  document.getElementById("layer-zone").checked = state.activeLayer === "zone";
  document.getElementById("layer-setting").checked = state.activeLayer === "setting";
  document.getElementById("brush-height").value = state.brushHeight;
  document.getElementById("height-apply-zone").checked = state.heightApplyToZone;
  document.getElementById("stair-width").value = state.stairWidth;
  document.getElementById("stair-length").value = state.stairLength;
  document.getElementById("stair-height").value = state.stairHeight;
  document.querySelectorAll('input[name="stair-dir"]').forEach((r) => (r.checked = r.value === state.stairDirection));
  for (const sp of state.sprites) loadSpriteImage(sp).then(markDirty);
}

new ResizeObserver(resizeCanvas).observe(canvasWrap);
resizeCanvas();
rebuildAllUi();
markDirty();
