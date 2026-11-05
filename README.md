# yadakrishna245.github.io

Interactive 3D portfolio of **Krishna Chaithanya**, Senior Linux Administrator and DevOps Engineer.

**Live:** https://yadakrishna245.github.io

A scroll-driven fly-through of a data center with one rack for every server I manage (4,000), built with [Three.js](https://threejs.org) and hosted on GitHub Pages.

- No build step: `index.html`, `style.css`, `ui.js` and `main.js` (ES modules from jsDelivr)
- Falls back to a plain, readable page when WebGL isn't available
- Respects `prefers-reduced-motion`; lighter scene on phones

Run locally: `python -m http.server` in this folder, then open http://localhost:8000.
