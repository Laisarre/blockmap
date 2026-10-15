// Legend grouping/layout shared between the exported PNG's legend box and
// (indirectly, via usedPaletteEntries) the live sidebar legend built in
// ui.js. Mirrors _draw_pil_legend in app.py.

export function usedPaletteEntries(state, layer) {
  const palette = layer === "zone" ? state.zonePalette : state.settingPalette;
  const counts = state.counts[layer];
  return palette
    .filter((e) => (counts.get(e.color) || 0) > 0)
    .map((e) => ({ color: e.color, name: e.name, count: counts.get(e.color) }));
}

/**
 * Draw the legend box (top-left corner, 16,16) onto ctx — used only for
 * export, since the live view shows an always-on DOM sidebar legend
 * instead. `layer` may be null (a standalone notes+arrows export has no
 * zone/setting layer), in which case only the arrow section is drawn, with
 * no "Arrows" heading (it would be a redundant label over the only
 * content there is — same rule as the desktop app).
 */
export function drawLegendOnCanvas(ctx, state, layer, opts) {
  const { showCounts, legendFontPx, headingFontPx, headingText } = opts;
  const usedEntries = layer ? usedPaletteEntries(state, layer) : [];
  const arrowEntries = state.usedArrowPaletteEntries();
  if (usedEntries.length === 0 && arrowEntries.length === 0) return;

  const swatch = 14;
  const gap = 6;
  const padding = 10;
  const lineH = swatch + 6;

  const legendFont = `${legendFontPx}px "Segoe UI", sans-serif`;
  const headingFont = `${headingFontPx}px "Segoe UI", sans-serif`;
  ctx.font = headingFont;
  const headingMetrics = ctx.measureText(headingText || "Arrows");
  const headingH =
    (headingMetrics.actualBoundingBoxAscent ?? headingFontPx) +
    (headingMetrics.actualBoundingBoxDescent ?? headingFontPx * 0.2) +
    6;

  const label = (entry, count) => (showCounts ? `${entry.name}: ${count}` : entry.name);

  // rows: {color: hexOrNull, text, font} — color null marks the heading row.
  const rows = usedEntries.map((e) => ({ color: e.color, text: label(e, e.count), font: legendFont }));
  if (arrowEntries.length) {
    if (usedEntries.length) rows.push({ color: null, text: headingText || "Arrows", font: headingFont });
    for (const e of arrowEntries) rows.push({ color: e.color, text: label(e, e.count), font: legendFont });
  }

  let maxTextW = 0;
  for (const row of rows) {
    ctx.font = row.font;
    maxTextW = Math.max(maxTextW, ctx.measureText(row.text).width);
  }

  const boxW = padding * 2 + swatch + gap + maxTextW;
  const boxH = padding * 2 + rows.reduce((sum, row) => sum + (row.color === null ? headingH : lineH), 0);
  const x0 = 16;
  const y0 = 16;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#888888";
  ctx.lineWidth = 1;
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeRect(x0, y0, boxW, boxH);

  let ty = y0 + padding;
  for (const row of rows) {
    const sx = x0 + padding;
    ctx.font = row.font;
    ctx.textBaseline = "top";
    if (row.color === null) {
      ctx.fillStyle = "#777777";
      ctx.fillText(row.text, sx, ty);
      ty += headingH;
    } else {
      ctx.fillStyle = row.color;
      ctx.fillRect(sx, ty, swatch, swatch);
      ctx.strokeStyle = "#555555";
      ctx.strokeRect(sx, ty, swatch, swatch);
      ctx.fillStyle = "#222222";
      ctx.fillText(row.text, sx + swatch + gap, ty);
      ty += lineH;
    }
  }
}
