// Draw, move and resize link rectangles on top of the image.
// Rectangles live in the image's natural pixel space; edges snap to other
// rectangles' edges (and the image border) so the email gets no thin slivers.

let nextId = 1;
const SNAP_PX = 8; // on screen

export class Editor extends EventTarget {
  constructor(stage) {
    super();
    this.stage = stage;
    this.rects = [];
    this.sel = null;
    this.wrap = document.createElement('div');
    this.wrap.className = 'canvas-wrap';
    this.imgEl = document.createElement('img');
    this.imgEl.draggable = false;
    this.ov = document.createElement('div');
    this.ov.className = 'overlay';
    this.guideX = Object.assign(document.createElement('div'), { className: 'guide gx' });
    this.guideY = Object.assign(document.createElement('div'), { className: 'guide gy' });
    this.ov.append(this.guideX, this.guideY);
    this.wrap.append(this.imgEl, this.ov);
    stage.append(this.wrap);
    this.ov.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && !e.target.closest('input,textarea')) {
        e.preventDefault(); this.remove(this.sel);
      }
    });
    new ResizeObserver(() => this.render()).observe(this.wrap);
  }

  setImage(img, src) {
    this.img = img;
    this.W = img.naturalWidth; this.H = img.naturalHeight;
    this.imgEl.src = src;
    this.rects = [];
    this.sel = null;
    this.wrap.style.aspectRatio = `${this.W} / ${this.H}`;
    this.render();
    this._changed();
  }

  get scale() { return this.wrap.clientWidth / this.W; }

  add(r) {
    const rect = { id: nextId++, url: '', alt: '', ...r };
    this.rects.push(rect);
    this.select(rect.id);
    this._changed();
    return rect;
  }

  remove(id) {
    this.rects = this.rects.filter((r) => r.id !== id);
    if (this.sel === id) this.sel = null;
    this.render();
    this._changed();
  }

  update(id, patch) {
    const r = this.rects.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    this.render();
    this.dispatchEvent(new CustomEvent('change', { detail: { soft: true } }));
  }

  select(id) {
    this.sel = id;
    this.render();
    this.dispatchEvent(new CustomEvent('select', { detail: id }));
  }

  _changed() { this.dispatchEvent(new CustomEvent('change')); }

  // ------------------------------------------------------------ rendering
  render() {
    if (!this.W) return;
    const s = this.scale;
    const seen = new Set();
    this.rects.forEach((r, i) => {
      let el = this.ov.querySelector(`[data-id="${r.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hs';
        el.dataset.id = r.id;
        el.innerHTML = `<span class="num"></span><span class="url"></span>
          <button class="del" title="Διαγραφή" aria-label="Διαγραφή">&times;</button>
          ${['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => `<i class="h ${h}" data-h="${h}"></i>`).join('')}`;
        el.querySelector('.del').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.remove(r.id); });
        this.ov.append(el);
      }
      seen.add(String(r.id));
      el.style.left = r.x * s + 'px';
      el.style.top = r.y * s + 'px';
      el.style.width = r.w * s + 'px';
      el.style.height = r.h * s + 'px';
      el.classList.toggle('sel', r.id === this.sel);
      el.classList.toggle('missing', !r.url);
      el.querySelector('.num').textContent = i + 1;
      el.querySelector('.url').textContent = r.url ? r.url.replace(/^https?:\/\//, '') : 'χωρίς link';
    });
    this.ov.querySelectorAll('.hs').forEach((el) => { if (!seen.has(el.dataset.id)) el.remove(); });
  }

  // ------------------------------------------------------------ pointer
  _pt(e) {
    const b = this.ov.getBoundingClientRect(), s = this.scale;
    return {
      x: Math.min(this.W, Math.max(0, (e.clientX - b.left) / s)),
      y: Math.min(this.H, Math.max(0, (e.clientY - b.top) / s)),
    };
  }

  _snapTargets(exceptId) {
    const xs = [0, this.W], ys = [0, this.H];
    for (const r of this.rects) if (r.id !== exceptId) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
    return { xs, ys };
  }

  _snap(v, list) {
    const tol = SNAP_PX / this.scale;
    let best = v, d = tol;
    for (const t of list) if (Math.abs(t - v) < d) { d = Math.abs(t - v); best = t; }
    return { v: best, hit: best !== v || d === 0 ? best : null };
  }

  _down(e) {
    if (!this.W || e.button > 0) return;
    const p = this._pt(e);
    const hsEl = e.target.closest('.hs');
    this.ov.setPointerCapture?.(e.pointerId);
    if (hsEl) {
      const id = +hsEl.dataset.id, r = this.rects.find((x) => x.id === id);
      this.select(id);
      const h = e.target.dataset.h;
      this.drag = { id, mode: h ? 'resize' : 'move', h, start: p, orig: { ...r } };
    } else {
      this.drag = { mode: 'create', start: p, id: null };
    }
    e.preventDefault();
  }

  _move(e) {
    const d = this.drag;
    if (!d) return;
    const p = this._pt(e);
    const T = this._snapTargets(d.id);
    let gx = null, gy = null;
    if (d.mode === 'create') {
      if (!d.id) {
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.scale < 6) return;
        d.id = this.add({ x: d.start.x, y: d.start.y, w: 1, h: 1 }).id;
      }
      const sx = this._snap(d.start.x, T.xs), sy = this._snap(d.start.y, T.ys);
      const ex = this._snap(p.x, T.xs), ey = this._snap(p.y, T.ys);
      gx = ex.hit ?? sx.hit; gy = ey.hit ?? sy.hit;
      const x0 = Math.min(sx.v, ex.v), x1 = Math.max(sx.v, ex.v), y0 = Math.min(sy.v, ey.v), y1 = Math.max(sy.v, ey.v);
      Object.assign(this.rects.find((r) => r.id === d.id), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else if (d.mode === 'move') {
      const r = this.rects.find((x) => x.id === d.id), o = d.orig;
      let x = o.x + p.x - d.start.x, y = o.y + p.y - d.start.y;
      x = Math.min(this.W - o.w, Math.max(0, x)); y = Math.min(this.H - o.h, Math.max(0, y));
      // snap whichever edge is closest
      const l = this._snap(x, T.xs), rr = this._snap(x + o.w, T.xs);
      if (l.hit != null) { x = l.v; gx = l.hit; } else if (rr.hit != null) { x = rr.v - o.w; gx = rr.hit; }
      const t = this._snap(y, T.ys), b = this._snap(y + o.h, T.ys);
      if (t.hit != null) { y = t.v; gy = t.hit; } else if (b.hit != null) { y = b.v - o.h; gy = b.hit; }
      Object.assign(r, { x, y });
    } else if (d.mode === 'resize') {
      const r = this.rects.find((x) => x.id === d.id), o = d.orig, h = d.h;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (h.includes('w')) { const s = this._snap(p.x, T.xs); x0 = Math.min(s.v, x1 - 4); gx = s.hit; }
      if (h.includes('e')) { const s = this._snap(p.x, T.xs); x1 = Math.max(s.v, x0 + 4); gx = s.hit; }
      if (h.includes('n')) { const s = this._snap(p.y, T.ys); y0 = Math.min(s.v, y1 - 4); gy = s.hit; }
      if (h.includes('s')) { const s = this._snap(p.y, T.ys); y1 = Math.max(s.v, y0 + 4); gy = s.hit; }
      Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    this._guides(gx, gy);
    this.render();
  }

  _guides(gx, gy) {
    const s = this.scale;
    this.guideX.style.display = gx != null ? 'block' : 'none';
    this.guideY.style.display = gy != null ? 'block' : 'none';
    if (gx != null) this.guideX.style.left = gx * s + 'px';
    if (gy != null) this.guideY.style.top = gy * s + 'px';
  }

  _up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this._guides(null, null);
    if (d.mode === 'create' && !d.id) { this.select(null); return; }
    const r = this.rects.find((x) => x.id === d.id);
    if (r && (r.w * this.scale < 8 || r.h * this.scale < 8)) { this.remove(r.id); return; }
    this._changed();
    if (d.mode === 'create') this.dispatchEvent(new CustomEvent('created', { detail: d.id }));
  }
}
