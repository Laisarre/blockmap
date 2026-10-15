// Core tile/view constants and default palettes — direct port of the
// corresponding constants at the top of app.py. Keep numeric values in sync
// with the desktop app if either one changes.

export const TILE_W = 64;
export const TILE_H = 32;
export const UNPAINTED = "#e8e8e8";
export const GRID_LINE = "#9a9a9a";
export const HANDLE_SIZE = 10;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 1.1;
export const HEIGHT_UNIT_PX = 10;
export const HEIGHT_WALL_SHADE = 0.6;
export const STAIR_COLOR = "#8a5a2b";
export const STAIR_RISER_SHADE = 0.7;
export const STAIR_DEFAULT_WIDTH = 1;
export const STAIR_DEFAULT_LENGTH = 1;
export const STAIR_DEFAULT_HEIGHT = 1;

export const STAIR_DIRECTIONS = ["row_plus", "row_minus", "col_plus", "col_minus"];
// Labels name the screen direction the stair climbs toward, away from the
// clicked (ground-level) cell — much easier to reason about on sight than
// the row_plus/col_minus data values, which stay unchanged for saved files.
export const STAIR_DIRECTION_LABELS = {
  row_plus: "↙ Down-left",
  row_minus: "↗ Up-right",
  col_plus: "↘ Down-right",
  col_minus: "↖ Up-left",
};

export const DEFAULT_ZONE_PALETTE = [
  { color: "#f4a6a6", name: "Quest area" },
  { color: "#a6c8f4", name: "Combat area" },
  { color: "#a6f4b8", name: "Safe zone" },
  { color: "#f4e2a6", name: "Puzzle area" },
];

export const DEFAULT_SETTING_PALETTE = [
  { color: "#7fb069", name: "Forest" },
  { color: "#d9b382", name: "Desert" },
  { color: "#4a90c4", name: "Water" },
  { color: "#8c8c8c", name: "Rocks" },
];

export const DEFAULT_ARROW_PALETTE = [{ color: "#333333", name: "Movement" }];

export const GRID_MIN = 1;
export const GRID_MAX = 60;
