// game.js — core gameplay
import { clamp01, downloadJSON } from './utils.js';
import { AIClient } from './ai.js';
import { loadContent } from './content.js';

export class QuantumTruthMUD {
  constructor() {
    // Runtime
    this.apiKey = null;
    this.textModel = 'gpt-4o-mini';
    this.imageModel = 'gpt-image-1';
    this.aiEnabled = false;
    this.imageCache = new Map();
    this.tokenCount = 0;
    this.processingCommand = false;

    // State
    this.state = {
      stage: 'setup',
      player: null,
      currentRoom: null,
      visitedRooms: new Set(),
      actionCount: 0,
      history: [],
      inventory: [],
      quantumState: { coherence: 0, entanglement: [], superposition: 0 },
      truthDensity: 0.5,
      shadowIntegration: 0,
      creationData: { observations: [], currentScene: 0, startTime: Date.now() }
    };

    // Content (loaded in init)
    this.roomTemplates = {};
    this.creationScenes = [];

    // AI client bound to runtime getters
    this.ai = new AIClient(
      () => this.apiKey,
      () => this.textModel,
      () => this.imageModel,
      (n) => this.bumpTokens(n),
      (type, status, text) => this.updateStatus(type, status, text)
    );
  }

  async init() {
    // Load content (optionally overridden by rooms.json / scenes.json)
    const content = await loadContent();
    this.roomTemplates = content.rooms;
    this.creationScenes = content.scenes;

    // Hydrate UI defaults
    const savedKey = localStorage.getItem('qmud_api_key');
    if (savedKey) document.getElementById('api-key-input').value = savedKey;

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
    document.getElementById('text-model').addEventListener('change', (e) => {
      this.textModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });
    document.getElementById('image-model').addEventListener('change', (e) => {
      this.imageModel = e.target.value;
      localStorage.setItem('qmud_models', JSON.stringify({ textModel: this.textModel, imageModel: this.imageModel }));
    });

    // Mouse tracking for quantum overlay
    document.addEventListener('mousemove', (e) => {
      const display = document.getElementById('image-display');
      if (display) {
        const rect = display.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100) + '%';
        const y = ((e.clientY - rect.top) / rect.height * 100) + '%';
        display.style.setProperty('--mouse-x', x);
        display.style.setProperty('--mouse-y', y);
      }
    });

    // Auto-save
    setInterval(() => this.saveState(), 30000);

    // Load saved game if present
    this.loadState();

    // Register service worker (optional)
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('./sw.js'); } catch {}
    }
  }

  // ===== Setup / Start =====
  async validateAndStart() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey || !apiKey.startsWith('sk-')) { alert('Please enter a valid OpenAI API key'); return; }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!response.ok) throw new Error('Key check failed');

      this.apiKey = apiKey;
      localStorage.setItem('qmud_api_key', apiKey);
      this.aiEnabled = true;

      document.getElementById('setup-screen').style.display = 'none';
      document.getElementById('game-container').style.display = 'block';
      document.getElementById('status-panel').style.display = 'block';
      this.updateStatus('ai', 'active', 'Connected');
      this.updateStatus('image', 'active', 'Ready');
      this.state.stage = 'covenant';
    } catch {
      alert('Invalid API key or network issue. Please check and try again.');
    }
  }

  startOffline() {
    this.aiEnabled = false;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('status-panel').style.display = 'block';
    this.updateStatus('ai', 'inactive', 'Offline');
    this.updateStatus('image', 'inactive', 'Offline');
    this.state.stage = 'covenant';
  }

  updateStatus(type, status, text) {
    const dot = document.getElementById(`${type}-status`);
    dot.className = `status-dot ${status}`;
    document.getElementById(`${type}-status-text`).textContent = text;
  }

  acceptCovenant() {
    document.getElementById('covenant').style.display = 'none';
    document.getElementById('creation').style.display = 'block';
    this.state.stage = 'creation';
    this.startCharacterCreation();
  }

  // ===== Character Creation =====
  startCharacterCreation() { this.showCreationScene(0); }

  showCreationScene(index) {
    if (index >= this.creationScenes.length) { this.finalizeCharacter(); return; }
    const scene = this.creationScenes[index];
    const textEl = document.getElementById('creation-text');
    const choicesEl = document.getElementById('creation-choices');
    textEl.textContent = scene.text;
    choicesEl.innerHTML = '';

    if (scene.choices[0]?.input) {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'api-input'; input.placeholder = 'Your true name…'; input.style.marginBottom = '10px';
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
        btn.onclick = () => { this.recordCreationChoice(index, choice.value); this.showCreationScene(index + 1); };
        choicesEl.appendChild(btn);
      });
    }
  }

  recordCreationChoice(sceneIndex, value, extra = null) {
    this.state.creationData.observations.push({ scene: sceneIndex, choice: value, extra, timestamp: Date.now() - this.state.creationData.startTime });
  }

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

    if (this.aiEnabled) {
      const prompt = `As the Quantum Librarian, welcome ${this.state.player.name} (${this.state.player.archetype}) to the Library. Their truth density is ${this.state.truthDensity}, quantum coherence ${this.state.quantumState.coherence}, shadow integration ${this.state.shadowIntegration}. Give a personalized, mysterious welcome that hints at their journey ahead. Keep it under 100 words and deeply atmospheric.`;
      try { this.librarianMessage = await this.ai.callLLM(prompt); } catch {}
    }
    this.startGame();
  }

  deriveArchetype(observations) {
    const m = { active: 'Warrior', contemplative: 'Sage', intuitive: 'Mystic', cautious: 'Guardian' };
    return m[observations[0]?.choice] || 'Wanderer';
  }
  deriveShadowLevel(observations) {
    let s = 0;
    if (observations[2]?.choice === 'integrated') s += 0.3;
    if (observations[3]?.choice === 'rejection') s += 0.4;
    return clamp01(s + 0.5);
  }

  // ===== Game Start =====
  startGame() {
    document.getElementById('creation').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    document.getElementById('character').style.display = 'block';
    document.getElementById('map').style.display = 'block';
    this.state.stage = 'playing';
    this.updateDisplay();
    this.enterRoom('entrance');
    if (this.librarianMessage) {
      this.addOutput('[The Quantum Librarian speaks:]', 'system-message');
      this.addOutput(this.librarianMessage, 'librarian-voice');
    } else {
      this.addOutput(`Welcome to the Canonical Library, ${this.state.player.name}.`);
      this.addOutput(`You are a ${this.state.player.archetype} at the ${this.state.player.heroStage} of your journey.`);
    }
  }

  async enterRoom(roomId) {
    const room = this.roomTemplates[roomId];
    if (!room) return;
    this.state.currentRoom = roomId;
    this.state.visitedRooms.add(roomId);
    this.addOutput(`\n[${room.name}]`, 'room-name');

    if (this.aiEnabled) {
      await this.generateRoomImage(roomId);
      await this.generateRoomDescription(roomId);
    } else {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }

    // Items present?
    const items = (room.items || []).filter(it => !this.state.inventory.includes(it));
    if (items.length) this.addOutput(`You notice: ${items.join(', ')}`);

    const exits = Object.keys(room.exits || {});
    if (exits.length) this.addOutput(`\nPaths: ${exits.join(', ')}`);

    this.applyQuantumEffects(room);
    this.updateDisplay();
    this.updateMap();
    this.saveState();
  }

  async generateRoomImage(roomId) {
    const room = this.roomTemplates[roomId];
    const cacheKey = `${roomId}_${Math.floor(this.state.truthDensity*10)}_${Math.floor(this.state.quantumState.coherence*10)}_${Math.floor(this.state.shadowIntegration*10)}_${this.imageModel}`;
    if (this.imageCache.has(cacheKey)) {
      document.getElementById('room-image').src = this.imageCache.get(cacheKey);
      return;
    }
    const loading = document.getElementById('image-loading');
    loading.classList.remove('hidden');

    const imagePrompt =
      `${room.basePrompt}, truth density ${this.state.truthDensity>0.7?'high luminous':this.state.truthDensity<0.3?'dark shadowy':'twilight uncertain'}, ` +
      `quantum coherence ${this.state.quantumState.coherence>0.5?'stable reality':'reality fragmenting'}, ` +
      `shadow level ${this.state.shadowIntegration>0.5?'shadows visible and active':'shadows lurking hidden'}, ` +
      `literary style: ${room.literary}, photorealistic, cinematic lighting, mysterious atmosphere`;

    try {
      const url = await this.ai.generateImage(imagePrompt);
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
    }
  }

  async generateRoomDescription(roomId) {
    const room = this.roomTemplates[roomId];
    const prompt =
      `As the Quantum Librarian, describe ${room.name} for ${this.state.player.name}. ` +
      `Literary style: ${room.literary}. Player state: Truth ${this.state.truthDensity}, ` +
      `Quantum ${this.state.quantumState.coherence}, Shadow ${this.state.shadowIntegration}. ` +
      `Make it personal to their journey; show how the room reflects their inner state. Keep it atmospheric and under 150 words.`;
    try {
      const description = await this.ai.callLLM(prompt);
      if (description) this.addOutput(description, 'librarian-voice');
    } catch {
      this.addOutput(this.getOfflineRoomDescription(roomId));
    }
  }

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

  // ===== Command loop =====
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

    if (this.aiEnabled) await this.processWithAI(command);
    else this.processOffline(command);

    this.evolveQuantumState(command);
    this.updateDisplay();
    this.processingCommand = false;
    input.disabled = false;
    input.focus();
  }

  async processWithAI(command) {
    const room = this.roomTemplates[this.state.currentRoom];
    const prompt =
`As the Quantum Librarian in ${room.name}, respond to player "${command}".
Player: ${this.state.player.name} (${this.state.player.archetype})
Truth: ${this.state.truthDensity}, Quantum: ${this.state.quantumState.coherence}, Shadow: ${this.state.shadowIntegration}
Available exits: ${Object.keys(room.exits||{}).join(', ')}

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

        if (narrativeMatch) this.addOutput(narrativeMatch[1].trim(), 'librarian-voice');

        if (statsMatch) {
          const stats = statsMatch[1];
          const truthChange = parseFloat((stats.match(/truth_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const quantumChange = parseFloat((stats.match(/quantum_change:\s*([\-\d.]+)/) || [])[1] || 0);
          const shadowChange = parseFloat((stats.match(/shadow_change:\s*([\-\d.]+)/) || [])[1] || 0);
          this.state.truthDensity = clamp01(this.state.truthDensity + truthChange);
          this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + quantumChange);
          this.state.shadowIntegration = clamp01(this.state.shadowIntegration + shadowChange);
        }

        if (moveMatch) {
          const mv = moveMatch[1].trim();
          if (mv !== 'none' && this.roomTemplates[mv]) await this.enterRoom(mv);
        }
      }
    } catch {
      this.processOffline(command);
    }
  }

  processOffline(command) {
    const words = command.toLowerCase().split(' ');
    const verb = words[0];
    const target = words.slice(1).join(' ');

    switch (verb) {
      case 'go': case 'move': case 'walk': this.handleMovement(target); break;
      case 'look': case 'examine': this.handleLook(target); break;
      case 'meditate': this.handleMeditate(); break;
      case 'stats': this.showStats(); break;
      case 'map': this.toggleMap(); break;
      case 'help': this.showHelp(); break;
      case 'reset': this.resetGameConfirm(); break;
      case 'save': this.exportSave(); break;
      case 'load': document.getElementById('import-file').click(); break;
      case 'take': this.handleTake(target); break;
      case 'use': this.handleUse(target); break;
      case 'inventory': case 'inv': this.showInventory(); break;
      default: this.addOutput('The Library remains silent.');
    }
  }

  handleMovement(direction) {
    const room = this.roomTemplates[this.state.currentRoom];
    if (!direction) { this.addOutput('Which path will you take?'); return; }
    const shortcuts = { n: 'north', s: 'south', e: 'east', w: 'west' };
    direction = shortcuts[direction] || direction;
    if (room?.exits?.[direction]) { this.enterRoom(room.exits[direction]); }
    else { this.addOutput(`There is no path ${direction} from here.`); }
  }

  handleLook(target) {
    if (!target || target === 'around') { this.addOutput(this.getOfflineRoomDescription(this.state.currentRoom)); }
    else if (['self', 'me', 'character'].includes(target)) { this.showStats(); }
    else { this.addOutput('You see only echoes of intention.'); }
  }

  handleMeditate() {
    this.addOutput('You close your eyes and feel the quantum field…');
    this.state.quantumState.coherence = Math.min(1, this.state.quantumState.coherence + 0.1);
    this.state.truthDensity = Math.min(1, this.state.truthDensity + 0.05);
    this.addOutput('Your consciousness expands.');
  }

  showStats() {
    this.addOutput(`You are ${this.state.player.name}, the ${this.state.player.archetype}.`);
    this.addOutput(`Truth: ${(this.state.truthDensity*100).toFixed(0)}% — Quantum: ${(this.state.quantumState.coherence*100).toFixed(0)}% — Shadow: ${(this.state.shadowIntegration*100).toFixed(0)}%`);
  }

  toggleMap() {
    const m = document.getElementById('map');
    m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
  }

  handleTake(target) {
    if (!target) { this.addOutput('Take what?'); return; }
    const room = this.roomTemplates[this.state.currentRoom];
    const items = (room.items || []).filter(it => !this.state.inventory.includes(it));
    const match = items.find(it => it.toLowerCase().includes(target.toLowerCase()));
    if (!match) { this.addOutput('There is nothing like that to take.'); return; }
    this.state.inventory.push(match);
    this.addOutput(`You take the ${match}.`);
  }

  handleUse(target) {
    if (!target) { this.addOutput('Use what?'); return; }
    const item = this.state.inventory.find(it => it.toLowerCase().includes(target.toLowerCase()));
    if (!item) { this.addOutput("You don't have that."); return; }
    // Simple affordances
    if (item === 'Quantum Key' && this.state.truthDensity < 0.8) {
      this.addOutput('The key hums. Locks you cannot see shift in distant stacks.');
      this.state.truthDensity = clamp01(this.state.truthDensity + 0.1);
    } else if (item === 'Shadow Lantern') {
      this.addOutput('You raise the lantern. Shadows organize into legible shapes.');
      this.state.shadowIntegration = clamp01(this.state.shadowIntegration + 0.1);
    } else if (item === 'Mirror Shard') {
      this.addOutput('You peer into the shard. For a moment, you are entirely observed.');
      this.state.quantumState.coherence = clamp01(this.state.quantumState.coherence + 0.1);
    } else {
      this.addOutput('Nothing obvious happens.');
    }
  }

  showInventory() {
    if (!this.state.inventory.length) this.addOutput('Your pockets are full of potential, not objects.');
    else this.addOutput(`Inventory: ${this.state.inventory.join(', ')}`);
  }

  showHelp() {
    this.addOutput(
      [
        'Commands:',
        '  go/move/walk <north|south|east|west|n|s|e|w>',
        '  look [around|self]',
        '  meditate, stats, map, help',
        '  save, load, reset',
        '  take <item>, use <item>, inventory'
      ].join('\n')
    );
  }

  // ===== Systems =====
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
    while (output.children.length > 120) output.removeChild(output.firstChild);
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
      roomDiv.onclick = () => { if (roomId !== this.state.currentRoom) this.enterRoom(roomId); };
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

  // ===== Persistence =====
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
    } catch (e) { console.error('Deserialize failed', e); }
  }

  saveState() {
    if (this.state.stage === 'playing') {
      localStorage.setItem('qmud_state', JSON.stringify(this.serializeState()));
      localStorage.setItem('qmud_version', '2.2');
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
          this.apiKey = savedKey; this.aiEnabled = true;
          document.getElementById('status-panel').style.display = 'block';
          this.updateStatus('ai', 'active', 'Connected');
          this.updateStatus('image', 'active', 'Ready');
        }
        this.startGame();
      }
    } catch { console.log('Could not load saved game'); }
  }

  resetGameConfirm() {
    if (confirm('Reset your journey? This clears local save.')) {
      localStorage.removeItem('qmud_state');
      this.state = {
        stage: 'setup', player: null, currentRoom: null, visitedRooms: new Set(), actionCount: 0,
        history: [], inventory: [],
        quantumState: { coherence: 0, entanglement: [], superposition: 0 },
        truthDensity: 0.5, shadowIntegration: 0,
        creationData: { observations: [], currentScene: 0, startTime: Date.now() }
      };
      location.reload();
    }
  }

  exportSave() {
    try {
      downloadJSON(this.serializeState(), `qmud-save-${Date.now()}.json`);
      this.addOutput('[Save exported]', 'system-message');
    } catch { this.addOutput('[Export failed]', 'system-message'); }
  }

  importSave(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        this.deserializeState(json);
        this.addOutput('[Save imported]', 'system-message');
      } catch { alert('Invalid save file.'); }
    };
    reader.readAsText(file);
  }
}
