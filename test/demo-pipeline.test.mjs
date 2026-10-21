import test from "node:test";
import assert from "node:assert/strict";
import { captureUrl } from "../scripts/record-demo.mjs";
import { synthesizeScore } from "../scripts/render-score.mjs";

test("capture URL preserves existing query parameters and fixes the requested seed", () => {
  const url = new URL(captureUrl("https://example.test/game?lang=en&seed=old", 42));
  assert.equal(url.searchParams.get("record"), "");
  assert.equal(url.searchParams.get("bot"), "");
  assert.equal(url.searchParams.get("seed"), "42");
  assert.equal(url.searchParams.get("lang"), "en");
});

test("score synthesis is deterministic and includes a timed event stinger", () => {
  const event = [{ type: "shot", timeSeconds: 0.1 }];
  const first = synthesizeScore(event, 0.25, 8_000);
  const second = synthesizeScore(event, 0.25, 8_000);
  const droneOnly = synthesizeScore([], 0.25, 8_000);
  assert.deepEqual(first, second);
  assert.equal(first.toString("ascii", 0, 4), "RIFF");
  assert.notDeepEqual(first, droneOnly);
});

test("unknown score events do not break WAV rendering", () => {
  const wav = synthesizeScore([{ type: "not-mapped", timeSeconds: 0 }], 0.1, 8_000);
  assert.equal(wav.readUInt32LE(40), 8_000 * 0.1 * 4);
});
