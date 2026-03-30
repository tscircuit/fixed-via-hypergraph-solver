# @tscircuit/fixed-via-hypergraph-solver

A TypeScript package for fixed via-tile hypergraph routing.

## Overview

This package provides:

- `FixedViaHypergraphSolver` for solving via-graph routing problems.
- Via graph builders for fixed tiles and XY connection inputs.
- Shared type contracts from `lib/type.ts`.

## Installation

Install directly from GitHub and pin to a commit SHA:

Note: the SHA below is only an example. Replace it with the exact commit you want to pin.

```json
{
  "dependencies": {
    "@tscircuit/fixed-via-hypergraph-solver": "git+https://github.com/tscircuit/fixed-via-hypergraph-solver.git#1c48988"
  }
}
```

With Bun:

```bash
bun add git+https://github.com/tscircuit/fixed-via-hypergraph-solver.git#1c48988
```

## Usage

```ts
import {
  FixedViaHypergraphSolver,
  type ViaTile,
} from "@tscircuit/fixed-via-hypergraph-solver"

const solver = new FixedViaHypergraphSolver({
  inputConnections: [
    {
      connectionId: "A",
      start: { x: -2.5, y: 1.0 },
      end: { x: 2.5, y: -1.0 },
    },
  ],
})

solver.solve()
console.log(solver.solved)
```

Optional deterministic override with `viaTile`:

```ts
const viaTile: ViaTile = {
  viasByNet: {
    A: [{ viaId: "A1", diameter: 0.6, position: { x: -0.8, y: 0.8 } }],
    B: [{ viaId: "B1", diameter: 0.6, position: { x: 0.8, y: 0.8 } }],
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
  ],
  tileWidth: 2.4,
  tileHeight: 2.4,
}

const solver = new FixedViaHypergraphSolver({
  inputConnections: [
    {
      connectionId: "A",
      start: { x: -2.5, y: 1.0 },
      end: { x: 2.5, y: -1.0 },
    },
  ],
  viaTile,
})
```

Advanced tuning with nested `options`:

```ts
const solver = new FixedViaHypergraphSolver({
  inputConnections: [
    {
      connectionId: "A",
      start: { x: -2.5, y: 1.0 },
      end: { x: 2.5, y: -1.0 },
    },
  ],
  viaTile,
  options: {
    graph: {
      tileWidth: 2.4,
      tileHeight: 2.4,
      portPitch: 0.4,
      clearance: 0.1,
      concavityTolerance: 0,
    },
    solver: {
      baseMaxIterations: 900000,
      additionalMaxIterationsPerConnection: 2000,
      ripCost: 35.38577539020022,
      portUsagePenalty: 0.034685181009478865,
      crossingPenalty: 4.072520483177124,
    },
  },
})
```

## API Surface

Export | Description
--- | ---
`FixedViaHypergraphSolver` | Main via-graph solver class
`new FixedViaHypergraphSolver({ inputConnections, viaTile? })` | Preferred minimal one-call convex graph + solver entrypoint
`options.graph` / `options.solver` | Advanced graph-generation and solver tuning for auto-convex mode
`new FixedViaHypergraphSolver({ inputGraph, inputConnections, ... })` | Low-level direct graph mode (compatibility path)
`generateConvexViaTopologyRegions` | Build convex via topology regions
`createConvexViaGraphFromXYConnections` | Low-level convex graph builder (kept for advanced usage)
`createViaGraphWithConnections` | Attach XY connections to a base via graph
Types from `lib/type.ts` | Shared package contracts

## Asset Generation

```bash
bun run generate:via-assets
bun run generate:via-topology
bun run generate:via-traces
bun run generate:baked-via-tiles
```

Generated assets are written under `assets/FixedViaHypergraphSolver/`.

## Development

```bash
bun run build
bun test
bunx tsc --noEmit
```

## Cosmos

Start Cosmos locally:

```bash
bun run start
```

Config and starter fixtures:

- `cosmos.config.json`
- `fixtures/fixed-via-hypergraph-solver.fixture.tsx`

## Dataset02 Benchmark

Run benchmark on `lib/datasets/dataset02.json`:

```bash
bun run benchmark:dataset02
```

Quick smoke run:

```bash
bun run benchmark:dataset02:smoke
```
