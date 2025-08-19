// content.js — default content and loader

export const defaultRooms = {
  entrance: {
    name: 'The Library Entrance',
    basePrompt: 'A vast library entrance with quantum properties, doors that exist in superposition',
    exits: { north: 'hall_of_mirrors', east: 'garden_of_forking_paths', west: 'shadow_archive' },
    literary: 'borges',
    items: ['Quantum Key']
  },
  hall_of_mirrors: {
    name: 'The Hall of Mirrors',
    basePrompt: 'An infinite hall of mirrors showing different versions of reality, Alice in Wonderland style',
    exits: { south: 'entrance', north: 'quantum_laboratory', east: 'tea_room' },
    literary: 'carroll',
    items: ['Mirror Shard']
  },
  garden_of_forking_paths: {
    name: 'The Garden of Forking Paths',
    basePrompt: 'A garden where every path branches into infinite possibilities, Borges-inspired labyrinth',
    exits: { west: 'entrance', north: 'tea_room', east: 'oracle_chamber' },
    literary: 'borges'
  },
  shadow_archive: {
    name: 'The Shadow Archive',
    basePrompt: 'A dark library containing shadow selves and repressed memories, Jungian psychology',
    exits: { east: 'entrance', north: 'abyss_reading_room' },
    literary: 'jung',
    items: ['Shadow Lantern']
  },
  tea_room: {
    name: 'The Mad Tea Room',
    basePrompt: "A perpetual tea party frozen in time, Mad Hatter's tea party from Alice in Wonderland",
    exits: { south: 'garden_of_forking_paths', west: 'hall_of_mirrors' },
    literary: 'carroll'
  },
  quantum_laboratory: {
    name: 'The Quantum Laboratory',
    basePrompt: "A laboratory where Schrödinger's cat exists in superposition, quantum physics made visible",
    exits: { south: 'hall_of_mirrors', east: 'oracle_chamber' },
    literary: 'science'
  },
  oracle_chamber: {
    name: 'The Oracle Chamber',
    basePrompt: 'Ancient temple meets quantum uncertainty, Oracle speaks in superpositions, Eastern philosophy',
    exits: { west: 'garden_of_forking_paths', north: 'quantum_laboratory' },
    literary: 'eastern'
  },
  abyss_reading_room: {
    name: 'The Abyss Reading Room',
    basePrompt: 'A void library where unwritten books exist, Nietzschean abyss that gazes back',
    exits: { south: 'shadow_archive' },
    literary: 'philosophy'
  }
};

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
