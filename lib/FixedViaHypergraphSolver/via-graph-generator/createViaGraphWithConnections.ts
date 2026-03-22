import { createConnectionPort } from "./createConnectionPort"
import { createConnectionRegion } from "./createConnectionRegion"
import type { XYConnection } from "../../type"
import type { JPort, JRegion, ViaGraph } from "../../type"
import type { Connection } from "../../type"
import { findBoundaryRegionForPolygons } from "./findBoundaryRegionForPolygons"

export type ViaGraphWithConnections = ViaGraph & {
  connections: Connection[]
}

/**
 * Creates a new graph from a via topology base graph with additional connection
 * regions at specified positions on the boundary.
 *
 * Uses polygon-edge proximity (not bounding-box proximity) to find the correct
 * boundary region for each connection endpoint. This is necessary because the
 * via topology's polygon regions have overlapping bounding boxes.
 */
export const createViaGraphWithConnections = (
  baseGraph: ViaGraph,
  xyConnections: XYConnection[],
): ViaGraphWithConnections => {
  const regions: JRegion[] = [...baseGraph.regions]
  const ports: JPort[] = [...baseGraph.ports]
  const connections: Connection[] = []

  for (const xyConn of xyConnections) {
    const { start, end, connectionId } = xyConn

    const startRegion = createConnectionRegion(
      `conn:${connectionId}:start`,
      start.x,
      start.y,
    )
    regions.push(startRegion)

    const endRegion = createConnectionRegion(
      `conn:${connectionId}:end`,
      end.x,
      end.y,
    )
    regions.push(endRegion)

    const startBoundary = findBoundaryRegionForPolygons({
      x: start.x,
      y: start.y,
      regions: baseGraph.regions,
    })
    if (startBoundary) {
      const startPort = createConnectionPort(
        `conn:${connectionId}:start-port`,
        startRegion,
        startBoundary.region,
        startBoundary.portPosition,
      )
      ports.push(startPort)
    }

    const endBoundary = findBoundaryRegionForPolygons({
      x: end.x,
      y: end.y,
      regions: baseGraph.regions,
    })
    if (endBoundary) {
      const endPort = createConnectionPort(
        `conn:${connectionId}:end-port`,
        endRegion,
        endBoundary.region,
        endBoundary.portPosition,
      )
      ports.push(endPort)
    }

    const connection: Connection = {
      connectionId,
      mutuallyConnectedNetworkId: connectionId,
      startRegion,
      endRegion,
    }
    connections.push(connection)
  }

  return {
    regions,
    ports,
    connections,
  }
}
