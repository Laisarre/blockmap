// Stair geometry — direct port of the Stair class and compute_staircase_polys
// in app.py. All math here is in WORLD coordinates; callers map through the
// view transform (or not, for export) afterward.

import { boundingParallelogram } from "./geometry.js";
import { HEIGHT_UNIT_PX } from "./constants.js";

// bounding_parallelogram always returns [TOP, RIGHT, BOTTOM, LEFT] regardless
// of climb direction. For each direction this says which 2 of those 4
// corners form the "ground" edge (near/far) and which form the "top" edge.
const STAIR_FOOTPRINT_CORNERS = {
  row_plus: [0, 1, 3, 2], // ground=(TOP,RIGHT), top=(LEFT,BOTTOM)
  row_minus: [3, 2, 0, 1], // ground=(LEFT,BOTTOM), top=(TOP,RIGHT)
  col_plus: [0, 3, 1, 2], // ground=(TOP,LEFT), top=(RIGHT,BOTTOM)
  col_minus: [1, 2, 0, 3], // ground=(RIGHT,BOTTOM), top=(TOP,LEFT)
};

function lerp(p0, p1, t) {
  return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
}

export class Stair {
  constructor(row, col, width, length, height, direction) {
    this.row = row;
    this.col = col;
    this.width = width;
    this.length = length;
    this.height = height;
    this.direction = direction;
  }

  /** [r0,r1,c0,c1]: the inclusive grid rectangle this staircase occupies. */
  cellRange() {
    const { row, col, width, length, direction } = this;
    if (direction === "row_plus") return [row, row + length - 1, col, col + width - 1];
    if (direction === "row_minus") return [row - length + 1, row, col, col + width - 1];
    if (direction === "col_plus") return [row, row + width - 1, col, col + length - 1];
    return [row, row + width - 1, col - length + 1, col]; // col_minus
  }

  containsCell(row, col) {
    const [r0, r1, c0, c1] = this.cellRange();
    return r0 <= row && row <= r1 && c0 <= col && col <= c1;
  }
}

/**
 * Tread + riser polygons for one staircase, in WORLD coordinates.
 *
 * Every riser is exactly one full HEIGHT_UNIT_PX level — never a fractional
 * sliver — so the number of risers always equals `height`. When there's room
 * (length >= height is false, i.e. height < length), the extra cells stay
 * flat at ground level as a walkway leading up to the climb. When there
 * ISN'T room (height >= length), the climb is sliced into `height + 1` equal
 * straight-line sub-divisions of the available footprint instead (1 flat
 * landing slot + one slot per riser), so a tall climb in a short footprint
 * still shows every individual riser rather than collapsing into one
 * oversized block.
 */
export function computeStaircasePolys(stair, originX, originY) {
  const [r0, r1, c0, c1] = stair.cellRange();
  const quad = boundingParallelogram(r0, r1, c0, c1, originX, originY);
  const [giNear, giFar, tiNear, tiFar] = STAIR_FOOTPRINT_CORNERS[stair.direction];
  const groundNear = quad[giNear];
  const groundFar = quad[giFar];
  const topNear = quad[tiNear];
  const topFar = quad[tiFar];

  let numSlots, flatSlots;
  if (stair.height < stair.length) {
    numSlots = stair.length;
    flatSlots = stair.length - stair.height;
  } else {
    numSlots = stair.height + 1;
    flatSlots = 1;
  }

  const treads = [];
  const risers = [];
  let lift = 0;
  for (let i = 0; i < numSlots; i++) {
    const t0 = i / numSlots;
    const t1 = (i + 1) / numSlots;
    const near0 = lerp(groundNear, topNear, t0);
    const near1 = lerp(groundNear, topNear, t1);
    const far0 = lerp(groundFar, topFar, t0);
    const far1 = lerp(groundFar, topFar, t1);
    const prevLift = lift;
    const isFlat = i < flatSlots;
    if (!isFlat) lift += HEIGHT_UNIT_PX;

    treads.push([
      [near1[0], near1[1] - lift],
      [far1[0], far1[1] - lift],
      [far0[0], far0[1] - lift],
      [near0[0], near0[1] - lift],
    ]);
    if (!isFlat) {
      risers.push([
        [near0[0], near0[1] - prevLift],
        [far0[0], far0[1] - prevLift],
        [far0[0], far0[1] - lift],
        [near0[0], near0[1] - lift],
      ]);
    }
  }
  return { treads, risers };
}
