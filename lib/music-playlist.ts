export const OPENING_MUSIC_URL = "/audio/three-note-motif.mp3";

export const SHUFFLED_MUSIC_URLS = [
  "/audio/motivo-de-piano.mp3",
  "/audio/untitled-2.mp3",
  "/audio/three-note-motif-3.mp3",
  "/audio/untitled.mp3",
  "/audio/three-note-motif-2.mp3",
] as const;

/** One opening song per page, followed by shuffled batches of the added songs. */
export function createMusicPlaylist(random: () => number = Math.random) {
  let current: string = OPENING_MUSIC_URL;
  let remaining: string[] = [];

  return {
    current: () => current,
    next(unavailable: ReadonlySet<string> = new Set()): string | null {
      remaining = remaining.filter((url) => !unavailable.has(url));
      if (remaining.length === 0) {
        remaining = SHUFFLED_MUSIC_URLS.filter((url) => !unavailable.has(url));
        if (remaining.length === 0) return null;
        for (let index = remaining.length - 1; index > 0; index--) {
          const swap = Math.floor(random() * (index + 1));
          [remaining[index], remaining[swap]] = [remaining[swap], remaining[index]];
        }
        // Keep the end of one batch different from the start of the next.
        if (remaining.length > 1 && remaining[0] === current) {
          const swap = 1 + Math.floor(random() * (remaining.length - 1));
          [remaining[0], remaining[swap]] = [remaining[swap], remaining[0]];
        }
      }
      current = remaining.shift()!;
      return current;
    },
  };
}
