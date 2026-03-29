import type { JPort, JRegion, ViaTile } from "../../type"
import { generateConvexViaTopologyRegions } from "./generateConvexViaTopologyRegions"

export type GenerateViaTopologyRegionsOptions = {
  graphSize?: number
  idPrefix?: string
  tileWidth?: number
  tileHeight?: number
  tileSize?: number
  portPitch?: number
  clearance?: number
  concavityTolerance?: number
}

/**
 * @deprecated Legacy name retained for compatibility.
 * This now always uses the convex topology pipeline.
 */
export const generateViaTopologyRegions = (
  viaTile: ViaTile,
  opts?: GenerateViaTopologyRegionsOptions,
): { regions: JRegion[]; ports: JPort[] } => {
  const graphSize = opts?.graphSize ?? 5
  const half = graphSize / 2

  const { regions, ports } = generateConvexViaTopologyRegions({
    viaTile,
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
