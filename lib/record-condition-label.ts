import type { SharedRecord } from '../db/records';

/** Safe comparison labels for public records, with older saved-share fallbacks. */
export function sharedConditionLines(conditions: SharedRecord['conditions']): string[] {
  const startingSeat = conditions.startingSeat ?? 0;
  const order = conditions.turnOrderSeat ?? (conditions.seat - startingSeat + conditions.playerCount) % conditions.playerCount;
  return [
    `${conditions.format.replaceAll('-', ' ')} | ${conditions.deal} deal | ${conditions.playerCount} players (${conditions.humanCount} human${conditions.humanCount === 1 ? '' : 's'})`,
    `${conditions.ai.length ? `AI: ${conditions.ai.join(', ')}` : 'No AI'} | Hints ${conditions.hints ? 'on' : 'off'} | ${conditions.timerSeconds ? `${conditions.timerSeconds}s turns` : 'No turn timer'}`,
    `Seat ${conditions.seat + 1} | Seat ${startingSeat + 1} starts | Turn order ${order + 1}/${conditions.playerCount} | ${conditions.engineVersion}`,
  ];
}
