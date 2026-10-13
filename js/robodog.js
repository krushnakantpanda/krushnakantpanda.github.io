/* ══════════════════════════════════════════════════════════════
   KP—04 QUADRUPED VIRTUAL RIG · robodog.js
   A robot dog that lives in a <canvas>:
   · two-link inverse-kinematics legs
   · adaptive stepping gait (trot pairs / 4-beat walk)
   · roam / follow / sit behaviours, blinking, tail wag
   Digital twin of the Arduino quadruped project.
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  class RoboDog {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // ── behaviour state ──────────────────────────────
      this.mode = "roam";            // roam | follow | sit
      this.gait = "trot";            // trot | walk
      this.speed01 = 0.55;
      this.state = "ROAM";

      // ── body kinematics ──────────────────────────────
      this.x = 0;                    // body center x (world px)
      this.facing = 1;
      this.vel = 0;                  // px/s (signed in facing space)
      this.dir = 0;                  // target direction of travel
      this.bobT = 0;
      this.bodyRise = 0;             // sit amount 0..1 (extra crouch)
      this.turnHop = 0;
      this.breathT = Math.random() * 10;

      this.target = null;            // {x}
      this.pointer = { x: 0, y: 0, active: false };
      this.idleTimer = 0;
      this.sniffT = 0;
      this.blinkT = 2 + Math.random() * 3;
      this.blink = 0;
      this.headYaw = 0;
      this.headPitch = 0;
      this.tailT = 0;

      // ── legs: FL, FR(far), HL, HR(far) ──────────────
      // offX is along-body ratio, front positive
      this.legs = [
        { id: "FL", front: true,  far: false, offX:  0.44, group: 0, foot: { x: 0, y: 0 }, step: null, thr: 1.0 },
        { id: "FR", front: true,  far: true,  offX:  0.49, group: 1, foot: { x: 0, y: 0 }, step: null, thr: 1.0 },
        { id: "HL", front: false, far: false, offX: -0.44, group: 1, foot: { x: 0, y: 0 }, step: null, thr: 1.0 },
        { id: "HR", front: false, far: true,  offX: -0.49, group: 0, foot: { x: 0, y: 0 }, step: null, thr: 1.0 },
      ];

      this.readout = { hip: 0, knee: 0 };
      this._roTick = 0;

      this._resize = this._resize.bind(this);
      this._loop = this._loop.bind(this);
      this.visible = true;

      new ResizeObserver(this._resize).observe(canvas);
      this._resize();

      // pause off-screen
      new IntersectionObserver((e) => {
        this.visible = e[0].isIntersecting;
      }, { threshold: 0.02 }).observe(canvas);

      // pointer input
      const toLocal = (ev) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: (ev.clientX - r.left) * (canvas.width / this.dpr / r.width),
          y: (ev.clientY - r.top) * (canvas.height / this.dpr / r.height),
        };
      };
      canvas.addEventListener("pointerdown", (ev) => {
        const p = toLocal(ev);
        this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.active = true;
        this.onFirstInteract && this.onFirstInteract();
        if (this.mode === "follow") this.target = clamp(p.x, this.minX, this.maxX);
        else { this.mode = "roam"; this.target = clamp(p.x, this.minX, this.maxX); this.state = "TRACK"; }
        canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      });
      canvas.addEventListener("pointermove", (ev) => {
        const p = toLocal(ev);
        this.pointer.x = p.x; this.pointer.y = p.y;
        if (this.mode === "follow") { this.target = clamp(p.x, this.minX, this.maxX); this.pointer.active = true; }
      });
      canvas.addEventListener("pointerup", () => { this.pointer.active = false; });
      canvas.addEventListener("pointercancel", () => { this.pointer.active = false; });

      this._last = performance.now();
      requestAnimationFrame(this._loop);
    }

    /* ── public API ── */
    setMode(m) {
      if (this.mode === m) return;
      this.mode = m;
      if (m === "roam") { this.target = null; this.idleTimer = 0.3; }
      if (m === "follow") { this.target = clamp(this.pointer.x || this.x + 80 * this.facing, this.minX, this.maxX); }
    }
    setGait(g) { this.gait = g; }
    setSpeed(v) { this.speed01 = this.reduced ? Math.min(v, 0.6) : v; }

    /* ── geometry ── */
    _resize() {
      const r = this.cv.getBoundingClientRect();
      const w = Math.max(320, r.width), h = Math.max(220, r.height);
      this.cv.width = w * this.dpr;
      this.cv.height = h * this.dpr;
      this.W = w; this.H = h;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.u = clamp(h / 36, 7, 14);        // dog unit
      this.groundY = h * 0.82;
      this.minX = this.u * 8.5;
      this.maxX = w - this.u * 8.5;

      if (!this._placed) {
        this.x = w * 0.5;
        for (const l of this.legs) {
          l.foot.x = this.x + this.facing * l.offX * this._bodyLen() + (l.far ? -4 : 4) * this.facing;
          l.foot.y = this.groundY;
        }
        this._placed = true;
      } else {
        this.x = clamp(this.x, this.minX, this.maxX);
        for (const l of this.legs) {
          l.foot.x = clamp(l.foot.x, this.u * 2, w - this.u * 2);
          l.foot.y = this.groundY;
        }
      }
    }

    _bodyLen() { return 11 * this.u; }
    _standHipY() { return this.groundY - 6.9 * this.u; }

    /* ── two-link IK ── */
    _ik(hx, hy, fx, fy, front) {
      const L1 = 3.5 * this.u, L2 = 4.1 * this.u;
      let dx = fx - hx, dy = fy - hy;
      let d = Math.hypot(dx, dy);
      d = clamp(d, Math.abs(L1 - L2) + 1, L1 + L2 - 1);
      const a = Math.atan2(dy, dx);
      const b = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      // candidate knees; choose: front → elbow to rear, hind → knee forward
      const k1 = { x: hx + Math.cos(a + b) * L1, y: hy + Math.sin(a + b) * L1, ang: a + b };
      const k2 = { x: hx + Math.cos(a - b) * L1, y: hy + Math.sin(a - b) * L1, ang: a - b };
      const side = (k) => (k.x - hx) * this.facing * (front ? -1 : 1);
      const knee = side(k1) > side(k2) ? k1 : k2;
      // angles for HUD
      const vert = Math.PI / 2;
      let hipDeg = (knee.ang - vert) * 180 / Math.PI * this.facing;
      const shinAng = Math.atan2(fy - knee.y, fx - knee.x);
      let kneeDeg = (shinAng - knee.ang) * 180 / Math.PI;
      kneeDeg = ((kneeDeg + 540) % 360) - 180;
      return { knee, hipDeg, kneeDeg };
    }

    /* ── behaviour + physics ── */
    _update(dt) {
      const u = this.u;
      const vMax = u * lerp(7, 30, this.speed01);
      let wantVel = 0;

      /* --- mode logic → desired velocity --- */
      if (this.mode === "sit") {
        this.bodyRise = lerp(this.bodyRise, 1, dt * 4);
        this.state = "SIT";
        if (this.target !== null) this.target = null;
      } else {
        this.bodyRise = lerp(this.bodyRise, 0, dt * 4);
        if (this.mode === "follow") {
          if (!this.pointer.active && this.target === null) {
            this.state = "IDLE";
          } else {
            const t = this.target ?? this.x;
            const dx = t - this.x;
            if (Math.abs(dx) > 4 * u) { wantVel = clamp(dx * 1.6, -vMax, vMax); this.state = "TRACK"; this.sniffT = 0; }
            else { this.state = "SNIFF"; this.sniffT += dt; }
          }
        } else { // roam
          if (this.target === null) {
            this.idleTimer -= dt;
            this.state = "IDLE";
            if (this.idleTimer <= 0) {
              const span = this.maxX - this.minX;
              const nx = this.x + (Math.random() - 0.42 * this.facing) * span * 0.75;
              this.target = clamp(nx, this.minX, this.maxX);
              this.state = "TRACK";
            }
          } else {
            const dx = this.target - this.x;
            if (Math.abs(dx) > 3.5 * u) {
              wantVel = clamp(dx * 1.5, -vMax, vMax);
              this.state = "TRACK";
            } else {
              this.target = null;
              this.idleTimer = 0.8 + Math.random() * 2.2;
              this.sniffT = 0;
            }
          }
        }
      }

      /* --- facing / turnaround --- */
      if (this.state === "TRACK" && this.target !== null) {
        const dx = this.target - this.x;
        if (Math.abs(dx) > 2.2 * u && Math.sign(dx) !== this.facing) {
          this.facing = Math.sign(dx);
          this.turnHop = 1;
          // plant feet near new neutral so it doesn't glide
          for (const l of this.legs) {
            const hipX = this.x + this.facing * l.offX * this._bodyLen();
            l.foot.x = hipX + this.facing * (l.far ? -0.4 : 0.6) * u;
            l.step = null;
          }
        }
      }
      if (this.turnHop > 0) this.turnHop = Math.max(0, this.turnHop - dt * 3);

      /* --- velocity smoothing + body motion --- */
      const accel = vMax * 3.2;
      const dv = clamp(wantVel * this.facing - this.vel, -accel * dt, accel * dt);
      this.vel += dv;
      if (Math.abs(this.vel) < 0.01 * vMax && wantVel === 0) this.vel = 0;
      this.x += this.vel * this.facing * dt;
      if (this.x < this.minX) { this.x = this.minX; if (this.target !== null && this.mode === "roam") { this.target = null; this.idleTimer = 0.4; } }
      if (this.x > this.maxX) { this.x = this.maxX; if (this.target !== null && this.mode === "roam") { this.target = null; this.idleTimer = 0.4; } }

      const speedN = clamp(Math.abs(this.vel) / vMax, 0, 1);
      this.bobT += dt * (4 + 9 * speedN);
      this.breathT += dt;
      this.tailT += dt * (this.state === "SNIFF" || this.state === "SIT" ? 11 : 5 + 5 * speedN);

      /* --- head intent --- */
      let hy = 0, hp = 0;
      if (this.state === "TRACK" && this.target !== null) hy = clamp((this.target - this.x) / (18 * u), -1, 1) * 0.45;
      if (this.state === "SNIFF") hp = 0.55 + Math.sin(this.sniffT * 7) * 0.18;
      if (this.state === "IDLE") { hy = Math.sin(this.breathT * 0.7) * 0.28; hp = Math.sin(this.breathT * 0.45) * 0.1; }
      if (this.state === "SIT") { hy = 0; hp = -0.22; }
      this.headYaw = lerp(this.headYaw, hy, dt * 6);
      this.headPitch = lerp(this.headPitch, hp, dt * 6);

      /* --- blinking --- */
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2.4 + Math.random() * 3.4; }
      if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7);

      /* --- legs: adaptive stepping --- */
      const bodyLen = this._bodyLen();
      const standHip = this._standHipY();
      const bobAmp = (this.state === "TRACK" ? (this.gait === "trot" ? 0.35 : 0.2) : 0) * u * speedN
                   + (this.state === "IDLE" ? Math.sin(this.breathT * 1.4) * 0.06 * u : 0);
      const hop = Math.sin(this.turnHop * Math.PI) * 1.2 * u;

      const strideBase = (this.gait === "trot" ? 3.1 : 2.2) * u;
      const thrScale = this.gait === "walk" ? [1, 1.3, 1.65, 1.08] : [1, 1, 1, 1];

      let hipDegSum = 0, kneeDegSum = 0;

      this.legs.forEach((l, i) => {
        const isHind = !l.front;
        const hipX = this.x + this.facing * l.offX * bodyLen + (l.far ? -0.55 * u * this.facing : 0.55 * u * this.facing);
        // hip height: stand pose + gait bob + turnaround hop + sit crouch (hind drops, front lifts)
        const hy = standHip - hop + bobAmp * (l.front ? 1 : -1)
                 + (isHind ? this.bodyRise * 2.5 * u : -this.bodyRise * 0.4 * u);
        l.hip = { x: hipX, y: hy };

        // desired neutral standing foot
        let neutralX = hipX + this.facing * 0.5 * u * (l.front ? 1 : -0.6);
        if (isHind && this.bodyRise > 0.02) neutralX = hipX - this.facing * 0.9 * u * this.bodyRise + this.facing * (-0.3) * u;

        const thr = strideBase * thrScale[i] * (0.55 + 0.45 * speedN);

        if (!l.step) {
          const err = l.foot.x - neutralX;
          const need = Math.abs(err) > thr && Math.abs(this.vel) > 0.02 * vMax;
          if (need) {
            this._startStep(l, neutralX, speedN);
            if (this.gait === "trot") {
              const partner = this.legs.find((o) => o !== l && o.group === l.group && !o.step);
              if (partner) {
                const pHipX = this.x + this.facing * partner.offX * bodyLen;
                const pNeutral = pHipX + this.facing * 0.5 * u * (partner.front ? 1 : -0.6);
                if (Math.abs(partner.foot.x - pNeutral) > thr * 0.3) this._startStep(partner, pNeutral, speedN);
              }
            }
          }
        }

        if (l.step) {
          l.step.t += dt / l.step.dur;
          if (l.step.t >= 1) { l.foot.x = l.step.toX; l.foot.y = this.groundY; l.step = null; }
          else {
            const t = easeInOut(clamp(l.step.t, 0, 1));
            l.foot.x = lerp(l.step.fromX, l.step.toX, t);
            l.foot.y = this.groundY - Math.sin(clamp(l.step.t, 0, 1) * Math.PI) * l.step.lift;
          }
        } else if (this.state === "SIT" || this.bodyRise > 0.02) {
          // while crouching/sitting, glide feet toward their sit positions
          l.foot.x = lerp(l.foot.x, neutralX, dt * 4);
          l.foot.y = this.groundY;
        }

        const ik = this._ik(l.hip.x, l.hip.y, l.foot.x, l.foot.y, l.front);
        l.knee = ik.knee;
        hipDegSum += Math.abs(ik.hipDeg);
        kneeDegSum += Math.abs(ik.kneeDeg);
      });

      this.bodyBob = bobAmp;
      this.readout.hip = hipDegSum / 4;
      this.readout.knee = kneeDegSum / 4;
      this.velOut = Math.abs(this.vel) / u * 0.32; // pseudo m/s
    }

    _startStep(l, neutralX, speedN) {
      const u = this.u;
      const lookAhead = this.vel * this.facing * 0.22;
      const toX = clamp(neutralX + lookAhead, this.u * 2, this.W - this.u * 2);
      const dist = Math.abs(toX - l.foot.x);
      l.step = {
        t: 0,
        dur: clamp(dist / (Math.abs(this.vel) * 1.6 + 2 * u), 0.13, 0.34),
        fromX: l.foot.x,
        toX,
        lift: (this.gait === "trot" ? 1.5 : 1.0) * u,
      };
    }

    /* ── render ── */
    /* ── render · "Spot-class" industrial quadruped ── */
    _draw() {
      const c = this.ctx, u = this.u, W = this.W, H = this.H, gY = this.groundY;
      const F = this.facing;
      c.clearRect(0, 0, W, H);

      /* palette */
      const YEL = "#f2b23a", YEL_D = "#b0791d";           // chassis yellow
      const PLATE = "#1c2622", PLATE_DK = "#101714";      // leg plates
      const EDGE_NEAR = "#5df2b6", EDGE_FAR = "#22342c";  // accents
      const DARKS = "#0c1210", AMBER = "#ffb454";
      const NEAR = "#6ff2c0", FAR = "#2e5245";

      /* floor grid */
      c.save();
      c.strokeStyle = "rgba(93,242,182,0.10)";
      c.lineWidth = 1;
      const horizon = gY - 7.4 * u;
      for (let i = -10; i <= 10; i++) {
        c.beginPath();
        c.moveTo(W * 0.5 + i * u * 2.2, horizon);
        c.lineTo(W * 0.5 + i * u * 6.5, H);
        c.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const y = horizon + (H - horizon) * (i / 6) ** 1.7;
        c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      }
      c.strokeStyle = "rgba(93,242,182,0.55)";
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, gY + 0.5); c.lineTo(W, gY + 0.5); c.stroke();
      const glow = c.createLinearGradient(0, gY - 40, 0, gY);
      glow.addColorStop(0, "rgba(93,242,182,0)");
      glow.addColorStop(1, "rgba(93,242,182,0.07)");
      c.fillStyle = glow;
      c.fillRect(0, gY - 40, W, 40);
      c.restore();

      /* target marker */
      if ((this.state === "TRACK") && this.target !== null) {
        const t = this.target;
        const pulse = (performance.now() / 400) % 1;
        c.save();
        c.strokeStyle = "rgba(255,180,84,0.9)";
        c.lineWidth = 1.4;
        c.setLineDash([4, 5]);
        c.beginPath(); c.arc(t, gY, u * (1 + pulse * 1.2), 0, TAU); c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(t - u * 0.7, gY - u * 0.7); c.lineTo(t + u * 0.7, gY + u * 0.7);
        c.moveTo(t + u * 0.7, gY - u * 0.7); c.lineTo(t - u * 0.7, gY + u * 0.7);
        c.stroke();
        c.fillStyle = "rgba(255,180,84,0.85)";
        c.font = `500 ${Math.max(9, u)}px 'JetBrains Mono', monospace`;
        c.textAlign = "center";
        c.fillText("TGT", t, gY - u * (2.2 + pulse));
        c.restore();
      }

      /* shadow */
      c.save();
      c.fillStyle = "rgba(0,0,0,0.38)";
      c.beginPath();
      c.ellipse(this.x, gY + u * 0.35, 6.6 * u, 0.75 * u, 0, 0, TAU);
      c.fill();
      for (const l of this.legs) {
        if (!l.step) continue;
        c.beginPath();
        c.ellipse(l.foot.x, gY + 0.3 * u, 0.9 * u, 0.22 * u, 0, 0, TAU);
        c.fill();
      }
      c.restore();

      const frontHip = this.legs[0].hip, rearHip = this.legs[2].hip;
      const cx = this.x, cy = (frontHip.y + rearHip.y) / 2 - 1.4 * u;
      const ang = Math.atan2(frontHip.y - rearHip.y, frontHip.x - rearHip.x); // +x → head
      const L = 5.5 * u, HB = 2.15 * u;

      /* helpers */
      const seg = (x1, y1, x2, y2, w1, w2, fill, stroke) => {
        const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        c.beginPath();
        c.moveTo(x1 + nx * w1, y1 + ny * w1);
        c.lineTo(x2 + nx * w2, y2 + ny * w2);
        c.lineTo(x2 - nx * w2, y2 - ny * w2);
        c.lineTo(x1 - nx * w1, y1 - ny * w1);
        c.closePath();
        c.fillStyle = fill; c.fill();
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.14 * u; c.stroke(); }
      };
      const disc = (x, y, r, hub) => {
        c.beginPath(); c.arc(x, y, r, 0, TAU);
        c.fillStyle = DARKS; c.fill();
        c.strokeStyle = hub; c.lineWidth = 0.16 * u; c.stroke();
        c.beginPath(); c.arc(x, y, r * 0.42, 0, TAU);
        c.fillStyle = "#0a0f0d"; c.fill();
      };

      /* ── FAR LEGS (behind body) ── */
      for (const l of this.legs) {
        if (!l.far) continue;
        const h = l.hip, k = l.knee, f = l.foot;
        seg(h.x, h.y + 0.3 * u, k.x, k.y, 0.85 * u, 0.58 * u, "#243129");
        seg(k.x, k.y, f.x, f.y - 0.15 * u, 0.56 * u, 0.32 * u, "#1e2a23");
        c.fillStyle = "#243129";
        c.beginPath(); c.arc(h.x, h.y + 0.3 * u, 0.68 * u, 0, TAU); c.fill();
        c.beginPath(); c.arc(k.x, k.y, 0.5 * u, 0, TAU); c.fill();
        // far foot pad
        c.beginPath();
        c.ellipse(f.x, f.y - 0.22 * u, 0.62 * u, 0.3 * u, 0, 0, TAU);
        c.fillStyle = "#141d18"; c.fill();
      }

      /* ── REAR STATUS LED BAR (no tail — Spot has none) ── */
      c.save();
      c.translate(cx, cy); c.rotate(ang);
      const lbOn = Math.sin(this.tailT * 2.2) > (this.state === "SNIFF" || this.state === "SIT" ? -0.6 : 0.2);
      c.fillStyle = DARKS;
      c.strokeStyle = "rgba(255,180,84,0.4)"; c.lineWidth = 0.1 * u;
      c.beginPath(); c.roundRect(-L - 0.28 * u, -0.85 * u, 0.55 * u, 1.4 * u, 0.24 * u); c.fill(); c.stroke();
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(-L, -0.45 * u + i * 0.42 * u, 0.13 * u, 0, TAU);
        c.fillStyle = lbOn ? AMBER : "rgba(255,180,84,0.18)"; c.fill();
      }
      c.restore();

      /* ── CHASSIS (chamfered yellow hull) ── */
      c.save();
      c.translate(cx, cy); c.rotate(ang);
      const ch = [[L - 1.5*u, -HB], [L, -HB + 1.4*u], [L, HB - 1.0*u], [L - 1.0*u, HB],
                  [-L + 1.1*u, HB], [-L, HB - 1.1*u], [-L, -HB + 0.8*u], [-L + 0.8*u, -HB]];
      const hullGrad = c.createLinearGradient(0, -HB, 0, HB);
      hullGrad.addColorStop(0, "#f7c458"); hullGrad.addColorStop(0.55, YEL); hullGrad.addColorStop(1, "#d9992b");
      c.beginPath();
      ch.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.closePath();
      c.fillStyle = hullGrad; c.fill();
      c.strokeStyle = YEL_D; c.lineWidth = 0.2 * u; c.stroke();

      // bottom skid plate
      c.fillStyle = "rgba(12,18,16,0.85)";
      c.beginPath(); c.roundRect(-L + 0.7*u, HB - 0.52*u, L*2 - 1.4*u, 0.5*u, 0.2*u); c.fill();

      // chamfer highlight lines
      c.strokeStyle = "rgba(120,80,20,0.5)"; c.lineWidth = 0.1 * u;
      c.beginPath(); c.moveTo(L - 1.15*u, -HB + 0.28*u); c.lineTo(L - 0.15*u, -HB + 1.25*u); c.stroke();

      // battery door + latch
      c.strokeStyle = "rgba(60,40,10,0.55)"; c.lineWidth = 0.12 * u;
      c.beginPath(); c.roundRect(-2.9*u, -1.15*u, 4.6*u, 1.9*u, 0.3*u); c.stroke();
      c.beginPath(); c.moveTo(-0.6*u, -1.15*u); c.lineTo(-0.6*u, -0.85*u); c.stroke();

      // vents (front-bottom)
      c.fillStyle = "rgba(12,18,16,0.75)";
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.roundRect(L - 2.3*u - i*0.52*u, HB - 1.15*u, 0.3*u, 0.55*u, 0.12*u); c.fill();
      }

      // corner bolts
      c.fillStyle = "rgba(60,40,10,0.6)";
      const bolts = [[L - 2.0*u, -HB + 0.5*u], [L - 0.75*u, HB - 0.75*u], [-L + 0.62*u, -HB + 0.42*u], [-L + 0.75*u, HB - 0.62*u]];
      for (const b of bolts) { c.beginPath(); c.arc(b[0], b[1], 0.09*u, 0, TAU); c.fill(); }

      // front sensor face plate
      c.fillStyle = DARKS;
      c.beginPath(); c.roundRect(L - 0.62*u, -HB + 0.35*u, 0.72*u, 2.4*u, 0.28*u); c.fill();
      // stereo lenses on face
      for (let i = 0; i < 2; i++) {
        const ly = -HB + 0.85*u + i * 0.85*u;
        c.beginPath(); c.arc(L - 0.26*u, ly, 0.17*u, 0, TAU); c.fillStyle = "#05080a"; c.fill();
        c.beginPath(); c.arc(L - 0.26*u, ly, 0.17*u, 0, TAU); c.strokeStyle = EDGE_NEAR; c.lineWidth = 0.07*u; c.stroke();
        c.beginPath(); c.arc(L - 0.31*u, ly - 0.05*u, 0.05*u, 0, TAU); c.fillStyle = "rgba(160,255,220,0.9)"; c.fill();
      }

      // top grab handle (rear) — mid graphite so it reads on dark stage too
      c.strokeStyle = "#3a4a41"; c.lineWidth = 0.34 * u; c.lineCap = "round";
      c.beginPath();
      c.moveTo(-4.1*u, -HB + 0.15*u); c.lineTo(-4.1*u, -HB - 0.72*u);
      c.lineTo(-0.9*u, -HB - 0.72*u); c.lineTo(-0.9*u, -HB + 0.15*u);
      c.stroke();
      // amber end-caps on the handle posts
      c.fillStyle = AMBER;
      c.beginPath(); c.arc(-4.1*u, -HB - 0.72*u, 0.14*u, 0, TAU); c.fill();
      c.beginPath(); c.arc(-0.9*u, -HB - 0.72*u, 0.14*u, 0, TAU); c.fill();
      c.lineCap = "butt";
      c.restore();

      /* chassis stencil (drawn unrotated so it always reads) */
      c.save();
      c.fillStyle = "rgba(12,18,16,0.85)";
      c.font = `800 ${0.72 * u}px 'Sora', sans-serif`;
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("KP—04", cx + F * 0.6 * u, cy - 0.05 * u);
      c.font = `500 ${0.34 * u}px 'JetBrains Mono', monospace`;
      c.fillStyle = "rgba(12,18,16,0.55)";
      c.fillText("QUADRUPED VIRTUAL RIG", cx + F * 0.6 * u, cy + 0.68 * u);
      c.restore();

      /* ── SENSOR MAST + PAN-TILT CAMERA BALL (the "face") ── */
      {
        const mastBase = {
          x: cx + Math.cos(ang) * (L - 1.35*u) - Math.sin(ang) * (-HB - 0.02*u),
          y: cy + Math.sin(ang) * (L - 1.35*u) + Math.cos(ang) * (-HB - 0.02*u),
        };
        const mastAng = ang - Math.PI / 2 + 0.16 + this.headPitch * 0.28;
        const mastLen = 1.85 * u;
        const tip = {
          x: mastBase.x + Math.cos(mastAng) * mastLen,
          y: mastBase.y + Math.sin(mastAng) * mastLen,
        };
        // mast
        c.strokeStyle = DARKS; c.lineWidth = 0.5 * u; c.lineCap = "round";
        c.beginPath(); c.moveTo(mastBase.x, mastBase.y); c.lineTo(tip.x, tip.y); c.stroke();
        c.strokeStyle = "#2b3a33"; c.lineWidth = 0.14 * u;
        c.beginPath(); c.moveTo(mastBase.x, mastBase.y); c.lineTo(tip.x, tip.y); c.stroke();
        // tip status LED
        const ledOn = Math.sin(this.breathT * 4) > -0.2;
        c.beginPath(); c.arc(mastBase.x + Math.cos(mastAng) * mastLen * 0.55, mastBase.y + Math.sin(mastAng) * mastLen * 0.55, 0.09 * u, 0, TAU);
        c.fillStyle = ledOn ? EDGE_NEAR : "rgba(93,242,182,0.25)"; c.fill();

        // camera ball
        const ballR = 0.82 * u;
        const bc = { x: tip.x, y: tip.y };
        c.beginPath(); c.arc(bc.x, bc.y, ballR, 0, TAU);
        c.fillStyle = "#151f1a"; c.fill();
        c.strokeStyle = DARKS; c.lineWidth = 0.16 * u; c.stroke();
        // ball seam
        c.beginPath(); c.arc(bc.x, bc.y, ballR * 0.68, 0, TAU);
        c.strokeStyle = "rgba(93,242,182,0.25)"; c.lineWidth = 0.06 * u; c.stroke();
        // lens — steered by headYaw (x) and headPitch (y), "blink" = shutter flicker
        const ldx = F * (0.42 + this.headYaw * 0.22) * ballR;
        const ldy = (0.02 + this.headPitch * 0.42) * ballR;
        const shutter = 1 - this.blink;
        c.save();
        if (shutter > 0.15) { c.shadowColor = AMBER; c.shadowBlur = 10; }
        c.beginPath(); c.arc(bc.x + ldx, bc.y + ldy, 0.3 * u * Math.max(0.2, shutter), 0, TAU);
        c.fillStyle = shutter > 0.15 ? AMBER : "rgba(255,180,84,0.25)"; c.fill();
        c.restore();
        c.beginPath(); c.arc(bc.x + ldx, bc.y + ldy, 0.15 * u * Math.max(0.2, shutter), 0, TAU);
        c.fillStyle = "#1a0e02"; c.fill();
        c.beginPath(); c.arc(bc.x + ldx - F*0.06*u, bc.y + ldy - 0.06*u, 0.05 * u, 0, TAU);
        c.fillStyle = "rgba(255,255,255,0.85)"; c.fill();
      }

      /* ── NEAR LEGS (in front) ── */
      for (const l of this.legs) {
        if (l.far) continue;
        const h = l.hip, k = l.knee, f = l.foot;
        // upper plate with metal gradient
        const upGrad = c.createLinearGradient(h.x, h.y, k.x, k.y);
        upGrad.addColorStop(0, "#3d4f46"); upGrad.addColorStop(1, "#26332c");
        seg(h.x, h.y + 0.3 * u, k.x, k.y, 0.92 * u, 0.62 * u, upGrad, "#547065");
        // hazard band across the upper plate
        {
          const dx = k.x - h.x, dy = k.y - (h.y + 0.3 * u), d = Math.hypot(dx, dy) || 1;
          const nx = -dy / d, ny = dx / d;
          const mxa = (h.x + k.x) / 2, mya = (h.y + 0.3 * u + k.y) / 2;
          c.save();
          c.strokeStyle = "rgba(255,180,84,0.85)"; c.lineWidth = 0.18 * u;
          c.beginPath();
          c.moveTo(mxa - nx * 0.5 * u, mya - ny * 0.5 * u);
          c.lineTo(mxa + nx * 0.5 * u, mya + ny * 0.5 * u);
          c.stroke();
          c.restore();
        }
        // lower plate + hydraulic line
        const loGrad = c.createLinearGradient(k.x, k.y, f.x, f.y);
        loGrad.addColorStop(0, "#364740"); loGrad.addColorStop(1, "#212c26");
        seg(k.x, k.y, f.x, f.y - 0.15 * u, 0.56 * u, 0.32 * u, loGrad, "#48635a");
        c.strokeStyle = "rgba(93,242,182,0.45)"; c.lineWidth = 0.07 * u;
        c.beginPath();
        c.moveTo(k.x + (k.x - h.x > 0 ? 0.2 : -0.2) * u, k.y + 0.3 * u);
        c.lineTo(f.x + (k.x - h.x > 0 ? 0.16 : -0.16) * u, f.y - 0.9 * u);
        c.stroke();
        // joints
        disc(h.x, h.y + 0.3 * u, 0.72 * u, EDGE_NEAR);
        c.beginPath(); c.arc(h.x, h.y + 0.3 * u, 0.2 * u, 0, TAU); c.fillStyle = AMBER; c.fill();
        disc(k.x, k.y, 0.52 * u, EDGE_NEAR);
        // foot pad (rubber toe + stance glow)
        c.beginPath();
        c.ellipse(f.x, f.y - 0.22 * u, 0.66 * u, 0.32 * u, 0, 0, TAU);
        c.fillStyle = "#0a0f0d"; c.fill();
        c.strokeStyle = "#2b3a33"; c.lineWidth = 0.08 * u; c.stroke();
        if (!l.step) {
          c.save();
          c.shadowColor = NEAR; c.shadowBlur = 9;
          c.beginPath();
          c.ellipse(f.x, f.y - 0.1 * u, 0.4 * u, 0.12 * u, 0, 0, TAU);
          c.fillStyle = "rgba(111,242,192,0.85)"; c.fill();
          c.restore();
        }
      }

      /* shoulder / hip actuator pods on the chassis corners */
      for (const p of [frontHip, rearHip]) {
        c.beginPath(); c.arc(p.x, p.y + 0.3 * u, 1.12 * u, 0, TAU);
        c.fillStyle = "#141d19"; c.fill();
        c.strokeStyle = EDGE_NEAR; c.lineWidth = 0.16 * u; c.stroke();
        c.beginPath(); c.arc(p.x, p.y + 0.3 * u, 0.55 * u, 0, TAU);
        c.fillStyle = DARKS; c.fill();
        c.strokeStyle = "rgba(93,242,182,0.35)"; c.lineWidth = 0.08 * u; c.stroke();
        c.beginPath(); c.arc(p.x, p.y + 0.3 * u, 0.16 * u, 0, TAU);
        c.fillStyle = YEL; c.fill();
      }

      /* canvas HUD (top-left) */
      c.save();
      c.font = `500 ${Math.max(9, this.u * 0.95)}px 'JetBrains Mono', monospace`;
      c.fillStyle = "rgba(147,168,158,0.9)";
      c.textAlign = "left"; c.textBaseline = "top";
      c.fillText(`MODE: ${this.mode.toUpperCase()}`, 14, 12);
      c.fillText(`GAIT: ${this.gait.toUpperCase()}  ·  DRIVE ${Math.round(this.speed01 * 100)}%`, 14, 12 + Math.max(12, u * 1.3));
      c.fillStyle = "rgba(93,242,182,0.85)";
      c.fillText(`◤ ${this.state}`, 14, 12 + Math.max(24, u * 2.6));
      c.restore();
    }


    _loop(now) {
      requestAnimationFrame(this._loop);
      if (!this.visible || document.hidden) { this._last = now; return; }
      let dt = (now - this._last) / 1000;
      this._last = now;
      dt = clamp(dt, 0.001, 0.033);

      const steps = Math.abs(this.vel) > 60 ? 2 : 1;
      for (let i = 0; i < steps; i++) this._update(dt / steps);
      this._draw();

      // throttled DOM readouts
      this._roTick += dt;
      if (this._roTick > 0.12) {
        this._roTick = 0;
        if (this.onReadout) this.onReadout({
          state: this.state,
          vel: this.velOut,
          hip: this.readout.hip,
          knee: this.readout.knee,
        });
      }
    }
  }

  window.RoboDog = RoboDog;
})();
