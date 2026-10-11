import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner requires the explicit file extension.
import { createMusicPlaylist, OPENING_MUSIC_URL, SHUFFLED_MUSIC_URLS } from "../lib/music-playlist.ts";

test("the original opens each fresh playlist, followed by all five additions before repeats", () => {
  const playlist = createMusicPlaylist(() => 0.5);
  assert.equal(playlist.current(), OPENING_MUSIC_URL);
  for (let batch = 0; batch < 20; batch++) {
    const songs = Array.from({ length: 5 }, () => playlist.next());
    assert.equal(new Set(songs).size, 5);
    assert.deepEqual([...songs].sort(), [...SHUFFLED_MUSIC_URLS].sort());
    assert.ok(!songs.includes(OPENING_MUSIC_URL));
  }
  assert.equal(createMusicPlaylist().current(), OPENING_MUSIC_URL);
});

test("a reshuffle never repeats the preceding song at the batch boundary", () => {
  for (const random of [() => 0, () => 0.5, () => 0.999999]) {
    const playlist = createMusicPlaylist(random);
    let previous = playlist.current();
    for (let song = 0; song < 100; song++) {
      const next = playlist.next();
      assert.notEqual(next, previous);
      previous = next!;
    }
  }
});

test("random input changes the order without changing the available songs", () => {
  const first = createMusicPlaylist(() => 0);
  const second = createMusicPlaylist(() => 0.999999);
  assert.notDeepEqual(
    Array.from({ length: 5 }, () => first.next()),
    Array.from({ length: 5 }, () => second.next()),
  );
});

test("unavailable songs are removed from queued and future batches with a bounded empty result", () => {
  const playlist = createMusicPlaylist(() => 0.999999);
  assert.equal(playlist.next(), SHUFFLED_MUSIC_URLS[0]);
  const unavailable = new Set<string>([SHUFFLED_MUSIC_URLS[1], SHUFFLED_MUSIC_URLS[3]]);
  const remaining = [SHUFFLED_MUSIC_URLS[0], SHUFFLED_MUSIC_URLS[2], SHUFFLED_MUSIC_URLS[4]];
  for (let song = 0; song < 20; song++) assert.ok(remaining.includes(playlist.next(unavailable)! as typeof remaining[number]));
  for (const song of SHUFFLED_MUSIC_URLS) unavailable.add(song);
  assert.equal(playlist.next(unavailable), null);
  assert.equal(playlist.next(unavailable), null);
});
