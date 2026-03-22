import { expect, test } from "bun:test"
import {
  FixedViaHypergraphSolver,
  createViaGraphWithConnections,
  generateViaTopologyRegions,
} from "../lib"
import type { ViaTile } from "../lib/type"

test("FixedViaHypergraphSolver: solves a basic 3-connection perimeter case", () => {
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

  const baseGraph = generateViaTopologyRegions(viaTile, {
    graphSize: 5,
    idPrefix: "via",
  })

  const graphWithConnections = createViaGraphWithConnections(baseGraph, [
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
  ])

  const solver = new FixedViaHypergraphSolver({
    inputGraph: {
      regions: graphWithConnections.regions,
      ports: graphWithConnections.ports,
    },
    inputConnections: graphWithConnections.connections,
    viaTile,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes.length).toBe(3)
})
