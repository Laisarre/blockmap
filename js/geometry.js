// Pure geometry/color helpers — ports of the free functions near the top of
// app.py. These never touch the DOM or app state, so they're trivially
// testable (see geometry.test.mjs) and safe to call from both the live
// canvas renderer and the PNG export renderer.

import { TILE_W, TILE_H } from "./constants.js";

/** World-space center of a grid cell (row,col), before pan/zoom. */
export function cellCenter(row, col, originX, originY) {
  const sx = originX + (col - row) * (TILE_W / 2);
  const sy = originY + (col + row) * (TILE_H / 2);
  return [sx, sy];
}

/** Inverse of cellCenter: nearest (row,col) for a world-space point. */
export function worldToCell(wx, wy, originX, originY) {
  const a = (wx - originX) / (TILE_W / 2);
  const b = (wy - originY) / (TILE_H / 2);
  const col = Math.round((a + b) / 2);
  const row = Math.round((b - a) / 2);
  return [row, col];
}

export function darkenColor(hexColor, factor) {
  const hex = hexColor.replace("#", "");
  const r = Math.floor(parseInt(hex.slice(0, 2), 16) * factor);
  const g = Math.floor(parseInt(hex.slice(2, 4), 16) * factor);
  const b = Math.floor(parseInt(hex.slice(4, 6), 16) * factor);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The 2 simple (non-self-intersecting) quads forming the visible "cliff"
 * under an elevated tile at screen center (sx,sy): south-facing and
 * east-facing — the only 2 faces this camera angle ever shows. Each face
 * gets its own depth (southPx/eastPx) since a cell's south and east drops
 * can differ. Direct port of wall_face_points() in app.py.
 */
export function wallFacePoints(sx, sy, halfW, halfH, southPx, eastPx) {
  const left = [sx - halfW, sy];
  const bottom = [sx, sy + halfH];
  const right = [sx + halfW, sy];
  const leftDown = [sx - halfW, sy + southPx];
  const bottomDownSouth = [sx, sy + halfH + southPx];
  const bottomDownEast = [sx, sy + halfH + eastPx];
  const rightDown = [sx + halfW, sy + eastPx];
  return {
    south: [left, bottom, bottomDownSouth, leftDown],
    east: [bottom, right, rightDown, bottomDownEast],
  };
}

/**
 * The 4 WORLD-space corners [top,right,bottom,left] of the parallelogram
 * covering every cell in the inclusive rectangle [r0..r1] x [c0..c1] — a
 * diamond generalized to a whole rectangle of cells (adjacent diamonds
 * tessellate without gaps). Direct port of bounding_parallelogram().
 */
export function boundingParallelogram(r0, r1, c0, c1, originX, originY) {
  const halfW = TILE_W / 2;
  const halfH = TILE_H / 2;
  const [topX, topY] = cellCenter(r0, c0, originX, originY);
  const [rightX, rightY] = cellCenter(r0, c1, originX, originY);
  const [bottomX, bottomY] = cellCenter(r1, c1, originX, originY);
  const [leftX, leftY] = cellCenter(r1, c0, originX, originY);
  return [
    [topX, topY - halfH],
    [rightX + halfW, rightY],
    [bottomX, bottomY + halfH],
    [leftX - halfW, leftY],
  ];
}
