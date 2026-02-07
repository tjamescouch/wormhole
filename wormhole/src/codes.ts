/**
 * Memorable transfer code generation.
 *
 * Format: {number}-{word}-{word}
 * Example: 42-banana-thunder
 *
 * ~656K combinations (999 * 26^2 word pairs from 500-word list).
 */

import crypto from 'node:crypto';

// 500 common English nouns — easy to spell, easy to say
const WORDS = [
  'acid', 'acorn', 'acre', 'agent', 'album', 'alert', 'alien', 'alley', 'amber', 'angel',
  'angle', 'ankle', 'anvil', 'apple', 'apron', 'arena', 'atlas', 'axle', 'badge', 'bagel',
  'baker', 'balm', 'bamboo', 'banjo', 'barn', 'baron', 'basin', 'batch', 'beach', 'beard',
  'beast', 'bench', 'berry', 'birch', 'blade', 'blank', 'blast', 'blaze', 'bloom', 'bluff',
  'board', 'booth', 'boulder', 'brain', 'brass', 'brave', 'brick', 'bridge', 'brisk', 'brook',
  'brush', 'bubble', 'bucket', 'buddy', 'buggy', 'bunny', 'cabin', 'cable', 'camel', 'candy',
  'canoe', 'cargo', 'cedar', 'chain', 'chalk', 'charm', 'chase', 'chess', 'chill', 'china',
  'choir', 'chunk', 'cider', 'cigar', 'circle', 'civic', 'claim', 'clamp', 'clash', 'cliff',
  'climb', 'clock', 'cloud', 'clown', 'coach', 'cobra', 'cocoa', 'comet', 'coral', 'couch',
  'crane', 'crash', 'crest', 'crisp', 'cross', 'crowd', 'crown', 'crush', 'curve', 'cycle',
  'dagger', 'dairy', 'dance', 'delta', 'demon', 'derby', 'diary', 'ditch', 'dodge', 'donut',
  'draft', 'dragon', 'drama', 'dream', 'drift', 'drill', 'drone', 'drum', 'dune', 'dwarf',
  'eagle', 'earth', 'easel', 'eclipse', 'elder', 'ember', 'emoji', 'epoch', 'equip', 'event',
  'exile', 'fable', 'faith', 'falcon', 'feast', 'fence', 'ferry', 'fiber', 'field', 'flame',
  'flash', 'fleet', 'flint', 'float', 'flood', 'flora', 'flute', 'focus', 'forge', 'forum',
  'fossil', 'fox', 'frame', 'frost', 'fruit', 'fudge', 'fungi', 'fury', 'galaxy', 'gamma',
  'garden', 'garlic', 'gauge', 'gavel', 'ghost', 'giant', 'ginger', 'glacier', 'glaze', 'globe',
  'glove', 'glyph', 'goat', 'goblet', 'grace', 'grain', 'grape', 'gravel', 'green', 'grill',
  'grove', 'guard', 'guild', 'guitar', 'gypsy', 'habit', 'hammer', 'harbor', 'haven', 'hawk',
  'hazel', 'heart', 'hedge', 'heron', 'honey', 'honor', 'horse', 'hotel', 'humor', 'hydra',
  'ivory', 'jacket', 'jade', 'jaguar', 'jewel', 'joker', 'judge', 'juice', 'jungle', 'karma',
  'kayak', 'kernel', 'kiosk', 'knight', 'knob', 'label', 'lace', 'lake', 'lance', 'lantern',
  'larch', 'laser', 'latch', 'lava', 'leaf', 'ledge', 'lemon', 'lens', 'lever', 'light',
  'lilac', 'linen', 'lion', 'llama', 'lodge', 'lotus', 'lunar', 'lunch', 'mango', 'manor',
  'maple', 'marsh', 'mason', 'match', 'maze', 'medal', 'melon', 'mesa', 'metal', 'micro',
  'miner', 'mint', 'moat', 'model', 'molar', 'money', 'moose', 'morph', 'moth', 'motor',
  'mount', 'mouse', 'mural', 'music', 'myth', 'navel', 'nerve', 'nexus', 'noble', 'north',
  'notch', 'novel', 'nudge', 'oasis', 'ocean', 'olive', 'omega', 'onion', 'opera', 'orbit',
  'organ', 'otter', 'outer', 'oxide', 'oyster', 'panda', 'panel', 'paper', 'park', 'patch',
  'pearl', 'pedal', 'penny', 'petal', 'phase', 'piano', 'pilot', 'pinch', 'pixel', 'pizza',
  'plank', 'plant', 'plaza', 'plumb', 'plume', 'poach', 'polar', 'pond', 'porch', 'pouch',
  'pound', 'prism', 'probe', 'prong', 'prose', 'proud', 'prune', 'pulse', 'punch', 'pupil',
  'quail', 'quake', 'query', 'quest', 'quill', 'quota', 'radar', 'radio', 'raven', 'realm',
  'ridge', 'rivet', 'robin', 'robot', 'rogue', 'roost', 'rover', 'ruby', 'rugby', 'rumor',
  'salad', 'salon', 'salsa', 'sandy', 'sauce', 'sauna', 'scale', 'scout', 'shark', 'shelf',
  'shell', 'shift', 'shirt', 'shock', 'shore', 'shrub', 'sigma', 'silk', 'siren', 'skull',
  'slate', 'sleek', 'slice', 'slope', 'smoke', 'snail', 'snake', 'solar', 'sonic', 'space',
  'spark', 'spear', 'spice', 'spike', 'spine', 'spoke', 'spoon', 'spray', 'squid', 'staff',
  'stage', 'stake', 'stamp', 'steam', 'steel', 'steep', 'steer', 'stern', 'stone', 'stork',
  'storm', 'stove', 'straw', 'sugar', 'surge', 'swamp', 'swarm', 'swift', 'sword', 'syrup',
  'table', 'talon', 'tango', 'thorn', 'tiara', 'tidal', 'tiger', 'toast', 'topaz', 'torch',
  'tower', 'trace', 'trail', 'train', 'tramp', 'trend', 'tribe', 'trick', 'trout', 'truck',
  'tulip', 'tumor', 'tundra', 'turbo', 'turf', 'tweed', 'ultra', 'umber', 'unity', 'urban',
  'usher', 'valve', 'vault', 'venom', 'verse', 'vigor', 'villa', 'viola', 'viper', 'vivid',
  'vocal', 'vodka', 'vortex', 'wafer', 'wagon', 'waltz', 'watch', 'water', 'whale', 'wheat',
  'wheel', 'whirl', 'widow', 'wings', 'witch', 'wizard', 'world', 'wound', 'wrist', 'yacht',
  'yield', 'zebra', 'zinc', 'cozy', 'haze', 'dome', 'pine', 'reef', 'sage', 'tide',
  'vine', 'wren', 'yoke', 'zone', 'arch', 'bolt', 'cape', 'claw', 'cone', 'cork',
  'dusk', 'elm', 'fang', 'fern', 'fist', 'gale', 'gem', 'glen', 'harp', 'helm',
  'hive', 'hull', 'iris', 'isle', 'jolt', 'kelp', 'kiln', 'knot', 'lamp', 'lark',
];

export function generateCode(): string {
  const num = crypto.randomInt(1, 1000); // 1-999
  const w1 = WORDS[crypto.randomInt(WORDS.length)];
  let w2 = WORDS[crypto.randomInt(WORDS.length)];
  while (w2 === w1) {
    w2 = WORDS[crypto.randomInt(WORDS.length)];
  }
  return `${num}-${w1}-${w2}`;
}

export function parseCode(code: string): { number: number; word1: string; word2: string } | null {
  const match = code.match(/^(\d+)-([a-z]+)-([a-z]+)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num < 1 || num > 999) return null;
  return { number: num, word1: match[2], word2: match[3] };
}

export function isValidCode(code: string): boolean {
  return parseCode(code) !== null;
}

export { WORDS };
