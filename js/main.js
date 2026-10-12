/* ══════════════════════════════════════════════════════════════
   KRUSHNAKANTA PANDA — PORTFOLIO · main.js
   loader · cursor · nav · reveals · counters · tilt · marquee
   project filters · certificate lightbox · robo-dog wiring
══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ─────────── BOOT LOADER ─────────── */
  const loader = $("#loader");
  const loaderBar = $(".loader__bar i");
  const loaderLog = $("#loaderLog");
  const bootLines = [
    "initializing mechatronic interface…",
    "loading gait controller ......... OK",
    "servo rail 4×2 DOF .............. OK",
    "calibrating showcase modules .... OK",
    "systems nominal. welcome.",
  ];
  let bootStep = 0;
  const bootTimer = setInterval(() => {
    bootStep++;
    if (loaderBar) loaderBar.style.width = `${Math.min(100, bootStep * 25)}%`;
    if (loaderLog && bootLines[bootStep - 1]) loaderLog.textContent = bootLines[bootStep - 1];
    if (bootStep >= 5) {
      clearInterval(bootTimer);
      setTimeout(() => loader && loader.classList.add("is-done"), 220);
    }
  }, reduceMotion ? 60 : 240);
  window.addEventListener("load", () => {
    setTimeout(() => loader && loader.classList.add("is-done"), 1400);
  });

  /* ─────────── CUSTOM CURSOR ─────────── */
  if (finePointer && !reduceMotion) {
    const cursor = $(".cursor");
    const dot = $(".cursor__dot"), ring = $(".cursor__ring");
    let mx = -100, my = -100, rx = -100, ry = -100;
    document.addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; });
    document.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
    document.addEventListener("pointerup", () => cursor.classList.remove("is-down"));
    const hoverSel = "a, button, input[type=range], [data-cert-open], .proj__link";
    document.addEventListener("pointerover", (e) => {
      cursor.classList.toggle("is-hover", !!e.target.closest(hoverSel));
    });
    (function cursorLoop() {
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      dot.style.transform = `translate(${mx - 3}px, ${my - 3}px)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(cursorLoop);
    })();
  }

  /* ─────────── NAV: progress, hide-on-scroll, active link ─────────── */
  const nav = $("#nav");
  const navProgress = $("#navProgress");
  let lastY = 0;
  const onScroll = () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (navProgress) navProgress.style.width = `${(y / Math.max(1, max)) * 100}%`;
    if (y > 140 && y > lastY + 4) nav.classList.add("is-hidden");
    else if (y < lastY - 4 || y < 140) nav.classList.remove("is-hidden");
    lastY = y;
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const sections = ["lab", "work", "experience", "about", "certifications"];
  const navLinks = $$(".nav__link");
  const secObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      navLinks.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${en.target.id}`));
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach((id) => { const el = document.getElementById(id); if (el) secObserver.observe(el); });

  /* ─────────── MOBILE MENU ─────────── */
  const burger = $("#burger");
  const mmenu = $("#mmenu");
  const setMenu = (open) => {
    burger.classList.toggle("is-open", open);
    mmenu.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    mmenu.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("no-scroll", open);
  };
  burger.addEventListener("click", () => setMenu(!mmenu.classList.contains("is-open")));
  $$(".mmenu__link, .mmenu__foot a", mmenu).forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && mmenu.classList.contains("is-open")) setMenu(false); });

  /* ─────────── REVEAL ON SCROLL ─────────── */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); revealObserver.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  $$(".reveal, .proj").forEach((el) => revealObserver.observe(el));

  /* ─────────── COUNTERS ─────────── */
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      countObserver.unobserve(en.target);
      const el = en.target;
      const end = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.decimals || "0", 10);
      const dur = reduceMotion ? 1 : 1400;
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (end * eased).toFixed(dec);
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => countObserver.observe(el));

  /* ─────────── MARQUEES (duplicate for seamless loop) ─────────── */
  $$("[data-marquee]").forEach((track) => {
    track.innerHTML += track.innerHTML;
  });

  /* ─────────── MAGNETIC BUTTONS ─────────── */
  if (finePointer && !reduceMotion) {
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.14}px, ${dy * 0.18}px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }

  /* ─────────── TILT CARDS ─────────── */
  if (finePointer && !reduceMotion) {
    $$("[data-tilt]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateZ(0)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }

  /* ─────────── PROJECT SPOTLIGHT + FILTERS ─────────── */
  $$(".proj__link").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      card.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    });
  });
  $$(".work__filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$(".work__filters .chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      const f = chip.dataset.filter;
      $$(".proj").forEach((p) => {
        p.classList.toggle("is-filtered", f !== "all" && p.dataset.cat !== f);
      });
    });
  });

  /* ─────────── CERTIFICATE LIGHTBOX ─────────── */
  const CERTS = {
    hmel: {
      title: "HMEL · VOCATIONAL INTERNSHIP CERTIFICATE",
      img: "assets/certs/hmel.jpg",
      pdf: "assets/certs/HMEL-Internship-Certificate-Krushnakanta-Panda.pdf",
      meta: "HPCL–MITTAL ENERGY LTD · GGSR BATHINDA · “OVERVIEW OF ASRS” · 05 MAY – 20 JUN 2026 · REF: HMEL/HL/VIT/2025-26/044",
    },
    udemy: {
      title: "UDEMY · 8051 MICROCONTROLLER — EMBEDDED C & ASSEMBLY",
      img: "assets/certs/udemy.jpg",
      pdf: "assets/certs/Udemy-8051-Microcontroller-Embedded-C-Krushnakanta-Panda.pdf",
      meta: "SMART LOGIC ACADEMY · 9.5 HOURS · 15 MAR 2026 · CERT NO. UC-715448C4-53D5-4A48-AE94-63B7AFB8D6DA",
    },
    matlab: {
      title: "NIELIT CALICUT · INTRODUCTION TO MATLAB & SIMULINK",
      img: "assets/certs/matlab.jpg",
      pdf: "assets/certs/NIELIT-MATLAB-Simulink-Krushnakanta-Panda.pdf",
      meta: "NIELIT CALICUT · CHIPS TO STARTUP PROGRAMME · 13–17 JAN 2026 · CERT NO. OLC 47704",
    },
  };
  const lightbox = $("#lightbox");
  const lbImg = $("#lbImg"), lbTitle = $("#lbTitle"), lbPdf = $("#lbPdf"), lbMeta = $("#lbMeta");
  let lastFocus = null;
  const openCert = (key) => {
    const c = CERTS[key];
    if (!c) return;
    lastFocus = document.activeElement;
    lbImg.src = c.img;
    lbImg.alt = c.title;
    lbTitle.textContent = c.title;
    lbPdf.href = c.pdf;
    lbMeta.textContent = c.meta;
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    $("#lbClose").focus();
  };
  const closeCert = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    lbImg.src = "";
    if (lastFocus) lastFocus.focus();
  };
  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-cert-open]");
    if (opener) { e.preventDefault(); openCert(opener.dataset.certOpen); return; }
    if (e.target.closest("[data-cert-close]") || e.target.closest("#lbClose")) closeCert();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.classList.contains("is-open")) closeCert();
  });

  /* ─────────── FOOTER CLOCK + TO TOP ─────────── */
  const clock = $("#footClock");
  if (clock) {
    const tickClock = () => {
      const d = new Date();
      clock.textContent = `LOCAL ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    };
    tickClock();
    setInterval(tickClock, 1000);
  }
  const toTop = $("#toTop");
  if (toTop) toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));

  /* ─────────── ROBO DOG WIRING ─────────── */
  const dogCanvas = $("#dogCanvas");
  if (dogCanvas && window.RoboDog) {
    const dog = new window.RoboDog(dogCanvas);
    const hint = $("#rigHint");
    dog.onFirstInteract = () => hint && hint.classList.add("is-hidden");
    setTimeout(() => hint && hint.classList.add("is-hidden"), 9000);

    // readouts
    const ro = {
      state: $("#ro-state"), vel: $("#ro-vel"), hips: $("#ro-hips"), knees: $("#ro-knees"),
    };
    dog.onReadout = (d) => {
      if (ro.state) ro.state.textContent = d.state;
      if (ro.vel) ro.vel.textContent = `${d.vel.toFixed(2)} m/s`;
      if (ro.hips) ro.hips.textContent = `${d.hip.toFixed(0)}° avg`;
      if (ro.knees) ro.knees.textContent = `${d.knee.toFixed(0)}° avg`;
    };

    // mode segmented control
    const modeSeg = $("#modeSeg");
    $$(".seg__btn", modeSeg).forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".seg__btn", modeSeg).forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        dog.setMode(btn.dataset.mode);
        if (hint) hint.classList.add("is-hidden");
      });
    });

    // gait segmented control
    const gaitSeg = $("#gaitSeg");
    $$(".seg__btn", gaitSeg).forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".seg__btn", gaitSeg).forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        dog.setGait(btn.dataset.gait);
      });
    });

    // speed slider
    const speedRange = $("#speedRange");
    const speedOut = $("#speedOut");
    const applySpeed = () => {
      const v = parseInt(speedRange.value, 10);
      dog.setSpeed(v / 100);
      speedOut.textContent = `${v}%`;
      speedRange.style.setProperty("--fill", `${v}%`);
    };
    speedRange.addEventListener("input", applySpeed);
    applySpeed();
  }
})();
