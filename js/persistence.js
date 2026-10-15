// Save/Load — mirrors _serialize/_write_project/open_project in app.py, with
// one necessary difference: a browser can't silently manage a sibling
// assets/ folder, so every sprite's image is embedded directly as a base64
// data URL inside the JSON. That makes a single .json fully portable, at
// the cost of file size, which is exactly the trade-off requested.
//
// Two persistence paths, both requested: (a) explicit Save (downloads a
// .json) / Open (file picker), and (b) autosave to localStorage (debounced)
// with auto-restore on page load, so an accidental tab close doesn't lose
// work.

import {
  DEFAULT_ZONE_PALETTE,
  DEFAULT_SETTING_PALETTE,
  DEFAULT_ARROW_PALETTE,
  STAIR_DEFAULT_LENGTH,
} from "./constants.js";
import { AppState, Sprite, Note, ArrowShape, allocId } from "./state.js";
import { Stair } from "./stairs.js";

const LEGACY_STAIR_DIRECTIONS = { right_to_left: "row_plus", left_to_right: "col_plus" };
const AUTOSAVE_KEY = "location-blockmap-tool:autosave";

export function serialize(state) {
  const grid = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.getCell(r, c);
      grid.push({ r, c, zone: cell.zone, setting: cell.setting, height: cell.height });
    }
  }
  return {
    rows: state.rows,
    cols: state.cols,
    originX: state.originX,
    originY: state.originY,
    zonePalette: state.zonePalette,
    settingPalette: state.settingPalette,
    arrowPalette: state.arrowPalette,
    grid,
    sprites: state.sprites.map((sp) => ({ id: sp.id, name: sp.name, dataUrl: sp.dataUrl, x: sp.x, y: sp.y, w: sp.w, h: sp.h })),
    notes: state.notes.map((n) => ({ id: n.id, x: n.x, y: n.y, text: n.text })),
    arrows: state.arrows.map((a) => ({ id: a.id, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color: a.color })),
    stairs: state.stairs.map((s) => ({ row: s.row, col: s.col, width: s.width, length: s.length, height: s.height, direction: s.direction })),
    exportSettings: {
      showCounts: state.exportShowCounts,
      plainWalls: state.exportPlainWalls,
      legendFontSize: state.exportLegendFontSize,
      noteFontSize: state.exportNoteFontSize,
      arrowsHeadingText: state.exportArrowsHeadingText,
      arrowsHeadingFontSize: state.exportArrowsHeadingFontSize,
    },
  };
}

/** Rebuilds a fresh AppState from a parsed save file. Tolerant of partial/legacy data. */
export function deserialize(data) {
  const state = new AppState();
  state.rows = data.rows;
  state.cols = data.cols;
  state.originX = data.originX ?? 500;
  state.originY = data.originY ?? 80;
  state.zonePalette = data.zonePalette ?? DEFAULT_ZONE_PALETTE.map((e) => ({ ...e }));
  state.settingPalette = data.settingPalette ?? DEFAULT_SETTING_PALETTE.map((e) => ({ ...e }));
  state.arrowPalette = data.arrowPalette ?? DEFAULT_ARROW_PALETTE.map((e) => ({ ...e }));

  state.grid = new Map();
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      state.grid.set(`${r},${c}`, { zone: null, setting: null, height: 0 });
    }
  }
  for (const cell of data.grid ?? []) {
    state.grid.set(`${cell.r},${cell.c}`, { zone: cell.zone, setting: cell.setting, height: cell.height ?? 0 });
  }

  state.sprites = (data.sprites ?? [])
    .filter((sp) => sp.dataUrl) // a desktop-exported save with only a file path has no usable image in-browser
    .map((sp) => new Sprite({ id: allocId(), name: sp.name, dataUrl: sp.dataUrl, x: sp.x, y: sp.y, w: sp.w, h: sp.h }));

  state.notes = (data.notes ?? []).map((n) => new Note({ id: allocId(), x: n.x, y: n.y, text: n.text }));
  state.arrows = (data.arrows ?? []).map(
    (a) => new ArrowShape({ id: allocId(), x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color: a.color ?? state.arrowPalette[0].color })
  );

  state.stairs = (data.stairs ?? []).map((s) => {
    const direction = LEGACY_STAIR_DIRECTIONS[s.direction] ?? s.direction;
    let length, height;
    if ("length" in s) {
      length = s.length;
      height = s.height;
    } else {
      length = height = s.steps ?? STAIR_DEFAULT_LENGTH; // pre-height-split saves
    }
    return new Stair(s.row, s.col, s.width, length, height, direction);
  });

  const ex = data.exportSettings ?? {};
  state.exportShowCounts = ex.showCounts ?? true;
  state.exportPlainWalls = ex.plainWalls ?? false;
  state.exportLegendFontSize = ex.legendFontSize ?? 13;
  state.exportNoteFontSize = ex.noteFontSize ?? 13;
  state.exportArrowsHeadingText = ex.arrowsHeadingText ?? "Arrows";
  state.exportArrowsHeadingFontSize = ex.arrowsHeadingFontSize ?? 13;

  state.currentColor = { zone: state.zonePalette[0].color, setting: state.settingPalette[0].color };
  state.currentArrowColor = state.arrowPalette[0].color;
  state.recomputeCounts();
  return state;
}

export function downloadProjectJson(state, filename) {
  const json = JSON.stringify(serialize(state), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserialize(JSON.parse(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// --- localStorage autosave (debounced) --------------------------------

let autosaveTimer = null;
export function scheduleAutosave(state, delayMs = 800) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(state)));
    } catch (err) {
      // Quota exceeded or storage disabled — autosave is a convenience, not
      // a guarantee, so fail silently rather than interrupt the user.
      console.warn("Autosave failed:", err);
    }
  }, delayMs);
}

export function loadAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw));
  } catch (err) {
    console.warn("Autosave data was corrupt, ignoring:", err);
    return null;
  }
}

export function clearAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  localStorage.removeItem(AUTOSAVE_KEY);
}
