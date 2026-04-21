// =====================================================
// PROJECTION MAPPING
// =====================================================
// A shared projection-mapping layer for the Motion Text
// poster series. Warps the `#sketch` container of the
// current poster into an arbitrary 4-corner quadrilateral
// via CSS `matrix3d`, and persists the calibration in
// localStorage so it carries across every poster in the
// collection.
//
// USAGE
//   <script src="projection-mapping.js"></script>
//   (no other code required — auto-detects #sketch)
//
// KEY
//   P cycles through OFF → EDIT → ON → OFF
//     OFF  — no transform, canvas renders normally
//     EDIT — transform applied + draggable corner handles
//            shown so you can calibrate against the
//            physical projection surface
//     ON   — transform applied, no handles (clean
//            projection output for performance / recording)
//
// PERSISTENCE
//   All state (mode + corner positions) is stored under a
//   single localStorage key. Navigate to any other poster,
//   it reloads the exact same transform. Calibrate once,
//   project anywhere.
//
// MATH
//   Given 4 source corners (0,0)→(W,0)→(W,H)→(0,H) and 4
//   destination corners, compute a 3×3 projective transform
//   using the classic "two unit-square mappings" approach,
//   then convert to a CSS matrix3d string. The math is
//   lifted from Jim Blinn's derivation:
//     https://franklinta.com/2014/09/08/computing-css-matrix3d-transforms/
//
// NOTES
//   • Corners are stored as normalized (0..1) so the same
//     calibration works across different viewport sizes.
//   • The warp is re-applied on window.resize since the
//     pixel-space corner positions depend on the current
//     #sketch bounding rect.
//   • Handles are position:fixed so they follow the warped
//     element even after the matrix is applied (they sit
//     outside the warped container, in screen space).
// =====================================================

(function() {
  const STORAGE_KEY = 'motion-text-projection';
  const STATES = ['off', 'edit', 'on'];

  let targetEl = null;
  let state = 'off';
  let corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; // normalized
  let uiRoot = null;
  let handles = [];
  let hintEl = null;

  // ---------- Matrix math (projective transform) ----------

  function adj(m) {
    return [
      m[4]*m[8] - m[5]*m[7], m[2]*m[7] - m[1]*m[8], m[1]*m[5] - m[2]*m[4],
      m[5]*m[6] - m[3]*m[8], m[0]*m[8] - m[2]*m[6], m[2]*m[3] - m[0]*m[5],
      m[3]*m[7] - m[4]*m[6], m[1]*m[6] - m[0]*m[7], m[0]*m[4] - m[1]*m[3],
    ];
  }

  function multmm(a, b) {
    const c = new Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let cij = 0;
        for (let k = 0; k < 3; k++) cij += a[3*i + k] * b[3*k + j];
        c[3*i + j] = cij;
      }
    }
    return c;
  }

  function multmv(m, v) {
    return [
      m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
      m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
      m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
    ];
  }

  // Maps (0,0)(1,0)(0,1)(1,1) → (x1,y1)(x2,y2)(x3,y3)(x4,y4).
  // Note the odd order: this is the canonical unit-square-to-quad
  // basis mapping used in Blinn/Franklin Ta's derivation.
  function basisToPoints(x1, y1, x2, y2, x3, y3, x4, y4) {
    const m = [
      x1, x2, x3,
      y1, y2, y3,
      1,  1,  1,
    ];
    const v = multmv(adj(m), [x4, y4, 1]);
    return multmm(m, [
      v[0], 0,    0,
      0,    v[1], 0,
      0,    0,    v[2],
    ]);
  }

  // Returns a 3×3 projective matrix mapping source quad to dest quad.
  function general2DProjection(
    x1s, y1s, x1d, y1d,
    x2s, y2s, x2d, y2d,
    x3s, y3s, x3d, y3d,
    x4s, y4s, x4d, y4d
  ) {
    const s = basisToPoints(x1s, y1s, x2s, y2s, x3s, y3s, x4s, y4s);
    const d = basisToPoints(x1d, y1d, x2d, y2d, x3d, y3d, x4d, y4d);
    return multmm(d, adj(s));
  }

  // 3×3 projective matrix → CSS matrix3d (column-major 4×4).
  function transform2DToCss(t) {
    // Normalize so t[8] == 1 (affine homogeneous scaling).
    const k = t[8];
    for (let i = 0; i < 9; i++) t[i] = t[i] / k;
    return 'matrix3d(' + [
      t[0], t[3], 0, t[6],
      t[1], t[4], 0, t[7],
      0,    0,    1, 0,
      t[2], t[5], 0, t[8],
    ].join(',') + ')';
  }

  // ---------- Core state ----------

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, corners }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && STATES.indexOf(saved.state) !== -1) {
        state = saved.state;
      }
      if (saved && Array.isArray(saved.corners) && saved.corners.length === 4) {
        corners = saved.corners.map(c => [c[0], c[1]]);
      }
    } catch (e) {}
  }

  // Preserve the host poster's pre-existing inline transform (e.g.
  // Inflate's `transform: scale(...)` fit-to-viewport). When we enter
  // EDIT/ON we replace it with matrix3d; when we return to OFF we put
  // the saved transform back. Otherwise we'd silently wipe whatever
  // the poster set.
  let savedTransform = null;
  let savedOrigin    = null;

  function applyTransform() {
    if (!targetEl) return;
    if (state === 'off') {
      if (savedTransform !== null) {
        targetEl.style.transform = savedTransform;
        targetEl.style.transformOrigin = savedOrigin || '';
        savedTransform = null;
        savedOrigin = null;
      }
      return;
    }
    // Entering a warp — snapshot whatever inline transform the poster
    // was using so we can restore it later.
    if (savedTransform === null) {
      savedTransform = targetEl.style.transform || '';
      savedOrigin    = targetEl.style.transformOrigin || '';
    }
    const rect = targetEl.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw < 2 || ch < 2) return;
    const d = corners.map(c => [c[0] * cw, c[1] * ch]);
    const t = general2DProjection(
      0,  0,  d[0][0], d[0][1],
      cw, 0,  d[1][0], d[1][1],
      cw, ch, d[2][0], d[2][1],
      0,  ch, d[3][0], d[3][1]
    );
    targetEl.style.transformOrigin = '0 0';
    targetEl.style.transform = transform2DToCss(t);
  }

  // ---------- Edit UI ----------

  function ensureUI() {
    if (uiRoot) return;
    uiRoot = document.createElement('div');
    uiRoot.id = 'projection-mapping-ui';
    uiRoot.style.cssText = [
      'position: fixed',
      'inset: 0',
      'pointer-events: none',
      'z-index: 250',
      'display: none',
    ].join(';');
    document.body.appendChild(uiRoot);

    const LABELS = ['TL', 'TR', 'BR', 'BL'];
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'projection-handle';
      h.dataset.idx = i;
      h.textContent = LABELS[i];
      h.style.cssText = [
        'position: absolute',
        'width: 22px',
        'height: 22px',
        'margin: -11px 0 0 -11px',
        'border: 2px solid #ff2ea6',
        'background: rgba(255, 46, 166, 0.18)',
        'border-radius: 50%',
        'cursor: move',
        'pointer-events: auto',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'font: 8px/1 "IBM Plex Mono", monospace',
        'color: #ff2ea6',
        'letter-spacing: 1px',
        'user-select: none',
        'touch-action: none',
        'box-shadow: 0 0 18px rgba(255, 46, 166, 0.35)',
      ].join(';');
      uiRoot.appendChild(h);
      handles.push(h);
      attachDrag(h, i);
    }

    hintEl = document.createElement('div');
    hintEl.style.cssText = [
      'position: absolute',
      'top: 22px',
      'left: 50%',
      'transform: translateX(-50%)',
      'padding: 6px 12px',
      'background: rgba(255, 46, 166, 0.12)',
      'border: 1px solid rgba(255, 46, 166, 0.5)',
      'color: #ff2ea6',
      'font: 10px/1 "IBM Plex Mono", monospace',
      'letter-spacing: 2px',
      'text-transform: uppercase',
      'pointer-events: auto',
      'user-select: none',
    ].join(';');
    hintEl.textContent = 'PROJECTION · EDIT — DRAG CORNERS · P TO CYCLE · R TO RESET';
    uiRoot.appendChild(hintEl);
  }

  function attachDrag(handle, idx) {
    let startX, startY, startCorner, rect;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startCorner = [corners[idx][0], corners[idx][1]];
      rect = targetEl.getBoundingClientRect();
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const dx = (e.clientX - startX) / rect.width;
      const dy = (e.clientY - startY) / rect.height;
      corners[idx] = [startCorner[0] + dx, startCorner[1] + dy];
      applyTransform();
      positionHandles();
    });
    handle.addEventListener('pointerup', (e) => {
      if (handle.hasPointerCapture(e.pointerId)) {
        handle.releasePointerCapture(e.pointerId);
      }
      saveState();
    });
  }

  function positionHandles() {
    if (!targetEl || !uiRoot) return;
    const rect = targetEl.getBoundingClientRect();
    // Corners in untransformed CSS box → post-transform screen via
    // element transform; but reading from getBoundingClientRect on
    // targetEl already gives the WARPED bounds, so we need to
    // apply the matrix manually to get the screen corner positions.
    // Simpler: compute target-space corners and translate by the
    // target's layout top-left (pre-transform origin at 0,0 with
    // transform-origin: 0 0, so the element's offset + transformed
    // corner coords give screen coords).
    const cw = targetEl.offsetWidth;
    const ch = targetEl.offsetHeight;
    const originX = targetEl.getBoundingClientRect().left;
    const originY = targetEl.getBoundingClientRect().top;
    // Because the transform-origin is 0,0 and the matrix maps
    // (0,0)(W,0)(W,H)(0,H) to the destination corners, the
    // transformed corner positions are just `corners * cw/ch`
    // plus the element's pre-transform left/top. But
    // `getBoundingClientRect` returns the tight bounding box of
    // the transformed shape, which is the box containing all 4
    // warped corners. We need the PRE-transform origin so we can
    // add the transformed corner offsets to it.
    //
    // With transform-origin: 0 0, the origin in screen space is
    // the element's layout (unwarped) top-left. We can recover
    // that by walking the offsetParent chain, or by temporarily
    // clearing the transform. Simpler approach: use offsetLeft/
    // offsetTop relative to an offsetParent, then walk up to
    // document. But this gets brittle with nested transforms.
    //
    // Easiest robust approach: use `targetEl.getClientRects()[0]`
    // after parenting — but that gives the same bounding box.
    //
    // Final approach: temporarily strip the transform to measure
    // the layout rect, then restore. This is one-frame flicker-
    // free because we do it synchronously.
    const saved = targetEl.style.transform;
    const savedOrigin = targetEl.style.transformOrigin;
    targetEl.style.transform = '';
    targetEl.style.transformOrigin = '';
    const pristine = targetEl.getBoundingClientRect();
    targetEl.style.transform = saved;
    targetEl.style.transformOrigin = savedOrigin;

    const baseX = pristine.left;
    const baseY = pristine.top;
    const pw = pristine.width;
    const ph = pristine.height;

    for (let i = 0; i < 4; i++) {
      const [nx, ny] = corners[i];
      const sx = baseX + nx * pw;
      const sy = baseY + ny * ph;
      handles[i].style.left = sx + 'px';
      handles[i].style.top  = sy + 'px';
    }
  }

  function showHandles() {
    ensureUI();
    uiRoot.style.display = 'block';
    positionHandles();
  }

  function hideHandles() {
    if (uiRoot) uiRoot.style.display = 'none';
  }

  // ---------- Public controls ----------

  function toggle() {
    const idx = STATES.indexOf(state);
    state = STATES[(idx + 1) % STATES.length];
    updateUI();
    saveState();
  }

  function reset() {
    corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    applyTransform();
    positionHandles();
    saveState();
  }

  function updateUI() {
    applyTransform();
    if (state === 'edit') {
      showHandles();
    } else {
      hideHandles();
    }
  }

  // ---------- Init ----------

  function init(opts) {
    opts = opts || {};
    const sel = opts.target || '#sketch';
    const found = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!found) {
      // Target not in the DOM yet — retry after a tick in case the
      // poster script hasn't finished building the layout. But don't
      // overwrite an already-initialized target: if the poster called
      // init({target: '#stage'}) explicitly, a later auto-init pass
      // looking for '#sketch' must not clobber it.
      if (!targetEl) setTimeout(() => init(opts), 100);
      return;
    }
    targetEl = found;
    loadState();
    updateUI();

    // The target's layout may still be settling when init runs
    // (font loads, canvas sizing, flex reflow, etc.). Watch for
    // size changes and re-apply so the transform lands on the
    // right quad as soon as #sketch gets its real dimensions.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        applyTransform();
        if (state === 'edit') positionHandles();
      });
      ro.observe(targetEl);
    }

    window.addEventListener('resize', () => {
      applyTransform();
      if (state === 'edit') positionHandles();
    });

    // Belt and suspenders — some posters don't trigger a
    // ResizeObserver event until the first frame renders.
    // Poll for up to 2 seconds at increasing delays.
    const retryDelays = [50, 150, 400, 1000, 2000];
    retryDelays.forEach(d => setTimeout(() => {
      applyTransform();
      if (state === 'edit') positionHandles();
    }, d));
  }

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P' && e.key !== 'r' && e.key !== 'R') return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      toggle();
    } else if ((e.key === 'r' || e.key === 'R') && state === 'edit') {
      e.preventDefault();
      reset();
    }
  });

  // ---------- Auto-init ----------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init({}));
  } else {
    // Already parsed — init after a tick so the poster scripts
    // can size #sketch first.
    setTimeout(() => init({}), 0);
  }

  window.PROJECTION_MAPPING = {
    init: init,
    toggle: toggle,
    reset: reset,
    getState: () => state,
    getCorners: () => corners.map(c => [c[0], c[1]]),
    setCorners: (c) => {
      if (Array.isArray(c) && c.length === 4) {
        corners = c.map(p => [p[0], p[1]]);
        applyTransform();
        positionHandles();
        saveState();
      }
    },
  };
})();
