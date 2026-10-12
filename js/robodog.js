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
    _draw() {
      const c = this.ctx, u = this.u, W = this.W, H = this.H, gY = this.groundY;
      c.clearRect(0, 0, W, H);

      /* floor grid */
      c.save();
      c.strokeStyle = "rgba(93,242,182,0.10)";
      c.lineWidth = 1;
      const horizon = gY - 7.4 * u;
      // fan lines
      for (let i = -10; i <= 10; i++) {
        c.beginPath();
        c.moveTo(W * 0.5 + i * u * 2.2, horizon);
        c.lineTo(W * 0.5 + i * u * 6.5, H);
        c.stroke();
      }
      // horizontal depth lines
      for (let i = 0; i < 6; i++) {
        const y = horizon + (H - horizon) * (i / 6) ** 1.7;
        c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      }
      // ground line + horizon glow
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
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.beginPath();
      c.ellipse(this.x, gY + u * 0.35, 6.4 * u, 0.75 * u, 0, 0, TAU);
      c.fill();
      for (const l of this.legs) {
        if (!l.step) continue;
        c.beginPath();
        c.ellipse(l.foot.x, gY + 0.3 * u, 0.9 * u, 0.22 * u, 0, 0, TAU);
        c.fill();
      }
      c.restore();

      const bodyLen = this._bodyLen();
      const frontHip = this.legs[0].hip, rearHip = this.legs[2].hip;
      const bodyCY = (frontHip.y + rearHip.y) / 2;

      const NEAR = "#6ff2c0", FAR = "#2e5245", BODY = "#101915";

      const drawLeg = (l, stroke) => {
        const f = l.foot, k = l.knee, hp = l.hip;
        c.save();
        c.strokeStyle = stroke;
        c.lineCap = "round"; c.lineJoin = "round";
        c.lineWidth = 0.62 * u * (l.far ? 0.8 : 1);
        c.beginPath();
        c.moveTo(hp.x, hp.y + 0.4 * u);
        c.lineTo(k.x, k.y);
        c.lineTo(f.x, f.y);
        c.stroke();
        // joints
        c.fillStyle = stroke;
        for (const p of [hp, k]) {
          c.beginPath(); c.arc(p.x, p.y, 0.42 * u * (l.far ? 0.75 : 1), 0, TAU); c.fill();
          c.fillStyle = l.far ? FAR : "#0b241c";
          if (!l.far) { c.beginPath(); c.arc(p.x, p.y, 0.2 * u, 0, TAU); c.fillStyle = "#0b241c"; c.fill(); c.fillStyle = stroke; }
        }
        // foot pad
        if (!l.step && !l.far) {
          c.save();
          c.shadowColor = NEAR; c.shadowBlur = 8;
          c.fillStyle = NEAR;
          c.beginPath(); c.arc(f.x, f.y - 0.15 * u, 0.34 * u, 0, TAU); c.fill();
          c.restore();
        } else {
          c.fillStyle = stroke;
          c.beginPath(); c.arc(f.x, f.y - 0.15 * u, 0.3 * u * (l.far ? 0.8 : 1), 0, TAU); c.fill();
        }
        c.restore();
      };

      /* far legs behind body */
      for (const l of this.legs) if (l.far) drawLeg(l, FAR);

      /* tail */
      const tailWag = Math.sin(this.tailT) * (this.state === "SNIFF" || this.state === "SIT" ? 1.4 : 0.6) * u;
      const tailBase = { x: rearHip.x - this.facing * 1.2 * u, y: rearHip.y - 0.6 * u };
      c.save();
      c.strokeStyle = NEAR; c.lineWidth = 0.42 * u; c.lineCap = "round";
      c.beginPath();
      c.moveTo(tailBase.x, tailBase.y);
      c.quadraticCurveTo(
        tailBase.x - this.facing * 1.8 * u, tailBase.y - 1.6 * u,
        tailBase.x - this.facing * 2.6 * u, tailBase.y - 2.4 * u + tailWag * 0.4
      );
      c.stroke();
      c.fillStyle = "#ffb454";
      c.beginPath();
      c.arc(tailBase.x - this.facing * 2.6 * u, tailBase.y - 2.4 * u + tailWag * 0.4, 0.5 * u, 0, TAU);
      c.fill();
      c.restore();

      /* body */
      c.save();
      const bodyTopF = frontHip.y - 0.3 * u, bodyTopR = rearHip.y - 0.1 * u;
      c.translate(this.x, bodyCY - 1.4 * u);
      const pitch = Math.atan2(frontHip.y - rearHip.y, bodyLen * 0.9);
      c.rotate(-pitch * this.facing);
      const bw = bodyLen * 0.96, bh = 4.4 * u;
      c.beginPath();
      const r = 2 * u;
      c.moveTo(-bw / 2 + r, -bh / 2);
      c.lineTo(bw / 2 - r, -bh / 2); c.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + r);
      c.lineTo(bw / 2, bh / 2 - r); c.quadraticCurveTo(bw / 2, bh / 2, bw / 2 - r, bh / 2);
      c.lineTo(-bw / 2 + r, bh / 2); c.quadraticCurveTo(-bw / 2, bh / 2, -bw / 2, bh / 2 - r);
      c.lineTo(-bw / 2, -bh / 2 + r); c.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + r, -bh / 2);
      c.closePath();
      c.fillStyle = BODY; c.fill();
      c.strokeStyle = NEAR; c.lineWidth = 0.28 * u; c.stroke();
      // vents + core
      c.strokeStyle = "rgba(93,242,182,0.55)"; c.lineWidth = 0.14 * u;
      for (let i = -2; i <= 2; i++) {
        c.beginPath();
        c.moveTo(i * 1.5 * u - 0.5 * u, -0.6 * u);
        c.lineTo(i * 1.5 * u + 0.5 * u, -0.6 * u);
        c.stroke();
      }
      c.fillStyle = this.state === "SNIFF" ? "#ffb454" : NEAR;
      c.beginPath(); c.arc(0, 0.8 * u, 0.42 * u + Math.sin(this.breathT * 3) * 0.06 * u, 0, TAU); c.fill();
      c.fillStyle = "#06231a";
      c.font = `700 ${0.62 * u}px 'JetBrains Mono', monospace`;
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("04", 0, 0.82 * u);
      c.restore();

      /* neck + head */
      c.save();
      const neck = { x: frontHip.x + this.facing * 2.2 * u, y: frontHip.y - 1.4 * u };
      const headC = {
        x: neck.x + this.facing * (2.4 * u) + this.headYaw * this.facing * 2 * u,
        y: neck.y - 3.3 * u + this.headPitch * 2.2 * u,
      };
      c.strokeStyle = NEAR; c.lineWidth = 0.5 * u; c.lineCap = "round";
      c.beginPath(); c.moveTo(neck.x, neck.y + u); c.lineTo(headC.x - this.facing * 0.8 * u, headC.y + 0.8 * u); c.stroke();

      c.translate(headC.x, headC.y);
      c.rotate(this.headPitch * 0.55 * this.facing);
      // ear
      c.fillStyle = BODY; c.strokeStyle = NEAR; c.lineWidth = 0.22 * u;
      c.beginPath();
      c.moveTo(-this.facing * 0.4 * u, -1.3 * u);
      c.lineTo(-this.facing * 1.3 * u, -2.6 * u);
      c.lineTo(this.facing * 0.5 * u, -1.7 * u);
      c.closePath(); c.fill(); c.stroke();
      // skull
      const hw = 3.6 * u, hh = 2.5 * u;
      c.beginPath();
      const hr = 0.9 * u;
      c.moveTo(-hw / 2 + hr, -hh / 2);
      c.lineTo(hw / 2 - hr, -hh / 2); c.quadraticCurveTo(hw / 2, -hh / 2, hw / 2, -hh / 2 + hr);
      c.lineTo(hw / 2, hh / 2 - hr); c.quadraticCurveTo(hw / 2, hh / 2, hw / 2 - hr, hh / 2);
      c.lineTo(-hw / 2 + hr, hh / 2); c.quadraticCurveTo(-hw / 2, hh / 2, -hw / 2, hh / 2 - hr);
      c.lineTo(-hw / 2, -hh / 2 + hr); c.quadraticCurveTo(-hw / 2, -hh / 2, -hw / 2 + hr, -hh / 2);
      c.closePath(); c.fill(); c.stroke();
      // snout
      c.fillStyle = BODY;
      c.beginPath();
      c.rect(this.facing * (hw / 2) - (this.facing < 0 ? 1.5 * u : 0), -0.2 * u, 1.5 * u, 1.15 * u);
      c.fill(); c.stroke();
      // nose
      c.fillStyle = NEAR;
      c.beginPath();
      c.arc(this.facing * (hw / 2 + 1.5 * u - 0.2 * u), 0.35 * u, 0.34 * u, 0, TAU);
      c.fill();
      // eye (blink)
      const eyeOpen = 1 - this.blink;
      c.fillStyle = "#ffb454";
      c.beginPath();
      c.ellipse(this.facing * 0.7 * u, -0.35 * u, 0.34 * u, Math.max(0.05, 0.34 * u * eyeOpen), 0, 0, TAU);
      c.fill();
      c.restore();

      /* near legs in front */
      for (const l of this.legs) if (!l.far) drawLeg(l, NEAR);

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
