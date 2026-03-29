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
  createConvexViaGraphFromXYConnections,
  type ViaTile,
} from "@tscircuit/fixed-via-hypergraph-solver"

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

const graphWithConnections = createConvexViaGraphFromXYConnections([
  {
    connectionId: "A",
    start: { x: -2.5, y: 1.0 },
    end: { x: 2.5, y: -1.0 },
  },
], viaTile)

const solver = new FixedViaHypergraphSolver({
  inputGraph: {
    regions: graphWithConnections.regions,
    ports: graphWithConnections.ports,
  },
  inputConnections: graphWithConnections.connections,
  viaTile,
})

solver.solve()
console.log(solver.solved)
```

## API Surface

Export | Description
--- | ---
`FixedViaHypergraphSolver` | Main via-graph solver class
`generateConvexViaTopologyRegions` | Build convex via topology regions
`createConvexViaGraphFromXYConnections` | Build convex via graph from XY connection input
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
