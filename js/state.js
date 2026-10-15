// Central application state — no DOM references live here, so it's cheap to
// serialize/restore and easy to reason about independent of rendering.
// Mirrors BlockmapApp's instance fields in app.py.

import {
  DEFAULT_ZONE_PALETTE,
  DEFAULT_SETTING_PALETTE,
  DEFAULT_ARROW_PALETTE,
  GRID_MIN,
  GRID_MAX,
} from "./constants.js";

let nextId = 1;
export function allocId() {
  return nextId++;
}

export class Sprite {
  constructor({ id, name, dataUrl, x, y, w, h }) {
    this.id = id ?? allocId();
    this.name = name;
    this.dataUrl = dataUrl; // the sprite's own image, as a data: URL
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.image = null; // populated lazily by an ImageBitmap/Image cache (see render.js)
  }
}

export class Note {
  constructor({ id, x, y, text }) {
    this.id = id ?? allocId();
    this.x = x;
    this.y = y;
    this.text = text;
  }
}

export class ArrowShape {
  constructor({ id, x1, y1, x2, y2, color }) {
    this.id = id ?? allocId();
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.color = color;
  }
}

function freshGrid(rows, cols) {
  const grid = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.set(`${r},${c}`, { zone: null, setting: null, height: 0 });
    }
  }
  return grid;
}

export class AppState {
  constructor() {
    this.rows = 10;
    this.cols = 10;
    this.originX = 500;
    this.originY = 80;

    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;

    this.grid = freshGrid(this.rows, this.cols);
    this.counts = { zone: new Map(), setting: new Map() };

    this.zonePalette = DEFAULT_ZONE_PALETTE.map((e) => ({ ...e }));
    this.settingPalette = DEFAULT_SETTING_PALETTE.map((e) => ({ ...e }));
    this.arrowPalette = DEFAULT_ARROW_PALETTE.map((e) => ({ ...e }));

    this.activeLayer = "zone";
    this.currentColor = { zone: this.zonePalette[0].color, setting: this.settingPalette[0].color };
    this.currentArrowColor = this.arrowPalette[0].color;

    this.sprites = [];
    this.notes = [];
    this.arrows = [];
    this.stairs = [];

    this.tool = "paint"; // paint, erase, select, note, arrow, stair, height, place_sprite
    this.brushHeight = 1;
    this.heightApplyToZone = false;
    this.stairWidth = 1;
    this.stairLength = 1;
    this.stairHeight = 1;
    this.stairDirection = "row_plus";
    this.pendingSpritePath = null; // id of the sprite-palette entry chosen for placement

    this.exportShowCounts = true;
    this.exportPlainWalls = false;
    this.exportLegendFontSize = 13;
    this.exportNoteFontSize = 13;
    this.exportArrowsHeadingText = "Arrows";
    this.exportArrowsHeadingFontSize = 13;

    this.projectName = null; // last-used filename, for Save vs Save As framing
  }

  cellKey(row, col) {
    return `${row},${col}`;
  }

  getCell(row, col) {
    return this.grid.get(this.cellKey(row, col));
  }

  inBounds(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /** O(1) incremental color set — mirrors _set_cell_color. Returns true if it changed anything. */
  setCellColor(row, col, layer, newColor) {
    if (!this.inBounds(row, col)) return false;
    const cell = this.getCell(row, col);
    const oldColor = cell[layer];
    if (oldColor === newColor) return false;
    cell[layer] = newColor;
    const counts = this.counts[layer];
    if (oldColor) {
      const n = (counts.get(oldColor) || 0) - 1;
      if (n <= 0) counts.delete(oldColor);
      else counts.set(oldColor, n);
    }
    if (newColor) counts.set(newColor, (counts.get(newColor) || 0) + 1);
    return true;
  }

  setCellHeight(row, col, newHeight) {
    if (!this.inBounds(row, col)) return;
    this.getCell(row, col).height = newHeight;
  }

  recomputeCounts() {
    const counts = { zone: new Map(), setting: new Map() };
    for (const cell of this.grid.values()) {
      for (const layer of ["zone", "setting"]) {
        const color = cell[layer];
        if (color) counts[layer].set(color, (counts[layer].get(color) || 0) + 1);
      }
    }
    this.counts = counts;
  }

  /** 4-connected flood fill of same-color cells on a layer. Mirrors _flood_fill_zone. */
  floodFillZone(row, col, layer) {
    const color = this.getCell(row, col)?.[layer];
    if (!color) return null;
    const visited = new Set();
    const stack = [[row, col]];
    const cells = [];
    while (stack.length) {
      const [r, c] = stack.pop();
      const key = this.cellKey(r, c);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!this.inBounds(r, c)) continue;
      if (this.getCell(r, c)[layer] !== color) continue;
      cells.push([r, c]);
      stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
    return { color, cells };
  }

  /**
   * A wall is needed on a side whenever THIS cell is taller than that
   * specific neighbor (off-grid counts as height 0) — only south/east are
   * ever checked, since those are the only 2 faces this camera angle ever
   * shows. The wall's own depth is this cell's FULL height, never clamped —
   * z-order (see render.js's height-sorted draw) is what keeps a tall wall
   * from covering something it shouldn't, not clipping the wall itself.
   */
  wallFaceHeights(row, col) {
    const ownH = this.getCell(row, col).height;
    if (ownH === 0) return { south: 0, east: 0 };
    const southH = this.inBounds(row + 1, col) ? this.getCell(row + 1, col).height : 0;
    const eastH = this.inBounds(row, col + 1) ? this.getCell(row, col + 1).height : 0;
    return {
      south: ownH > southH ? ownH : 0,
      east: ownH > eastH ? ownH : 0,
    };
  }

  applyGridSize(rows, cols) {
    rows = Math.max(GRID_MIN, Math.min(GRID_MAX, rows));
    cols = Math.max(GRID_MIN, Math.min(GRID_MAX, cols));
    const newGrid = freshGrid(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = this.cellKey(r, c);
        if (this.grid.has(key)) newGrid.set(key, this.grid.get(key));
      }
    }
    this.rows = rows;
    this.cols = cols;
    this.grid = newGrid;
    this.recomputeCounts();
  }

  /** Only arrow-palette entries actually used by at least one arrow, each with its live count. */
  usedArrowPaletteEntries() {
    const counts = new Map();
    for (const arrow of this.arrows) counts.set(arrow.color, (counts.get(arrow.color) || 0) + 1);
    return this.arrowPalette
      .filter((e) => counts.get(e.color) > 0)
      .map((e) => ({ color: e.color, name: e.name, count: counts.get(e.color) }));
  }
}
