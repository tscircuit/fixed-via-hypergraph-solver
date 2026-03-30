import type { GraphicsObject } from "graphics-debug"
import { HyperGraphSolver } from "@tscircuit/hypergraph"
import { countInputConnectionCrossings } from "../graph-utils/countInputConnectionCrossings"
import type { JPort, JRegion } from "../type"
import type {
  Connection,
  HyperGraph,
  RouteSegment,
  RegionPortAssignment,
  SerializedConnection,
  SerializedHyperGraph,
  SolvedRoute,
  ViaByNet,
  ViaData,
  ViaTile,
  XYConnection,
} from "../type"
import { createConvexViaGraphFromXYConnections } from "./via-graph-generator/createConvexViaGraphFromXYConnections"
import {
  computeCrossingAssignmentsForPolygon,
  computeDifferentNetCrossingsForPolygon,
} from "./polygonPerimeterUtils"
import {
  type ResolvedRouteLineSegment,
  resolveSolvedRouteLineSegments,
  resolveSolvedRoutePoints,
} from "./resolveSolvedRoutePoints"
import { visualizeFixedViaHypergraphSolver } from "./visualizeFixedViaHypergraphSolver"

export type { RouteSegment, ViaByNet, ViaData, ViaTile } from "../type"

export const VIA_GRAPH_SOLVER_DEFAULTS = {
  portUsagePenalty: 0.034685181009478865,
  portUsagePenaltySq: 0,
  crossingPenalty: 4.072520483177124,
  crossingPenaltySq: 0,
  ripCost: 35.38577539020022,
  greedyMultiplier: 0.5518001238069296,
}

export type FixedViaHypergraphSolverSolverOptions = {
  inputSolvedRoutes?: SolvedRoute[]
  ripCost?: number
  portUsagePenalty?: number
  crossingPenalty?: number
  baseMaxIterations?: number
  additionalMaxIterationsPerConnection?: number
}

export type FixedViaHypergraphSolverAutoOptions = {
  graph?: Parameters<typeof createConvexViaGraphFromXYConnections>[2]
  solver?: FixedViaHypergraphSolverSolverOptions
}

export type FixedViaHypergraphSolverDirectInput = {
  inputGraph: HyperGraph | SerializedHyperGraph
  inputConnections: (Connection | SerializedConnection)[]
  inputSolvedRoutes?: SolvedRoute[]
  viaTile?: ViaTile
  options?: never
  ripCost?: number
  portUsagePenalty?: number
  crossingPenalty?: number
  baseMaxIterations?: number
  additionalMaxIterationsPerConnection?: number
}

export type FixedViaHypergraphSolverAutoInput = {
  inputGraph?: never
  inputConnections: XYConnection[]
  viaTile?: ViaTile
  options?: FixedViaHypergraphSolverAutoOptions
}

export type FixedViaHypergraphSolverInput =
  | FixedViaHypergraphSolverDirectInput
  | FixedViaHypergraphSolverAutoInput

const normalizeFixedViaSolverInput = (
  input: FixedViaHypergraphSolverInput,
): FixedViaHypergraphSolverDirectInput => {
  if (input.inputGraph !== undefined) {
    return input
  }

  const graphResult = createConvexViaGraphFromXYConnections(
    input.inputConnections,
    input.viaTile,
    input.options?.graph,
  )

  return {
    inputGraph: {
      regions: graphResult.regions,
      ports: graphResult.ports,
    },
    inputConnections: graphResult.connections,
    viaTile: graphResult.viaTile,
    inputSolvedRoutes: input.options?.solver?.inputSolvedRoutes,
    ripCost: input.options?.solver?.ripCost,
    portUsagePenalty: input.options?.solver?.portUsagePenalty,
    crossingPenalty: input.options?.solver?.crossingPenalty,
    baseMaxIterations: input.options?.solver?.baseMaxIterations,
    additionalMaxIterationsPerConnection:
      input.options?.solver?.additionalMaxIterationsPerConnection,
  }
}

export class FixedViaHypergraphSolver extends HyperGraphSolver<JRegion, JPort> {
  override getSolverName(): string {
    return "FixedViaHypergraphSolver"
  }

  UNIT_OF_COST = "hops"

  viaTile?: ViaTile

  portUsagePenalty = VIA_GRAPH_SOLVER_DEFAULTS.portUsagePenalty
  portUsagePenaltySq = VIA_GRAPH_SOLVER_DEFAULTS.portUsagePenaltySq
  crossingPenalty = VIA_GRAPH_SOLVER_DEFAULTS.crossingPenalty
  crossingPenaltySq = VIA_GRAPH_SOLVER_DEFAULTS.crossingPenaltySq
  override ripCost = VIA_GRAPH_SOLVER_DEFAULTS.ripCost
  baseMaxIterations = 900000
  additionalMaxIterationsPerConnection = 2000
  additionalMaxIterationsPerCrossing = 2000

  constructor(input: FixedViaHypergraphSolverInput) {
    const normalizedInput = normalizeFixedViaSolverInput(input)

    super({
      greedyMultiplier: VIA_GRAPH_SOLVER_DEFAULTS.greedyMultiplier,
      rippingEnabled: true,
      ...normalizedInput,
    })
    this.viaTile = normalizedInput.viaTile
    this.ripCost = normalizedInput.ripCost ?? this.ripCost
    this.portUsagePenalty =
      normalizedInput.portUsagePenalty ?? this.portUsagePenalty
    this.crossingPenalty =
      normalizedInput.crossingPenalty ?? this.crossingPenalty
    this.baseMaxIterations =
      normalizedInput.baseMaxIterations ?? this.baseMaxIterations
    this.additionalMaxIterationsPerConnection =
      normalizedInput.additionalMaxIterationsPerConnection ??
      this.additionalMaxIterationsPerConnection

    const crossings = countInputConnectionCrossings(
      this.graph,
      normalizedInput.inputConnections,
    )

    this.MAX_ITERATIONS =
      this.baseMaxIterations +
      normalizedInput.inputConnections.length *
        this.additionalMaxIterationsPerConnection +
      crossings * this.additionalMaxIterationsPerCrossing

    this.populateDistanceToEndMaps()
  }

  private populateDistanceToEndMaps() {
    const endRegions = new Set(this.connections.map((c) => c.endRegion))

    for (const endRegion of endRegions) {
      const regionDistanceMap = new Map<string, number>()
      const queue: Array<{ region: JRegion; distance: number }> = []

      regionDistanceMap.set(endRegion.regionId, 0)
      queue.push({ region: endRegion as JRegion, distance: 0 })

      while (queue.length > 0) {
        const { region, distance: dist } = queue.shift()!

        for (const port of region.ports) {
          const otherRegion = (
            port.region1 === region ? port.region2 : port.region1
          ) as JRegion
          if (!regionDistanceMap.has(otherRegion.regionId)) {
            regionDistanceMap.set(otherRegion.regionId, dist + 1)
            queue.push({ region: otherRegion, distance: dist + 1 })
          }
        }
      }

      for (const port of this.graph.ports) {
        if (!port.distanceToEndMap) {
          port.distanceToEndMap = {}
        }
        const d1 = regionDistanceMap.get(port.region1.regionId) ?? Infinity
        const d2 = regionDistanceMap.get(port.region2.regionId) ?? Infinity
        port.distanceToEndMap[endRegion.regionId] = Math.min(d1, d2)
      }
    }
  }

  override estimateCostToEnd(port: JPort): number {
    const endRegionId = this.currentEndRegion!.regionId
    const hopDistance = port.distanceToEndMap![endRegionId]!
    return hopDistance
  }

  override getPortUsagePenalty(port: JPort): number {
    const ripCount = port.ripCount ?? 0
    return ripCount * this.portUsagePenalty + ripCount * this.portUsagePenaltySq
  }

  override computeIncreasedRegionCostIfPortsAreUsed(
    region: JRegion,
    port1: JPort,
    port2: JPort,
  ): number {
    // Via regions are exclusive: any existing different-connection assignment
    // incurs the full crossing penalty (even if chords don't geometrically
    // cross). Two different connections cannot share a via region.
    if (region.d.isViaRegion) {
      const assignments = region.assignments ?? []
      const differentNetCount = assignments.filter(
        (a) =>
          a.connection.mutuallyConnectedNetworkId !==
          this.currentConnection!.mutuallyConnectedNetworkId,
      ).length
      if (differentNetCount > 0) {
        return (
          differentNetCount * this.crossingPenalty +
          differentNetCount * this.crossingPenaltySq
        )
      }
      return 0
    }

    const crossings = computeDifferentNetCrossingsForPolygon(
      region,
      port1,
      port2,
    )
    return crossings * this.crossingPenalty + crossings * this.crossingPenaltySq
  }

  override isRipRequiredForPortUsage(
    region: JRegion,
    _port1: JPort,
    _port2: JPort,
  ): boolean {
    // Via regions are exclusive - if the region has any assignment from a
    // different connection, using it requires ripping. This ensures the solver
    // properly considers via region exclusivity during pathfinding.
    if (region.d.isViaRegion) {
      const assignments = region.assignments ?? []
      return assignments.some(
        (a) =>
          a.connection.mutuallyConnectedNetworkId !==
          this.currentConnection!.mutuallyConnectedNetworkId,
      )
    }
    return false
  }

  override getRipsRequiredForPortUsage(
    region: JRegion,
    port1: JPort,
    port2: JPort,
  ): RegionPortAssignment[] {
    // Via regions are exclusive: ALL existing different-connection assignments
    // must be ripped, not just geometrically crossing ones.
    if (region.d.isViaRegion) {
      const assignments = region.assignments ?? []
      return assignments.filter(
        (a) =>
          a.connection.mutuallyConnectedNetworkId !==
          this.currentConnection!.mutuallyConnectedNetworkId,
      )
    }

    const crossingAssignments = computeCrossingAssignmentsForPolygon(
      region,
      port1,
      port2,
    )
    return crossingAssignments.filter(
      (a) =>
        a.connection.mutuallyConnectedNetworkId !==
        this.currentConnection!.mutuallyConnectedNetworkId,
    )
  }

  override routeSolvedHook(solvedRoute: SolvedRoute) {}

  getSolvedRoutePoints(
    solvedRoute: SolvedRoute,
  ): Array<{ x: number; y: number }> {
    return resolveSolvedRoutePoints(solvedRoute, this.viaTile)
  }

  getSolvedRouteLineSegments(
    solvedRoute: SolvedRoute,
  ): ResolvedRouteLineSegment[] {
    return resolveSolvedRouteLineSegments(solvedRoute, this.viaTile)
  }

  override routeStartedHook(connection: Connection) {}

  override visualize(): GraphicsObject {
    return visualizeFixedViaHypergraphSolver(this)
  }
}
