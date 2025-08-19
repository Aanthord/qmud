# Quantum Truth MUD (qmud)
_Client-only, BYOK, GitHub Pages–ready narrative MUD_

A minimal, modular, **front-end only** MUD that runs on static hosting (GitHub Pages, Netlify, S3). It can play entirely **offline** (no AI/images) or, with your own OpenAI key, generate dynamic room prose and images.

---

## ✨ Features

- **Zero backend**: pure HTML/CSS/JS. Works on GitHub Pages.
- **BYOK AI** (optional): uses OpenAI **Responses API** (fallback to Chat Completions).  
  Image gen via `v1/images`. Model picks from UI.
- **Offline mode**: full game loop without AI or images.
- **Modular content**: drop `rooms.json` / `scenes.json` next to `index.html` to extend the world.
- **Inventory system**: `take`, `use`, `inventory`.
- **Map & fast travel**: clickable visited rooms.
- **Saves**: localStorage + **Export/Import** as JSON.
- **PWA-lite** (optional): `sw.js` + `manifest.webmanifest` for cached assets.

---

## 📁 Repo Layout

/
├─ index.html
├─ css/
│  └─ styles.css
├─ js/
│  ├─ app.js        # bootstraps and exposes window.game
│  ├─ game.js       # core loop, UI/state, commands
│  ├─ ai.js         # OpenAI wrappers (text + image)
│  ├─ content.js    # default rooms/scenes + JSON override loader
│  └─ utils.js      # helpers
├─ rooms.json           # (optional) extend/override rooms
├─ scenes.json          # (optional) extend/override creation scenes
├─ sw.js                # (optional) service worker (asset cache)
└─ manifest.webmanifest # (optional) PWA metadata

> All files are referenced via **relative paths**, so any file committed in the same directory is accessible.

---

## 🚀 Quick Start

### A) Run locally
```bash
# any static server works; examples:
python3 -m http.server 8080
# or
npx serve .

Open http://localhost:8080 and click Play Offline or enter your OpenAI API key and Enter the Library.

⚠️ Opening index.html via file:// will break fetch() for JSON/AI. Use a local HTTP server.

B) Deploy on GitHub Pages
	1.	Put these files in the repo root or /docs.
	2.	Settings → Pages
	•	Source: main branch
	•	Folder: / (root) or /docs (if you used a docs folder)
	3.	Visit your Pages URL.

⸻

🔐 BYOK (Bring Your Own Key)
	•	Enter your OpenAI API key in the setup screen.
	•	The key is stored only in your browser’s localStorage and sent only to OpenAI endpoints from your device.
	•	Do not hardcode keys in source. For production, proxy requests server-side.

Models
	•	Text (UI select): gpt-4o-mini (default), gpt-4o, gpt-5 (if enabled)
	•	Images: gpt-image-1

Endpoints used
	•	POST /v1/responses (preferred) → usage counted if present
	•	POST /v1/chat/completions (fallback)
	•	POST /v1/images (returns URL or base64)

⸻

🕹️ Gameplay
	•	Type in the command box. Try: help
	•	Movement: go north|south|east|west (also n|s|e|w)
	•	Look: look, examine, look around, look self
	•	Stats: stats
	•	Meditate: meditate
	•	Map: map (toggle mini-map; click rooms to fast-travel)
	•	Inventory: take <item>, use <item>, inventory (or inv)
	•	Save: save (export JSON)
	•	Load: load (choose a previous JSON)
	•	Reset: reset

AI enhancements (if enabled):
	•	Atmospheric room descriptions from the Quantum Librarian.
	•	Cinematic room images tailored to your current stats.

⸻

🧱 Content Packs

Extend or replace the world without editing code.

rooms.json (example)

{
  "oracle_chamber": {
    "name": "The Oracle Chamber",
    "basePrompt": "Ancient temple meets quantum uncertainty, Oracle speaks in superpositions, Eastern philosophy",
    "exits": { "west": "garden_of_forking_paths", "north": "quantum_laboratory", "east": "vault_of_names" },
    "literary": "eastern"
  },
  "vault_of_names": {
    "name": "The Vault of Names",
    "basePrompt": "An obsidian vault where true names vibrate as strings of light; each syllable folds space",
    "exits": { "west": "oracle_chamber" },
    "literary": "myth",
    "items": ["Glyph of Memory"]
  }
}

scenes.json (example)

[
  {
    "text": "The door asks for a price you once refused to pay. What do you offer now?",
    "choices": [
      { "text": "A memory I no longer need", "value": "memory" },
      { "text": "My certainty", "value": "uncertainty" },
      { "text": "Time from a future that may not come", "value": "time" }
    ]
  }
]

If present, these files override/extend defaults at runtime via fetch().

⸻

🧪 Saving & Versioning
	•	Saves live in localStorage and can be exported/imported as JSON.
	•	Old saves are compatible; the game auto-migrates simple changes (e.g., visitedRooms Set ↔ Array).

⸻

⚙️ Optional PWA
	•	sw.js caches static assets (HTML/CSS/JS/manifest) for offline play.
	•	JSON content packs (rooms.json, scenes.json) use network-first (then cache fallback).
	•	Safe to delete if you don’t want caching.

⸻

🔧 Dev Notes
	•	Modern browsers required (ES modules + top-level await).
	•	No build step. No dependencies.
	•	All network calls are direct from browser → OpenAI.
	•	CORS: serve over HTTP locally; don’t use file://.

⸻

🧭 Architecture
	•	game.js: state machine, command parser, rendering
	•	ai.js: OpenAI calls (text + image), token accounting, status updates
	•	content.js: default rooms/scenes + override loader
	•	app.js: bootstraps, exposes window.game for inline buttons
	•	styles.css: the look (status panel, map, overlays, etc.)

⸻

🛡️ Security Notes
	•	BYOK demo. Your key, your browser, your requests.
	•	If you fork for public use, strongly consider:
	•	Server-side proxy to protect keys and enforce quotas
	•	Domain allowlists, rate limits, abuse protection
	•	Optional auth to gate AI usage

⸻

❓ FAQ

Q: Why do images sometimes fail?
A: Model/plan limits or network hiccups. The UI handles it and continues the story. Offline mode skips image generation entirely.

Q: I changed rooms.json but nothing happened.
A: Your browser may cache. Hard refresh or bump the sw.js cache name (or disable the service worker during content iteration).

Q: Can I add more commands?
A: Yes—extend the processOffline() switch in game.js. For AI-aware behaviors, adjust the prompt in processWithAI().

Q: Can I persist images locally?
A: Current cache is in-memory (URL/b64). You can extend to IndexedDB if you want persistent image caching.

⸻

🗺️ Changelog (highlights)
	•	2.2: Modular split, content packs, inventory, optional PWA, save compatibility.
	•	2.1: Responses API + Chat Completions fallback, image caching, UI polish, map fast-travel, save import/export.
	•	2.0: Offline narrative, character creation, status panel, basic rooms.

⸻

🙌 Credits
	•	Narrative engine and UI, © You.
	•	OpenAI models: gpt-4o-mini, gpt-4o, gpt-5 (if enabled), gpt-image-1.

“We don’t see things as they are, we see them as we are.” — Anaïs Nin

