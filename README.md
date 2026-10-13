# Krushnakanta Panda — Portfolio & Quadruped Lab

A dark, industrial-styled personal portfolio for a mechatronics engineering student,
with an **interactive robot-dog simulation** built into it — a digital twin of the
real Arduino quadruped project.

## ✨ Highlights

- **KP—04 Quadruped Virtual Rig** — a canvas robot dog with real two-link inverse
  kinematics legs, an adaptive stepping gait (trot pairs + 4-beat walk), and three
  behaviours: **ROAM** (wanders on its own), **FOLLOW** (trots to your cursor/finger),
  **SIT** (folds its hind legs and sits like a good boy). Tap the floor inside the pen
  to call it over. Live readout shows state, velocity and average joint angles.
- **Certificate wall with real previews** — tap any certificate (HMEL internship,
  Udemy 8051, NIELIT MATLAB) to inspect the actual document in a lightbox, or open
  the original PDF for recruitment records.
- **Projects linked to GitHub repos** — RGV/ASRS industry work, Arduino quadruped,
  wireless CNC plotter, autonomous mopping robot, with category filters.
- Reveal-on-scroll animations, animated blueprint SVGs, custom cursor + magnetic
  buttons (desktop), 3-D tilt photo cards, animated stat counters, seamless marquees,
  progress-aware nav, fullscreen mobile menu.
- **Fully responsive** — fluid type, touch-friendly controls, the dog works with
  fingers too. Pauses rendering off-screen to save battery. Honors
  `prefers-reduced-motion`.
- Zero dependencies, zero build step, works fully offline (fonts bundled as woff2).

## 🗂 Structure

```
portfolio/
├── index.html                  # single-page site
├── css/
│   ├── style.css               # design system + responsive rules
│   └── fonts.css               # local @font-face declarations
├── js/
│   ├── robodog.js              # KP—04 quadruped simulation (IK gait engine)
│   └── main.js                 # UI logic, lightbox, filters, animations
├── assets/
│   ├── img/                    # profile photo (optimized)
│   ├── certs/                  # certificate previews (jpg) + originals (pdf)
│   ├── fonts/                  # Sora, Space Grotesk, JetBrains Mono (woff2)
│   └── Krushnakanta-Panda-Resume.pdf
```

## 🚀 Run / deploy

It's a static site — no build needed.

```bash
# local preview
python3 -m http.server 8000
# → http://localhost:8000
```

**GitHub Pages:** push this folder to the root of a repo named
`<username>.github.io` (or any repo + enable Pages). All paths are relative, so it
works from a sub-folder too.

## 🔗 Links

- GitHub: https://github.com/krushnakantpanda
- Email: krishnakantpanda25@gmail.com

---
© 2026 Krushnakanta Panda · Machines that move. Code that moves them.
