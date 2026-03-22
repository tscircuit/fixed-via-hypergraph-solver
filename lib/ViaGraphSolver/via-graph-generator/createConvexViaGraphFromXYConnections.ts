import type { XYConnection } from "../../type"
import type { ViaGraph } from "../../type"
import type { Connection } from "../../type"
import type { ViaTile } from "../../type"
import { createViaGraphWithConnections } from "./createViaGraphWithConnections"
import { generateConvexViaTopologyRegions } from "./generateConvexViaTopologyRegions"
import {
  selectViaTileForProblemInput,
  type ViaTileRecommendationProblemInput,
} from "./recommendViaTileFromGraphInput"

export {
  recommendViaTileFromGraphInput,
  type ViaTileRecommendation,
  type ViaTileRecommendationCandidate,
  type ViaTileRecommendationProblemInput,
} from "./recommendViaTileFromGraphInput"

export type ConvexViaGraphFromXYConnectionsResult = ViaGraph & {
  connections: Connection[]
  viaTile: ViaTile
  tileCount: { rows: number; cols: number }
}

const isViaTile = (input: unknown): input is ViaTile =>
  Boolean(
    input &&
      typeof input === "object" &&
      "viasByNet" in input &&
      "routeSegments" in input,
  )

/**
 * Calculate the bounds from XY connections with no margin.
 * The bounds go edge-to-edge with the connection points.
 */
function calculateBoundsFromConnections(xyConnections: XYConnection[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  if (xyConnections.length === 0) {
    throw new Error("Cannot calculate bounds from empty connections array")
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const conn of xyConnections) {
    minX = Math.min(minX, conn.start.x, conn.end.x)
    maxX = Math.max(maxX, conn.start.x, conn.end.x)
    minY = Math.min(minY, conn.start.y, conn.end.y)
    maxY = Math.max(maxY, conn.start.y, conn.end.y)
  }

  return { minX, maxX, minY, maxY }
}

/**
 * Creates a complete via topology graph from XY connections using convex regions.
 *
 * This function uses ConvexRegionsSolver to compute convex regions around
 * via region obstacles, instead of the manual T/B/L/R outer regions.
 *
 * It:
 * 1. Calculates bounds from connection XY coordinates (no margin)
 * 2. Generates per-net via region polygons on a tiled grid
 * 3. Uses ConvexRegionsSolver to compute convex regions around via regions
 * 4. Creates ports between adjacent convex regions and via regions
 * 5. Attaches connection regions to the graph
 *
 * @param xyConnections - Array of connections with start/end XY coordinates
 * @param viaTileOrProblem - Optional explicit via tile, or one-problem input used to recommend a tile
 * @param opts - Optional configuration
 */
export function createConvexViaGraphFromXYConnections(
  xyConnections: XYConnection[],
  viaTileOrProblem?: ViaTile | ViaTileRecommendationProblemInput,
  opts?: {
    tileWidth?: number
    tileHeight?: number
    tileSize?: number
    portPitch?: number
    clearance?: number
    concavityTolerance?: number
  },
): ConvexViaGraphFromXYConnectionsResult {
  const selectedViaTile = isViaTile(viaTileOrProblem)
    ? viaTileOrProblem
    : selectViaTileForProblemInput(
        {
          ...(viaTileOrProblem ?? {}),
          xyConnections: viaTileOrProblem?.xyConnections ?? xyConnections,
        },
        xyConnections,
      )

  // Calculate bounds from connections (no margin)
  const bounds = calculateBoundsFromConnections(xyConnections)

  // Generate the via topology with convex regions
  // Use tileWidth/tileHeight from opts, or fall back to viaTile's values
  const {
    regions,
    ports,
    viaTile: generatedViaTile,
    tileCount,
  } = generateConvexViaTopologyRegions({
    viaTile: selectedViaTile,
    bounds,
    tileWidth: opts?.tileWidth ?? selectedViaTile.tileWidth,
    tileHeight: opts?.tileHeight ?? selectedViaTile.tileHeight,
    tileSize: opts?.tileSize,
    portPitch: opts?.portPitch,
    clearance: opts?.clearance,
    concavityTolerance: opts?.concavityTolerance,
  })

  // Create base graph from regions
  const baseGraph: ViaGraph = { regions, ports }

  // Add connections to the graph
  // Note: findBoundaryRegionForPolygons auto-detects convex topology by checking
  // for filler regions and only connects to them (avoiding tiny isolated convex regions)
  const graphWithConnections = createViaGraphWithConnections(
    baseGraph,
    xyConnections,
  )

  return {
    ...graphWithConnections,
    viaTile: generatedViaTile,
    tileCount,
  }
}
