// Canvas rendering — shared by both the live on-screen canvas and the PNG
// export renderer (export.js), via drawScene()'s `transform`/`scale`
// parameters. This sharing is a deliberate simplification over the desktop
// app, which had to duplicate this logic once for Tkinter canvas items and
// once for PIL drawing; a <canvas> 2D context works identically for both
// "live" and "offscreen for export" uses, so one implementation covers both.

import { TILE_W, TILE_H, UNPAINTED, GRID_LINE, HEIGHT_UNIT_PX, HEIGHT_WALL_SHADE, HANDLE_SIZE, STAIR_COLOR, STAIR_RISER_SHADE } from "./constants.js";
import { cellCenter, wallFacePoints, darkenColor } from "./geometry.js";
import { computeStaircasePolys } from "./stairs.js";

function fillPoly(ctx, points, fill, stroke) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Draw the grid (floors + height walls), in the exact height-sorted
 * single-pass order the desktop app settled on after many iterations: a
 * floor sorts at its own height, a wall sorts at `height - 0.5`. Ascending
 * order means a wall always draws (and so visually wins) over anything
 * strictly lower than it anywhere on the grid, but never over anything at
 * its own height or taller. Do not "simplify" this to a per-neighbor or
 * per-adjacency rule — that was tried and is wrong (see project history).
 */
function drawGridLayer(ctx, state, { transform, scale, layer, includeGrid, plainWalls }) {
  const halfW = (TILE_W / 2) * scale;
  const halfH = (TILE_H / 2) * scale;
  const items = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.getCell(r, c);
      if (!includeGrid && !cell[layer]) continue; // plain export: skip unpainted cells entirely
      items.push({ key: cell.height, kind: "floor", r, c });
      if (includeGrid || plainWalls) {
        const faces = state.wallFaceHeights(r, c);
        if (faces.south || faces.east) items.push({ key: cell.height - 0.5, kind: "wall", r, c });
      }
    }
  }
  items.sort((a, b) => a.key - b.key);

  for (const item of items) {
    const { r, c, kind } = item;
    const cell = state.getCell(r, c);
    const color = cell[layer];
    const [wx, wy] = cellCenter(r, c, state.originX, state.originY);
    const [sx, sy] = transform(wx, wy);
    if (kind === "floor") {
      const points = [
        [sx, sy - halfH],
        [sx + halfW, sy],
        [sx, sy + halfH],
        [sx - halfW, sy],
      ];
      fillPoly(ctx, points, color || (includeGrid ? UNPAINTED : null), includeGrid ? GRID_LINE : null);
    } else {
      const faces = state.wallFaceHeights(r, c);
      const wallColor = darkenColor(color || UNPAINTED, HEIGHT_WALL_SHADE);
      const southPx = HEIGHT_UNIT_PX * faces.south * scale;
      const eastPx = HEIGHT_UNIT_PX * faces.east * scale;
      const quads = wallFacePoints(sx, sy, halfW, halfH, southPx, eastPx);
      if (faces.south) fillPoly(ctx, quads.south, wallColor, includeGrid ? GRID_LINE : null);
      if (faces.east) fillPoly(ctx, quads.east, wallColor, includeGrid ? GRID_LINE : null);
    }
  }
}

function drawStair(ctx, stair, state, transform, scale, selected) {
  const { treads, risers } = computeStaircasePolys(stair, state.originX, state.originY);
  const toScreen = (pts) => pts.map(([x, y]) => transform(x, y));
  // scale isn't applied inside computeStaircasePolys (it works in world units),
  // so for the live (scaled) canvas we scale each point about the stair's own
  // world origin via the transform function itself — transform already bakes
  // in pan+zoom, so passing raw world points through it is correct as-is.
  for (const tread of treads) fillPoly(ctx, toScreen(tread), STAIR_COLOR, GRID_LINE);
  for (const riser of risers) fillPoly(ctx, toScreen(riser), darkenColor(STAIR_COLOR, STAIR_RISER_SHADE), GRID_LINE);
  if (selected) {
    const [r0, r1, c0, c1] = stair.cellRange();
    // dashed outline around the footprint using the same bounding corners order as boundingParallelogram
    const pts = [
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
    pts.forEach(([r, c], i) => {
      const [wx, wy] = cellCenter(r, c, state.originX, state.originY);
      const [sx, sy] = transform(wx, wy);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

function drawArrow(ctx, x1, y1, x2, y2, color, { width = 3, headLen = 14, headAngleDeg = 25 } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = (headAngleDeg * Math.PI) / 180;
  const left = [x2 + headLen * Math.cos(angle + Math.PI - spread), y2 + headLen * Math.sin(angle + Math.PI - spread)];
  const right = [x2 + headLen * Math.cos(angle + Math.PI + spread), y2 + headLen * Math.sin(angle + Math.PI + spread)];
  fillPoly(ctx, [[x2, y2], left, right], color, null);
}

function drawNote(ctx, note, sx, sy, fontSize) {
  ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
  const lines = note.text.split("\n");
  const lineH = fontSize * 1.25;
  const pad = 6;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const textH = lines.length * lineH;
  const x0 = sx + 6 - pad;
  const y0 = sy + 6 - pad;
  ctx.fillStyle = "#fff6b0";
  ctx.strokeStyle = "#c9b64a";
  ctx.lineWidth = 1;
  ctx.fillRect(x0, y0, textW + pad * 2, textH + pad * 2);
  ctx.strokeRect(x0, y0, textW + pad * 2, textH + pad * 2);
  ctx.fillStyle = "#333300";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, sx + 6, sy + 6 + i * lineH));
  return { x0, y0, x1: x0 + textW + pad * 2, y1: y0 + textH + pad * 2 };
}

/** Image cache: decode each sprite's data URL exactly once, never per frame. */
const spriteImageCache = new Map();
export async function loadSpriteImage(sprite) {
  if (spriteImageCache.has(sprite.dataUrl)) return spriteImageCache.get(sprite.dataUrl);
  const img = new Image();
  img.src = sprite.dataUrl;
  await img.decode();
  spriteImageCache.set(sprite.dataUrl, img);
  return img;
}

/**
 * Draw the whole scene (grid + optional markers) into ctx. `transform`
 * converts world coords to canvas-pixel coords (already includes pan/zoom
 * for the live canvas, or an export shift with no scale otherwise);
 * `scale` must match transform's linear scale factor (zoom, or 1 for
 * export) so wall/stair/tile sizing stays consistent with it.
 */
export function drawScene(ctx, state, opts) {
  const { transform, scale, layer, includeGrid, includeMarkers, plainWalls = true } = opts;
  drawGridLayer(ctx, state, { transform, scale, layer, includeGrid, plainWalls });
  if (!includeMarkers) return;

  const sortedSprites = [...state.sprites].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const sp of sortedSprites) {
    const img = spriteImageCache.get(sp.dataUrl);
    if (!img) continue; // not decoded yet; next frame will have it
    const [sx, sy] = transform(sp.x, sp.y);
    const w = sp.w * scale;
    const h = sp.h * scale;
    ctx.drawImage(img, sx, sy, w, h);
  }

  for (const arrow of state.arrows) {
    const [sx1, sy1] = transform(arrow.x1, arrow.y1);
    const [sx2, sy2] = transform(arrow.x2, arrow.y2);
    drawArrow(ctx, sx1, sy1, sx2, sy2, arrow.color);
  }

  for (const stair of state.stairs) {
    drawStair(ctx, stair, state, transform, scale, false);
  }

  // Note text is drawn at a fixed pixel size regardless of zoom (matching
  // the desktop app's fixed-font canvas text items) for the live view; an
  // export call passes its own configured size explicitly via opts.
  for (const note of state.notes) {
    const [sx, sy] = transform(note.x, note.y);
    drawNote(ctx, note, sx, sy, opts.noteFontSize ?? 13);
  }
}

export { drawStair, drawArrow, drawNote, fillPoly };
