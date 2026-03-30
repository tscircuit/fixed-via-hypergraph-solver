import { expect, test } from "bun:test"
import { FixedViaHypergraphSolver } from "../lib"
import type { ViaTile, XYConnection } from "../lib/type"

const basicInputConnections: XYConnection[] = [
  {
    start: { x: -2.5, y: 1.0 },
    end: { x: 2.5, y: -1.0 },
    connectionId: "A",
  },
  {
    start: { x: 0, y: 2.5 },
    end: { x: -2.5, y: -1.0 },
    connectionId: "B",
  },
  {
    start: { x: 0, y: -2.5 },
    end: { x: 2.5, y: 1.0 },
    connectionId: "C",
  },
]

test("FixedViaHypergraphSolver: explicit viaTile override in auto mode", () => {
  const viaTile: ViaTile = {
    viasByNet: {
      A: [{ viaId: "A1", diameter: 0.6, position: { x: -0.8, y: 0.8 } }],
      B: [{ viaId: "B1", diameter: 0.6, position: { x: 0.8, y: 0.8 } }],
      C: [{ viaId: "C1", diameter: 0.6, position: { x: -0.8, y: -0.8 } }],
      D: [{ viaId: "D1", diameter: 0.6, position: { x: 0.8, y: -0.8 } }],
    },
    routeSegments: [
      {
        routeId: "seg-ab",
        fromPort: "A1",
        toPort: "B1",
        layer: "bottom",
        segments: [
          { x: -0.8, y: 0.8 },
          { x: 0.8, y: 0.8 },
        ],
      },
      {
        routeId: "seg-cd",
        fromPort: "C1",
        toPort: "D1",
        layer: "bottom",
        segments: [
          { x: -0.8, y: -0.8 },
          { x: 0.8, y: -0.8 },
        ],
      },
    ],
    tileWidth: 2.4,
    tileHeight: 2.4,
  }

  const solver = new FixedViaHypergraphSolver({
    inputConnections: basicInputConnections,
    viaTile,
    options: {
      graph: {
        tileWidth: viaTile.tileWidth,
        tileHeight: viaTile.tileHeight,
      },
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes.length).toBe(3)
  const allVias = Object.values(solver.viaTile?.viasByNet ?? {}).flat()
  expect(allVias.length).toBeGreaterThan(0)
  expect(allVias.every((via) => Math.abs(via.diameter - 0.6) < 1e-6)).toBe(true)
})

test("FixedViaHypergraphSolver: auto-selects viaTile when none is provided", () => {
  const solver = new FixedViaHypergraphSolver({
    inputConnections: basicInputConnections,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(3)
  expect(solver.viaTile).toBeDefined()
  expect(
    Object.values(solver.viaTile?.viasByNet ?? {}).flat().length,
  ).toBeGreaterThan(0)
})
