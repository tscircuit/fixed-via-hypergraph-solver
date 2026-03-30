import { expect, test } from "bun:test"
import { FixedViaHypergraphSolver, type ViaTile } from "../lib"

test("bootstrap smoke: test runner is configured", () => {
  expect(FixedViaHypergraphSolver).toBeDefined()
  const tile: ViaTile = { viasByNet: {}, routeSegments: [] }
  expect(tile.viasByNet).toBeDefined()
})
