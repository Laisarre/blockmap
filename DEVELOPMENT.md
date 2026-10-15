# Running this locally

This is a plain static site — just HTML, CSS, and JavaScript files. No npm install, no build step, nothing to compile. If you've downloaded this folder and want to run it on your own machine, all you need is a local web server to serve the files.

Why a server and not just double-clicking `index.html`? The app is split into several JavaScript modules that `import` from each other, and browsers refuse to load modules over a plain `file://` path for security reasons. Serving the folder over `http://localhost` instead fixes that, and takes one line in a terminal.

Pick whichever of these you already have installed:

**Python** (comes with most systems):

```
python -m http.server 8000
```

**Node.js**:

```
npx serve
```

**VS Code**: install the "Live Server" extension, right-click `index.html`, choose "Open with Live Server."

Whichever you use, open the address it gives you (something like `http://localhost:8000`) in your browser, and you're running the full app from your own machine.

One small catch with the Python option: on some systems it serves `.js` files with the wrong content type, which makes browsers refuse to load them as modules. If the page loads but the canvas stays blank and the browser console shows a module-loading error, switch to `npx serve` instead — it always gets this right.

## Putting it online

Since it's just static files, any static host works — GitHub Pages, Netlify, Cloudflare Pages, a plain file server, whatever you've got. Upload the contents of this folder and point the host at `index.html`. There's no build step to run first.

## Project layout

```
index.html          page shell
css/styles.css       all styling
js/constants.js      tile size, colors, zoom limits, default palettes
js/geometry.js       cellCenter, wall-face math, color helpers (pure functions)
js/stairs.js         Stair class + tread/riser geometry
js/state.js           AppState: grid/palettes/sprites/notes/arrows/stairs, no DOM
js/render.js          canvas drawing, shared by the live view and PNG export
js/legend.js          legend grouping/layout, shared by the sidebar and export
js/export.js          PNG export (bounds-fitting, all 5 variants, preview)
js/persistence.js     serialize/deserialize, autosave, Save/Open
js/ui.js              palettes, legend, sprite list, popovers, modal (DOM only)
js/main.js            bootstrap + canvas pointer/keyboard event wiring
```

## A couple of implementation notes

- Sprite images and saved projects are embedded as base64 inside the `.json` file on Save — there's no separate folder of image files to keep track of, since a browser can't manage one on disk the way a desktop app could. One file has everything.
- The project also autosaves to the browser's `localStorage` as you work. If you're testing storage-related changes, remember that's per-origin — `http://localhost:8000` and `http://localhost:5000` won't see each other's autosaved data.
