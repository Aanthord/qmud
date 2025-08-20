// js/books.js
// Dynamic books: branching pages (JSON), illustrations, stat effects, Aterna events.

import { Topics } from './aterna.js';
import { clamp01 } from './utils.js';

function extractJSON(text) {
  if (!text) return null;
  const t = text.trim();
  // 1) direct JSON
  try { return JSON.parse(t); } catch {}
  // 2) fenced ```json
  const m1 = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m1) { try { return JSON.parse(m1[1]); } catch {} }
  // 3) [JSON]...[/JSON]
  const m2 = t.match(/\$begin:math:display\$JSON\$end:math:display\$\s*([\s\S]*?)\s*\$begin:math:display\$\/JSON\$end:math:display\$/i);  if (m2) { try { return JSON.parse(m2[1]); } catch {} }
  // 4) first {...}
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
return null;
}

function stableSeed(playerId, bookId) {
  // simple deterministic seed string
  return `${playerId || 'p'}:${bookId || 'b'}`;
}

function isBookItem(it) { return it?.type === 'book'; }

export class BooksEngine {
  /**
   * @param {QuantumTruthMUD} game - the host game
   */
  constructor(game) {
    this.g = game;
  }

  // ----- Public Commands -----

  list() {
    const books = this._availableBooks();
    if (!books.length) {
      this.g.addOutput('You carry no books. Seek them in the stacks or the Scribe’s bazaar.');
      return;
    }
    const lines = ['[Books]'];
    for (const b of books) lines.push(`- ${b.name} (${b.id})`);
    lines.push('Use: read <book>, open <book>, use <book>, choose <n|id>, ask <question>, draw, book close, book resume, book summary');
    this.g.addOutput(lines.join('\n'));
  }

  open(token) {
    const id = this._findBookId(token);
    if (!id) { this.g.addOutput('Name the book clearly.'); return; }
    this._ensureSession(id);
    if (!this.g.aiEnabled) { this.g.addOutput('This book remains blank without the Librarian’s voice (AI is offline).'); return; }
    // If session has a current page, show it; else start at page 1
    if (this.g.state.bookSession?.current) {
      this._renderCurrent();
      return;
    }
    this._generatePage([]);
  }

  openById(id) { this.open(id); }

  async choose(token) {
    const s = this.g.state.bookSession;
    if (!s?.current) { this.g.addOutput('No book is open.'); return; }
    const page = s.pages[s.current];
    if (!page?.choices || !page.choices.length) { this.g.addOutput('This page offers no choice.'); return; }

    let choice = null;

    // numeric index
    const idx = parseInt(token, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= page.choices.length) {
      choice = page.choices[idx - 1];
    } else {
      // id or label startsWith
      const low = (token || '').toLowerCase();
      choice = page.choices.find(c => (c.id && c.id.toLowerCase() === low) ||
                                      (c.id && c.id.toLowerCase().startsWith(low)) ||
                                      (c.label && c.label.toLowerCase().startsWith(low)));
    }

    if (!choice) { this.g.addOutput('Choice not found.'); return; }

    // Apply immediate choice effects
    this._applyEffects(choice.effects || {});

    // Append to path and generate next
    s.path.push(choice.id || String(page.choices.indexOf(choice)));
    await this._generatePage([...s.path], choice);
  }

  async ask(q) {
    const s = this.g.state.bookSession;
    if (!s?.current) { this.g.addOutput('No book is open.'); return; }
    if (!this.g.aiEnabled) { this.g.addOutput('The pages rustle but do not answer (AI offline).'); return; }

    const page = s.pages[s.current];
    const prompt = this._promptAsk(s, page, q);
    const answer = await this.g.ai.callLLM(prompt);
    if (answer) this.g.addOutput(answer, 'librarian-voice');
  }

  async draw() {
    const s = this.g.state.bookSession;
    if (!s?.current) { this.g.addOutput('Open a book first.'); return; }
    if (!this.g.aiEnabled) { this.g.addOutput('Illustrations require the Librarian (AI offline).'); return; }
    const page = s.pages[s.current];
    const base = page.illustration_prompt || page.prose || page.title || s.title;
    const style = `an illustration from the ${s.title}, mythic, chiaroscuro, etching-like, cinematic`;
    const prompt = `${base}\n\n${style}`;
    const url = await this.g.ai.generateImage(prompt);
    if (url) {
      document.getElementById('room-image').src = url;
      this.g.addOutput('[An illustration bleeds through the page.]', 'system-message');
    } else {
      this.g.addOutput('[The illustration fails to manifest.]', 'system-message');
    }
  }

  close() {
    if (this.g.state.bookSession?.bookId) {
      this._publishBookEvent('book_close', { page_id: this.g.state.bookSession.current });
      this.g.addOutput(`You close ${this.g.state.bookSession.title}.`, 'system-message');
      this.g.state.bookSession.active = false;
    } else {
      this.g.addOutput('No book is open.');
    }
  }

  resume() {
    const s = this.g.state.bookSession;
    if (!s?.bookId) { this.g.addOutput('No book to resume.'); return; }
    s.active = true;
    this._renderCurrent();
  }

  summary() {
    const s = this.g.state.bookSession;
    if (!s?.bookId) { this.g.addOutput('No book is open.'); return; }
    const lines = [
      `[${s.title}]`,
      `Seed: ${s.seed}`,
      `Path: ${s.path.join(' → ') || '—'}`,
      `Pages: ${Object.keys(s.pages).length}`
    ];
    this.g.addOutput(lines.join('\n'));
  }

  // ----- Internals -----

  _availableBooks() {
    const invIds = this.g.state.inventory || [];
    return invIds
      .map(id => this.g.items[id])
      .filter(isBookItem);
  }

  _findBookId(token) {
    if (!token) return null;
    const invIds = this.g.state.inventory || [];
    const low = token.toLowerCase();
    for (const id of invIds) {
      const it = this.g.items[id];
      if (!isBookItem(it)) continue;
      if (id.toLowerCase() === low) return id;
      if (it.name.toLowerCase() === low) return id;
      if (it.name.toLowerCase().includes(low)) return id;
    }
    return null;
  }

  _ensureSession(bookId) {
    const it = this.g.items[bookId];
    if (!isBookItem(it)) { this.g.addOutput('That is not a book.'); return; }
    if (!this.g.state.bookSession || this.g.state.bookSession.bookId !== bookId) {
      const seed = stableSeed(this.g.playerId, bookId);
      this.g.state.bookSession = {
        active: true,
        bookId,
        title: it.name,
        seed,
        pages: {},
        current: null,
        path: [],
        createdAt: Date.now(),
        lastAt: Date.now()
      };
      this._publishBookEvent('book_open', {});
      this.g.addOutput(`[You open ${it.name}.]`, 'system-message');
    } else {
      this.g.state.bookSession.active = true;
    }
  }

  async _generatePage(path, chosen = null) {
    const s = this.g.state.bookSession;
    if (!s?.bookId) return;
    const roomId = this.g.state.currentRoom || 'nowhere';
    const room = this.g.roomTemplates[roomId];
    const prompt = this._promptPage(s, path, room?.name || roomId, chosen);

    const raw = await this.g.ai.callLLM(prompt);
    const obj = extractJSON(raw);

    if (!obj || !obj.page_id || !obj.prose) {
      this.g.addOutput('[The page refuses to resolve. Try again.]', 'system-message');
      return;
    }

    // Normalize shape
    obj.title = obj.title || `Leaf ${Object.keys(s.pages).length + 1}`;
    obj.choices = Array.isArray(obj.choices) ? obj.choices.slice(0, 6) : [];
    // Apply any page.on_enter effects (optional)
    if (obj.effects && typeof obj.effects === 'object') this._applyEffects(obj.effects);

    s.pages[obj.page_id] = obj;
    s.current = obj.page_id;
    s.lastAt = Date.now();

    this._renderCurrent();
    this._publishBookEvent('book_page', { page_id: obj.page_id, choice_id: chosen?.id || null });
    // snapshot (optional)
    this._publishBookSnapshot();
  }

  _renderCurrent() {
    const s = this.g.state.bookSession;
    if (!s?.current) return;
    const page = s.pages[s.current];
    this.g.addOutput(`\n[${s.title} — ${page.title}]`, 'room-name');
    this.g.addOutput(page.prose, 'librarian-voice');
    if (page.choices?.length) {
      const lines = ['Choices:'];
      page.choices.forEach((c, i) => lines.push(`${i+1}. ${c.label || c.id}`));
      this.g.addOutput(lines.join('\n'));
    } else {
      this.g.addOutput('The page offers contemplation, not decision.');
    }
  }

  _applyEffects(effects) {
    if (!effects || typeof effects !== 'object') return;
    // Supported: truth, quantum, shadow, insight, hp (deltas or absolutes with =)
    const s = this.g.state;
    const upd = (field, val) => {
      if (typeof val === 'number') s[field] = clamp01(s[field] + val);
      else if (typeof val === 'string' && /^=/.test(val)) {
        const num = parseFloat(val.slice(1));
        if (!isNaN(num)) s[field] = clamp01(num);
      }
    };
    if ('truth' in effects)  upd('truthDensity', effects.truth);
    if ('quantum' in effects) upd('quantumState', effects.quantum); // special: could be {coherence: +0.1}
    if (effects.quantum && typeof effects.quantum === 'object' && 'coherence' in effects.quantum) {
      s.quantumState.coherence = clamp01(s.quantumState.coherence + (effects.quantum.coherence || 0));
    }
    if ('shadow' in effects) upd('shadowIntegration', effects.shadow);
    if ('insight' in effects) {
      const val = effects.insight;
      if (typeof val === 'number') s.insight += Math.floor(val);
    }
    if ('hp' in effects) {
      const v = effects.hp;
      if (typeof v === 'number') s.hp = Math.max(0, Math.min(100, s.hp + Math.floor(v)));
    }
    if (effects.give_item && this.g.items[effects.give_item]) this.g.addItem(effects.give_item);
    if (effects.take_item && this.g.items[effects.take_item]) this.g.removeItem(effects.take_item);
    this.g.updateDisplay();
    this.g.publishPlayerState('book_effects').catch(()=>{});
  }

  _promptPage(session, path, roomName, chosen) {
    const me = this.g.state.player;
    const stats = {
      truth: this.g.state.truthDensity,
      quantum: this.g.state.quantumState.coherence,
      shadow: this.g.state.shadowIntegration,
      insight: this.g.state.insight,
      hp: this.g.state.hp
    };

    return `
You are the Quantum Librarian generating a branching page in an in‑world book.
Book Title: "${session.title}"
Book ID: "${session.bookId}"
Seed: "${session.seed}"
Room: "${roomName}"
Reader: ${me.name} (${me.archetype}), Stage: ${this.g.state.player.heroStage}
Stats: ${JSON.stringify(stats)}
Path so far (choice ids): ${JSON.stringify(path)}
${chosen ? `Last choice taken: ${JSON.stringify({ id: chosen.id, label: chosen.label })}` : ''}

Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "page_id": "short_slug_or_uuid",
  "title": "short page title",
  "prose": "≤160 words, atmospheric, second-person present, consistent with the book's theme",
  "illustration_prompt": "a compact visual prompt for an illustration of this page",
  "effects": { "truth": 0.0, "quantum": {"coherence": 0.0}, "shadow": 0.0, "insight": 0, "hp": 0 }, // optional
  "choices": [
    { "id":"a1", "label":"Do X", "effects":{"insight": 4} },
    { "id":"a2", "label":"Do Y" }
  ]
}
Keep choices 2–4 entries. If the story should end, return an empty array for "choices".
    `.trim();
  }

  _promptAsk(session, page, q) {
    const me = this.g.state.player;
    return `
As the narrator spirit of "${session.title}", answer the reader briefly (≤80 words), in‑voice.
Reader: ${me.name} (${me.archetype}), Stage: ${this.g.state.player.heroStage}
Current page title: ${page.title}
Question: ${q}
Avoid spoilers; give a nudge or luminous hint.
    `.trim();
  }

  _publishBookEvent(event_type, payload) {
    try {
      if (!this.g.aterna?.enabled) return;
      const s = this.g.state.bookSession;
      this.g.aterna.publishEvent(Topics.bookEvents(s.bookId), {
        event_type,
        player: this.g.buildPublicPlayerState(),
        payload: { ...payload, path: s.path.slice(0) }
      });
    } catch {}
  }

  _publishBookSnapshot() {
    try {
      if (!this.g.aterna?.enabled) return;
      const s = this.g.state.bookSession;
      this.g.aterna.publishEvent(Topics.bookState(s.bookId), {
        event_type: 'book_snapshot',
        player: this.g.buildPublicPlayerState(),
        payload: {
          book: { id: s.bookId, title: s.title, seed: s.seed },
          current: s.current,
          path: s.path.slice(0)
        }
      });
    } catch {}
  }
}
