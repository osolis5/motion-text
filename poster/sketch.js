// ==========================================
// GENERATIVE TYPE POSTER ENGINE
// P5.js — raw, electric, confrontational
// UV palette on void — 22" x 30" (11:15)
// ==========================================

const POSTER_RATIO = 11 / 15;
const POSTER_H = 900;
const POSTER_W = Math.round(POSTER_H * POSTER_RATIO); // 660

// Reference size used for cached point sampling in Flow mode.
// Points are sampled at this size, then scaled per-render.
const REF_SIZE = 400;

// --- Tweakable Parameters (bound to UI) ---
const params = {
  // Render mode
  renderMode: 'solid', // 'solid' | 'flow'

  // Typography
  text: 'MOTION',
  fontFamily: 'Anton',
  textScale: 0.92,
  lineHeight: 0.82,

  // Distortion (per-character transform)
  distortAmount: 35,
  distortSpeed: 0.4,
  distortScale: 0.5,
  rotationAmount: 0.02,
  scaleAmount: 0.06,

  // Flow — vertex deformation
  sampleDensity: 0.35,
  vertexNoiseAmount: 10,
  vertexNoiseScale: 0.012,

  // Color — UV palette
  hueBase: 265,
  hueRange: 40,
  saturation: 80,
  lightness: 60,
  glowAmount: 15,

  // Animation
  gradientSpeed: 0.3,
  trailOpacity: 12,

  // Layers
  layerCount: 3,
  layerSpread: 18,
  layerScale: 0.12,

  // State
  animate: true,
  seed: 42,
};

// --- Internal state ---
let time = 0;
let pg;
let displayX, displayY, displayW, displayH;

// --- Flow mode font + point cache ---
let ballPillFont = null;
let pointsCache = new Map(); // key: `${char}|${sampleDensity}` -> { subpaths, bounds }

// ===================
// Preload
// ===================

function preload() {
  ballPillFont = loadFont(
    'fonts/BallPill-Regular.otf',
    () => console.log('[poster] Ball Pill loaded'),
    (err) => console.warn('[poster] Ball Pill failed to load', err)
  );
}

// ===================
// P5.js Lifecycle
// ===================

function setup() {
  let container = document.getElementById('poster-container');
  let canvas = createCanvas(container.clientWidth, container.clientHeight);
  canvas.parent('poster-container');
  pixelDensity(1);

  pg = createGraphics(POSTER_W, POSTER_H);
  pg.pixelDensity(1);

  noiseSeed(params.seed);
  calculateDisplay();
  bindControls();

  // Fill poster with void
  pg.background(5, 2, 8);
}

function draw() {
  // Editor background
  background(7, 6, 14);

  if (params.animate) {
    time += deltaTime * 0.001;
  }

  renderPoster(pg);

  // Draw poster centered in preview area
  image(pg, displayX, displayY, displayW, displayH);

  // Thin UV border around poster
  noFill();
  stroke(168, 85, 247, 25);
  strokeWeight(1);
  rect(displayX - 1, displayY - 1, displayW + 2, displayH + 2);
}

function windowResized() {
  let container = document.getElementById('poster-container');
  resizeCanvas(container.clientWidth, container.clientHeight);
  calculateDisplay();
}

// ===================
// Display layout
// ===================

function calculateDisplay() {
  let pad = 30;
  let availW = width - pad * 2;
  let availH = height - pad * 2;

  if (POSTER_RATIO < availW / availH) {
    displayH = availH;
    displayW = displayH * POSTER_RATIO;
  } else {
    displayW = availW;
    displayH = displayW / POSTER_RATIO;
  }

  displayX = (width - displayW) / 2;
  displayY = (height - displayH) / 2;
}

// ===================
// Poster Rendering
// ===================

function renderPoster(g) {
  // Trail: semi-transparent void overlay
  g.noStroke();
  g.fill(5, 2, 12, params.trailOpacity);
  g.rect(0, 0, g.width, g.height);

  // Subtle background pulse
  renderBackgroundPulse(g);

  // Parse characters
  let chars = params.text.toUpperCase().split('');
  if (chars.length === 0) return;

  let charSize = calculateCharSize(g, chars);
  let positions = calculatePositions(g, chars, charSize);

  // Breathing amplitude — the poster inhales and exhales
  let breathe = 0.65 + 0.35 * Math.sin(time * 0.4);

  // Render layers back-to-front
  let renderFn = (params.renderMode === 'flow' && ballPillFont)
    ? renderTextLayerFlow
    : renderTextLayer;

  for (let l = params.layerCount - 1; l >= 0; l--) {
    let t = params.layerCount > 1 ? l / (params.layerCount - 1) : 0;
    renderFn(g, chars, positions, charSize, l, t, breathe);
  }

  // Top-layer scanline grain
  renderGrain(g);
}

function renderBackgroundPulse(g) {
  let pulse = noise(time * 0.08) * 6;
  let hue = params.hueBase + 30 + Math.sin(time * 0.2) * 15;
  let cx = g.width * (0.4 + 0.2 * Math.sin(time * 0.15));
  let cy = g.height * (0.4 + 0.2 * Math.cos(time * 0.12));
  let maxR = g.width * 0.9;

  g.noStroke();
  for (let r = maxR; r > 0; r -= maxR / 6) {
    let t = r / maxR;
    let a = pulse * (1 - t) * 0.25;
    let [cr, cg, cb] = hslToRgb(hue, 50, 10);
    g.fill(cr, cg, cb, a);
    g.ellipse(cx, cy, r * 2, r * 2);
  }
}

function renderTextLayer(g, chars, positions, charSize, layerIdx, t, breathe) {
  // t: 0 = front layer, 1 = back layer
  // Oscillate within UV range instead of cycling through full spectrum
  let hueOsc = Math.sin(time * params.gradientSpeed) * params.hueRange * 0.5;
  let hue = params.hueBase + t * params.hueRange * 0.5 + hueOsc;
  let sat = params.saturation;
  let lit = params.lightness + t * 18;
  let alpha = lerp(235, 40, t);
  let distMult = lerp(1.0, 2.8, t) * breathe;
  let scaleMult = 1 + t * params.layerScale;

  // Back layers drift organically
  let spreadX = t * params.layerSpread * (noise(time * 0.15 + layerIdx * 10) - 0.5) * 2;
  let spreadY = t * params.layerSpread * 0.4 * (noise(time * 0.12 + layerIdx * 20 + 50) - 0.5) * 2;

  g.push();
  g.translate(spreadX, spreadY);
  g.textAlign(CENTER, CENTER);
  g.textSize(charSize * scaleMult);
  g.textFont(params.fontFamily);

  for (let i = 0; i < chars.length; i++) {
    let [bx, by] = positions[i];

    // Noise displacement per character
    let nOff = i * params.distortScale;
    let tSpeed = time * params.distortSpeed;
    let nx = (noise(nOff, tSpeed, 0) - 0.5) * 2;
    let ny = (noise(nOff, tSpeed, 100) - 0.5) * 2;
    let nr = (noise(nOff, tSpeed, 200) - 0.5) * 2;
    let ns = noise(nOff, tSpeed, 300);

    let x = bx + nx * params.distortAmount * distMult;
    let y = by + ny * params.distortAmount * distMult * 0.5;

    g.push();
    g.translate(x, y);
    g.rotate(nr * params.rotationAmount * distMult);
    let s = scaleMult + (ns - 0.5) * params.scaleAmount * distMult;
    g.scale(s);

    // Per-character hue shift across the UV spectrum
    let charHue = (hue + i * (params.hueRange / Math.max(chars.length, 1))) % 360;
    let [cr, cg, cb] = hslToRgb(charHue, sat, lit);

    // Glow — phosphorescent UV bleed
    if (params.glowAmount > 0) {
      g.drawingContext.shadowColor = `rgba(${cr}, ${cg}, ${cb}, 0.55)`;
      g.drawingContext.shadowBlur = params.glowAmount * (1 - t * 0.4);
    }

    g.fill(cr, cg, cb, alpha);
    g.noStroke();
    g.text(chars[i], 0, 0);

    g.drawingContext.shadowBlur = 0;
    g.pop();
  }

  g.pop();
}

// ===================
// Flow Mode — Vertex-deformed glyphs
// ===================

function renderTextLayerFlow(g, chars, positions, charSize, layerIdx, t, breathe) {
  // t: 0 = front, 1 = back
  let hueOsc = Math.sin(time * params.gradientSpeed) * params.hueRange * 0.5;
  let hue = params.hueBase + t * params.hueRange * 0.5 + hueOsc;
  let sat = params.saturation;
  let lit = params.lightness + t * 18;
  let alpha = lerp(235, 40, t);
  let distMult = lerp(1.0, 2.8, t) * breathe;
  let scaleMult = 1 + t * params.layerScale;
  let vertexAmplify = 1 + t * 0.8; // back layers ripple more

  // Layer drift
  let spreadX = t * params.layerSpread * (noise(time * 0.15 + layerIdx * 10) - 0.5) * 2;
  let spreadY = t * params.layerSpread * 0.4 * (noise(time * 0.12 + layerIdx * 20 + 50) - 0.5) * 2;

  // Render scale: display-space size per reference-space unit
  let renderScale = (charSize * scaleMult) / REF_SIZE;

  g.push();
  g.translate(spreadX, spreadY);

  for (let i = 0; i < chars.length; i++) {
    let [bx, by] = positions[i];

    // Per-character transform noise (same pattern as solid mode)
    let nOff = i * params.distortScale;
    let tSpeed = time * params.distortSpeed;
    let nx = (noise(nOff, tSpeed, 0) - 0.5) * 2;
    let ny = (noise(nOff, tSpeed, 100) - 0.5) * 2;
    let nr = (noise(nOff, tSpeed, 200) - 0.5) * 2;
    let ns = noise(nOff, tSpeed, 300);

    let x = bx + nx * params.distortAmount * distMult;
    let y = by + ny * params.distortAmount * distMult * 0.5;

    g.push();
    g.translate(x, y);
    g.rotate(nr * params.rotationAmount * distMult);
    let s = 1 + (ns - 0.5) * params.scaleAmount * distMult;
    g.scale(s);

    // Per-character hue shift
    let charHue = (hue + i * (params.hueRange / Math.max(chars.length, 1))) % 360;
    let [cr, cg, cb] = hslToRgb(charHue, sat, lit);

    if (params.glowAmount > 0) {
      g.drawingContext.shadowColor = `rgba(${cr}, ${cg}, ${cb}, 0.55)`;
      g.drawingContext.shadowBlur = params.glowAmount * (1 - t * 0.4);
    }

    g.fill(cr, cg, cb, alpha);
    g.noStroke();

    // Draw vertex-deformed glyph
    let data = getCharData(chars[i]);
    drawDeformedGlyph(g, data, renderScale, vertexAmplify);

    g.drawingContext.shadowBlur = 0;
    g.pop();
  }

  g.pop();
}

function drawDeformedGlyph(g, data, renderScale, amountMult) {
  if (!data || !data.subpaths || data.subpaths.length === 0) return;

  let vScale = params.vertexNoiseScale;
  let amount = params.vertexNoiseAmount * amountMult;
  let tPhase = time * params.distortSpeed * 0.5;

  g.beginShape();
  for (let subIdx = 0; subIdx < data.subpaths.length; subIdx++) {
    let sp = data.subpaths[subIdx];

    if (subIdx > 0) g.beginContour();

    for (let p of sp) {
      let px = p.x * renderScale;
      let py = p.y * renderScale;

      // Flow-field noise in display space
      let nx = (noise(px * vScale, py * vScale, tPhase) - 0.5) * 2 * amount;
      let ny = (noise(px * vScale, py * vScale, tPhase + 100) - 0.5) * 2 * amount;

      g.vertex(px + nx, py + ny);
    }

    if (subIdx > 0) g.endContour();
  }
  g.endShape(CLOSE);
}

// Fetch (and cache) centered outline points + subpaths for a character.
// Points are sampled once at REF_SIZE and scaled per-render.
function getCharData(char) {
  if (!ballPillFont) return null;

  let key = char + '|' + params.sampleDensity.toFixed(2);
  if (pointsCache.has(key)) return pointsCache.get(key);

  let raw;
  try {
    raw = ballPillFont.textToPoints(char, 0, 0, REF_SIZE, {
      sampleFactor: params.sampleDensity,
      simplifyThreshold: 0,
    });
  } catch (e) {
    console.warn('textToPoints failed for', char, e);
    return null;
  }

  if (!raw || raw.length === 0) {
    pointsCache.set(key, { subpaths: [], bounds: { w: 0, h: 0 } });
    return pointsCache.get(key);
  }

  // Bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;

  // Center points around (0, 0) so per-char transforms rotate around the glyph center
  let centered = raw.map(p => ({ x: p.x - cx, y: p.y - cy }));

  let subpaths = splitIntoSubpaths(centered);

  let data = {
    subpaths,
    bounds: { w: maxX - minX, h: maxY - minY },
  };
  pointsCache.set(key, data);
  return data;
}

// Adaptively split a flat point array into subpaths by detecting gaps.
// textToPoints walks subpaths sequentially but doesn't mark boundaries —
// a "big jump" between consecutive points means a new subpath started
// (e.g., inner ring of an O).
function splitIntoSubpaths(points) {
  if (points.length < 3) return [];

  // Compute inter-point distances
  let dists = new Array(points.length - 1);
  for (let i = 1; i < points.length; i++) {
    dists[i - 1] = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }

  // Adaptive threshold: 5× median of sampled distances (min 20px)
  let sorted = [...dists].sort((a, b) => a - b);
  let median = sorted[Math.floor(sorted.length / 2)] || 1;
  let threshold = Math.max(median * 5, 20);

  let subpaths = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i++) {
    if (dists[i - 1] > threshold) {
      if (current.length >= 3) subpaths.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length >= 3) subpaths.push(current);

  return subpaths;
}

function clearPointsCache() {
  pointsCache.clear();
}

function renderGrain(g) {
  // Subtle scanline texture — projection artifact feel
  g.drawingContext.globalCompositeOperation = 'overlay';
  for (let y = 0; y < g.height; y += 3) {
    let a = noise(y * 0.5, time * 2) * 8;
    g.stroke(255, 255, 255, a);
    g.strokeWeight(0.5);
    g.line(0, y, g.width, y);
  }
  g.drawingContext.globalCompositeOperation = 'source-over';
}

// ===================
// Text Layout
// ===================

function calculateCharSize(g, chars) {
  // Flow mode uses cached point bounds (at REF_SIZE)
  if (params.renderMode === 'flow' && ballPillFont) {
    return calculateCharSizeFlow(g, chars);
  }

  g.textFont(params.fontFamily);
  g.textSize(100);

  let maxW = 0;
  for (let c of chars) {
    let w = g.textWidth(c);
    if (w > maxW) maxW = w;
  }

  if (maxW === 0) return 100;

  // Size to fill width
  let targetW = g.width * params.textScale;
  let sizeByWidth = 100 * (targetW / maxW);

  // Constrain so total stack fits within poster height
  let lineH = sizeByWidth * params.lineHeight;
  let totalH = chars.length * lineH;
  let maxH = g.height * 0.88;

  if (totalH > maxH) {
    sizeByWidth *= maxH / totalH;
  }

  return sizeByWidth;
}

// Flow-mode sizing uses cached REF_SIZE bounds instead of textWidth()
// because textWidth doesn't know about the loaded p5.Font glyph metrics
// the same way textToPoints does.
function calculateCharSizeFlow(g, chars) {
  // Find widest and tallest character bounds (in REF_SIZE space)
  let maxW = 0;
  let maxHRef = 0;
  for (let c of chars) {
    let data = getCharData(c);
    if (!data) continue;
    if (data.bounds.w > maxW) maxW = data.bounds.w;
    if (data.bounds.h > maxHRef) maxHRef = data.bounds.h;
  }

  if (maxW === 0) return 100;

  // Target display width
  let targetW = g.width * params.textScale;
  let sizeByWidth = REF_SIZE * (targetW / maxW);

  // Height constraint must account for ACTUAL glyph height, not just line
  // height — glyphs extend beyond the line box at the top and bottom of
  // the stack. Total visual height = (n-1)*lineH + glyphH.
  let lineH = sizeByWidth * params.lineHeight;
  let glyphDisplayH = (maxHRef / REF_SIZE) * sizeByWidth;
  let totalVisualH = (chars.length - 1) * lineH + glyphDisplayH;
  // Padding for vertex noise amplitude (glyphs ripple outside their bounds)
  totalVisualH += params.vertexNoiseAmount * 2.5;

  let maxDisplayH = g.height * 0.92;
  if (totalVisualH > maxDisplayH) {
    sizeByWidth *= maxDisplayH / totalVisualH;
  }

  return sizeByWidth;
}

function calculatePositions(g, chars, charSize) {
  let positions = [];
  let lineH = charSize * params.lineHeight;
  let totalH = chars.length * lineH;

  // Baseline offset differs between modes:
  // - Solid uses text() with textAlign(CENTER, CENTER) — baseline sits
  //   slightly above visual center, so we push down ~0.42 * lineH.
  // - Flow uses pre-centered glyph points (origin at bounding-box center),
  //   so the center of the first char should be at lineH / 2 from the top.
  let baseOffset = params.renderMode === 'flow' ? lineH * 0.5 : lineH * 0.42;
  let startY = (g.height - totalH) / 2 + baseOffset;

  for (let i = 0; i < chars.length; i++) {
    positions.push([g.width / 2, startY + i * lineH]);
  }
  return positions;
}

// ===================
// Color Utilities
// ===================

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s;
  let x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let m = l - c / 2;

  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ===================
// UI Binding
// ===================

function bindControls() {
  // Text input
  let textInput = document.getElementById('ctrl-text');
  if (textInput) {
    textInput.value = params.text;
    textInput.addEventListener('input', (e) => {
      params.text = e.target.value || 'TYPE';
      pg.background(5, 2, 8);
    });
  }

  // Font select
  let fontSelect = document.getElementById('ctrl-font');
  if (fontSelect) {
    fontSelect.value = params.fontFamily;
    fontSelect.addEventListener('change', (e) => {
      params.fontFamily = e.target.value;
      pg.background(5, 2, 8);
    });
  }

  // Render mode toggle
  let modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      let mode = btn.getAttribute('data-mode');
      if (mode === params.renderMode) return;
      params.renderMode = mode;
      document.body.classList.toggle('mode-flow', mode === 'flow');
      document.body.classList.toggle('mode-solid', mode === 'solid');
      modeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      pg.background(5, 2, 8);
    });
  });
  // Initialize body class
  document.body.classList.toggle('mode-flow', params.renderMode === 'flow');
  document.body.classList.toggle('mode-solid', params.renderMode === 'solid');

  // All range sliders
  bindRange('ctrl-textScale', 'textScale');
  bindRange('ctrl-lineHeight', 'lineHeight');
  bindRange('ctrl-distortAmount', 'distortAmount');
  bindRange('ctrl-distortSpeed', 'distortSpeed');
  bindRange('ctrl-distortScale', 'distortScale');
  bindRange('ctrl-rotationAmount', 'rotationAmount');
  bindRange('ctrl-hueBase', 'hueBase');
  bindRange('ctrl-hueRange', 'hueRange');
  bindRange('ctrl-saturation', 'saturation');
  bindRange('ctrl-lightness', 'lightness');
  bindRange('ctrl-glowAmount', 'glowAmount');
  bindRange('ctrl-gradientSpeed', 'gradientSpeed');
  bindRange('ctrl-trailOpacity', 'trailOpacity');
  bindRange('ctrl-layerCount', 'layerCount');
  bindRange('ctrl-layerSpread', 'layerSpread');
  bindRange('ctrl-layerScale', 'layerScale');

  // Flow-only controls — sample density invalidates the point cache
  bindRange('ctrl-sampleDensity', 'sampleDensity', clearPointsCache);
  bindRange('ctrl-vertexNoiseAmount', 'vertexNoiseAmount');
  bindRange('ctrl-vertexNoiseScale', 'vertexNoiseScale');

  // Pause / Play
  let pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      params.animate = !params.animate;
      pauseBtn.textContent = params.animate ? 'PAUSE' : 'PLAY';
    });
  }

  // Clear trails
  let clearBtn = document.getElementById('btn-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => pg.background(5, 2, 8));
  }

  // Save PNG
  let saveBtn = document.getElementById('btn-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      pg.save('poster-' + Date.now() + '.png');
    });
  }

  // New seed
  let seedBtn = document.getElementById('btn-seed');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      params.seed = Math.floor(Math.random() * 10000);
      noiseSeed(params.seed);
      let display = document.getElementById('seed-display');
      if (display) display.textContent = params.seed;
      pg.background(5, 2, 8);
    });
  }
}

function bindRange(elementId, paramKey, onChange) {
  let el = document.getElementById(elementId);
  if (!el) return;

  el.value = params[paramKey];
  let valDisplay = document.getElementById(elementId + '-val');
  if (valDisplay) valDisplay.textContent = params[paramKey];

  el.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    params[paramKey] = val;
    if (valDisplay) valDisplay.textContent = val;
    if (typeof onChange === 'function') onChange();
  });
}
