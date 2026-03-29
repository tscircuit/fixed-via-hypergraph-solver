import viaTile from "../../assets/FixedViaHypergraphSolver/via-tile-4-regions.json"
import type { ViaTile } from "../type"
import { generateConvexViaTopologyRegions } from "./via-graph-generator/generateConvexViaTopologyRegions"

export { viaTile }

export function generateDefaultViaTopologyRegions(opts?: {
  graphSize?: number
  tileWidth?: number
  tileHeight?: number
  tileSize?: number
  portPitch?: number
  clearance?: number
  concavityTolerance?: number
}) {
  const graphSize = opts?.graphSize ?? 5
  const half = graphSize / 2

  const { regions, ports } = generateConvexViaTopologyRegions({
    viaTile: viaTile as ViaTile,
    bounds: {
      minX: -half,
      maxX: half,
      minY: -half,
      maxY: half,
    },
    tileWidth: opts?.tileWidth,
    tileHeight: opts?.tileHeight,
    tileSize: opts?.tileSize,
    portPitch: opts?.portPitch,
    clearance: opts?.clearance,
    concavityTolerance: opts?.concavityTolerance,
  })

  return { regions, ports }
}
