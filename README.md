# yadakrishna245.github.io

Portfolio of **Krishna Chaithanya**, Senior Linux Administrator and DevOps Engineer.

| Version | Live | Files |
|---|---|---|
| Particle field (current) | https://yadakrishna245.github.io | `index.html`, `app.css`, `app-ui.js`, `app.js` |
| Data center (classic backup) | https://yadakrishna245.github.io/classic/ | `classic/` (also tagged `v1-datacenter`) |

**Particle field:** 26,000 GPU particles rebuild themselves as you scroll: my name, a globe, a 4,096-point lattice (one point per server), a pipeline helix, an award rosette and a galaxy. Particles move away from the cursor.

**Data center:** a scroll-driven fly-through of 4,000 instanced server racks with clickable project screens.

Both are plain static files using Three.js from jsDelivr, with no build step. Each one falls back to a readable page without WebGL, respects `prefers-reduced-motion`, and runs a lighter scene on phones.

Run locally: `python -m http.server` in this folder, then open http://localhost:8000.
