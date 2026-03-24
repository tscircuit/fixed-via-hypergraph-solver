import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import {
  createConvexViaGraphFromXYConnections,
  recommendViaTileFromGraphInput,
} from "lib/FixedViaHypergraphSolver/via-graph-generator/createConvexViaGraphFromXYConnections"
import { FixedViaHypergraphSolver } from "lib/FixedViaHypergraphSolver/FixedViaHypergraphSolver"
import type { XYConnection } from "lib/type"
import { useMemo, useState } from "react"
import dataset from "../../lib/datasets/dataset02.json"

type DatasetSample = {
  config: {
    numCrossings: number
    seed: number
    rows: number
    cols: number
    orientation: "vertical" | "horizontal"
  }
  connections: {
    connectionId: string
    startRegionId: string
    endRegionId: string
  }[]
  connectionRegions: {
    regionId: string
    pointIds: string[]
    d: {
      bounds: { minX: number; maxX: number; minY: number; maxY: number }
      center: { x: number; y: number }
      isPad: boolean
      isConnectionRegion: boolean
    }
  }[]
}

const typedDataset = dataset as DatasetSample[]

const extractXYConnections = (sample: DatasetSample): XYConnection[] => {
  const regionMap = new Map(
    sample.connectionRegions.map((region) => [
      region.regionId,
      region.d.center,
    ]),
  )

  return sample.connections.map((connection) => {
    const start = regionMap.get(connection.startRegionId)
    const end = regionMap.get(connection.endRegionId)

    if (!start || !end) {
      throw new Error(
        `Missing region for connection ${connection.connectionId}: start=${connection.startRegionId}, end=${connection.endRegionId}`,
      )
    }

    return {
      connectionId: connection.connectionId,
      start,
      end,
    }
  })
}

export default function ViaGraphConvexDataset02AutoSelectFixture() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [key, setKey] = useState(0)

  const entry = typedDataset[selectedIndex]

  const problem = useMemo(() => {
    if (!entry) return null

    const xyConnections = extractXYConnections(entry)
    const problemInput = { sample: entry, xyConnections }
    const recommendation = recommendViaTileFromGraphInput(
      problemInput,
      xyConnections,
    )
    const result = createConvexViaGraphFromXYConnections(
      xyConnections,
      problemInput,
    )

    return {
      graph: result,
      connections: result.connections,
      tileCount: result.tileCount,
      viaTile: result.viaTile,
      selectedViaRegionName: recommendation.recommendedViaRegionName,
    }
  }, [selectedIndex])

  if (!entry || !problem) {
    return (
      <div style={{ padding: 20, fontFamily: "monospace" }}>
        No dataset loaded. Ensure dataset02.json exists at:
        <pre>lib/datasets/dataset02.json</pre>
      </div>
    )
  }

  const { config } = entry
  const { tileCount } = problem

  const convexRegions = problem.graph.regions.filter(
    (region) =>
      region.regionId.includes(":convex:") ||
      region.regionId.startsWith("filler:"),
  )
  const viaRegions = problem.graph.regions.filter(
    (region) => region.d.isViaRegion,
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #ccc",
          background: "#f5f5f5",
          fontFamily: "monospace",
          fontSize: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <label>
            Sample:{" "}
            <input
              type="number"
              min={0}
              max={typedDataset.length - 1}
              value={selectedIndex}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10)
                if (
                  !Number.isNaN(value) &&
                  value >= 0 &&
                  value < typedDataset.length
                ) {
                  setSelectedIndex(value)
                  setKey((k) => k + 1)
                }
              }}
              style={{ width: 60, marginRight: 5 }}
            />
            / {typedDataset.length - 1}
          </label>
          <button
            onClick={() => {
              setSelectedIndex(Math.max(0, selectedIndex - 1))
              setKey((k) => k + 1)
            }}
            disabled={selectedIndex === 0}
          >
            Prev
          </button>
          <button
            onClick={() => {
              setSelectedIndex(
                Math.min(typedDataset.length - 1, selectedIndex + 1),
              )
              setKey((k) => k + 1)
            }}
            disabled={selectedIndex === typedDataset.length - 1}
          >
            Next
          </button>
          <button
            onClick={() => {
              setSelectedIndex(Math.floor(Math.random() * typedDataset.length))
              setKey((k) => k + 1)
            }}
          >
            Random
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <span>
            <strong>Config:</strong> {config.rows}x{config.cols}{" "}
            {config.orientation}, {config.numCrossings} crossings, seed=
            {config.seed}
          </span>
          <span style={{ marginLeft: 20 }}>
            <strong>Selected via:</strong> {problem.selectedViaRegionName}
          </span>
          <span style={{ marginLeft: 20 }}>
            <strong>Tiles:</strong> {tileCount.cols}x{tileCount.rows}
          </span>
          <span style={{ marginLeft: 20 }}>
            <strong>Convex regions:</strong> {convexRegions.length}
          </span>
          <span style={{ marginLeft: 20 }}>
            <strong>Via regions:</strong> {viaRegions.length}
          </span>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <GenericSolverDebugger
          key={key}
          createSolver={() =>
            new FixedViaHypergraphSolver({
              inputGraph: {
                regions: problem.graph.regions,
                ports: problem.graph.ports,
              },
              inputConnections: problem.connections,
              viaTile: problem.viaTile,
            })
          }
        />
      </div>
    </div>
  )
}
