// =====================================================
// POSTER SYSTEM
// =====================================================
// Shared overlay convention for the Motion Text poster
// series (gestures, displace, bitmap, horizon, future
// pieces). Each poster calls POSTER_SYSTEM.drawOverlay(
// ctx, cfg) from its render loop, passing a
// CanvasRenderingContext2D and a config object.
//
// Renderer-agnostic — works with any 2D canvas context:
//   • p5 posters → pass `drawingContext` (p5's built-in
//     handle to the main canvas's 2D context)
//   • Three.js posters → pass a dedicated overlay
//     canvas's context, composited on top of the GL
//     canvas
//
// Renders up to 5 labels onto the target context:
//
//   ┌──────────────────────────────────┐
//   │[EXPERIMENT 04]    [GESTURE · X]  │  ← top strip
//   │                                  │
//   │[DISPLACE · TEXT]                 │  ← vertical mid
//   │                                  │
//   │                                  │
//   │[MOTION.TEXT 2026]  [REFRACT · 90]│  ← bottom strip
//   └──────────────────────────────────┘
//
// Config (all optional unless noted):
//   experimentId:     string  e.g. '04' → "EXPERIMENT 04"
//   seriesName:       string  e.g. 'DISPLACE' → vertical label
//   projectName:      string  (default "MOTION.TEXT")
//   year:             string  (default "2026")
//   topRight:         string  top-right dynamic slot (or null)
//   bottomRight:      string  bottom-right dynamic slot
//   verticalContent:  string  extra content after series name
//   invert:           bool    flip bg/fg for dark canvases
//   hidden:           bool    skip drawing entirely
//   posterW/posterH:  number  override canvas dimensions
//   showTop/Bottom/Vertical: bool  skip individual strips
//                                  (for horizon's split bg)
//
// Why draw on the canvas (not HTML overlays)?
//   1. PNG exports can include the metadata — critical
//      for projection-mapped output
//   2. The labels are part of the poster's identity
//   3. Swapping to projection output is a single `hidden`
//      flag
// =====================================================

(function() {
  const DEFAULTS = {
    projectName: 'MOTION.TEXT',
    year: '2026',
    font: 'IBM Plex Mono',
    fontSize: 10,
    edgePad: 14,
    labelPadX: 8,
    labelH: 16,
    invert: false,
    hidden: false,
    verticalMaxChars: 30,
    // Per-strip visibility — used by horizon's split-bg
    // composition where top and bottom need opposite inverts
    showTop: true,
    showBottom: true,
    showVertical: true,
  };

  // Draw a label rectangle with text, positioned with its top-left
  // corner at (rectX, rectY). Pure Canvas 2D API — no p5 globals.
  function drawLabelAt(ctx, str, rectX, rectY, bg, fg, padX, h) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const tw = ctx.measureText(str).width;
    const rw = tw + padX * 2;
    ctx.fillStyle = bg;
    ctx.fillRect(rectX, rectY, rw, h);
    ctx.fillStyle = fg;
    ctx.fillText(str, rectX + padX, rectY + h / 2);
    return rw;
  }

  // Main entry point — renders the full 5-slot poster overlay
  // onto the given 2D context.
  function drawOverlay(ctx, cfg) {
    if (!ctx) return;
    const c = Object.assign({}, DEFAULTS, cfg || {});
    if (c.hidden) return;

    const W  = c.posterW || ctx.canvas.width;
    const H  = c.posterH || ctx.canvas.height;
    const ep = c.edgePad;
    const px = c.labelPadX;
    const h  = c.labelH;
    // Alpha 0.92 ≈ the old p5 `fill(bg, 235)` (235/255)
    const fg = c.invert ? 'rgb(255,255,255)' : 'rgb(0,0,0)';
    const bg = c.invert ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.92)';

    ctx.save();
    ctx.font = c.fontSize + 'px "' + c.font + '", monospace';

    // --- Top strip ---
    if (c.showTop) {
      if (c.experimentId !== null) {
        const expText = 'EXPERIMENT ' + (c.experimentId || '--');
        drawLabelAt(ctx, expText, ep, ep, bg, fg, px, h);
      }
      if (c.topRight) {
        const tw = ctx.measureText(c.topRight).width;
        const rw = tw + px * 2;
        drawLabelAt(ctx, c.topRight, W - ep - rw, ep, bg, fg, px, h);
      }
    }

    // --- Bottom strip ---
    if (c.showBottom) {
      if (c.projectName !== null) {
        const projText = c.projectName + ' ' + c.year;
        drawLabelAt(ctx, projText, ep, H - ep - h, bg, fg, px, h);
      }
      if (c.bottomRight) {
        const tw = ctx.measureText(c.bottomRight).width;
        const rw = tw + px * 2;
        drawLabelAt(ctx, c.bottomRight, W - ep - rw, H - ep - h, bg, fg, px, h);
      }
    }

    // --- Vertical mid-left: series name + content, rotated 90° CCW ---
    if (c.showVertical && (c.seriesName || c.verticalContent)) {
      let vl = c.seriesName || '';
      if (c.verticalContent) {
        vl += (vl ? ' · ' : '') + c.verticalContent;
      }
      if (vl.length > c.verticalMaxChars) {
        vl = vl.slice(0, c.verticalMaxChars - 1) + '…';
      }
      const tw = ctx.measureText(vl).width;
      const rw = tw + px * 2;
      ctx.save();
      ctx.translate(ep + h / 2, H / 2);
      ctx.rotate(-Math.PI / 2);
      drawLabelAt(ctx, vl, -rw / 2, -h / 2, bg, fg, px, h);
      ctx.restore();
    }

    ctx.restore();
  }

  // Clear the full canvas — convenience for Three.js posters
  // that use a dedicated overlay canvas and need to wipe it
  // each frame before redrawing the labels.
  function clear(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  window.POSTER_SYSTEM = {
    drawOverlay: drawOverlay,
    clear: clear,
    DEFAULTS: DEFAULTS,
  };
})();
