// content.js — default content and loader

// js/content.js (only the defaultItems() and defaultRooms() sections shown changed)

function defaultItems() {
  return {
    // Evolution items
    mirror_shard:   { id:'mirror_shard',   name:'Mirror Shard',    type:'evolution',  price: 25, desc:'A sliver of possibility that reflects who you might be.' },
    quantum_key:    { id:'quantum_key',    name:'Quantum Key',     type:'evolution',  price: 40, desc:'Unlocks doors that exist and don’t.' },
    shadow_lantern: { id:'shadow_lantern', name:'Shadow Lantern',  type:'evolution',  price: 55, desc:'Makes shadows legible.' },
    glyph_memory:   { id:'glyph_memory',   name:'Glyph of Memory', type:'evolution',  price: 70, desc:'A sigil that fixes what fades.' },

    // Consumables
    tea_clarity:    { id:'tea_clarity',    name:'Tea of Clarity',  type:'consumable', price: 10, desc:'+Truth' },
    cat_paradox:    { id:'cat_paradox',    name:"Cat's Paradox",   type:'consumable', price: 12, desc:'+Quantum' },
    ink_of_nyx:     { id:'ink_of_nyx',     name:'Ink of Nyx',      type:'consumable', price: 12, desc:'+Shadow integration' },
    folio_notes:    { id:'folio_notes',    name:'Folio of Notes',  type:'consumable', price: 8,  desc:'+Insight' },

    // NEW: Books
    codex_paths:    { id:'codex_paths',    name:'Codex of Forking Paths', type:'book', price: 30, desc:'A living labyrinth on paper. Opens new routes.' },
    mirror_grimoire:{ id:'mirror_grimoire',name:'Mirror Grimoire',       type:'book', price: 45, desc:'Spells that rearrange what the page believes.' }
  };
}

function defaultRooms() {
  return {
    entrance: {
      name: 'The Library Entrance',
      basePrompt: 'A vast library entrance with quantum properties, doors that exist in superposition',
      exits: { north: 'hall_of_mirrors', east: 'garden_of_forking_paths', west: 'shadow_archive' },
      literary: 'borges',
      items: ['mirror_shard', 'codex_paths']  // add a book here
    },
    hall_of_mirrors: {
      name: 'The Hall of Mirrors',
      basePrompt: 'An infinite hall of mirrors showing different versions of reality, Alice in Wonderland style',
      exits: { south: 'entrance', north: 'quantum_laboratory', east: 'tea_room' },
      literary: 'carroll',
      items: []
    },
    garden_of_forking_paths: {
      name: 'The Garden of Forking Paths',
      basePrompt: 'A garden where every path branches into infinite possibilities, Borges-inspired labyrinth',
      exits: { west: 'entrance', north: 'tea_room', east: 'oracle_chamber' },
      literary: 'borges',
      items: ['folio_notes']
    },
    shadow_archive: {
      name: 'The Shadow Archive',
      basePrompt: 'A dark library containing shadow selves and repressed memories, Jungian psychology',
      exits: { east: 'entrance', north: 'abyss_reading_room' },
      literary: 'jung',
      items: ['shadow_lantern', 'mirror_grimoire'] // another book here
    },
    tea_room: {
      name: 'The Mad Tea Room',
      basePrompt: "A perpetual tea party frozen in time, Mad Hatter's tea party from Alice in Wonderland",
      exits: { south: 'garden_of_forking_paths', west: 'hall_of_mirrors' },
      literary: 'carroll',
      items: [],
      vendor: {
        name: 'The Scribe',
        goods: [
          { item: 'tea_clarity',   price: 10 },
          { item: 'cat_paradox',   price: 12 },
          { item: 'ink_of_nyx',    price: 12 },
          { item: 'folio_notes',   price: 8  },
          // Books purchasable
          { item: 'codex_paths',    price: 30 },
          { item: 'mirror_grimoire',price: 45 }
        ],
        sellbackRate: 0.5
      }
    },
    quantum_laboratory: {
      name: 'The Quantum Laboratory',
      basePrompt: "A laboratory where Schrödinger's cat exists in superposition, quantum physics made visible",
      exits: { south: 'hall_of_mirrors', east: 'oracle_chamber' },
      literary: 'science',
      items: ['quantum_key']
    },
    oracle_chamber: {
      name: 'The Oracle Chamber',
      basePrompt: 'Ancient temple meets quantum uncertainty, Oracle speaks in superpositions, Eastern philosophy',
      exits: { west: 'garden_of_forking_paths', north: 'quantum_laboratory' },
      literary: 'eastern',
      items: ['glyph_memory']
    },
    abyss_reading_room: {
      name: 'The Abyss Reading Room',
      basePrompt: 'A void library where unwritten books exist, Nietzschean abyss that gazes back',
      exits: { south: 'shadow_archive' },
      literary: 'philosophy',
      items: []
    }
  };
}
export const defaultScenes = [
  { text: 'The threshold observes you before you observe it.\n\nHow do you approach the unknown?', choices: [
    { text: 'Rush forward into mystery', value: 'active' },
    { text: 'Study the patterns first', value: 'contemplative' },
    { text: 'Feel for the right moment', value: 'intuitive' },
    { text: 'Test each step carefully', value: 'cautious' }
  ]},
  { text: "Three paths appear, but you sense they're choosing you:\n\n- Stairs descending into your fears\n- Light bridge over infinite void\n- Familiar hall that shouldn't exist\n\nWhich accepts you?", choices: [
    { text: 'The descent into shadow', value: 'shadow-seeker' },
    { text: 'The bridge of faith', value: 'faith-walker' },
    { text: 'The impossible familiar', value: 'comfort-drawn' },
    { text: 'Wait for them to choose', value: 'observer' }
  ]},
  { text: "Mirrors show not reflections but possibilities:\n\n- A hero you'll never be\n- A child you've forgotten\n- A shadow wearing your face\n- An elder remembering your future\n\nWhich is most true?", choices: [
    { text: 'The impossible hero', value: 'idealized' },
    { text: 'The forgotten child', value: 'vulnerable' },
    { text: 'The familiar shadow', value: 'integrated' },
    { text: 'The future memory', value: 'wisdom' }
  ]},
  { text: 'A book burns with your forgotten moments.\nThe fire reveals rather than destroys.\n\nWhat do you do with your hidden self?', choices: [
    { text: 'Read every burning word', value: 'full-integration' },
    { text: 'Let the fire cleanse', value: 'rejection' },
    { text: 'Save one essential page', value: 'partial-integration' },
    { text: 'Add new pages to burn', value: 'shadow-work' }
  ]},
  { text: 'The Library asks for your true name.\nNot given, not chosen, but the one that resonates in quantum space.', choices: [
    { text: 'Speak it into being', value: 'named', input: true },
    { text: 'Remain undefined', value: 'unnamed' }
  ]}
];

// attempt to fetch JSON files that override/extend defaults
async function maybeFetchJSON(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function loadContent() {
  const [roomsOverride, scenesOverride] = await Promise.all([
    maybeFetchJSON('./rooms.json'),
    maybeFetchJSON('./scenes.json')
  ]);

  const rooms = { ...defaultRooms, ...(roomsOverride || {}) };
  const scenes = Array.isArray(scenesOverride) && scenesOverride.length ? scenesOverride : defaultScenes;

  return { rooms, scenes };
}
