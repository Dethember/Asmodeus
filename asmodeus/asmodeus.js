/* ============================================================
   ASMODEUS — 2D skeletal character engine (vanilla JS, no deps)
   Cut from a single side-view image into body parts, animated
   procedurally. Perfect for GitHub Pages / any web game.
   ============================================================ */

const RIG = {
  canvasSpace: [1024, 1536],   // original image coordinate space
  groundY: 1500,
  drawOrder: ['wing', 'torso', 'legs', 'skirt', 'staff', 'head', 'arm'],
  markers: { orb: [818, 330] },           // orb center on staff (rest pose)
  parts: {
    root:  { parent: null,    img: null,             pos: [0, 0],     pivot: [560, 700] },
    torso: { parent: 'root',  img: 'assets/torso.png', pos: [495, 398], pivot: [560, 700] },
    wing:  { parent: 'torso', img: 'assets/wing.png',  pos: [198, 240], pivot: [480, 420] },
    skirt: { parent: 'torso', img: 'assets/skirt.png', pos: [370, 645], pivot: [560, 700] },
    head:  { parent: 'torso', img: 'assets/head.png',  pos: [324, 15],  pivot: [552, 396] },
    legs:  { parent: 'root',  img: 'assets/legs.png',  pos: [412, 1176],pivot: [560, 700] },
    arm:   { parent: 'torso', img: 'assets/arm.png',   pos: [510, 543], pivot: [540, 615] },
    staff: { parent: 'arm',   img: 'assets/staff.png', pos: [730, 225], pivot: [540, 615] }
  }
};

/* ---------- tiny 2D affine matrix [a,b,c,d,e,f] ---------- */
const M = {
  ident: () => [1, 0, 0, 1, 0, 0],
  mul(m, n) { // m * n
    return [
      m[0]*n[0] + m[2]*n[1],
      m[1]*n[0] + m[3]*n[1],
      m[0]*n[2] + m[2]*n[3],
      m[1]*n[2] + m[3]*n[3],
      m[0]*n[4] + m[2]*n[5] + m[4],
      m[1]*n[4] + m[3]*n[5] + m[5]
    ];
  },
  trans(x, y) { return [1, 0, 0, 1, x, y]; },
  rot(deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, s, -s, c, 0, 0];
  },
  scale(sx, sy) { return [sx, 0, 0, sy, 0, 0]; },
  apply(m, x, y) {
    return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
  }
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* smooth ease between keyframes */
const ease = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
/* piecewise: kfs = [[t0,v0],[t1,v1],...] */
function kf(t, kfs, smooth = true) {
  if (t <= kfs[0][0]) return kfs[0][1];
  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0] = kfs[i], [t1, v1] = kfs[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return lerp(v0, v1, smooth ? ease(u) : u);
    }
  }
  return kfs[kfs.length - 1][1];
}

/* ============================ NODES ============================ */
class Part {
  constructor(name, def) {
    this.name = name;
    this.img = def.img;
    this.pos = def.pos;      // sprite placement (rest pose, char space)
    this.pivot = def.pivot;  // rotation pivot (char space)
    this.parent = def.parent;
    this.rot = 0;  // degrees
    this.dx = 0;   // char-space px
    this.dy = 0;
    this.world = M.ident();
    this.el = null; // HTMLImageElement
  }
  localMatrix() {
    let m = M.mul(M.trans(this.dx, this.dy), M.trans(this.pivot[0], this.pivot[1]));
    m = M.mul(m, M.rot(this.rot));
    m = M.mul(m, M.trans(-this.pivot[0], -this.pivot[1]));
    return m;
  }
  computeWorld(parentWorld) {
    this.world = M.mul(parentWorld, this.localMatrix());
  }
  drawMatrix() { // world * T(pos) — maps sprite-local px to char space
    return M.mul(this.world, M.trans(this.pos[0], this.pos[1]));
  }
  worldPoint(charPoint) { // rest char-space point -> char space now
    return M.apply(this.world, charPoint[0], charPoint[1]);
  }
}

class Rig {
  constructor() {
    this.nodes = {};
    for (const [name, def] of Object.entries(RIG.parts)) {
      this.nodes[name] = new Part(name, def);
    }
    this.root = this.nodes.root;
  }
  setImages(map) { for (const n in map) this.nodes[n].el = map[n]; }
  applyPose(pose) {
    for (const name in this.nodes) {
      const p = (pose && pose[name]) || {};
      const n = this.nodes[name];
      n.rot = p.rot || 0; n.dx = p.dx || 0; n.dy = p.dy || 0;
    }
  }
  updateWorld() {
    this.root.world = this.root.localMatrix();
    for (const name of RIG.drawOrder) {
      const n = this.nodes[name];
      n.computeWorld(this.nodes[n.parent].world);
    }
  }
  draw(ctx, base) {
    const b = base || M.ident();
    for (const name of RIG.drawOrder) {
      const n = this.nodes[name];
      if (!n.el) continue;
      const dm = M.mul(b, n.drawMatrix());
      ctx.setTransform(dm[0], dm[1], dm[2], dm[3], dm[4], dm[5]);
      ctx.drawImage(n.el, 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /* world (char-space) position of a marker, e.g. the staff orb */
  markerPoint(key) {
    // orb lives on staff sprite: find staff node world, apply to rest coords
    const staff = this.nodes.staff;
    return staff.worldPoint(RIG.markers[key]);
  }
}

/* ============================ MOVES ============================
   Every move is fn(t01, sec, P) filling pose values.
   t01 = normalized phase 0..1. Angles: + = clockwise (canvas).
   Character faces RIGHT by default. */

const MOVES = {
  idle: { loop: true, dur: 2.4, fn(t, s, P) {
    const w = t * Math.PI * 2;
    P.root.dy = Math.sin(w) * 5;
    P.torso.rot = Math.sin(w) * 0.8;
    P.head.rot  = Math.sin(w + 0.6) * 1.6;
    P.wing.rot  = Math.sin(w) * 2.4;
    P.arm.rot   = Math.sin(w + 0.3) * 1.6;
    P.skirt.rot = Math.sin(w + 1.2) * 1.2;
  }},

  walk: { loop: true, dur: 0.9, fn(t, s, P) {
    const w = t * Math.PI * 2;
    P.legs.rot  = Math.sin(w) * 7;
    P.root.dy   = -Math.abs(Math.sin(w)) * 10;
    P.torso.rot = Math.sin(w) * 1.2;
    P.arm.rot   = -Math.sin(w) * 4;
    P.head.rot  = Math.sin(w + 0.4) * 1;
    P.skirt.rot = Math.sin(w + Math.PI / 2) * 2.2;
    P.wing.rot  = Math.sin(w * 2) * 2;
  }},

  /* staff strike: windup -> slam -> recover */
  strike: { loop: false, dur: 0.7, fn(t, s, P) {
    P.arm.rot   = kf(t, [[0, 0], [0.32, -46], [0.5, 88], [1, 0]]);
    P.torso.rot = kf(t, [[0, 0], [0.32, -5], [0.5, 9], [1, 0]]);
    P.head.rot  = kf(t, [[0, 0], [0.32, -3], [0.5, 4], [1, 0]]);
  }, event: (t) => t >= 0.48 && t < 0.52 ? 'slash' : null },

  /* orb cast: raise staff -> charge -> fire */
  cast: { loop: false, dur: 1.25, fn(t, s, P) {
    P.arm.rot  = kf(t, [[0, 0], [0.35, -78], [0.72, -78], [1, 0]]);
    P.head.rot = kf(t, [[0, 0], [0.35, -5], [0.72, -5], [1, 0]]);
    P.torso.rot= kf(t, [[0, 0], [0.35, -3], [0.72, -3], [1, 0]]);
    P.wing.rot = kf(t, [[0, 0], [0.35, -6], [0.72, 2], [1, 0]]);
  }, event: (t) => t >= 0.72 && t < 0.76 ? 'fire' : null,
   charge: (t) => t > 0.3 && t < 0.72 },

  kick: { loop: false, dur: 0.6, fn(t, s, P) {
    P.legs.rot  = kf(t, [[0, 0], [0.3, -20], [0.5, -20], [1, 0]]);
    P.torso.rot = kf(t, [[0, 0], [0.3, -8], [0.5, -8], [1, 0]]);
    P.root.dy   = kf(t, [[0, 0], [0.3, -26], [0.5, -26], [1, 0]]);
    P.arm.rot   = kf(t, [[0, 0], [0.3, -14], [0.5, -14], [1, 0]]);
    P.skirt.rot = kf(t, [[0, 0], [0.3, 4], [1, 0]]);
  }, event: (t) => t >= 0.28 && t < 0.32 ? 'impact' : null },

  jump: { loop: false, dur: 0.95, fn(t, s, P) {
    const h = Math.sin(Math.PI * clamp(t / 0.9, 0, 1)); // parabola-ish
    P.root.dy = -h * 230;
    P.legs.rot  = kf(t, [[0, 0], [0.2, -14], [0.75, -14], [1, 0]]);
    P.skirt.dy  = h * 26;           // cloth lags behind
    P.wing.rot  = -h * 10;
    P.arm.rot   = -h * 18;
    P.torso.rot = kf(t, [[0, 0], [0.2, -4], [0.8, -4], [1, 0]]);
  }, event: (t) => t >= 0.9 ? 'land' : null },

  hit: { loop: false, dur: 0.5, fn(t, s, P) {
    P.torso.rot = kf(t, [[0, 0], [0.15, -16], [1, 0]]);
    P.root.dx   = kf(t, [[0, 0], [0.15, -26], [1, 0]]);
    P.head.rot  = kf(t, [[0, 0], [0.15, -10], [1, 0]]);
    P.arm.rot   = kf(t, [[0, 0], [0.15, 10], [1, 0]]);
  }},

  victory: { loop: true, dur: 2.0, fn(t, s, P) {
    const w = t * Math.PI * 2;
    P.arm.rot   = kf(t, [[0, 0], [0.25, -95], [1, -95]]);
    P.wing.rot  = Math.sin(w * 3) * 5;
    P.head.rot  = -4;
    P.root.dy   = Math.sin(w * 3) * 4;
    P.skirt.rot = Math.sin(w * 3 + 1) * 2;
  }, charge: (t) => t > 0.2 },   // orb glow as victory flair
};

/* ============================ GAME/DEMO ============================ */
class AsmodeusDemo {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rig = new Rig();
    this.scale = 0.37;
    this.anchor = [470, 330];       // screen position of hip (560,700)
    this.face = 1;                  // 1 = right, -1 = left
    this.move = 'idle';
    this.moveT = 0;
    this.blendFrom = null;
    this.blendT = 1;
    this.fired = {};                // per-move event latch
    this.projectiles = [];
    this.slashes = [];
    this.dusts = [];
    this.hitFlash = 0;
    this.embers = [];
    for (let i = 0; i < 36; i++) {
      this.embers.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        r: 1 + Math.random() * 2, s: 8 + Math.random() * 22, a: 0.15 + Math.random() * 0.3 });
    }
    this.groundScreenY = this.anchor[1] + (RIG.groundY - RIG.parts.root.pivot[1]) * this.scale;
    this._last = performance.now();
    this._keys = {};
    this._bindInput();
  }

  loadImages(cb) {
    const imgs = {}, names = Object.values(RIG.parts).map(p => p.img).filter(Boolean);
    let left = names.length;
    names.forEach(src => {
      const im = new Image();
      im.onload = () => { if (--left === 0) cb(imgs); };
      im.src = src;
      imgs[src] = im;
    });
    this.rig.setImages(imgs);
  }

  setMove(name) {
    if (this.move === name) return;
    // capture current displayed pose for blending
    const snap = {};
    for (const n in this.rig.nodes) {
      const nd = this.rig.nodes[n];
      snap[n] = { rot: nd.rot, dx: nd.dx, dy: nd.dy };
    }
    this.blendFrom = snap;
    this.blendT = 0;
    this.move = name;
    this.moveT = 0;
    this.fired = {};
  }

  rawPose(name, t, dt) {
    const P = {};
    MOVES[name].fn(t, this.moveT, P);
    // walking drifts the character; position persists between moves
    if (name === 'walk' && this.walkDir) {
      this.rootX = clamp((this.rootX || 560) + this.walkDir * 150 * dt, 180, 1330);
    }
    if (!P.root) P.root = {};
    P.root.dx = (P.root.dx || 0) + ((this.rootX || 560) - 560);
    return P;
  }

  update(dt) {
    const mv = MOVES[this.move];
    this.moveT += dt;
    let t = mv.loop ? (this.moveT % mv.dur) / mv.dur : this.moveT / mv.dur;

    if (!mv.loop && t >= 1) {
      if (this.move === 'jump' && !this.fired.land) { this.spawnDust(); this.fired.land = true; }
      this.setMove('idle');
      return this.update(0);
    }

    // blend
    const cur = this.rawPose(this.move, t, dt);
    let pose = cur;
    if (this.blendFrom && this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 0.15);
      const u = ease(this.blendT), pose2 = {};
      for (const n in cur) {
        const a = this.blendFrom[n] || { rot: 0, dx: 0, dy: 0 }, b = cur[n];
        pose2[n] = { rot: lerp(a.rot, b.rot || 0, u), dx: lerp(a.dx, b.dx || 0, u), dy: lerp(a.dy, b.dy || 0, u) };
      }
      for (const n in this.blendFrom) if (!cur[n]) pose2[n] = this.blendFrom[n];
      pose = pose2;
    }
    this.rig.applyPose(pose);
    this.rig.updateWorld();

    // move events
    if (mv.event) {
      const ev = mv.event(t);
      if (ev && !this.fired[ev + Math.floor(this.moveT / mv.dur)]) {
        this.fired[ev + Math.floor(this.moveT / mv.dur)] = true;
        this.onEvent(ev);
      }
    }

    // FX updates
    this.projectiles = this.projectiles.filter(p => {
      p.x += p.vx * dt; p.life -= dt; return p.life > 0;
    });
    this.slashes = this.slashes.filter(s => (s.life -= dt) > 0);
    this.dusts = this.dusts.filter(d => (d.life -= dt) > 0);
    if (this.hitFlash > 0) this.hitFlash -= dt * 3;
    for (const e of this.embers) {
      e.y -= e.s * dt;
      if (e.y < -10) { e.y = this.canvas.height + 10; e.x = Math.random() * this.canvas.width; }
    }
  }

  onEvent(ev) {
    const orb = this.charToScreen(this.rig.markerPoint('orb'));
    if (ev === 'fire') {
      this.projectiles.push({ x: orb[0], y: orb[1], vx: 620 * this.face, life: 1.3, r: 16 });
    } else if (ev === 'slash') {
      const el = this.rig.nodes.arm;
      const c = this.charToScreen(el.worldPoint(el.pivot));
      this.slashes.push({ x: c[0], y: c[1], life: 0.28, max: 0.28, face: this.face });
    } else if (ev === 'land') {
      this.spawnDust();
    } else if (ev === 'impact') {
      const legs = this.rig.nodes.legs;
      const foot = this.charToScreen(legs.worldPoint([520, 1480]));
      this.slashes.push({ x: foot[0], y: foot[1], life: 0.2, max: 0.2, face: this.face, kick: true });
    }
  }

  spawnDust() {
    const gy = this.groundScreenY;
    for (let i = 0; i < 7; i++) {
      this.dusts.push({ x: 470 + (Math.random() - 0.5) * 160, y: gy - 6,
        vx: (Math.random() - 0.5) * 220, vy: -30 - Math.random() * 60, life: 0.5 + Math.random() * 0.3 });
    }
  }

  charToScreen(p) {
    // base transform: screen = anchor + S(scale*face, scale) * (p - hip)
    const hip = RIG.parts.root.pivot;
    const sx = this.anchor[0] + (p[0] - hip[0]) * this.scale * this.face;
    const sy = this.anchor[1] + (p[1] - hip[1]) * this.scale;
    return [sx, sy];
  }

  baseMatrix() {
    const hip = RIG.parts.root.pivot;
    let m = M.trans(this.anchor[0], this.anchor[1]);
    m = M.mul(m, M.scale(this.scale * this.face, this.scale));
    return M.mul(m, M.trans(-hip[0], -hip[1]));
  }

  render() {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;

    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0710'); g.addColorStop(0.7, '#160b12'); g.addColorStop(1, '#1d0f14');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // embers
    for (const e of this.embers) {
      ctx.globalAlpha = e.a;
      ctx.fillStyle = '#ff7a3c';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ground
    this.groundScreenY = this.charToScreen([0, RIG.groundY])[1];
    ctx.strokeStyle = 'rgba(255,120,60,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, this.groundScreenY); ctx.lineTo(W, this.groundScreenY); ctx.stroke();

    // shadow
    const air = clamp(-this.rig.nodes.root.dy / 230, 0, 1); // lift from jump
    ctx.fillStyle = `rgba(0,0,0,${0.4 - air * 0.12})`;
    ctx.beginPath();
    const shadowX = 470 + ((this.rootX || 560) - 560) * this.scale * this.face;
    ctx.ellipse(shadowX, this.groundScreenY + 6, 95 - air * 25, 14 - air * 4, 0, 0, 7);
    ctx.fill();

    // character
    this.rig.draw(ctx, this.baseMatrix());

    // cast charge glow at orb
    const mv = MOVES[this.move];
    if (mv.charge && mv.charge(this.moveT / mv.dur)) {
      const orb = this.charToScreen(this.rig.markerPoint('orb'));
      const pulse = 14 + Math.sin(this.moveT * 30) * 5;
      const rg = ctx.createRadialGradient(orb[0], orb[1], 2, orb[0], orb[1], pulse + 16);
      rg.addColorStop(0, 'rgba(255,190,120,0.9)');
      rg.addColorStop(0.4, 'rgba(255,90,40,0.5)');
      rg.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(orb[0], orb[1], pulse + 16, 0, 7); ctx.fill();
    }

    // projectiles
    for (const p of this.projectiles) {
      const rg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r + 10);
      rg.addColorStop(0, 'rgba(255,230,180,0.95)');
      rg.addColorStop(0.4, 'rgba(255,110,40,0.7)');
      rg.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10, 0, 7); ctx.fill();
    }

    // slash arcs
    for (const s of this.slashes) {
      const u = 1 - s.life / s.max;
      ctx.strokeStyle = `rgba(255,150,60,${(1 - u) * 0.8})`;
      ctx.lineWidth = 6 * (1 - u) + 1;
      ctx.beginPath();
      if (s.kick) ctx.arc(s.x, s.y, 46, -0.6, 1.2);
      else ctx.arc(s.x, s.y, 150 + u * 60, s.face > 0 ? -1.2 : Math.PI + 0.2, s.face > 0 ? 0.9 : Math.PI + 2.2);
      ctx.stroke();
    }

    // dust
    for (const d of this.dusts) {
      ctx.fillStyle = `rgba(180,140,110,${d.life})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, 4 + (0.5 - d.life) * 10, 0, 7); ctx.fill();
      d.x += d.vx * 0.016; d.y += d.vy * 0.016;
    }

    // hit flash
    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,40,20,${clamp(this.hitFlash, 0, 1) * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }

    // move label
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MOVE: ' + this.move.toUpperCase(), W / 2, 28);
  }

  _bindInput() {
    const attack = (m) => {
      if (MOVES[this.move] && (MOVES[this.move].loop || this.moveT > MOVES[this.move].dur * 0.6)) this.setMove(m);
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this._keys[k] = true;
      if (k === 'j' || k === 'z') attack('strike');
      if (k === 'k' || k === 'x') attack('cast');
      if (k === 'l' || k === 'c') attack('kick');
      if (k === ' ') { e.preventDefault(); attack('jump'); }
      if (k === 'h') { this.setMove('hit'); this.hitFlash = 1; }
    });
    window.addEventListener('keyup', (e) => { this._keys[e.key.toLowerCase()] = false; });
    // expose for UI buttons
    this.api = {
      strike: () => attack('strike'),
      cast:   () => attack('cast'),
      kick:   () => attack('kick'),
      jump:   () => attack('jump'),
      hit:    () => { this.setMove('hit'); this.hitFlash = 1; },
      victory:() => this.setMove('victory'),
      face:   (d) => { this.face = d; },
    };
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    // walk input
    const left = this._keys['a'] || this._keys['arrowleft'];
    const right = this._keys['d'] || this._keys['arrowright'];
    if (left || right) {
      this.walkDir = right ? 1 : -1;
      if (right) this.face = 1; if (left) this.face = -1;
      if (this.move === 'idle') this.setMove('walk');
    } else {
      this.walkDir = 0;
      if (this.move === 'walk') this.setMove('idle');
    }
    this.update(dt);
    this.render();
    requestAnimationFrame((n) => this.tick(n));
  }
}

/* export for modules / tests */
if (typeof window !== 'undefined') window.AsmodeusDemo = AsmodeusDemo;
