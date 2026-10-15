import type { Difficulty, GameType } from './types';

export interface QuickPlaySetup {
  game: GameType;
  /** Everyone plays this one random rule. Quick Play finishes after one hand. */
  ruleNumber: number;
  /** One to three computer players. At most one is Hard. */
  difficulties: Difficulty[];
}
function randomBelow(max: number): number {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Invalid random range');
  const limit = 0x100000000 - (0x100000000 % max);
  const bytes = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}
/** All choices happen server-side, after checking Original Rules ownership. */
export function chooseQuickPlaySetup(originalRulesUnlocked: boolean, random: (max: number) => number = randomBelow): QuickPlaySetup {
  const index = (max: number) => {
    const result = random(max);
    if (!Number.isInteger(result) || result < 0 || result >= max) throw new RangeError('Invalid random index');
    return result;
  };
  const games: GameType[] = originalRulesUnlocked ? [1, 2, 3, 4] : [1, 2, 3];
  const game = games[index(games.length)];
  const ruleNumber = 1 + index(10);
  const botCount = 1 + index(3);
  const difficulties: Difficulty[] = [];
  let hasHard = false;
  for (let n = 0; n < botCount; n++) {
    const available: Difficulty[] = hasHard ? ['easy', 'medium'] : ['easy', 'medium', 'hard'];
    const chosen = available[index(available.length)];
    difficulties.push(chosen);
    if (chosen === 'hard') hasHard = true;
  }
  return { game, ruleNumber, difficulties };
}
