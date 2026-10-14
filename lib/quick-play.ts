import type { Difficulty, GameType } from './types';

export interface QuickPlaySetup {
  /** One full game/ruleset, starting at Rule 1 with the normal progression. */
  game: GameType;
  /** Between one and seven computer players. Only one is ever Hard. */
  difficulties: Difficulty[];
}

function randomBelow(max: number): number {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Invalid random range');
  const limit = 0x100000000 - (0x100000000 % max);
  const bytes = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}

/**
 * Select a complete Parkes Rummy ruleset and computer opponents.
 * Purchasing Original Rules changes only the possible game choices.
 * The caller must check the entitlement on the server, not the browser.
 */
export function chooseQuickPlaySetup(
  originalRulesUnlocked: boolean,
  random: (max: number) => number = randomBelow,
): QuickPlaySetup {
  const index = (max: number) => {
    const result = random(max);
    if (!Number.isInteger(result) || result < 0 || result >= max) throw new RangeError('Invalid random index');
    return result;
  };
  const games: GameType[] = originalRulesUnlocked ? [1, 2, 3, 4] : [1, 2, 3];
  const game = games[index(games.length)];
  const botCount = 1 + index(7);
  const difficulties: Difficulty[] = [];
  let hasHard = false;

  for (let n = 0; n < botCount; n++) {
    const available: Difficulty[] = hasHard ? ['easy', 'medium'] : ['easy', 'medium', 'hard'];
    const chosen = available[index(available.length)];
    difficulties.push(chosen);
    if (chosen === 'hard') hasHard = true;
  }
  return { game, difficulties };
}
