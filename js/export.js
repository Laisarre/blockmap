// PNG export — mirrors _compute_export_bounds / _render_board_image /
// _render_notes_arrows_image / export_png / preview_export in app.py.
// Every variant's canvas is sized and shifted to the content's real
// bounding box (never a flat guess), computed fresh per call so it's always
// consistent with whatever is actually about to be drawn.

import { TILE_W, TILE_H, HEIGHT_UNIT_PX } from "./constants.js";
import { cellCenter, boundingParallelogram } from "./geometry.js";
import { drawScene, loadSpriteImage, drawArrow, drawNote } from "./render.js";
import { drawLegendOnCanvas } from "./legend.js";

let measureCtx = null;
function getMeasureCtx(font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx;
}

/**
 * True (minX, minY, maxX, maxY) of everything a given export variant would
 * draw, in world coordinates. Each include* flag drops that kind of content
 * from the bounds exactly like it would be dropped from the drawing, so
 * e.g. a notes+arrows-only export sizes itself to just that, not the whole
 * grid.
 */
function computeExportBounds(state, { includeGrid, includeSprites, includeArrows, includeStairs, includeNotes, noteFontPx }) {
  const halfW = TILE_W / 2;
  const halfH = TILE_H / 2;
  const xs = [];
  const ys = [];

  if (includeGrid) {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const [sx, sy] = cellCenter(r, c, state.originX, state.originY);
        xs.push(sx - halfW, sx + halfW);
        ys.push(sy - halfH, sy + halfH);
        const faces = state.wallFaceHeights(r, c);
        const reach = Math.max(faces.south, faces.east);
        if (reach) ys.push(sy + halfH + HEIGHT_UNIT_PX * reach);
      }
    }
  }
  if (includeSprites) {
    for (const sp of state.sprites) {
      xs.push(sp.x, sp.x + sp.w);
      ys.push(sp.y, sp.y + sp.h);
    }
  }
  if (includeArrows) {
    const margin = 20; // arrowhead overshoot past the endpoint
    for (const a of state.arrows) {
      xs.push(a.x1 - margin, a.x1 + margin, a.x2 - margin, a.x2 + margin);
      ys.push(a.y1 - margin, a.y1 + margin, a.y2 - margin, a.y2 + margin);
    }
  }
  if (includeStairs) {
    for (const stair of state.stairs) {
      const [r0, r1, c0, c1] = stair.cellRange();
      const lift = stair.height * HEIGHT_UNIT_PX;
      for (const [cx, cy] of boundingParallelogram(r0, r1, c0, c1, state.originX, state.originY)) {
        xs.push(cx);
        ys.push(cy, cy - lift); // a riser's top edge sits `lift` px higher
      }
    }
  }
  if (includeNotes && state.notes.length) {
    for (const note of state.notes) {
      const ctx = getMeasureCtx(`${noteFontPx}px "Segoe UI", sans-serif`);
      const lines = note.text.split("\n");
      const lineH = noteFontPx * 1.25;
      const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const textH = lines.length * lineH;
      const pad = 6;
      xs.push(note.x + 6 - pad, note.x + 6 + textW + pad);
      ys.push(note.y + 6 - pad, note.y + 6 + textH + pad);
    }
  }
  if (xs.length === 0) return [0, 0, TILE_W, TILE_H];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function ensureSpritesDecoded(state) {
  await Promise.all(state.sprites.map(loadSpriteImage));
}

/**
 * Render one of the 4 main variants (zone/setting x full/plain) to a new
 * canvas. "full" shows the grid (incl. unpainted cells) + walls + every
 * marker + the legend; "plain" is a transparent cutout of just painted
 * cells, no grid lines, optionally with walls (state.exportPlainWalls).
 */
export async function renderBoardCanvas(state, layer, includeMarkers, includeGrid) {
  await ensureSpritesDecoded(state);
  const pad = 24;
  const noteFontPx = state.exportNoteFontSize;
  // Bounds always consider the FULL grid (not just painted cells), even for
  // a "plain" variant — this is what keeps all 4 main variants the same
  // size and aligned with each other for overlay use. Only the dedicated
  // notes+arrows export (below) sizes itself to a restricted subset.
  const [minX, minY, maxX, maxY] = computeExportBounds(state, {
    includeGrid: true,
    includeSprites: true,
    includeArrows: true,
    includeStairs: true,
    includeNotes: true,
    noteFontPx,
  });
  const shiftX = pad - minX;
  const shiftY = pad - minY;
  const width = Math.max(1, Math.round(maxX - minX + 2 * pad));
  const height = Math.max(1, Math.round(maxY - minY + 2 * pad));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (includeGrid) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  const transform = (wx, wy) => [wx + shiftX, wy + shiftY];
  drawScene(ctx, state, {
    transform,
    scale: 1,
    layer,
    includeGrid,
    includeMarkers,
    plainWalls: state.exportPlainWalls,
    noteFontSize: noteFontPx,
  });

  if (includeMarkers) {
    drawLegendOnCanvas(ctx, state, layer, {
      showCounts: state.exportShowCounts,
      legendFontPx: state.exportLegendFontSize,
      headingFontPx: state.exportArrowsHeadingFontSize,
      headingText: state.exportArrowsHeadingText,
    });
  }
  return canvas;
}

/**
 * The 5th, standalone variant: just notes + arrows + the arrow legend, no
 * grid/zone colors/sprites/stairs, transparent background, sized to fit
 * only that content.
 */
export async function renderNotesArrowsCanvas(state) {
  await ensureSpritesDecoded(state);
  const pad = 24;
  const noteFontPx = state.exportNoteFontSize;
  const [minX, minY, maxX, maxY] = computeExportBounds(state, {
    includeGrid: false,
    includeSprites: false,
    includeArrows: true,
    includeStairs: false,
    includeNotes: true,
    noteFontPx,
  });
  const shiftX = pad - minX;
  const shiftY = pad - minY;
  const width = Math.max(1, Math.round(maxX - minX + 2 * pad));
  const height = Math.max(1, Math.round(maxY - minY + 2 * pad));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const transform = (wx, wy) => [wx + shiftX, wy + shiftY];
  for (const arrow of state.arrows) {
    const [sx1, sy1] = transform(arrow.x1, arrow.y1);
    const [sx2, sy2] = transform(arrow.x2, arrow.y2);
    drawArrow(ctx, sx1, sy1, sx2, sy2, arrow.color);
  }
  for (const note of state.notes) {
    const [sx, sy] = transform(note.x, note.y);
    drawNote(ctx, note, sx, sy, noteFontPx);
  }

  drawLegendOnCanvas(ctx, state, null, {
    showCounts: state.exportShowCounts,
    legendFontPx: state.exportLegendFontSize,
    headingFontPx: state.exportArrowsHeadingFontSize,
    headingText: state.exportArrowsHeadingText,
  });
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the download has had a tick to start, so the URL never lingers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Orchestrates the full 5-file export, mirroring export_png(). */
export async function exportAllPngs(state, baseName) {
  const variants = [
    ["zone", true, true, "_zones_full"],
    ["setting", true, true, "_setting_full"],
    ["zone", false, false, "_zones_plain"],
    ["setting", false, false, "_setting_plain"],
  ];
  const saved = [];
  for (const [layer, markers, grid, suffix] of variants) {
    const canvas = await renderBoardCanvas(state, layer, markers, grid);
    const blob = await canvasToBlob(canvas);
    const filename = `${baseName}${suffix}.png`;
    downloadBlob(blob, filename);
    saved.push(filename);
  }
  const notesArrowsCanvas = await renderNotesArrowsCanvas(state);
  const notesArrowsBlob = await canvasToBlob(notesArrowsCanvas);
  const notesArrowsName = `${baseName}_notes_arrows.png`;
  downloadBlob(notesArrowsBlob, notesArrowsName);
  saved.push(notesArrowsName);
  return saved;
}

/** Renders the full variant for the given layer, scaled to fit maxW/maxH (never upscaled). */
export async function renderPreviewCanvas(state, layer, maxW, maxH) {
  const full = await renderBoardCanvas(state, layer, true, true);
  const scale = Math.min(1, maxW / full.width, maxH / full.height);
  if (scale >= 1) return { canvas: full, scale: 1 };
  const scaled = document.createElement("canvas");
  scaled.width = Math.max(1, Math.round(full.width * scale));
  scaled.height = Math.max(1, Math.round(full.height * scale));
  const ctx = scaled.getContext("2d");
  ctx.drawImage(full, 0, 0, scaled.width, scaled.height);
  return { canvas: scaled, scale };
}
