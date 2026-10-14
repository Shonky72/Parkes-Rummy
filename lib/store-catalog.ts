export const FONT_STYLES = {
  default: { label: 'Standard', family: 'Arial', stack: 'Arial, sans-serif', group: 'Clean' },
  classic: { label: 'Classic', family: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", group: 'Classic' },
  rounded: { label: 'Rounded', family: 'Nunito', stack: "'Nunito', Arial, sans-serif", group: 'Friendly' },
  mono: { label: 'Monospace', family: 'Roboto Mono', stack: "'Roboto Mono', monospace", group: 'Clean' },
  elegant: { label: 'Elegant', family: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", group: 'Classic' },
  slab: { label: 'Slab', family: 'Roboto Slab', stack: "'Roboto Slab', Georgia, serif", group: 'Classic' },
  geometric: { label: 'Geometric', family: 'Montserrat', stack: "'Montserrat', Arial, sans-serif", group: 'Clean' },
  condensed: { label: 'Condensed', family: 'Oswald', stack: "'Oswald', Arial, sans-serif", group: 'Bold' },
  script: { label: 'Script', family: 'Dancing Script', stack: "'Dancing Script', cursive", group: 'Handwritten' },
  handwritten: { label: 'Handwritten', family: 'Caveat', stack: "'Caveat', cursive", group: 'Handwritten' },
  signature: { label: 'Signature', family: 'Great Vibes', stack: "'Great Vibes', cursive", group: 'Handwritten' },
  artdeco: { label: 'Art Deco', family: 'Poiret One', stack: "'Poiret One', sans-serif", group: 'Classic' },
  medieval: { label: 'Medieval', family: 'UnifrakturCook', stack: "'UnifrakturCook', serif", group: 'Character' },
  arcade: { label: 'Arcade', family: 'Press Start 2P', stack: "'Press Start 2P', monospace", group: 'Character' },
  retro: { label: 'Retro', family: 'Righteous', stack: "'Righteous', sans-serif", group: 'Character' },
  futuristic: { label: 'Futuristic', family: 'Orbitron', stack: "'Orbitron', sans-serif", group: 'Character' },
  western: { label: 'Western', family: 'Rye', stack: "'Rye', serif", group: 'Character' },
  cinematic: { label: 'Cinematic', family: 'Cinzel', stack: "'Cinzel', serif", group: 'Classic' },
  friendly: { label: 'Friendly', family: 'Quicksand', stack: "'Quicksand', sans-serif", group: 'Friendly' },
  bold: { label: 'Bold', family: 'Bungee', stack: "'Bungee', sans-serif", group: 'Bold' },
  minimal: { label: 'Minimal', family: 'Raleway', stack: "'Raleway', sans-serif", group: 'Clean' },
} as const;

export const PLAYER_SYMBOLS = {
  initials: { label: 'Initials', symbol: '', group: 'Free' },
  heart: { label: 'Heart', symbol: '♥', group: 'Cards' }, diamond: { label: 'Diamond', symbol: '♦', group: 'Cards' },
  club: { label: 'Club', symbol: '♣', group: 'Cards' }, spade: { label: 'Spade', symbol: '♠', group: 'Cards' },
  star: { label: 'Star', symbol: '★', group: 'Gold' }, sparkle: { label: 'Sparkle', symbol: '✦', group: 'Gold' },
  burst: { label: 'Starburst', symbol: '✹', group: 'Gold' }, crown: { label: 'Crown', symbol: '♛', group: 'Gold' },
  rook: { label: 'Rook', symbol: '♜', group: 'Games' }, knight: { label: 'Knight', symbol: '♞', group: 'Games' },
  king: { label: 'King', symbol: '♚', group: 'Games' }, queen: { label: 'Queen', symbol: '♕', group: 'Games' },
  pawn: { label: 'Pawn', symbol: '♟', group: 'Games' }, dice: { label: 'Dice', symbol: '⚄', group: 'Games' },
  sun: { label: 'Sun', symbol: '☀', group: 'Nature' }, moon: { label: 'Moon', symbol: '☾', group: 'Nature' },
  lightning: { label: 'Lightning', symbol: 'ϟ', group: 'Nature' }, snowflake: { label: 'Snowflake', symbol: '❄', group: 'Nature' },
  flower: { label: 'Flower', symbol: '✿', group: 'Nature' }, leaf: { label: 'Leaf', symbol: '❧', group: 'Nature' },
  comet: { label: 'Comet', symbol: '☄', group: 'Nature' }, mountain: { label: 'Mountain', symbol: '▲', group: 'Adventure' },
  wave: { label: 'Waves', symbol: '≋', group: 'Adventure' }, compass: { label: 'Compass', symbol: '✥', group: 'Adventure' },
  anchor: { label: 'Anchor', symbol: '⚓', group: 'Adventure' }, infinity: { label: 'Infinity', symbol: '∞', group: 'Shapes' },
  gem: { label: 'Gem', symbol: '◇', group: 'Shapes' }, hexagon: { label: 'Hexagon', symbol: '⬡', group: 'Shapes' },
  circle: { label: 'Circle', symbol: '◉', group: 'Shapes' }, target: { label: 'Target', symbol: '◎', group: 'Shapes' },
  shield: { label: 'Shield', symbol: '⛨', group: 'Shapes' }, music: { label: 'Music', symbol: '♫', group: 'Symbols' },
  note: { label: 'Note', symbol: '♪', group: 'Symbols' }, treble: { label: 'Treble', symbol: '𝄞', group: 'Symbols' },
  hourglass: { label: 'Hourglass', symbol: '⌛', group: 'Symbols' }, key: { label: 'Key', symbol: '⚿', group: 'Symbols' },
  peace: { label: 'Peace', symbol: '☮', group: 'Symbols' }, balance: { label: 'Balance', symbol: '☯', group: 'Symbols' },
  atom: { label: 'Atom', symbol: '⚛', group: 'Symbols' }, gear: { label: 'Gear', symbol: '⚙', group: 'Symbols' },
} as const;

export type FontId = keyof typeof FONT_STYLES;
export type SymbolId = keyof typeof PLAYER_SYMBOLS;
export type StoreProductKey = 'remove_ads' | 'fonts_pack' | 'symbols_pack' | 'voice_access' | 'original_rules' | 'everything_pack';
export type EntitlementKey = 'remove_ads' | 'premium_fonts' | 'premium_symbols' | 'voice_chat' | 'original_rules';
export interface PlayerProfile { font: FontId; symbol: SymbolId }

export const STORE_PRODUCTS: Readonly<Record<StoreProductKey, { label: string; amount: number; env: string; grants: readonly EntitlementKey[]; description: string }>> = {
  remove_ads: { label: 'Remove Ads', amount: 199, env: 'STRIPE_REMOVE_ADS_PRICE_ID', grants: ['remove_ads'], description: 'Never see Parkes Rummy ads again.' },
  fonts_pack: { label: 'Fonts Pack', amount: 199, env: 'STRIPE_FONTS_PRICE_ID', grants: ['premium_fonts'], description: 'Unlock all premium player-name styles.' },
  symbols_pack: { label: 'Symbols Pack', amount: 199, env: 'STRIPE_SYMBOLS_PRICE_ID', grants: ['premium_symbols'], description: 'Unlock the full player-symbol collection.' },
  voice_access: { label: 'Voice Chat', amount: 299, env: 'STRIPE_VOICE_PRICE_ID', grants: ['voice_chat'], description: 'Unlock table voice chat for this account.' },
  original_rules: { label: 'Original Rules', amount: 99, env: 'STRIPE_ORIGINAL_RULES_PRICE_ID', grants: ['original_rules'], description: 'Host the original ten Parkes house rules. Friends you invite can join without owning them.' },
  everything_pack: { label: 'Everything Pack', amount: 599, env: 'STRIPE_ALL_IN_ONE_PRICE_ID', grants: ['remove_ads','premium_fonts','premium_symbols','voice_chat','original_rules'], description: 'Remove Ads, all fonts, all symbols, Voice Chat and Original Rules.' },
};


export const DEFAULT_LIVE_PRICE_IDS: Readonly<Record<StoreProductKey,string>> = {
  remove_ads: 'price_1UOzkSFkx7dvBVlWXMfgzlEC',
  fonts_pack: 'price_1UPMOxFkx7dvBVlWPQpxb21c',
  symbols_pack: 'price_1UPMOzFkx7dvBVlWhbqWjYqy',
  voice_access: 'price_1UPMP2Fkx7dvBVlW684l2IBD',
  original_rules: 'price_1UQOjeFkx7dvBVlW7Y7jH1AK',
  everything_pack: 'price_1UPMP4Fkx7dvBVlWAWwLmICZ',
};
export const FONT_IDS = Object.keys(FONT_STYLES) as FontId[];
export const SYMBOL_IDS = Object.keys(PLAYER_SYMBOLS) as SymbolId[];
export const PREMIUM_FONT_IDS = FONT_IDS.filter(id => id !== 'default');
export const PREMIUM_SYMBOL_IDS = SYMBOL_IDS.filter(id => id !== 'initials');

export function productPriceId(key: StoreProductKey, environment: Record<string,string|undefined> = process.env) {
  const id = environment[STORE_PRODUCTS[key].env]?.trim() || DEFAULT_LIVE_PRICE_IDS[key];
  if (!/^price_[A-Za-z0-9]+$/.test(id)) return null;
  return id;
}
export function productFromPriceId(priceId: string, environment: Record<string,string|undefined> = process.env): StoreProductKey | null {
  for (const key of Object.keys(STORE_PRODUCTS) as StoreProductKey[]) if (productPriceId(key, environment) === priceId) return key;
  return null;
}
export function fontCssUrl(ids: readonly FontId[] = FONT_IDS): string {
  const families = [...new Set(ids.filter(id => id !== 'default').map(id => FONT_STYLES[id].family))].sort();
  return 'https://fonts.googleapis.com/css2?' + families.map(f => `family=${encodeURIComponent(f)}${f === 'UnifrakturCook' ? ':wght@700' : ''}`).join('&') + '&display=swap';
}
export function isFontId(value: string): value is FontId { return Object.hasOwn(FONT_STYLES, value); }
export function isSymbolId(value: string): value is SymbolId { return Object.hasOwn(PLAYER_SYMBOLS, value); }
