import viaTile from "assets/ViaGraphSolver/via-tile-4-regions.json"
import type { ViaTile } from "../type"
import { generateViaTopologyRegions } from "./via-graph-generator/generateViaTopologyRegions"

export { viaTile }

export function generateDefaultViaTopologyRegions(
  opts: Parameters<typeof generateViaTopologyRegions>[1],
) {
  return generateViaTopologyRegions(viaTile as ViaTile, opts)
}
