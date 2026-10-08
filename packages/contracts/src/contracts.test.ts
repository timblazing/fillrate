import { expect, test } from "vitest";
import fixtures from "../fixtures/envelopes.json";
import { parseContract } from "./index";
test("same fixture round-trips through generated TypeScript validators and Python", () => {
  expect(parseContract("Snapshot", fixtures.snapshot)).toEqual(fixtures.snapshot);
});
