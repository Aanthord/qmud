// js/game.js
// Complete file — fixed: showHelp() moved outside constructor; creationScenes default -> [].

import { clamp01, downloadJSON } from './utils.js';
import { AIClient } from './ai.js';
import { loadContent } from './content.js';
import { AternaClient, Topics } from './aterna.js';
import { BooksEngine } from './books.js';

/**
 * Main game class tying together AI, Aterna pub/sub, dynamic books,
 * items, combat, economy, evolution, saves, and UI.
 */
export class QuantumTruthMUD {
  constructor() {
    // --- Runtime configuration ---
    this.apiKey = null;
    this.textModel = 'gpt-4o-mini';
    this.imageModel = 'gpt-image-1';
    this.aiEnabled = false;

    // Image caching
    this.imageCache = new Map();
    this._imageInflight = new Set();
    this.descCache = new Map();
    this.tokenCount = 0;

    // AI throttle
    this.processingCommand = false;
    this.lastAIAt = 0;
    this.minAIIntervalMs = 1500;

    // Multiplayer / Aterna
    this.aterna = null;
    this.playerId = localStorage.getItem('qmud_player_id') || null;
    this.roomUnsub = null;
    this.roomPeers = new Map();
    this._hb = null; // heartbeat interval

    // Game state
    this.state = {
      stage: 'setup',
      player: null,
      currentRoom: null,
      visitedRooms: new Set(),
      actionCount: 0,
      history: [],
      inventory: [],
      insight: 0,
      hp: 100,
      quantumState: { coherence: 0, entanglement: [], superposition: 0 },
      truthDensity: 0.5,
      shadowIntegration: 0,
      creationData: { observations: [], currentScene: 0, startTime: Date.now() },
      bookSession: null // dynamic book reading session
    };

    // Content placeholders
    this.roomTemplates = {};
    this.creationScenes = []; // fix: must be an array (showCreationScene uses .length)
    this.items = {};

    // Instantiate Book engine
    this.books = new BooksEngine(this);

    // Instantiate AI client
    this.ai = new AIClient(
      () => this.apiKey,
      () => this.textModel,
      () => this.imageModel,
      n => this.bumpTokens(n),
      (type, status, text) => this.updateStatus(type, status, text),
      () => localStorage.getItem('qmud_api_base') || 'https://api.openai.com'
    );
  }

  /**
   * Initialize game: load content, hydrate settings, set up Aterna, attach UI listeners, auto-load save.
   */
  async init() {
    // Load rooms, items, scenes (allow overrides)
    const content = await loadContent();
    this.roomTemplates = content.rooms;
    this.creationScenes = content.scenes;
    this.items = content.items;

    // Hydrate OpenAI API key
    const savedKey = localStorage.getItem('qmud_api_key');
    if (savedKey) document.getElementById('api-key-input').value = savedKey;

    // Hydrate API base (proxy)
    const savedBase = localStorage.getItem('qmud_api_base') || '';
    const apiBaseInput = document.getElementById('api-base');
    if (apiBaseInput) {
      apiBaseInput.value = savedBase;
      apiBaseInput.addEventListener('change', e => {
        localStorage.setItem('qmud_api_base', e.target.value.trim());
      });
    }

    // Hydrate models
    const m = localStorage.getItem('qmud_models');
    if (m) {
      try {
        const { textModel, imageModel } = JSON.parse(m);
        if (textModel) this.textModel = textModel;
        if (imageModel) this.imageModel = imageModel;
      } catch {}
    }
    document.getElementById('text-model').value = this.textModel;
    document.getElementById('image-model').value = this.imageModel;
    document.getElementById('text-model').addEventListener('change', e => {
      this.textModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });
    document.getElementById('image-model').addEventListener('change', e => {
      this.imageModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });

    // Hydrate Aterna config
    const baseEl = document.getElementById('aterna-base');
    const tokEl  = document.getElementById('aterna-token');
    const pubEl  = document.getElementById('aterna-publish');
    const subEl  = document.getElementById('aterna-subscribe');
    const chkEl  = document.getElementById('aterna-enable');
    const audEl  = document.getElementById('aterna-audit');
    const sseTok = document.getElementById('aterna-sse-token');
    const sseTokParam = document.getElementById('aterna-sse-token-param');

    const aterBase  = localStorage.getItem('qmud_aterna_base') || '';
    const aterTok   = localStorage.getItem('qmud_aterna_token') || '';
    const aterPub   = localStorage.getItem('qmud_aterna_publish') || '/api/publish';
    const aterSub   = localStorage.getItem('qmud_aterna_subscribe') || '/api/subscribe';
    const aterEnable= localStorage.getItem('qmud_aterna_enable') === '1';
    const aterAudit = localStorage.getItem('qmud_aterna_audit') === '1';
    const sseTokenVal= localStorage.getItem('qmud_aterna_sse_token') || '';
    const sseTokenKey= localStorage.getItem('qmud_aterna_sse_token_param') || 'token';

    if (baseEl) baseEl.value = aterBase;
    if (tokEl)  tokEl.value  = aterTok;
    if (pubEl)  pubEl.value  = aterPub;
    if (subEl)  subEl.value  = aterSub;
    if (chkEl)  chkEl.checked= aterEnable;
    if (audEl)  audEl.checked= aterAudit;
    if (sseTok) sseTok.value = sseTokenVal;
    if (sseTokParam) sseTokParam.value = sseTokenKey;

    const persistAterna = () => {
      localStorage.setItem('qmud_aterna_base', baseEl.value.trim());
      localStorage.setItem('qmud_aterna_token', tokEl.value.trim());
      localStorage.setItem('qmud_aterna_publish', pubEl.value.trim() || '/api/publish');
      localStorage.setItem('qmud_aterna_subscribe', subEl.value.trim() || '/api/subscribe');
      localStorage.setItem('qmud_aterna_enable', chkEl.checked ? '1' : '0');
      localStorage.setItem('qmud_aterna_audit', audEl.checked ? '1' : '0');
      localStorage.setItem('qmud_aterna_sse_token', sseTok.value.trim());
      localStorage.setItem('qmud_aterna_sse_token_param', sseTokParam.value.trim() || 'token');
    };
    [baseEl, tokEl, pubEl, subEl, chkEl, audEl, sseTok, sseTokParam].forEach(el => el && el.addEventListener('change', persistAterna));

    if (aterEnable && aterBase) {
      this.aterna = new AternaClient({
        base: aterBase,
        token: aterTok,
        publishPath: aterPub,
        subscribePath: aterSub,
        sender: 'qmud-client',
        sseTokenParam: sseTokenKey,
        sseTokenValue: sseTokenVal,
        mirrorAudit: aterAudit
      });
    }

    // Mouse tracking for quantum overlay
    document.addEventListener('mousemove', e => {
      const display = document.getElementById('image-display');
      if (display) {
        const rect = display.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100) + '%';
        const y = ((e.clientY - rect.top) / rect.height * 100) + '%';
        display.style.setProperty('--mouse-x', x);
        display.style.setProperty('--mouse-y', y);
      }
    });

    // Auto-save state every 30 seconds
    setInterval(() => this.saveState(), 30000);

    // Load saved game (if any)
    this.loadState();

    // Service worker registration (no-op if missing)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ================= Setup / Start ==================

  /**
   * Validate API key and start game (AI-enabled).
   */
  validateAndStart() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey || !apiKey.startsWith('sk-')) {
      alert('Please enter a valid OpenAI API key');
      return;
    }
    this.apiKey = apiKey;
    localStorage.setItem('qmud_api_key', apiKey);
    this.aiEnabled = true;

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('status-panel').style.display = 'block';
    this.updateStatus('ai', 'active', 'Connected');
    this.updateStatus('image', 'active', 'Ready');
    this.state.stage = 'covenant';
  }

  /**
   * Start game in offline mode (AI disabled).
   */
  startOffline() {
    this.aiEnabled = false;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('status-panel').style.display = 'block';
    this.updateStatus('ai', 'inactive', 'Offline');
    this.updateStatus('image', 'inactive', 'Offline');
    this.state.stage = 'covenant';
  }

  /**
   * Update status panel (AI/Image).
   */
  updateStatus(type, status, text) {
    const dot = document.getElementById(`${type}-status`);
    dot.className = `status-dot ${status}`;
    document.getElementById(`${type}-status-text`).textContent = text;
  }

  // ================= Covenant & Character Creation ================

  /**
   * Accept covenant: proceed to character creation.
   */
  acceptCovenant() {
    document.getElementById('covenant').style.display = 'none';
    document.getElementById('creation').style.display = 'block';
    this.state.stage = 'creation';
    this.startCharacterCreation();
  }

  /**
   * Start character creation scenes.
   */
  startCharacterCreation() { 
    this.showCreationScene(0); 
  }

  /**
   * Render a creation scene and attach handlers.
   */
  showCreationScene(index) {
    if (index >= this.creationScenes.length) { 
      this.finalizeCharacter(); 
      return; 
    }
    const scene = this.creationScenes[index];
    const textEl = document.getElementById('creation-text');
    const choicesEl = document.getElementById('creation-choices');
    textEl.textContent = scene.text; 
    choicesEl.innerHTML = '';

    if (scene.choices[0]?.input) {
      const input = document.createElement('input');
      input.type = 'text'; 
      input.className = 'api-input'; 
      input.placeholder = 'Your true name…'; 
      input.style.marginBottom = '10px';
      choicesEl.appendChild(input);
      scene.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.onclick = () => {
          const value = choice.value === 'named' ? (input.value || 'Unnamed') : '[SILENCE]';
          this.recordCreationChoice(index, choice.value, value);
          this.showCreationScene(index + 1);
        };
        choicesEl.appendChild(btn);
      });
    } else {
      scene.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.onclick = () => {
          this.recordCreationChoice(index, choice.value);
          this.showCreationScene(index + 1);
        };
        choicesEl.appendChild(btn);
      });
    }
  }

  /**
   * Record choice during character creation.
   */
  recordCreationChoice(sceneIndex, value, extra=null) {
    this.state.creationData.observations.push({
      scene: sceneIndex, choice: value, extra,
      timestamp: Date.now() - this.state.creationData.startTime
    });
  }

  /**
   * Finalize character and proceed to game.
   */
  async finalizeCharacter() {
    const obs = this.state.creationData.observations;
    const trueForm = {
      name: obs[4]?.extra || 'Seeker',
      archetype: this.deriveArchetype(obs),
      shadowLevel: this.deriveShadowLevel(obs),
      quantumSignature: Math.random(),
      truthDensity: 0.5,
      heroStage: 'Threshold'
    };
    this.state.player = trueForm;
    this.state.currentRoom = 'entrance';

    if (obs[0]?.choice === 'contemplative') this.state.quantumState.coherence += 0.1;
    if (obs[1]?.choice === 'shadow-seeker') this.state.shadowIntegration += 0.2;
    if (obs[2]?.choice === 'integrated') this.state.shadowIntegration += 0.3;
    if (obs[3]?.choice === 'full-integration') this.state.shadowIntegration -= 0.2;
    this.state.shadowIntegration = clamp01(this.state.shadowIntegration + 0.5);

    // Ensure stable playerId
    if (!this.playerId) {
      this.playerId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem('qmud_player_id', this.playerId);
    }

    // Set Aterna sender and publish initial state
    if (this.aterna?.enabled) {
      this.aterna.sender = `${this.state.player.name}#${this.playerId.slice(0,6)}`;
      this.publishPlayerState('join').catch(()=>{});
    }

    // AI welcome
    if (this.aiEnabled) {
      const prompt = `As the Quantum Librarian, welcome ${this.state.player.name} (${this.state.player.archetype}) to the Library. Their truth density is ${this.state.truthDensity}, quantum coherence ${this.state.quantumState.coherence}, shadow integration ${this.state.shadowIntegration}. Give a personalized, mysterious welcome that hints at their journey ahead. Keep it under 100 words and deeply atmospheric.`;
      try { this.librarianMessage = await this.ai.callLLM(prompt); } catch {}
    }
    this.startGame();
  }

  /**
   * Determine archetype from first scene choice.
   */
  deriveArchetype(observations) {
    const m = { active:'Warrior', contemplative:'Sage', intuitive:'Mystic', cautious:'Guardian' };
    return m[observations[0]?.choice] || 'Wanderer';
  }

  /**
   * Determine initial shadow level.
   */
  deriveShadowLevel(observations) {
    let s = 0;
    if (observations[2]?.choice === 'integrated') s += 0.3;
    if (observations[3]?.choice === 'rejection') s += 0.4;
    return clamp01(s + 0.5);
  }

  // ================= Game Play =================

  /**
   * Start main game after character creation or load.
   */
  startGame() {
    document.getElementById('creation').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('character').style.display = 'block';
    document.getElementById('map').style.display = 'block';
    this.state.stage = 'playing';
    this.updateDisplay();
    this.enterRoom('entrance');

    // Show Librarian welcome
    if (this.librarianMessage) {
      this.addOutput('[The Quantum Librarian speaks:]', 'system-message');
      this.addOutput(this.librarianMessage, 'librarian-voice');
    } else {
      this.addOutput(`Welcome to the Canonical Library, ${this.state.player.name}.`);
      this.addOutput(`You are a ${this.state.player.archetype} at the ${this.state.player.heroStage} stage of your journey.`);
    }

    // On unload, send leave signal
    window.addEventListener('beforeunload', () => {
      if (this.aterna?.enabled && this.state.currentRoom) {
        this.publishPresence(this.state.currentRoom, 'leave');
      }
    });
  }

  /**
   * Rate-limiting guard for AI calls.
   */
  _shouldRateLimit() {
    const now = Date.now();
    if (now - this.lastAIAt < this.minAIIntervalMs) return true;
    this.lastAIAt = now;
    return false;
  }

  /**
   * Refresh current room's visuals and description.
   */
  async refreshRoomVisuals({ reDescribe=true, forceRegenerate=false } = {}) {
    const roomId = this.state.currentRoom;
    if (!roomId) return;

    if (forceRegenerate) {
      for (const k of Array.from(this.imageCache.keys())) {
        if (k.startsWith(`${roomId}_`)) this.imageCache.delete(k);
      }
      for (const k of Array.from(this.descCache.keys())) {
        if (k.startsWith(`${roomId}:`)) this.descCache.delete(k);
      }
      this.updateCacheDisplay();
    }

    if (this.aiEnabled) {
      if (this._shouldRateLimit()) {
        this.addOutput('[AI cooling down…]', 'system-message');
        return;
      }
      await this.generateRoomImage(roomId);
      if (reDescribe) await this.generateRoomDescription(roomId);
    } else if (reDescribe) {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }
  }

  /**
   * Enter a room: handle subscriptions, presence, UI updates, AI description.
   */
  async enterRoom(roomId) {
    const room = this.roomTemplates[roomId];
    if (!room) return;
    const prevRoom = this.state.currentRoom;
    this.state.currentRoom = roomId;
    this.state.visitedRooms.add(roomId);
    this.addOutput(`\n[${room.name}]`, 'room-name');

    // Multiplayer: presence and subscriptions
    if (this.aterna?.enabled) {
      if (prevRoom) await this.publishPresence(prevRoom, 'leave');
      if (this.roomUnsub) { try { this.roomUnsub(); } catch {} this.roomUnsub = null; }
      this.roomUnsub = this.subscribeRoomStreams(roomId);
      await this.publishPresence(roomId, 'join');
      await this.publishRoomEvent(roomId, {
        event_type:'move',
        player:this.buildPublicPlayerState(),
        payload:{ from_room: prevRoom || null }
      });
      await this.publishPlayerState('move');
      if (this._hb) clearInterval(this._hb);
      this._hb = setInterval(() => this.publishPresence(roomId, 'heartbeat'), 25000);
    }

    // AI or offline description & image
    if (this.aiEnabled) {
      await this.generateRoomImage(roomId);
      await this.generateRoomDescription(roomId);
    } else {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }

    // Show items
    const items = (room.items || []).filter(id => !this.state.inventory.includes(id));
    if (items.length) this.addOutput(`You notice: ${items.map(id => this.items[id]?.name || id).join(', ')}`);

    // Show exits
    const exits = Object.keys(room.exits || {});
    if (exits.length) this.addOutput(`\nPaths: ${exits.join(', ')}`);

    // Apply room effects
    this.applyQuantumEffects(room);
    this.updateDisplay();
    this.updateMap();
    this.saveState();
  }

  /**
   * Generate image for current room, using AI with caching.
   */
  async generateRoomImage(roomId) {
    const cacheKey = `${roomId}_${Math.floor(this.state.truthDensity*10)}_${Math.floor(this.state.quantumState.coherence*10)}_${Math.floor(this.state.shadowIntegration*10)}_${this.imageModel}`;
    if (this.imageCache.has(cacheKey)) {
      document.getElementById('room-image').src = this.imageCache.get(cacheKey);
      return;
    }
    if (this._imageInflight.has(cacheKey)) return;
    this._imageInflight.add(cacheKey);

    const loading = document.getElementById('image-loading');
    loading.classList.remove('hidden');

    const room = this.roomTemplates[roomId];
    const prompt =
      `${room.basePrompt}, truth density ${this.state.truthDensity>0.7?'high luminous':this.state.truthDensity<0.3?'dark shadowy':'twilight uncertain'}, ` +
      `quantum coherence ${this.state.quantumState.coherence>0.5?'stable reality':'reality fragmenting'}, ` +
      `shadow level ${this.state.shadowIntegration>0.5?'shadows visible and active':'shadows lurking hidden'}, ` +
      `literary style: ${room.literary}, photorealistic, cinematic lighting, mysterious atmosphere`;

    try {
      const url = await this.ai.generateImage(prompt);
      if (url) {
        this.imageCache.set(cacheKey, url);
        this.updateCacheDisplay();
        document.getElementById('room-image').src = url;
      } else {
        this.addOutput('[Image generation failed — quantum interference]', 'system-message');
      }
    } catch {
      this.addOutput('[Image generation error]', 'system-message');
    } finally {
      loading.classList.add('hidden');
      this._imageInflight.delete(cacheKey);
    }
  }

  /**
   * Generate AI description for room.
   */
  async generateRoomDescription(roomId) {
    const key = `${roomId}:${Math.round(this.state.truthDensity*10)}:${Math.round(this.state.quantumState.coherence*10)}:${Math.round(this.state.shadowIntegration*10)}:${this.textModel}`;
    if (this.descCache.has(key)) {
      this.addOutput(this.descCache.get(key), 'librarian-voice');
      return;
    }
    const room = this.roomTemplates[roomId];
    const prompt =
      `As the Quantum Librarian, describe ${room.name} for ${this.state.player.name}. ` +
      `Literary style: ${room.literary}. Player state: Truth ${this.state.truthDensity}, ` +
      `Quantum ${this.state.quantumState.coherence}, Shadow ${this.state.shadowIntegration}. ` +
      `Make it personal to their journey; show how the room reflects their inner state. Keep it atmospheric and under 150 words.`;
    try {
      const description = await this.ai.callLLM(prompt);
      if (description) {
        this.descCache.set(key, description);
        this.addOutput(description, 'librarian-voice');
      }
    } catch {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }
  }

  /**
   * Fallback description when AI disabled.
   */
  getOfflineRoomDescription(roomId) {
    const d = {
      entrance: "The Library entrance thrums with potential. Doors exist and don't exist simultaneously.",
      hall_of_mirrors: 'Infinite reflections cascade through impossible geometries. Each shows a different you.',
      garden_of_forking_paths: 'Every step creates new timelines. You see yourself walking paths not taken.',
      shadow_archive: 'Your shadow moves independently here, browsing shelves of fears and forgotten dreams.',
      tea_room: "Time stopped at 6 o'clock. Empty chairs wait for aspects of yourself.",
      quantum_laboratory: 'Reality equations float mid-air. A cat prowls between existence and void.',
      oracle_chamber: 'Ancient wisdom merges with quantum uncertainty. All answers are true until observed.',
      abyss_reading_room: 'Books of unwritten stories line the walls. The void reads you as you read it.'
    };
    return d[roomId] || 'The room defies description.';
  }

  // ================= Command Processing =================

  /**
   * Process user input (main entrypoint).
   */
  async processCommand() {
    const input = document.getElementById('command-input');
    const command = (input.value || '').trim();
    if (!command || this.processingCommand) return;

    this.processingCommand = true;
    input.disabled = true;
    this.addOutput(`> ${command}`, 'command-echo');
    this.state.history.push(command);
    input.value = '';
    this.state.actionCount++;

    if (this.aiEnabled) {
      await this.processWithAI(command);
    } else {
      this.processOffline(command);
    }

    this.evolveQuantumState(command);
    this.updateDisplay();
    this.processingCommand = false;
    input.disabled = false;
    input.focus();
  }

  /**
   * Process command via AI when AI-enabled.
   */
  async processWithAI(command) {
    // Special-case: look/examine triggers visual refresh rather than full AI prompt
    if (/^(look|examine)\b/i.test(command)) {
      await this.refreshRoomVisuals({ reDescribe:true });
      return;
    }

    // Rate limit AI
    if (this._shouldRateLimit()) {
      this.addOutput('[AI cooling down…]', 'system-message');
      return;
    }

    const room = this.roomTemplates[this.state.currentRoom];
    const prompt =
`As the Quantum Librarian in ${room.name}, respond to player "${command}".
Player: ${this.state.player.name} (${this.state.player.archetype})
Truth: ${this.state.truthDensity}, Quantum: ${this.state.quantumState.coherence}, Shadow: ${this.state.shadowIntegration}
Available exits: ${Object.keys(room.exits || {}).join(', ')}

Instructions:
- If they're moving (go/walk/move + direction), confirm movement and describe the transition
- React to their truth density and quantum state
- Be mysterious and literary
- Sometimes change their stats slightly based on their actions
- If their action reveals character, note it
- Keep response under 150 words

Response format:
[NARRATIVE]
Your atmospheric response here
[/NARRATIVE]
[STATS]
truth_change: 0.0
quantum_change: 0.0
shadow_change: 0.0
[/STATS]
[MOVE]
room_id or none
[/MOVE]`;

    try {
      const response = await this.ai.callLLM(prompt);
      if (response) {
        const narrativeMatch = response.match(/\[NARRATIVE\]([\s\S]*?)\[\/NARRATIVE\]/);
        const statsMatch = response.match(/\[STATS\]([\s\S]*?)\[\/STATS\]/);
        const moveMatch = response.match(/\[MOVE\]([\s\S]*?)\[\/MOVE\]/);

        if (narrativeMatch) {
          this.addOutput(narrativeMatch[1].trim(), 'librarian-voice');
        }
        if (statsMatch) {
          const stats = statsMatch[1];
          const truthChange = parseFloat((stats.match(/truth_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const quantumChange = parseFloat((stats.match(/quantum_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const shadowChange = parseFloat((stats.match(/shadow_change:\s*([\-\d.]+)/) || [])[1] || 0);
          this.state.truthDensity = clamp01(this.state.truthDensity + truthChange);
          this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + quantumChange);
          this.state.shadowIntegration = clamp01(this.state.shadowIntegration + shadowChange);
          this.publishPlayerState('stats').catch(()=>{});
        }
        if (moveMatch) {
          const mv = moveMatch[1].trim();
          if (mv !== 'none' && this.roomTemplates[mv]) {
            await this.enterRoom(mv);
          }
        }
      }
    } catch {
      // Fallback: offline processing if AI fails
      this.processOffline(command);
    }
  }

  /**
   * Process commands in offline mode (non-AI).
   */
  processOffline(command) {
    const words = command.toLowerCase().split(' ');
    const verb = words[0];
    const target = words.slice(1).join(' ');

    switch (verb) {
      // Movement
      case 'go': case 'move': case 'walk':
        this.handleMovement(target);
        break;

      // Look / examine
      case 'look': case 'examine':
        this.handleLook(target);
        break;

      // Meditation & stats
      case 'meditate':
        this.handleMeditate();
        break;
      case 'stats':
        this.showStats();
        break;

      // Map toggling
      case 'map':
        this.toggleMap();
        break;

      // Help & resets & saves
      case 'help':
        this.showHelp();
        break;
      case 'reset':
        this.resetGameConfirm();
        break;
      case 'save':
        this.exportSave();
        break;
      case 'load':
        document.getElementById('import-file').click();
        break;

      // Items & inventory
      case 'take':
        this.handleTake(target);
        break;
      case 'use':
        this.handleUse(target);
        break;
      case 'inventory': case 'inv':
        this.showInventory();
        break;

      // Shop
      case 'shop':
        this.showShop();
        break;
      case 'buy':
        this.buyItem(target);
        break;
      case 'sell':
        this.sellItem(target);
        break;

      // Learning & evolution
      case 'learn': case 'study':
        this.study();
        break;
      case 'evolve':
        this.tryEvolve();
        break;

      // Progress
      case 'progress':
        this.showProgress();
        break;

      // Multiplayer
      case 'who':
        this.cmdWho();
        break;
      case 'say':
        this.cmdSay(target);
        break;
      case 'attack':
        this.cmdAttack(target);
        break;

      // Books
      case 'books':
        this.books.list();
        break;
      case 'read':
      case 'open':
        this.books.open(target);
        break;
      case 'choose':
        this.books.choose(target);
        break;
      case 'ask':
        this.books.ask(target);
        break;
      case 'draw':
        this.books.draw();
        break;
      case 'book':
        this._dispatchBookSubcommand(words.slice(1));
        break;

      // Redraw room image
      case 'redraw':
        this.refreshRoomVisuals({ reDescribe:true, forceRegenerate:true });
        break;

      default:
        this.addOutput('The Library remains silent.');
        break;
    }
  }

  /**
   * Dispatch subcommands for "book" verb.
   */
  _dispatchBookSubcommand(args) {
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1).join(' ');
    switch (sub) {
      case 'open':
        this.books.open(rest);
        break;
      case 'close':
        this.books.close();
        break;
      case 'resume':
        this.books.resume();
        break;
      case 'summary':
        this.books.summary();
        break;
      case 'ask':
        this.books.ask(rest);
        break;
      case 'choose':
        this.books.choose(rest);
        break;
      case 'draw':
        this.books.draw();
        break;
      default:
        this.addOutput('Book commands: book open <name>, book close, book resume, book summary, book ask <q>, book choose <n|id>, book draw');
    }
  }

  // ---------- Help ----------
  showHelp() {
    this.addOutput(
      `Commands:
- Movement: go <n|s|e|w>, map
- Observe: look, look self, meditate, stats
- Items: take <item>, use <item>, inventory|inv
- Shop (when vendor present): shop, buy <item>, sell <item>
- Learning/Money: learn|study (gain Ξ Insight)
- Evolution: evolve (consume items/Ξ to advance stage)
- Multiplayer: who, say <text>, attack <name>
- Books: books, read <book>, choose <n|id>, ask <question>, draw, book close|resume|summary
- Progress/Saves: progress, save, load, reset, redraw (force regenerate room art)`
    );
  }

  // ================= Command handlers (offline) =================

  handleMovement(direction) {
    const room = this.roomTemplates[this.state.currentRoom];
    if (!direction) {
      this.addOutput('Which path will you take?');
      return;
    }
    const shortcuts = { n:'north', s:'south', e:'east', w:'west' };
    direction = shortcuts[direction] || direction;
    if (room?.exits?.[direction]) {
      this.enterRoom(room.exits[direction]);
    } else {
      this.addOutput(`There is no path ${direction} from here.`);
    }
  }

  handleLook(target) {
    const around = !target || target === 'around';
    if (around) {
      if (this.aiEnabled) {
        this.refreshRoomVisuals({ reDescribe:true });
      } else {
        this.addOutput(this.getOfflineRoomDescription(this.state.currentRoom));
      }
      return;
    }
    if (['self','me','character'].includes(target)) {
      this.showStats();
    } else {
      this.addOutput('You see only echoes of intention.');
    }
  }

  handleMeditate() {
    this.addOutput('You close your eyes and feel the quantum field…');
    this.state.quantumState.coherence = Math.min(1, this.state.quantumState.coherence + 0.1);
    this.state.truthDensity = Math.min(1, this.state.truthDensity + 0.05);
    this.addOutput('Your consciousness expands.');
    this.publishPlayerState('meditate').catch(()=>{});
  }

  showStats() {
    this.addOutput(`You are ${this.state.player.name}, the ${this.state.player.archetype}.`);
    this.addOutput(`Truth: ${(this.state.truthDensity*100).toFixed(0)}% — Quantum: ${(this.state.quantumState.coherence*100).toFixed(0)}% — Shadow: ${(this.state.shadowIntegration*100).toFixed(0)}%`);
  }

  toggleMap() {
    const m = document.getElementById('map');
    m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
  }

  // Items & inventory
  hasItem(id) { return this.state.inventory.includes(id); }
  addItem(id) {
    if (!this.items[id]) return false;
    if (!this.hasItem(id)) this.state.inventory.push(id);
    return true;
  }
  removeItem(id) {
    const i = this.state.inventory.indexOf(id);
    if (i >= 0) this.state.inventory.splice(i,1);
  }
  findItemIdByName(name) {
    const n = (name || '').toLowerCase();
    const entry = Object.values(this.items).find(it => it.name.toLowerCase().includes(n));
    return entry?.id || null;
  }
  grantInsight(n) {
    const add = Math.max(0, Math.floor(n || 0));
    this.state.insight += add;
    this.addOutput(`[+${add} Ξ Insight]`, 'system-message');
  }
  spendInsight(n) {
    const need = Math.max(0, Math.floor(n || 0));
    if (this.state.insight < need) return false;
    this.state.insight -= need;
    return true;
  }

  handleTake(target) {
    if (!target) {
      this.addOutput('Take what?');
      return;
    }
    const room = this.roomTemplates[this.state.currentRoom];
    const pool = (room.items || []).filter(id => !this.state.inventory.includes(id));
    const id = this.findItemIdByName(target) || pool.find(pid => (this.items[pid]?.name || pid).toLowerCase().includes(target.toLowerCase()));
    if (!id || !pool.includes(id)) {
      this.addOutput('There is nothing like that to take.');
      return;
    }
    this.addItem(id);
    room.items = (room.items || []).filter(x => x !== id);
    this.addOutput(`You take the ${this.items[id].name}.`);
    // Publish loot to Aterna
    this.publishRoomEvent(this.state.currentRoom, {
      event_type:'loot',
      player: this.buildPublicPlayerState(),
      payload:{ item: this.items[id]?.name || id }
    }).catch(()=>{});
    this.publishPlayerState('loot').catch(()=>{});
  }

  handleUse(target) {
    if (!target) {
      this.addOutput('Use what?');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id || !this.hasItem(id)) {
      this.addOutput("You don't have that.");
      return;
    }
    const it = this.items[id];
    if (it.type === 'book') {
      this.books.openById(id);
      return;
    }
    switch (it.type) {
      case 'consumable':
        this.consumeItem(it);
        this.removeItem(id);
        break;
      case 'evolution':
        this.addOutput(`You attune to the ${it.name}. Its purpose may be ritual, not immediate.`);
        break;
      default:
        this.addOutput('Nothing obvious happens.');
    }
  }

  consumeItem(it) {
    if (it.id === 'tea_clarity') {
      this.addOutput('Warmth clears the noise.');
      this.state.truthDensity = clamp01(this.state.truthDensity + 0.08);
    } else if (it.id === 'cat_paradox') {
      this.addOutput('A purr, and all states purr with it.');
      this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + 0.10);
    } else if (it.id === 'ink_of_nyx') {
      this.addOutput('Night gathers in the nib, drawing your shadow nearer.');
      this.state.shadowIntegration = clamp01(this.state.shadowIntegration + 0.10);
    } else if (it.id === 'folio_notes') {
      this.addOutput('You annotate the margins with yourself.');
      this.grantInsight(8);
    } else {
      this.addOutput('You feel… marginally altered.');
    }
    this.updateDisplay();
    this.publishPlayerState('consume').catch(()=>{});
  }

  showInventory() {
    if (!this.state.inventory.length) {
      this.addOutput('Your pockets are full of potential, not objects.');
    } else {
      this.addOutput(`Inventory: ${this.state.inventory.map(id => this.items[id]?.name || id).join(', ')}`);
    }
  }

  // Shop & vendor
  currentVendor() {
    const room = this.roomTemplates[this.state.currentRoom];
    return room?.vendor || null;
  }

  showShop() {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const lines = [`[${v.name} — Bazaar of Proofs]`, `You have ${this.state.insight} Ξ.`];
    for (const g of v.goods) {
      const it = this.items[g.item];
      lines.push(`- ${it.name} — ${g.price} Ξ :: ${it.desc}`);
    }
    lines.push('Use: buy <item>, sell <item>');
    this.addOutput(lines.join('\n'));
  }

  async buyItem(target) {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id) {
      this.addOutput('Name it clearly.');
      return;
    }
    const g = v.goods.find(x => x.item === id);
    if (!g) {
      this.addOutput('Not sold here.');
      return;
    }
    if (!this.spendInsight(g.price)) {
      this.addOutput('Not enough Ξ.');
      return;
    }
    this.addItem(id);
    this.addOutput(`Purchased ${this.items[id].name} for ${g.price} Ξ.`);
    this.updateDisplay();
    try {
      await this.aterna?.publishEvent(Topics.trades, {
        event_type:'buy',
        player: this.buildPublicPlayerState(),
        payload:{ item:this.items[id]?.name, price:g.price }
      });
    } catch {}
    this.publishPlayerState('trade').catch(()=>{});
  }

  async sellItem(target) {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id || !this.hasItem(id)) {
      this.addOutput("You don't have that.");
      return;
    }
    const it = this.items[id];
    const base = it.price || 0;
    const p = Math.max(1, Math.floor(base * (v.sellbackRate ?? 0.5)));
    this.removeItem(id);
    this.grantInsight(p);
    this.addOutput(`Sold ${it.name} for ${p} Ξ.`);
    this.updateDisplay();
    try {
      await this.aterna?.publishEvent(Topics.trades, {
        event_type:'sell',
        player: this.buildPublicPlayerState(),
        payload:{ item:it.name, price:p }
      });
    } catch {}
    this.publishPlayerState('trade').catch(()=>{});
  }

  // Learning / study
  study() {
    const base = 4;
    const bonus = Math.round(4 * (this.state.truthDensity + this.state.quantumState.coherence));
    const gain = base + bonus;
    this.grantInsight(gain);
    this.addOutput('You study. The stacks yield a little more of you back.');
    this.updateDisplay();
    this.publishPlayerState('study').catch(()=>{});
  }

  // Evolution
  evolutionPlan() {
    return {
      Threshold:{ need:[{id:'mirror_shard'}, {insight:10}], next:'Initiate', gain:{ truth:+0.05 } },
      Initiate: { need:[{id:'quantum_key'}, {insight:25}, {truth:0.60}], next:'Adept', gain:{ quantum:+0.05 } },
      Adept:    { need:[{id:'shadow_lantern'}, {insight:40}, {shadow:0.60}], next:'Scholar', gain:{ shadow:+0.05 } },
      Scholar:  { need:[{id:'glyph_memory'}, {insight:80}, {quantum:0.70}], next:'Oracle', gain:{ truth:+0.05, quantum:+0.05 } }
    };
  }

  tryEvolve() {
    const stage = this.state.player.heroStage || 'Threshold';
    const plan = this.evolutionPlan()[stage];
    if (!plan) {
      this.addOutput('No further evolution is visible.');
      return;
    }
    const lacks = [];
    for (const req of plan.need) {
      if (req.id && !this.hasItem(req.id)) lacks.push(this.items[req.id].name);
      if (req.insight && this.state.insight < req.insight) lacks.push(`${req.insight} Ξ`);
      if (req.truth && this.state.truthDensity < req.truth) lacks.push(`Truth≥${Math.round(req.truth*100)}%`);
      if (req.quantum && this.state.quantumState.coherence < req.quantum) lacks.push(`Quantum≥${Math.round(req.quantum*100)}%`);
      if (req.shadow && this.state.shadowIntegration < req.shadow) lacks.push(`Shadow≥${Math.round(req.shadow*100)}%`);
    }
    if (lacks.length) {
      this.addOutput(`Evolution requires: ${lacks.join(', ')}`);
      return;
    }

    for (const req of plan.need) {
      if (req.id) this.removeItem(req.id);
      if (req.insight) this.state.insight -= req.insight;
    }

    if (plan.gain.truth) this.state.truthDensity = clamp01(this.state.truthDensity + plan.gain.truth);
    if (plan.gain.quantum) this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + plan.gain.quantum);
    if (plan.gain.shadow) this.state.shadowIntegration = clamp01(this.state.shadowIntegration + plan.gain.shadow);

    this.state.player.heroStage = plan.next;
    this.addOutput(`You evolve: ${stage} → ${plan.next}. Something irreversible rearranges.`);
    this.updateDisplay();
    this.publishRoomEvent(this.state.currentRoom, {
      event_type:'evolve',
      player:this.buildPublicPlayerState(),
      payload:{ new_stage:plan.next }
    }).catch(()=>{});
    this.publishPlayerState('evolve').catch(()=>{});
  }

  // Progress
  showProgress() {
    const visited = this.state.visitedRooms.size;
    const inv = this.state.inventory.map(id => this.items[id]?.name || id).join(', ') || '—';
    const lines = [
      `[Progress]`,
      `Stage: ${this.state.player.heroStage}`,
      `Insight: ${this.state.insight} Ξ`,
      `HP: ${this.state.hp}`,
      `Rooms visited: ${visited}`,
      `Actions: ${this.state.actionCount}`,
      `Inventory: ${inv}`
    ];
    this.addOutput(lines.join('\n'));
  }

  // ================= Multiplayer & Aterna =================

  /**
   * Build a minimal public player snapshot.
   */
  buildPublicPlayerState() {
    return {
      id: this.playerId,
      name: this.state.player?.name || 'Unknown',
      stage: this.state.player?.heroStage || 'Threshold',
      truth: this.state.truthDensity,
      quantum: this.state.quantumState.coherence,
      shadow: this.state.shadowIntegration,
      insight: this.state.insight,
      room: this.state.currentRoom || null,
      hp: this.state.hp ?? 100
    };
  }

  /**
   * Publish player snapshot to Aterna.
   */
  async publishPlayerState(reason='update') {
    if (!this.aterna?.enabled) return;
    await this.aterna.publishEvent(Topics.playerState(this.playerId), {
      event_type:'snapshot',
      player: this.buildPublicPlayerState(),
      payload:{ reason }
    });
  }

  /**
   * Publish room-level events to proper topic (chat, move, loot, combat, evolve).
   */
  async publishRoomEvent(roomId, evt) {
    if (!this.aterna?.enabled) return;
    const t = evt.event_type;
    const topic =
      t === 'chat'   ? Topics.roomChat(roomId) :
      t === 'attack' || t === 'heal' ? Topics.roomCombat(roomId) :
      Topics.roomUpdates(roomId);
    await this.aterna.publishEvent(topic, { ...evt, room_id: roomId });
  }

  /**
   * Publish presence events.
   */
  async publishPresence(roomId, kind) {
    if (!this.aterna?.enabled) return;
    await this.aterna.publishEvent(Topics.roomPresence(roomId), {
      event_type: kind,
      room_id: roomId,
      player: this.buildPublicPlayerState()
    });
  }

  /**
   * Subscribe to room-specific streams: updates, combat, presence, chat.
   */
  subscribeRoomStreams(roomId) {
    const unsubs = [];
    unsubs.push(this.aterna.subscribe(Topics.roomUpdates(roomId), msg => this.onRoomEvent(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomCombat(roomId),  msg => this.onRoomEvent(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomPresence(roomId),msg => this.onPresence(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomChat(roomId),    msg => this.onRoomEvent(msg)));
    return () => unsubs.forEach(u => { try { u(); } catch {} });
  }

  /**
   * Handle presence messages (join/leave/heartbeat).
   */
  onPresence(msg) {
    const d = msg?.content?.data || {};
    const kind = d.event_type;
    if (!d.player) return;
    const p = d.player;
    this.roomPeers.set(p.id, {
      name:p.name,
      hp:p.hp ?? 100,
      stage:p.stage,
      lastSeen: Date.now()
    });
    if (kind === 'join') this.addOutput(`${p.name} enters.`, 'system-message');
    if (kind === 'leave') this.addOutput(`${p.name} departs.`, 'system-message');
  }

  /**
   * Handle room events (chat, move, attack, loot, evolve).
   */
  onRoomEvent(msg) {
    const d = msg?.content?.data || {};
    switch (d.event_type) {
      case 'chat':
        this.addOutput(`${d.player?.name || d.from}: ${d.payload?.text || ''}`);
        break;
      case 'move':
        if (d.player) {
          this.roomPeers.set(d.player.id, {
            name:d.player.name,
            hp:d.player.hp ?? 100,
            stage:d.player.stage,
            lastSeen: Date.now()
          });
        }
        break;
      case 'attack':
        this.applyCombatEvent(d);
        break;
      case 'loot':
        if (d.player && d.payload?.item) {
          this.addOutput(`${d.player.name} acquires ${d.payload.item}.`);
        }
        break;
      case 'evolve':
        if (d.player && d.payload?.new_stage) {
          this.addOutput(`${d.player.name} evolves to ${d.payload.new_stage}.`, 'system-message');
        }
        break;
      default:
        break;
    }
  }

  /**
   * List who is present.
   */
  cmdWho() {
    if (!this.aterna?.enabled) {
      this.addOutput('Multiplayer is offline.');
      return;
    }
    const lines = ['[Here]'];
    for (const [, p] of this.roomPeers.entries()) {
      lines.push(`- ${p.name} (${p.stage}) — HP:${p.hp}`);
    }
    if (lines.length === 1) lines.push('No one else is observable.');
    this.addOutput(lines.join('\n'));
  }

  /**
   * Say message to room.
   */
  async cmdSay(text) {
    if (!text) {
      this.addOutput('Say what?');
      return;
    }
    const me = this.buildPublicPlayerState();
    this.addOutput(`${me.name}: ${text}`);
    await this.publishRoomEvent(this.state.currentRoom, {
      event_type:'chat',
      player: me,
      payload:{ text }
    });
  }

  /**
   * Attack another player by name (prefix match).
   */
  async cmdAttack(targetStr) {
    if (!this.aterna?.enabled) {
      this.addOutput('Combat requires Aterna.');
      return;
    }
    if (!targetStr) {
      this.addOutput('Attack whom?');
      return;
    }
    const target = Array.from(this.roomPeers.values()).find(p => p.name.toLowerCase().startsWith(targetStr.toLowerCase()));
    if (!target) {
      this.addOutput('No such target.');
      return;
    }
    const me = this.buildPublicPlayerState();
    const dmg = 3 + ((me.name.length + target.name.length + (Date.now() >> 10)) % 8);
    await this.publishRoomEvent(this.state.currentRoom, {
      event_type:'attack',
      player: me,
      target:{ name: target.name },
      payload:{ dmg }
    });
    this.addOutput(`You strike ${target.name} for ${dmg}.`);
  }

  /**
   * Apply combat damage event to peers and self.
   */
  applyCombatEvent(evt) {
    const from = evt.player;
    const toName = evt.target?.name;
    const dmg = evt.payload?.dmg;
    if (!from || !toName || !dmg) return;
    for (const [id, p] of this.roomPeers.entries()) {
      if (p.name === toName) {
        p.hp = Math.max(0, (p.hp ?? 100) - dmg);
        this.roomPeers.set(id, p);
        if (p.hp === 0) {
          this.addOutput(`${p.name} falls.`, 'system-message');
        } else {
          this.addOutput(`${from.name} hits ${p.name} for ${dmg}.`);
        }
        break;
      }
    }
    const meName = this.state.player?.name;
    if (toName === meName) {
      this.addOutput(`[You take ${dmg} damage]`, 'system-message');
      this.state.hp = Math.max(0, (this.state.hp ?? 100) - dmg);
      this.publishPlayerState('damage').catch(()=>{});
      this.updateDisplay();
    }
  }

  // ================= Systems & stats =================

  buildContext() {
    return {
      player: this.state.player,
      room: this.state.currentRoom,
      stats: {
        truth: this.state.truthDensity,
        quantum: this.state.quantumState.coherence,
        shadow: this.state.shadowIntegration
      },
      history: this.state.history.slice(-5)
    };
  }

  applyQuantumEffects(room) {
    if (room.literary === 'science') this.state.quantumState.coherence = Math.min(1, this.state.quantumState.coherence + 0.05);
    if (room.name.includes('Shadow')) this.state.shadowIntegration = Math.min(1, this.state.shadowIntegration + 0.02);
  }

  evolveQuantumState(action) {
    this.state.quantumState.coherence *= 0.99;
    if (/\bthink\b|\bobserve\b/.test(action)) this.state.quantumState.coherence += 0.01;
    if (/\btruth\b|\bhonest\b/.test(action)) this.state.truthDensity = Math.min(1, this.state.truthDensity + 0.01);
    this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence);
    this.state.truthDensity = clamp01(this.state.truthDensity);
    this.state.shadowIntegration = clamp01(this.state.shadowIntegration);
  }

  addOutput(text, className = '') {
    const output = document.getElementById('text-output');
    const entry = document.createElement('div');
    entry.className = className || 'text-entry';
    entry.textContent = text;
    output.appendChild(entry);
    output.scrollTop = output.scrollHeight;
    while (output.children.length > 120) {
      output.removeChild(output.firstChild);
    }
  }

  updateDisplay() {
    if (!this.state.player) return;
    document.getElementById('char-name').textContent = this.state.player.name;
    document.getElementById('truth-density').textContent = (this.state.truthDensity*100).toFixed(0) + '%';
    document.getElementById('quantum-coherence').textContent = (this.state.quantumState.coherence*100).toFixed(0) + '%';
    document.getElementById('shadow-integration').textContent = (this.state.shadowIntegration*100).toFixed(0) + '%';
    document.getElementById('truth-bar').style.width = (this.state.truthDensity*100) + '%';
    document.getElementById('quantum-bar').style.width = (this.state.quantumState.coherence*100) + '%';
    document.getElementById('shadow-bar').style.width = (this.state.shadowIntegration*100) + '%';
    document.getElementById('hero-stage').textContent = this.state.player.heroStage;
    document.getElementById('action-count').textContent = this.state.actionCount;
    document.getElementById('token-count').textContent = this.tokenCount;
    const ic = document.getElementById('insight-count');
    if (ic) ic.textContent = this.state.insight.toString();
  }

  updateMap() {
    const mapGrid = document.getElementById('map-grid');
    mapGrid.innerHTML = '';
    const rooms = Array.from(this.state.visitedRooms);
    rooms.forEach(roomId => {
      const roomDiv = document.createElement('div');
      roomDiv.className = 'map-room';
      roomDiv.classList.add(roomId === this.state.currentRoom ? 'current' : 'visited');
      roomDiv.title = this.roomTemplates[roomId]?.name || roomId;
      roomDiv.onclick = () => {
        if (roomId !== this.state.currentRoom) {
          this.enterRoom(roomId);
        }
      };
      mapGrid.appendChild(roomDiv);
    });
  }

  updateCacheDisplay() {
    document.getElementById('cache-count').textContent = this.imageCache.size;
    const cacheSizeKB = Math.round(this.imageCache.size * 120);
    document.getElementById('cache-size').textContent = cacheSizeKB + ' KB';
  }

  bumpTokens(n) {
    this.tokenCount += (n || 0);
    document.getElementById('token-count').textContent = this.tokenCount;
  }

  // ================= Persistence =================

  serializeState() {
    const clone = JSON.parse(JSON.stringify(this.state));
    clone.visitedRooms = Array.from(this.state.visitedRooms);
    return clone;
  }

  deserializeState(obj) {
    try {
      this.state = obj;
      this.state.visitedRooms = new Set(obj.visitedRooms || []);
      this.state.stage = 'playing';
      localStorage.setItem('qmud_state', JSON.stringify(this.serializeState()));
      this.startGame();
    } catch (e) {
      console.error('Deserialize failed', e);
    }
  }

  saveState() {
    if (this.state.stage === 'playing') {
      localStorage.setItem('qmud_state', JSON.stringify(this.serializeState()));
      localStorage.setItem('qmud_version', '2.4');
    }
  }

  loadState() {
    const saved = localStorage.getItem('qmud_state');
    if (!saved) return;
    try {
      const loaded = JSON.parse(saved);
      if (loaded.stage === 'playing' && loaded.player) {
        this.state = loaded;
        this.state.visitedRooms = new Set(loaded.visitedRooms || []);
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('covenant').style.display = 'none';
        document.getElementById('creation').style.display = 'none';
        const savedKey = localStorage.getItem('qmud_api_key');
        if (savedKey) {
          this.apiKey = savedKey;
          this.aiEnabled = true;
          document.getElementById('status-panel').style.display = 'block';
          this.updateStatus('ai','active','Connected');
          this.updateStatus('image','active','Ready');
        }
        this.startGame();
      }
    } catch {
      console.log('Could not load saved game');
    }
  }

  resetGameConfirm() {
    if (confirm('Reset your journey? This clears local save.')) {
      localStorage.removeItem('qmud_state');
      this.state = {
        stage:'setup', player:null, currentRoom:null, visitedRooms:new Set(), actionCount:0,
        history:[], inventory:[], insight:0, hp:100,
        quantumState:{ coherence:0, entanglement:[], superposition:0 },
        truthDensity:0.5, shadowIntegration:0,
        creationData:{ observations:[], currentScene:0, startTime: Date.now() },
        bookSession:null
      };
      if (this._hb) { try { clearInterval(this._hb); } catch {} }
      location.reload();
    }
  }

  exportSave() {
    try {
      downloadJSON(this.serializeState(), `qmud-save-${Date.now()}.json`);
      this.addOutput('[Save exported]', 'system-message');
    } catch {
      this.addOutput('[Export failed]', 'system-message');
    }
  }

  importSave(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target.result);
        this.deserializeState(json);
        this.addOutput('[Save imported]', 'system-message');
      } catch {
        alert('Invalid save file.');
      }
    };
    reader.readAsText(file);
  }

// js/game.js
// Complete file — fixed: showHelp() moved outside constructor; creationScenes default -> [].

import { clamp01, downloadJSON } from './utils.js';
import { AIClient } from './ai.js';
import { loadContent } from './content.js';
import { AternaClient, Topics } from './aterna.js';
import { BooksEngine } from './books.js';

/**
 * Main game class tying together AI, Aterna pub/sub, dynamic books,
 * items, combat, economy, evolution, saves, and UI.
 */
export class QuantumTruthMUD {
  constructor() {
    // --- Runtime configuration ---
    this.apiKey = null;
    this.textModel = 'gpt-4o-mini';
    this.imageModel = 'gpt-image-1';
    this.aiEnabled = false;

    // Image caching
    this.imageCache = new Map();
    this._imageInflight = new Set();
    this.descCache = new Map();
    this.tokenCount = 0;

    // AI throttle
    this.processingCommand = false;
    this.lastAIAt = 0;
    this.minAIIntervalMs = 1500;

    // Multiplayer / Aterna
    this.aterna = null;
    this.playerId = localStorage.getItem('qmud_player_id') || null;
    this.roomUnsub = null;
    this.roomPeers = new Map();
    this._hb = null; // heartbeat interval

    // Game state
    this.state = {
      stage: 'setup',
      player: null,
      currentRoom: null,
      visitedRooms: new Set(),
      actionCount: 0,
      history: [],
      inventory: [],
      insight: 0,
      hp: 100,
      quantumState: { coherence: 0, entanglement: [], superposition: 0 },
      truthDensity: 0.5,
      shadowIntegration: 0,
      creationData: { observations: [], currentScene: 0, startTime: Date.now() },
      bookSession: null // dynamic book reading session
    };

    // Content placeholders
    this.roomTemplates = {};
    this.creationScenes = []; // fix: must be an array (showCreationScene uses .length)
    this.items = {};

    // Instantiate Book engine
    this.books = new BooksEngine(this);

    // Instantiate AI client
    this.ai = new AIClient(
      () => this.apiKey,
      () => this.textModel,
      () => this.imageModel,
      n => this.bumpTokens(n),
      (type, status, text) => this.updateStatus(type, status, text),
      () => localStorage.getItem('qmud_api_base') || 'https://api.openai.com'
    );
  }

  /**
   * Initialize game: load content, hydrate settings, set up Aterna, attach UI listeners, auto-load save.
   */
  async init() {
    // Load rooms, items, scenes (allow overrides)
    const content = await loadContent();
    this.roomTemplates = content.rooms;
    this.creationScenes = content.scenes;
    this.items = content.items;

    // Hydrate OpenAI API key
    const savedKey = localStorage.getItem('qmud_api_key');
    if (savedKey) document.getElementById('api-key-input').value = savedKey;

    // Hydrate API base (proxy)
    const savedBase = localStorage.getItem('qmud_api_base') || '';
    const apiBaseInput = document.getElementById('api-base');
    if (apiBaseInput) {
      apiBaseInput.value = savedBase;
      apiBaseInput.addEventListener('change', e => {
        localStorage.setItem('qmud_api_base', e.target.value.trim());
      });
    }

    // Hydrate models
    const m = localStorage.getItem('qmud_models');
    if (m) {
      try {
        const { textModel, imageModel } = JSON.parse(m);
        if (textModel) this.textModel = textModel;
        if (imageModel) this.imageModel = imageModel;
      } catch {}
    }
    document.getElementById('text-model').value = this.textModel;
    document.getElementById('image-model').value = this.imageModel;
    document.getElementById('text-model').addEventListener('change', e => {
      this.textModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });
    document.getElementById('image-model').addEventListener('change', e => {
      this.imageModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });

    // Hydrate Aterna config
    const baseEl = document.getElementById('aterna-base');
    const tokEl  = document.getElementById('aterna-token');
    const pubEl  = document.getElementById('aterna-publish');
    const subEl  = document.getElementById('aterna-subscribe');
    const chkEl  = document.getElementById('aterna-enable');
    const audEl  = document.getElementById('aterna-audit');
    const sseTok = document.getElementById('aterna-sse-token');
    const sseTokParam = document.getElementById('aterna-sse-token-param');

    const aterBase  = localStorage.getItem('qmud_aterna_base') || '';
    const aterTok   = localStorage.getItem('qmud_aterna_token') || '';
    const aterPub   = localStorage.getItem('qmud_aterna_publish') || '/api/publish';
    const aterSub   = localStorage.getItem('qmud_aterna_subscribe') || '/api/subscribe';
    const aterEnable= localStorage.getItem('qmud_aterna_enable') === '1';
    const aterAudit = localStorage.getItem('qmud_aterna_audit') === '1';
    const sseTokenVal= localStorage.getItem('qmud_aterna_sse_token') || '';
    const sseTokenKey= localStorage.getItem('qmud_aterna_sse_token_param') || 'token';

    if (baseEl) baseEl.value = aterBase;
    if (tokEl)  tokEl.value  = aterTok;
    if (pubEl)  pubEl.value  = aterPub;
    if (subEl)  subEl.value  = aterSub;
    if (chkEl)  chkEl.checked= aterEnable;
    if (audEl)  audEl.checked= aterAudit;
    if (sseTok) sseTok.value = sseTokenVal;
    if (sseTokParam) sseTokParam.value = sseTokenKey;

    const persistAterna = () => {
      localStorage.setItem('qmud_aterna_base', baseEl.value.trim());
      localStorage.setItem('qmud_aterna_token', tokEl.value.trim());
      localStorage.setItem('qmud_aterna_publish', pubEl.value.trim() || '/api/publish');
      localStorage.setItem('qmud_aterna_subscribe', subEl.value.trim() || '/api/subscribe');
      localStorage.setItem('qmud_aterna_enable', chkEl.checked ? '1' : '0');
      localStorage.setItem('qmud_aterna_audit', audEl.checked ? '1' : '0');
      localStorage.setItem('qmud_aterna_sse_token', sseTok.value.trim());
      localStorage.setItem('qmud_aterna_sse_token_param', sseTokParam.value.trim() || 'token');
    };
    [baseEl, tokEl, pubEl, subEl, chkEl, audEl, sseTok, sseTokParam].forEach(el => el && el.addEventListener('change', persistAterna));

    if (aterEnable && aterBase) {
      this.aterna = new AternaClient({
        base: aterBase,
        token: aterTok,
        publishPath: aterPub,
        subscribePath: aterSub,
        sender: 'qmud-client',
        sseTokenParam: sseTokenKey,
        sseTokenValue: sseTokenVal,
        mirrorAudit: aterAudit
      });
    }

    // Mouse tracking for quantum overlay
    document.addEventListener('mousemove', e => {
      const display = document.getElementById('image-display');
      if (display) {
        const rect = display.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100) + '%';
        const y = ((e.clientY - rect.top) / rect.height * 100) + '%';
        display.style.setProperty('--mouse-x', x);
        display.style.setProperty('--mouse-y', y);
      }
    });

    // Auto-save state every 30 seconds
    setInterval(() => this.saveState(), 30000);

    // Load saved game (if any)
    this.loadState();

    // Service worker registration (no-op if missing)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ================= Setup / Start ==================

  /**
   * Validate API key and start game (AI-enabled).
   */
  validateAndStart() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey || !apiKey.startsWith('sk-')) {
      alert('Please enter a valid OpenAI API key');
      return;
    }
    this.apiKey = apiKey;
    localStorage.setItem('qmud_api_key', apiKey);
    this.aiEnabled = true;

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('status-panel').style.display = 'block';
    this.updateStatus('ai', 'active', 'Connected');
    this.updateStatus('image', 'active', 'Ready');
    this.state.stage = 'covenant';
  }

  /**
   * Start game in offline mode (AI disabled).
   */
  startOffline() {
    this.aiEnabled = false;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('status-panel').style.display = 'block';
    this.updateStatus('ai', 'inactive', 'Offline');
    this.updateStatus('image', 'inactive', 'Offline');
    this.state.stage = 'covenant';
  }

  /**
   * Update status panel (AI/Image).
   */
  updateStatus(type, status, text) {
    const dot = document.getElementById(`${type}-status`);
    dot.className = `status-dot ${status}`;
    document.getElementById(`${type}-status-text`).textContent = text;
  }

  // ================= Covenant & Character Creation ================

  /**
   * Accept covenant: proceed to character creation.
   */
  acceptCovenant() {
    document.getElementById('covenant').style.display = 'none';
    document.getElementById('creation').style.display = 'block';
    this.state.stage = 'creation';
    this.startCharacterCreation();
  }

  /**
   * Start character creation scenes.
   */
  startCharacterCreation() { 
    this.showCreationScene(0); 
  }

  /**
   * Render a creation scene and attach handlers.
   */
  showCreationScene(index) {
    if (index >= this.creationScenes.length) { 
      this.finalizeCharacter(); 
      return; 
    }
    const scene = this.creationScenes[index];
    const textEl = document.getElementById('creation-text');
    const choicesEl = document.getElementById('creation-choices');
    textEl.textContent = scene.text; 
    choicesEl.innerHTML = '';

    if (scene.choices[0]?.input) {
      const input = document.createElement('input');
      input.type = 'text'; 
      input.className = 'api-input'; 
      input.placeholder = 'Your true name…'; 
      input.style.marginBottom = '10px';
      choicesEl.appendChild(input);
      scene.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.onclick = () => {
          const value = choice.value === 'named' ? (input.value || 'Unnamed') : '[SILENCE]';
          this.recordCreationChoice(index, choice.value, value);
          this.showCreationScene(index + 1);
        };
        choicesEl.appendChild(btn);
      });
    } else {
      scene.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.text;
        btn.onclick = () => {
          this.recordCreationChoice(index, choice.value);
          this.showCreationScene(index + 1);
        };
        choicesEl.appendChild(btn);
      });
    }
  }

  /**
   * Record choice during character creation.
   */
  recordCreationChoice(sceneIndex, value, extra=null) {
    this.state.creationData.observations.push({
      scene: sceneIndex, choice: value, extra,
      timestamp: Date.now() - this.state.creationData.startTime
    });
  }

  /**
   * Finalize character and proceed to game.
   */
  async finalizeCharacter() {
    const obs = this.state.creationData.observations;
    const trueForm = {
      name: obs[4]?.extra || 'Seeker',
      archetype: this.deriveArchetype(obs),
      shadowLevel: this.deriveShadowLevel(obs),
      quantumSignature: Math.random(),
      truthDensity: 0.5,
      heroStage: 'Threshold'
    };
    this.state.player = trueForm;
    this.state.currentRoom = 'entrance';

    if (obs[0]?.choice === 'contemplative') this.state.quantumState.coherence += 0.1;
    if (obs[1]?.choice === 'shadow-seeker') this.state.shadowIntegration += 0.2;
    if (obs[2]?.choice === 'integrated') this.state.shadowIntegration += 0.3;
    if (obs[3]?.choice === 'full-integration') this.state.shadowIntegration -= 0.2;
    this.state.shadowIntegration = clamp01(this.state.shadowIntegration + 0.5);

    // Ensure stable playerId
    if (!this.playerId) {
      this.playerId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
      localStorage.setItem('qmud_player_id', this.playerId);
    }

    // Set Aterna sender and publish initial state
    if (this.aterna?.enabled) {
      this.aterna.sender = `${this.state.player.name}#${this.playerId.slice(0,6)}`;
      this.publishPlayerState('join').catch(()=>{});
    }

    // AI welcome
    if (this.aiEnabled) {
      const prompt = `As the Quantum Librarian, welcome ${this.state.player.name} (${this.state.player.archetype}) to the Library. Their truth density is ${this.state.truthDensity}, quantum coherence ${this.state.quantumState.coherence}, shadow integration ${this.state.shadowIntegration}. Give a personalized, mysterious welcome that hints at their journey ahead. Keep it under 100 words and deeply atmospheric.`;
      try { this.librarianMessage = await this.ai.callLLM(prompt); } catch {}
    }
    this.startGame();
  }

  /**
   * Determine archetype from first scene choice.
   */
  deriveArchetype(observations) {
    const m = { active:'Warrior', contemplative:'Sage', intuitive:'Mystic', cautious:'Guardian' };
    return m[observations[0]?.choice] || 'Wanderer';
  }

  /**
   * Determine initial shadow level.
   */
  deriveShadowLevel(observations) {
    let s = 0;
    if (observations[2]?.choice === 'integrated') s += 0.3;
    if (observations[3]?.choice === 'rejection') s += 0.4;
    return clamp01(s + 0.5);
  }

  // ================= Game Play =================

  /**
   * Start main game after character creation or load.
   */
  startGame() {
    document.getElementById('creation').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('character').style.display = 'block';
    document.getElementById('map').style.display = 'block';
    this.state.stage = 'playing';
    this.updateDisplay();
    this.enterRoom('entrance');

    // Show Librarian welcome
    if (this.librarianMessage) {
      this.addOutput('[The Quantum Librarian speaks:]', 'system-message');
      this.addOutput(this.librarianMessage, 'librarian-voice');
    } else {
      this.addOutput(`Welcome to the Canonical Library, ${this.state.player.name}.`);
      this.addOutput(`You are a ${this.state.player.archetype} at the ${this.state.player.heroStage} stage of your journey.`);
    }

    // On unload, send leave signal
    window.addEventListener('beforeunload', () => {
      if (this.aterna?.enabled && this.state.currentRoom) {
        this.publishPresence(this.state.currentRoom, 'leave');
      }
    });
  }

  /**
   * Rate-limiting guard for AI calls.
   */
  _shouldRateLimit() {
    const now = Date.now();
    if (now - this.lastAIAt < this.minAIIntervalMs) return true;
    this.lastAIAt = now;
    return false;
  }

  /**
   * Refresh current room's visuals and description.
   */
  async refreshRoomVisuals({ reDescribe=true, forceRegenerate=false } = {}) {
    const roomId = this.state.currentRoom;
    if (!roomId) return;

    if (forceRegenerate) {
      for (const k of Array.from(this.imageCache.keys())) {
        if (k.startsWith(`${roomId}_`)) this.imageCache.delete(k);
      }
      for (const k of Array.from(this.descCache.keys())) {
        if (k.startsWith(`${roomId}:`)) this.descCache.delete(k);
      }
      this.updateCacheDisplay();
    }

    if (this.aiEnabled) {
      if (this._shouldRateLimit()) {
        this.addOutput('[AI cooling down…]', 'system-message');
        return;
      }
      await this.generateRoomImage(roomId);
      if (reDescribe) await this.generateRoomDescription(roomId);
    } else if (reDescribe) {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }
  }

  /**
   * Enter a room: handle subscriptions, presence, UI updates, AI description.
   */
  async enterRoom(roomId) {
    const room = this.roomTemplates[roomId];
    if (!room) return;
    const prevRoom = this.state.currentRoom;
    this.state.currentRoom = roomId;
    this.state.visitedRooms.add(roomId);
    this.addOutput(`\n[${room.name}]`, 'room-name');

    // Multiplayer: presence and subscriptions
    if (this.aterna?.enabled) {
      if (prevRoom) await this.publishPresence(prevRoom, 'leave');
      if (this.roomUnsub) { try { this.roomUnsub(); } catch {} this.roomUnsub = null; }
      this.roomUnsub = this.subscribeRoomStreams(roomId);
      await this.publishPresence(roomId, 'join');
      await this.publishRoomEvent(roomId, {
        event_type:'move',
        player:this.buildPublicPlayerState(),
        payload:{ from_room: prevRoom || null }
      });
      await this.publishPlayerState('move');
      if (this._hb) clearInterval(this._hb);
      this._hb = setInterval(() => this.publishPresence(roomId, 'heartbeat'), 25000);
    }

    // AI or offline description & image
    if (this.aiEnabled) {
      await this.generateRoomImage(roomId);
      await this.generateRoomDescription(roomId);
    } else {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }

    // Show items
    const items = (room.items || []).filter(id => !this.state.inventory.includes(id));
    if (items.length) this.addOutput(`You notice: ${items.map(id => this.items[id]?.name || id).join(', ')}`);

    // Show exits
    const exits = Object.keys(room.exits || {});
    if (exits.length) this.addOutput(`\nPaths: ${exits.join(', ')}`);

    // Apply room effects
    this.applyQuantumEffects(room);
    this.updateDisplay();
    this.updateMap();
    this.saveState();
  }

  /**
   * Generate image for current room, using AI with caching.
   */
  async generateRoomImage(roomId) {
    const cacheKey = `${roomId}_${Math.floor(this.state.truthDensity*10)}_${Math.floor(this.state.quantumState.coherence*10)}_${Math.floor(this.state.shadowIntegration*10)}_${this.imageModel}`;
    if (this.imageCache.has(cacheKey)) {
      document.getElementById('room-image').src = this.imageCache.get(cacheKey);
      return;
    }
    if (this._imageInflight.has(cacheKey)) return;
    this._imageInflight.add(cacheKey);

    const loading = document.getElementById('image-loading');
    loading.classList.remove('hidden');

    const room = this.roomTemplates[roomId];
    const prompt =
      `${room.basePrompt}, truth density ${this.state.truthDensity>0.7?'high luminous':this.state.truthDensity<0.3?'dark shadowy':'twilight uncertain'}, ` +
      `quantum coherence ${this.state.quantumState.coherence>0.5?'stable reality':'reality fragmenting'}, ` +
      `shadow level ${this.state.shadowIntegration>0.5?'shadows visible and active':'shadows lurking hidden'}, ` +
      `literary style: ${room.literary}, photorealistic, cinematic lighting, mysterious atmosphere`;

    try {
      const url = await this.ai.generateImage(prompt);
      if (url) {
        this.imageCache.set(cacheKey, url);
        this.updateCacheDisplay();
        document.getElementById('room-image').src = url;
      } else {
        this.addOutput('[Image generation failed — quantum interference]', 'system-message');
      }
    } catch {
      this.addOutput('[Image generation error]', 'system-message');
    } finally {
      loading.classList.add('hidden');
      this._imageInflight.delete(cacheKey);
    }
  }

  /**
   * Generate AI description for room.
   */
  async generateRoomDescription(roomId) {
    const key = `${roomId}:${Math.round(this.state.truthDensity*10)}:${Math.round(this.state.quantumState.coherence*10)}:${Math.round(this.state.shadowIntegration*10)}:${this.textModel}`;
    if (this.descCache.has(key)) {
      this.addOutput(this.descCache.get(key), 'librarian-voice');
      return;
    }
    const room = this.roomTemplates[roomId];
    const prompt =
      `As the Quantum Librarian, describe ${room.name} for ${this.state.player.name}. ` +
      `Literary style: ${room.literary}. Player state: Truth ${this.state.truthDensity}, ` +
      `Quantum ${this.state.quantumState.coherence}, Shadow ${this.state.shadowIntegration}. ` +
      `Make it personal to their journey; show how the room reflects their inner state. Keep it atmospheric and under 150 words.`;
    try {
      const description = await this.ai.callLLM(prompt);
      if (description) {
        this.descCache.set(key, description);
        this.addOutput(description, 'librarian-voice');
      }
    } catch {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }
  }

  /**
   * Fallback description when AI disabled.
   */
  getOfflineRoomDescription(roomId) {
    const d = {
      entrance: "The Library entrance thrums with potential. Doors exist and don't exist simultaneously.",
      hall_of_mirrors: 'Infinite reflections cascade through impossible geometries. Each shows a different you.',
      garden_of_forking_paths: 'Every step creates new timelines. You see yourself walking paths not taken.',
      shadow_archive: 'Your shadow moves independently here, browsing shelves of fears and forgotten dreams.',
      tea_room: "Time stopped at 6 o'clock. Empty chairs wait for aspects of yourself.",
      quantum_laboratory: 'Reality equations float mid-air. A cat prowls between existence and void.',
      oracle_chamber: 'Ancient wisdom merges with quantum uncertainty. All answers are true until observed.',
      abyss_reading_room: 'Books of unwritten stories line the walls. The void reads you as you read it.'
    };
    return d[roomId] || 'The room defies description.';
  }

  // ================= Command Processing =================

  /**
   * Process user input (main entrypoint).
   */
  async processCommand() {
    const input = document.getElementById('command-input');
    const command = (input.value || '').trim();
    if (!command || this.processingCommand) return;

    this.processingCommand = true;
    input.disabled = true;
    this.addOutput(`> ${command}`, 'command-echo');
    this.state.history.push(command);
    input.value = '';
    this.state.actionCount++;

    if (this.aiEnabled) {
      await this.processWithAI(command);
    } else {
      this.processOffline(command);
    }

    this.evolveQuantumState(command);
    this.updateDisplay();
    this.processingCommand = false;
    input.disabled = false;
    input.focus();
  }

  /**
   * Process command via AI when AI-enabled.
   */
  async processWithAI(command) {
    // Special-case: look/examine triggers visual refresh rather than full AI prompt
    if (/^(look|examine)\b/i.test(command)) {
      await this.refreshRoomVisuals({ reDescribe:true });
      return;
    }

    // Rate limit AI
    if (this._shouldRateLimit()) {
      this.addOutput('[AI cooling down…]', 'system-message');
      return;
    }

    const room = this.roomTemplates[this.state.currentRoom];
    const prompt =
`As the Quantum Librarian in ${room.name}, respond to player "${command}".
Player: ${this.state.player.name} (${this.state.player.archetype})
Truth: ${this.state.truthDensity}, Quantum: ${this.state.quantumState.coherence}, Shadow: ${this.state.shadowIntegration}
Available exits: ${Object.keys(room.exits || {}).join(', ')}

Instructions:
- If they're moving (go/walk/move + direction), confirm movement and describe the transition
- React to their truth density and quantum state
- Be mysterious and literary
- Sometimes change their stats slightly based on their actions
- If their action reveals character, note it
- Keep response under 150 words

Response format:
[NARRATIVE]
Your atmospheric response here
[/NARRATIVE]
[STATS]
truth_change: 0.0
quantum_change: 0.0
shadow_change: 0.0
[/STATS]
[MOVE]
room_id or none
[/MOVE]`;

    try {
      const response = await this.ai.callLLM(prompt);
      if (response) {
        const narrativeMatch = response.match(/\[NARRATIVE\]([\s\S]*?)\[\/NARRATIVE\]/);
        const statsMatch = response.match(/\[STATS\]([\s\S]*?)\[\/STATS\]/);
        const moveMatch = response.match(/\[MOVE\]([\s\S]*?)\[\/MOVE\]/);

        if (narrativeMatch) {
          this.addOutput(narrativeMatch[1].trim(), 'librarian-voice');
        }
        if (statsMatch) {
          const stats = statsMatch[1];
          const truthChange = parseFloat((stats.match(/truth_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const quantumChange = parseFloat((stats.match(/quantum_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const shadowChange = parseFloat((stats.match(/shadow_change:\s*([\-\d.]+)/) || [])[1] || 0);
          this.state.truthDensity = clamp01(this.state.truthDensity + truthChange);
          this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + quantumChange);
          this.state.shadowIntegration = clamp01(this.state.shadowIntegration + shadowChange);
          this.publishPlayerState('stats').catch(()=>{});
        }
        if (moveMatch) {
          const mv = moveMatch[1].trim();
          if (mv !== 'none' && this.roomTemplates[mv]) {
            await this.enterRoom(mv);
          }
        }
      }
    } catch {
      // Fallback: offline processing if AI fails
      this.processOffline(command);
    }
  }

  /**
   * Process commands in offline mode (non-AI).
   */
  processOffline(command) {
    const words = command.toLowerCase().split(' ');
    const verb = words[0];
    const target = words.slice(1).join(' ');

    switch (verb) {
      // Movement
      case 'go': case 'move': case 'walk':
        this.handleMovement(target);
        break;

      // Look / examine
      case 'look': case 'examine':
        this.handleLook(target);
        break;

      // Meditation & stats
      case 'meditate':
        this.handleMeditate();
        break;
      case 'stats':
        this.showStats();
        break;

      // Map toggling
      case 'map':
        this.toggleMap();
        break;

      // Help & resets & saves
      case 'help':
        this.showHelp();
        break;
      case 'reset':
        this.resetGameConfirm();
        break;
      case 'save':
        this.exportSave();
        break;
      case 'load':
        document.getElementById('import-file').click();
        break;

      // Items & inventory
      case 'take':
        this.handleTake(target);
        break;
      case 'use':
        this.handleUse(target);
        break;
      case 'inventory': case 'inv':
        this.showInventory();
        break;

      // Shop
      case 'shop':
        this.showShop();
        break;
      case 'buy':
        this.buyItem(target);
        break;
      case 'sell':
        this.sellItem(target);
        break;

      // Learning & evolution
      case 'learn': case 'study':
        this.study();
        break;
      case 'evolve':
        this.tryEvolve();
        break;

      // Progress
      case 'progress':
        this.showProgress();
        break;

      // Multiplayer
      case 'who':
        this.cmdWho();
        break;
      case 'say':
        this.cmdSay(target);
        break;
      case 'attack':
        this.cmdAttack(target);
        break;

      // Books
      case 'books':
        this.books.list();
        break;
      case 'read':
      case 'open':
        this.books.open(target);
        break;
      case 'choose':
        this.books.choose(target);
        break;
      case 'ask':
        this.books.ask(target);
        break;
      case 'draw':
        this.books.draw();
        break;
      case 'book':
        this._dispatchBookSubcommand(words.slice(1));
        break;

      // Redraw room image
      case 'redraw':
        this.refreshRoomVisuals({ reDescribe:true, forceRegenerate:true });
        break;

      default:
        this.addOutput('The Library remains silent.');
        break;
    }
  }

  /**
   * Dispatch subcommands for "book" verb.
   */
  _dispatchBookSubcommand(args) {
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1).join(' ');
    switch (sub) {
      case 'open':
        this.books.open(rest);
        break;
      case 'close':
        this.books.close();
        break;
      case 'resume':
        this.books.resume();
        break;
      case 'summary':
        this.books.summary();
        break;
      case 'ask':
        this.books.ask(rest);
        break;
      case 'choose':
        this.books.choose(rest);
        break;
      case 'draw':
        this.books.draw();
        break;
      default:
        this.addOutput('Book commands: book open <name>, book close, book resume, book summary, book ask <q>, book choose <n|id>, book draw');
    }
  }

  // ---------- Help ----------
  showHelp() {
    this.addOutput(
      `Commands:
- Movement: go <n|s|e|w>, map
- Observe: look, look self, meditate, stats
- Items: take <item>, use <item>, inventory|inv
- Shop (when vendor present): shop, buy <item>, sell <item>
- Learning/Money: learn|study (gain Ξ Insight)
- Evolution: evolve (consume items/Ξ to advance stage)
- Multiplayer: who, say <text>, attack <name>
- Books: books, read <book>, choose <n|id>, ask <question>, draw, book close|resume|summary
- Progress/Saves: progress, save, load, reset, redraw (force regenerate room art)`
    );
  }

  // ================= Command handlers (offline) =================

  handleMovement(direction) {
    const room = this.roomTemplates[this.state.currentRoom];
    if (!direction) {
      this.addOutput('Which path will you take?');
      return;
    }
    const shortcuts = { n:'north', s:'south', e:'east', w:'west' };
    direction = shortcuts[direction] || direction;
    if (room?.exits?.[direction]) {
      this.enterRoom(room.exits[direction]);
    } else {
      this.addOutput(`There is no path ${direction} from here.`);
    }
  }

  handleLook(target) {
    const around = !target || target === 'around';
    if (around) {
      if (this.aiEnabled) {
        this.refreshRoomVisuals({ reDescribe:true });
      } else {
        this.addOutput(this.getOfflineRoomDescription(this.state.currentRoom));
      }
      return;
    }
    if (['self','me','character'].includes(target)) {
      this.showStats();
    } else {
      this.addOutput('You see only echoes of intention.');
    }
  }

  handleMeditate() {
    this.addOutput('You close your eyes and feel the quantum field…');
    this.state.quantumState.coherence = Math.min(1, this.state.quantumState.coherence + 0.1);
    this.state.truthDensity = Math.min(1, this.state.truthDensity + 0.05);
    this.addOutput('Your consciousness expands.');
    this.publishPlayerState('meditate').catch(()=>{});
  }

  showStats() {
    this.addOutput(`You are ${this.state.player.name}, the ${this.state.player.archetype}.`);
    this.addOutput(`Truth: ${(this.state.truthDensity*100).toFixed(0)}% — Quantum: ${(this.state.quantumState.coherence*100).toFixed(0)}% — Shadow: ${(this.state.shadowIntegration*100).toFixed(0)}%`);
  }

  toggleMap() {
    const m = document.getElementById('map');
    m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
  }

  // Items & inventory
  hasItem(id) { return this.state.inventory.includes(id); }
  addItem(id) {
    if (!this.items[id]) return false;
    if (!this.hasItem(id)) this.state.inventory.push(id);
    return true;
  }
  removeItem(id) {
    const i = this.state.inventory.indexOf(id);
    if (i >= 0) this.state.inventory.splice(i,1);
  }
  findItemIdByName(name) {
    const n = (name || '').toLowerCase();
    const entry = Object.values(this.items).find(it => it.name.toLowerCase().includes(n));
    return entry?.id || null;
  }
  grantInsight(n) {
    const add = Math.max(0, Math.floor(n || 0));
    this.state.insight += add;
    this.addOutput(`[+${add} Ξ Insight]`, 'system-message');
  }
  spendInsight(n) {
    const need = Math.max(0, Math.floor(n || 0));
    if (this.state.insight < need) return false;
    this.state.insight -= need;
    return true;
  }

  handleTake(target) {
    if (!target) {
      this.addOutput('Take what?');
      return;
    }
    const room = this.roomTemplates[this.state.currentRoom];
    const pool = (room.items || []).filter(id => !this.state.inventory.includes(id));
    const id = this.findItemIdByName(target) || pool.find(pid => (this.items[pid]?.name || pid).toLowerCase().includes(target.toLowerCase()));
    if (!id || !pool.includes(id)) {
      this.addOutput('There is nothing like that to take.');
      return;
    }
    this.addItem(id);
    room.items = (room.items || []).filter(x => x !== id);
    this.addOutput(`You take the ${this.items[id].name}.`);
    // Publish loot to Aterna
    this.publishRoomEvent(this.state.currentRoom, {
      event_type:'loot',
      player: this.buildPublicPlayerState(),
      payload:{ item: this.items[id]?.name || id }
    }).catch(()=>{});
    this.publishPlayerState('loot').catch(()=>{});
  }

  handleUse(target) {
    if (!target) {
      this.addOutput('Use what?');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id || !this.hasItem(id)) {
      this.addOutput("You don't have that.");
      return;
    }
    const it = this.items[id];
    if (it.type === 'book') {
      this.books.openById(id);
      return;
    }
    switch (it.type) {
      case 'consumable':
        this.consumeItem(it);
        this.removeItem(id);
        break;
      case 'evolution':
        this.addOutput(`You attune to the ${it.name}. Its purpose may be ritual, not immediate.`);
        break;
      default:
        this.addOutput('Nothing obvious happens.');
    }
  }

  consumeItem(it) {
    if (it.id === 'tea_clarity') {
      this.addOutput('Warmth clears the noise.');
      this.state.truthDensity = clamp01(this.state.truthDensity + 0.08);
    } else if (it.id === 'cat_paradox') {
      this.addOutput('A purr, and all states purr with it.');
      this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + 0.10);
    } else if (it.id === 'ink_of_nyx') {
      this.addOutput('Night gathers in the nib, drawing your shadow nearer.');
      this.state.shadowIntegration = clamp01(this.state.shadowIntegration + 0.10);
    } else if (it.id === 'folio_notes') {
      this.addOutput('You annotate the margins with yourself.');
      this.grantInsight(8);
    } else {
      this.addOutput('You feel… marginally altered.');
    }
    this.updateDisplay();
    this.publishPlayerState('consume').catch(()=>{});
  }

  showInventory() {
    if (!this.state.inventory.length) {
      this.addOutput('Your pockets are full of potential, not objects.');
    } else {
      this.addOutput(`Inventory: ${this.state.inventory.map(id => this.items[id]?.name || id).join(', ')}`);
    }
  }

  // Shop & vendor
  currentVendor() {
    const room = this.roomTemplates[this.state.currentRoom];
    return room?.vendor || null;
  }

  showShop() {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const lines = [`[${v.name} — Bazaar of Proofs]`, `You have ${this.state.insight} Ξ.`];
    for (const g of v.goods) {
      const it = this.items[g.item];
      lines.push(`- ${it.name} — ${g.price} Ξ :: ${it.desc}`);
    }
    lines.push('Use: buy <item>, sell <item>');
    this.addOutput(lines.join('\n'));
  }

  async buyItem(target) {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id) {
      this.addOutput('Name it clearly.');
      return;
    }
    const g = v.goods.find(x => x.item === id);
    if (!g) {
      this.addOutput('Not sold here.');
      return;
    }
    if (!this.spendInsight(g.price)) {
      this.addOutput('Not enough Ξ.');
      return;
    }
    this.addItem(id);
    this.addOutput(`Purchased ${this.items[id].name} for ${g.price} Ξ.`);
    this.updateDisplay();
    try {
      await this.aterna?.publishEvent(Topics.trades, {
        event_type:'buy',
        player: this.buildPublicPlayerState(),
        payload:{ item:this.items[id]?.name, price:g.price }
      });
    } catch {}
    this.publishPlayerState('trade').catch(()=>{});
  }

  async sellItem(target) {
    const v = this.currentVendor();
    if (!v) {
      this.addOutput('No vendor here.');
      return;
    }
    const id = this.findItemIdByName(target);
    if (!id || !this.hasItem(id)) {
      this.addOutput("You don't have that.");
      return;
    }
    const it = this.items[id];
    const base = it.price || 0;
    const p = Math.max(1, Math.floor(base * (v.sellbackRate ?? 0.5)));
    this.removeItem(id);
    this.grantInsight(p);
    this.addOutput(`Sold ${it.name} for ${p} Ξ.`);
    this.updateDisplay();
    try {
      await this.aterna?.publishEvent(Topics.trades, {
        event_type:'sell',
        player: this.buildPublicPlayerState(),
        payload:{ item:it.name, price:p }
      });
    } catch {}
    this.publishPlayerState('trade').catch(()=>{});
  }

  // Learning / study
  study() {
    const base = 4;
    const bonus = Math.round(4 * (this.state.truthDensity + this.state.quantumState.coherence));
    const gain = base + bonus;
    this.grantInsight(gain);
    this.addOutput('You study. The stacks yield a little more of you back.');
    this.updateDisplay();
    this.publishPlayerState('study').catch(()=>{});
  }

  // Evolution
  evolutionPlan() {
    return {
      Threshold:{ need:[{id:'mirror_shard'}, {insight:10}], next:'Initiate', gain:{ truth:+0.05 } },
      Initiate: { need:[{id:'quantum_key'}, {insight:25}, {truth:0.60}], next:'Adept', gain:{ quantum:+0.05 } },
      Adept:    { need:[{id:'shadow_lantern'}, {insight:40}, {shadow:0.60}], next:'Scholar', gain:{ shadow:+0.05 } },
      Scholar:  { need:[{id:'glyph_memory'}, {insight:80}, {quantum:0.70}], next:'Oracle', gain:{ truth:+0.05, quantum:+0.05 } }
    };
  }

  tryEvolve() {
    const stage = this.state.player.heroStage || 'Threshold';
    const plan = this.evolutionPlan()[stage];
    if (!plan) {
      this.addOutput('No further evolution is visible.');
      return;
    }
    const lacks = [];
    for (const req of plan.need) {
      if (req.id && !this.hasItem(req.id)) lacks.push(this.items[req.id].name);
      if (req.insight && this.state.insight < req.insight) lacks.push(`${req.insight} Ξ`);
      if (req.truth && this.state.truthDensity < req.truth) lacks.push(`Truth≥${Math.round(req.truth*100)}%`);
      if (req.quantum && this.state.quantumState.coherence < req.quantum) lacks.push(`Quantum≥${Math.round(req.quantum*100)}%`);
      if (req.shadow && this.state.shadowIntegration < req.shadow) lacks.push(`Shadow≥${Math.round(req.shadow*100)}%`);
    }
    if (lacks.length) {
      this.addOutput(`Evolution requires: ${lacks.join(', ')}`);
      return;
    }

    for (const req of plan.need) {
      if (req.id) this.removeItem(req.id);
      if (req.insight) this.state.insight -= req.insight;
    }

    if (plan.gain.truth) this.state.truthDensity = clamp01(this.state.truthDensity + plan.gain.truth);
    if (plan.gain.quantum) this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + plan.gain.quantum);
    if (plan.gain.shadow) this.state.shadowIntegration = clamp01(this.state.shadowIntegration + plan.gain.shadow);

    this.state.player.heroStage = plan.next;
    this.addOutput(`You evolve: ${stage} → ${plan.next}. Something irreversible rearranges.`);
    this.updateDisplay();
    this.publishRoomEvent(this.state.currentRoom, {
      event_type:'evolve',
      player:this.buildPublicPlayerState(),
      payload:{ new_stage:plan.next }
    }).catch(()=>{});
    this.publishPlayerState('evolve').catch(()=>{});
  }

  // Progress
  showProgress() {
    const visited = this.state.visitedRooms.size;
    const inv = this.state.inventory.map(id => this.items[id]?.name || id).join(', ') || '—';
    const lines = [
      `[Progress]`,
      `Stage: ${this.state.player.heroStage}`,
      `Insight: ${this.state.insight} Ξ`,
      `HP: ${this.state.hp}`,
      `Rooms visited: ${visited}`,
      `Actions: ${this.state.actionCount}`,
      `Inventory: ${inv}`
    ];
    this.addOutput(lines.join('\n'));
  }

  // ================= Multiplayer & Aterna =================

  /**
   * Build a minimal public player snapshot.
   */
  buildPublicPlayerState() {
    return {
      id: this.playerId,
      name: this.state.player?.name || 'Unknown',
      stage: this.state.player?.heroStage || 'Threshold',
      truth: this.state.truthDensity,
      quantum: this.state.quantumState.coherence,
      shadow: this.state.shadowIntegration,
      insight: this.state.insight,
      room: this.state.currentRoom || null,
      hp: this.state.hp ?? 100
    };
  }

  /**
   * Publish player snapshot to Aterna.
   */
  async publishPlayerState(reason='update') {
    if (!this.aterna?.enabled) return;
    await this.aterna.publishEvent(Topics.playerState(this.playerId), {
      event_type:'snapshot',
      player: this.buildPublicPlayerState(),
      payload:{ reason }
    });
  }

  /**
   * Publish room-level events to proper topic (chat, move, loot, combat, evolve).
   */
  async publishRoomEvent(roomId, evt) {
    if (!this.aterna?.enabled) return;
    const t = evt.event_type;
    const topic =
      t === 'chat'   ? Topics.roomChat(roomId) :
      t === 'attack' || t === 'heal' ? Topics.roomCombat(roomId) :
      Topics.roomUpdates(roomId);
    await this.aterna.publishEvent(topic, { ...evt, room_id: roomId });
  }

  /**
   * Publish presence events.
   */
  async publishPresence(roomId, kind) {
    if (!this.aterna?.enabled) return;
    await this.aterna.publishEvent(Topics.roomPresence(roomId), {
      event_type: kind,
      room_id: roomId,
      player: this.buildPublicPlayerState()
    });
  }

  /**
   * Subscribe to room-specific streams: updates, combat, presence, chat.
   */
  subscribeRoomStreams(roomId) {
    const unsubs = [];
    unsubs.push(this.aterna.subscribe(Topics.roomUpdates(roomId), msg => this.onRoomEvent(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomCombat(roomId),  msg => this.onRoomEvent(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomPresence(roomId),msg => this.onPresence(msg)));
    unsubs.push(this.aterna.subscribe(Topics.roomChat(roomId),    msg => this.onRoomEvent(msg)));
    return () => unsubs.forEach(u => { try { u(); } catch {} });
  }

  /**
   * Handle presence messages (join/leave/heartbeat).
   */
  onPresence(msg) {
    const d = msg?.content?.data || {};
    const kind = d.event_type;
    if (!d.player) return;
    const p = d.player;
    this.roomPeers.set(p.id, {
      name:p.name,
      hp:p.hp ?? 100,
      stage:p.stage,
      lastSeen: Date.now()
    });
    if (kind === 'join') this.addOutput(`${p.name} enters.`, 'system-message');
    if (kind === 'leave') this.addOutput(`${p.name} departs.`, 'system-message');
  }

  /**
   * Handle room events (chat, move, attack, loot, evolve).
   */
  onRoomEvent(msg) {
    const d = msg?.content?.data || {};
    switch (d.event_type) {
      case 'chat':
        this.addOutput(`${d.player?.name || d.from}: ${d.payload?.text || ''}`);
        break;
      case 'move':
        if (d.player) {
          this.roomPeers.set(d.player.id, {
            name:d.player.name,
            hp:d.player.hp ?? 100,
            stage:d.player.stage,
            lastSeen: Date.now()
          });
        }
        break;
      case 'attack':
        this.applyCombatEvent(d);
        break;
      case 'loot':
        if (d.player && d.payload?.item) {
          this.addOutput(`${d.player.name} acquires ${d.payload.item}.`);
        }
        break;
      case 'evolve':
        if (d.player && d.payload?.new_stage) {
          this.addOutput(`${d.player.name} evolves to ${d.payload.new_stage}.`, 'system-message');
        }
        break;
      default:
        break;
    }
  }

  /**
   * List who is present.
   */
  cmdWho() {
    if (!this.aterna?.enabled) {
      this.addOutput('Multiplayer is offline.');
      return;
    }
    const lines = ['[Here]'];
    for (const [, p] of this.roomPeers.entries()) {
      lines.push(`- ${p.name} (${p.stage}) — HP:${p.hp}`);
    }
    if (lines.length === 1) lines.push('No one else is observable.');
    this.addOutput(lines.join('\n'));
  }

  /**
   * Say message to room.
   */
  async cmdSay(text) {
    if (!text) {
      this.addOutput('Say what?');
      return;
    }
    const me = this.buildPublicPlayerState();
    this.addOutput(`${me.name}: ${text}`);
    await this.publishRoomEvent(this.state.currentRoom, {
      event_type:'chat',
      player: me,
      payload:{ text }
    });
  }

  /**
   * Attack another player by name (prefix match).
   */
  async cmdAttack(targetStr) {
    if (!this.aterna?.enabled) {
      this.addOutput('Combat requires Aterna.');
      return;
    }
    if (!targetStr) {
      this.addOutput('Attack whom?');
      return;
    }
    const target = Array.from(this.roomPeers.values()).find(p => p.name.toLowerCase().startsWith(targetStr.toLowerCase()));
    if (!target) {
      this.addOutput('No such target.');
      return;
    }
    const me = this.buildPublicPlayerState();
    const dmg = 3 + ((me.name.length + target.name.length + (Date.now() >> 10)) % 8);
    await this.publishRoomEvent(this.state.currentRoom, {
      event_type:'attack',
      player: me,
      target:{ name: target.name },
      payload:{ dmg }
    });
    this.addOutput(`You strike ${target.name} for ${dmg}.`);
  }

  /**
   * Apply combat damage event to peers and self.
   */
  applyCombatEvent(evt) {
    const from = evt.player;
    const toName = evt.target?.name;
    const dmg = evt.payload?.dmg;
    if (!from || !toName || !dmg) return;
    for (const [id, p] of this.roomPeers.entries()) {
      if (p.name === toName) {
        p.hp = Math.max(0, (p.hp ?? 100) - dmg);
        this.roomPeers.set(id, p);
        if (p.hp === 0) {
          this.addOutput(`${p.name} falls.`, 'system-message');
        } else {
          this.addOutput(`${from.name} hits ${p.name} for ${dmg}.`);
        }
        break;
      }
    }
    const meName = this.state.player?.name;
    if (toName === meName) {
      this.addOutput(`[You take ${dmg} damage]`, 'system-message');
      this.state.hp = Math.max(0, (this.state.hp ?? 100) - dmg);
      this.publishPlayerState('damage').catch(()=>{});
      this.updateDisplay();
    }
  }

  // ================= Systems & stats =================

  buildContext() {
    return {
      player: this.state.player,
      room: this.state.currentRoom,
      stats: {
        truth: this.state.truthDensity,
        quantum: this.state.quantumState.coherence,
        shadow: this.state.shadowIntegration
      },
      history: this.state.history.slice(-5)
    };
  }

  applyQuantumEffects(room) {
    if (room.literary === 'science') this.state.quantumState.coherence = Math.min(1, this.state.quantumState.coherence + 0.05);
    if (room.name.includes('Shadow')) this.state.shadowIntegration = Math.min(1, this.state.shadowIntegration + 0.02);
  }

  evolveQuantumState(action) {
    this.state.quantumState.coherence *= 0.99;
    if (/\bthink\b|\bobserve\b/.test(action)) this.state.quantumState.coherence += 0.01;
    if (/\btruth\b|\bhonest\b/.test(action)) this.state.truthDensity = Math.min(1, this.state.truthDensity + 0.01);
    this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence);
    this.state.truthDensity = clamp01(this.state.truthDensity);
    this.state.shadowIntegration = clamp01(this.state.shadowIntegration);
  }

  addOutput(text, className = '') {
    const output = document.getElementById('text-output');
    const entry = document.createElement('div');
    entry.className = className || 'text-entry';
    entry.textContent = text;
    output.appendChild(entry);
    output.scrollTop = output.scrollHeight;
    while (output.children.length > 120) {
      output.removeChild(output.firstChild);
    }
  }

  updateDisplay() {
    if (!this.state.player) return;
    document.getElementById('char-name').textContent = this.state.player.name;
    document.getElementById('truth-density').textContent = (this.state.truthDensity*100).toFixed(0) + '%';
    document.getElementById('quantum-coherence').textContent = (this.state.quantumState.coherence*100).toFixed(0) + '%';
    document.getElementById('shadow-integration').textContent = (this.state.shadowIntegration*100).toFixed(0) + '%';
    document.getElementById('truth-bar').style.width = (this.state.truthDensity*100) + '%';
    document.getElementById('quantum-bar').style.width = (this.state.quantumState.coherence*100) + '%';
    document.getElementById('shadow-bar').style.width = (this.state.shadowIntegration*100) + '%';
    document.getElementById('hero-stage').textContent = this.state.player.heroStage;
    document.getElementById('action-count').textContent = this.state.actionCount;
    document.getElementById('token-count').textContent = this.tokenCount;
    const ic = document.getElementById('insight-count');
    if (ic) ic.textContent = this.state.insight.toString();
  }

  updateMap() {
    const mapGrid = document.getElementById('map-grid');
    mapGrid.innerHTML = '';
    const rooms = Array.from(this.state.visitedRooms);
    rooms.forEach(roomId => {
      const roomDiv = document.createElement('div');
      roomDiv.className = 'map-room';
      roomDiv.classList.add(roomId === this.state.currentRoom ? 'current' : 'visited');
      roomDiv.title = this.roomTemplates[roomId]?.name || roomId;
      roomDiv.onclick = () => {
        if (roomId !== this.state.currentRoom) {
          this.enterRoom(roomId);
        }
      };
      mapGrid.appendChild(roomDiv);
    });
  }

  updateCacheDisplay() {
    document.getElementById('cache-count').textContent = this.imageCache.size;
    const cacheSizeKB = Math.round(this.imageCache.size * 120);
    document.getElementById('cache-size').textContent = cacheSizeKB + ' KB';
  }

  bumpTokens(n) {
    this.tokenCount += (n || 0);
    document.getElementById('token-count').textContent = this.tokenCount;
  }

  // ================= Persistence =================

  serializeState() {
    const clone = JSON.parse(JSON.stringify(this.state));
    clone.visitedRooms = Array.from(this.state.visitedRooms);
    return clone;
  }

  deserializeState(obj) {
    try {
      this.state = obj;
      this.state.visitedRooms = new Set(obj.visitedRooms || []);
      this.state.stage = 'playing';
      localStorage.setItem('qmud_state', JSON.stringify(this.serializeState()));
      this.startGame();
    } catch (e) {
      console.error('Deserialize failed', e);
    }
  }

  saveState() {
    if (this.state.stage === 'playing') {
      localStorage.setItem('qmud_state', JSON.stringify(this.serializeState()));
      localStorage.setItem('qmud_version', '2.4');
    }
  }

  loadState() {
    const saved = localStorage.getItem('qmud_state');
    if (!saved) return;
    try {
      const loaded = JSON.parse(saved);
      if (loaded.stage === 'playing' && loaded.player) {
        this.state = loaded;
        this.state.visitedRooms = new Set(loaded.visitedRooms || []);
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('covenant').style.display = 'none';
        document.getElementById('creation').style.display = 'none';
        const savedKey = localStorage.getItem('qmud_api_key');
        if (savedKey) {
          this.apiKey = savedKey;
          this.aiEnabled = true;
          document.getElementById('status-panel').style.display = 'block';
          this.updateStatus('ai','active','Connected');
          this.updateStatus('image','active','Ready');
        }
        this.startGame();
      }
    } catch {
      console.log('Could not load saved game');
    }
  }

  resetGameConfirm() {
    if (confirm('Reset your journey? This clears local save.')) {
      localStorage.removeItem('qmud_state');
      this.state = {
        stage:'setup', player:null, currentRoom:null, visitedRooms:new Set(), actionCount:0,
        history:[], inventory:[], insight:0, hp:100,
        quantumState:{ coherence:0, entanglement:[], superposition:0 },
        truthDensity:0.5, shadowIntegration:0,
        creationData:{ observations:[], currentScene:0, startTime: Date.now() },
        bookSession:null
      };
      if (this._hb) { try { clearInterval(this._hb); } catch {} }
      location.reload();
    }
  }

  exportSave() {
    try {
      downloadJSON(this.serializeState(), `qmud-save-${Date.now()}.json`);
      this.addOutput('[Save exported]', 'system-message');
    } catch {
      this.addOutput('[Export failed]', 'system-message');
    }
  }

  importSave(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target.result);
        this.deserializeState(json);
        this.addOutput('[Save imported]', 'system-message');
      } catch {
        alert('Invalid save file.');
      }
    };
    reader.readAsText(file);
  }

  // ================= End of Game Class =================
  }
// expose to the window so qmud.js / onclick handlers can use it
window.QuantumTruthMUD = QuantumTruthMUD;
