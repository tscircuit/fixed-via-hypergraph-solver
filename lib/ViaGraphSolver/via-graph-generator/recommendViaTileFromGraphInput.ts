import viaTile3Regions from "assets/ViaGraphSolver/via-tile-3-regions-baked.json"
import defaultViaTile from "assets/ViaGraphSolver/via-tile-4-regions-baked.json"
import viaTile5Regions from "assets/ViaGraphSolver/via-tile-5-regions-baked.json"
import viaTile6Regions from "assets/ViaGraphSolver/via-tile-6-regions-baked.json"
import type { XYConnection } from "../../type"
import type { ViaTile } from "../../type"

export type ViaTileRecommendationProblemInput = {
  graphWidthMm?: number
  graphHeightMm?: number
  connectionCount?: number
  intersectionCount?: number
  xyConnections?: XYConnection[]
  sample?: {
    config?: {
      numCrossings?: number
    }
    connections?: Array<{
      connectionId: string
      startRegionId: string
      endRegionId: string
    }>
    connectionRegions?: Array<{
      regionId: string
      d: {
        center: { x: number; y: number }
        bounds: { minX: number; maxX: number; minY: number; maxY: number }
      }
    }>
  }
}

type ViaTileCandidate = {
  viaRegionName: string
  viaTile: ViaTile
}

export type ViaTileRecommendationCandidate = {
  viaRegionName: string
  predictedReliability: number
  estimatedIterationCost: number
  capacityScore: number
  requiredCapacityScore: number
  acceptedAsReliable: boolean
}

export type ViaTileRecommendation = {
  recommendedViaRegionName: string
  inputFeatures: {
    graphWidthMm: number
    graphHeightMm: number
    connectionCount: number
    intersectionCount: number
  }
  candidates: ViaTileRecommendationCandidate[]
}

const DEFAULT_VIA_TILE_CANDIDATES: ViaTileCandidate[] = [
  {
    viaRegionName: "via-tile-3-regions",
    viaTile: viaTile3Regions as ViaTile,
  },
  {
    viaRegionName: "via-tile-4-regions",
    viaTile: defaultViaTile as ViaTile,
  },
  {
    viaRegionName: "via-tile-5-regions",
    viaTile: viaTile5Regions as ViaTile,
  },
  {
    viaRegionName: "via-tile-6-regions",
    viaTile: viaTile6Regions as ViaTile,
  },
]

const round2 = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

const ccw = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)

const segmentsIntersect = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
) => ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2)

const countIntersections = (xyConnections: XYConnection[]): number => {
  let intersections = 0
  for (let i = 0; i < xyConnections.length; i++) {
    for (let j = i + 1; j < xyConnections.length; j++) {
      if (
        segmentsIntersect(
          xyConnections[i].start,
          xyConnections[i].end,
          xyConnections[j].start,
          xyConnections[j].end,
        )
      ) {
        intersections++
      }
    }
  }
  return intersections
}

const getBoundsFromSample = (
  sample: NonNullable<ViaTileRecommendationProblemInput["sample"]>,
) => {
  const regions = sample.connectionRegions ?? []
  if (regions.length === 0) return null
  const minX = Math.min(...regions.map((r) => r.d.bounds.minX))
  const maxX = Math.max(...regions.map((r) => r.d.bounds.maxX))
  const minY = Math.min(...regions.map((r) => r.d.bounds.minY))
  const maxY = Math.max(...regions.map((r) => r.d.bounds.maxY))
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
  }
}

const extractXYConnectionsFromSample = (
  sample: NonNullable<ViaTileRecommendationProblemInput["sample"]>,
): XYConnection[] => {
  const connections = sample.connections ?? []
  const regionMap = new Map(
    (sample.connectionRegions ?? []).map((r) => [r.regionId, r.d.center]),
  )
  const xyConnections: XYConnection[] = []

  for (const conn of connections) {
    const start = regionMap.get(conn.startRegionId)
    const end = regionMap.get(conn.endRegionId)
    if (!start || !end) continue
    xyConnections.push({
      connectionId: conn.connectionId,
      start,
      end,
    })
  }

  return xyConnections
}

const predictViaRegionFromSolveMatrix = (input: {
  graphWidthMm: number
  graphHeightMm: number
  connectionCount: number
  intersectionCount: number
}): string => {
  const area = input.graphWidthMm * input.graphHeightMm

  // Decision tree fitted from benchmark-results/via-tile-solve-matrix-dataset02.json
  // to maximize solve rate across the four static via tiles.
  if (input.graphWidthMm > 22) {
    return "via-tile-4-regions"
  }

  if (input.intersectionCount <= 20) {
    if (input.intersectionCount <= 17) {
      return "via-tile-5-regions"
    }
    return input.graphWidthMm <= 12.6
      ? "via-tile-3-regions"
      : "via-tile-4-regions"
  }

  return area <= 246.01 ? "via-tile-3-regions" : "via-tile-5-regions"
}

const getViaTileBounds = (viaTile: ViaTile) => {
  const points: Array<{ x: number; y: number }> = []
  for (const vias of Object.values(viaTile.viasByNet)) {
    for (const via of vias) points.push(via.position)
  }
  for (const route of viaTile.routeSegments) {
    for (const p of route.segments) points.push(p)
  }

  if (points.length === 0) {
    return { width: 1, height: 1 }
  }

  const minX = Math.min(...points.map((p) => p.x))
  const maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  return {
    width: Math.max(maxX - minX, 0.01),
    height: Math.max(maxY - minY, 0.01),
  }
}

const scoreViaTileForProblem = (
  problem: {
    graphWidthMm: number
    graphHeightMm: number
    connectionCount: number
    intersectionCount: number
  },
  candidate: ViaTileCandidate,
): ViaTileRecommendationCandidate => {
  const viaCount = Object.values(candidate.viaTile.viasByNet).reduce(
    (sum, vias) => sum + vias.length,
    0,
  )
  const netCount = Object.keys(candidate.viaTile.viasByNet).length
  const routeSegmentCount = candidate.viaTile.routeSegments.length
  const bounds = getViaTileBounds(candidate.viaTile)
  const tileArea = Math.max(
    candidate.viaTile.tileWidth && candidate.viaTile.tileHeight
      ? candidate.viaTile.tileWidth * candidate.viaTile.tileHeight
      : bounds.width * bounds.height,
    0.01,
  )

  const graphArea = Math.max(problem.graphWidthMm * problem.graphHeightMm, 0.01)
  const crossingPerConnection =
    problem.intersectionCount / Math.max(problem.connectionCount, 1)
  const density = problem.connectionCount / graphArea

  const requiredCapacityScore =
    problem.connectionCount * 1.2 +
    problem.intersectionCount * 1.5 +
    crossingPerConnection * 5 +
    density * 40

  const capacityScore =
    viaCount * 3.1 +
    routeSegmentCount * 2.4 +
    netCount * 0.5 +
    (1 / tileArea) * 4.5

  const predictedReliability = clamp(
    sigmoid((capacityScore - requiredCapacityScore) / 3.2),
    0,
    1,
  )

  const oversupplyRatio = Math.max(
    0,
    (capacityScore - requiredCapacityScore) /
      Math.max(requiredCapacityScore, 1),
  )
  const undersupplyRatio = Math.max(
    0,
    (requiredCapacityScore - capacityScore) /
      Math.max(requiredCapacityScore, 1),
  )

  const estimatedIterationCost =
    problem.connectionCount * 120 +
    problem.intersectionCount * 140 +
    oversupplyRatio * 900 +
    undersupplyRatio * 6000

  return {
    viaRegionName: candidate.viaRegionName,
    predictedReliability,
    estimatedIterationCost,
    capacityScore,
    requiredCapacityScore,
    acceptedAsReliable: predictedReliability >= 0.9,
  }
}

const calculateBoundsFromConnections = (xyConnections: XYConnection[]) => {
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

const normalizeGraphProblemInput = (
  input: ViaTileRecommendationProblemInput,
  fallbackXYConnections: XYConnection[],
) => {
  const xyConnections = (
    input.xyConnections && input.xyConnections.length > 0
      ? input.xyConnections
      : fallbackXYConnections
  ).slice()

  let graphWidthMm = input.graphWidthMm
  let graphHeightMm = input.graphHeightMm
  let connectionCount = input.connectionCount
  let intersectionCount = input.intersectionCount

  if (input.sample) {
    const sampleXYConnections = extractXYConnectionsFromSample(input.sample)
    if (xyConnections.length === 0 && sampleXYConnections.length > 0) {
      xyConnections.push(...sampleXYConnections)
    }
    if (!connectionCount) {
      connectionCount = input.sample.connections?.length ?? xyConnections.length
    }
    if (intersectionCount == null) {
      intersectionCount =
        input.sample.config?.numCrossings ??
        (xyConnections.length > 0 ? countIntersections(xyConnections) : 0)
    }
    if (graphWidthMm == null || graphHeightMm == null) {
      const bounds = getBoundsFromSample(input.sample)
      if (bounds) {
        graphWidthMm = graphWidthMm ?? bounds.widthMm
        graphHeightMm = graphHeightMm ?? bounds.heightMm
      }
    }
  }

  if (xyConnections.length > 0) {
    const bounds = calculateBoundsFromConnections(xyConnections)
    graphWidthMm = graphWidthMm ?? bounds.maxX - bounds.minX
    graphHeightMm = graphHeightMm ?? bounds.maxY - bounds.minY
    connectionCount = connectionCount ?? xyConnections.length
    intersectionCount = intersectionCount ?? countIntersections(xyConnections)
  }

  if (
    graphWidthMm == null ||
    graphHeightMm == null ||
    connectionCount == null ||
    intersectionCount == null
  ) {
    throw new Error(
      "Insufficient graph input. Provide width/height/connections/intersections, or pass xyConnections.",
    )
  }

  return {
    graphWidthMm: round2(graphWidthMm),
    graphHeightMm: round2(graphHeightMm),
    connectionCount,
    intersectionCount,
  }
}

export const recommendViaTileFromGraphInput = (
  problemInput: ViaTileRecommendationProblemInput,
  fallbackXYConnections: XYConnection[] = [],
  viaTileCandidates: ViaTileCandidate[] = DEFAULT_VIA_TILE_CANDIDATES,
  _opts?: unknown,
): ViaTileRecommendation => {
  if (viaTileCandidates.length === 0) {
    throw new Error("No via-tile candidates provided")
  }

  const xyConnections =
    problemInput.xyConnections && problemInput.xyConnections.length > 0
      ? problemInput.xyConnections
      : fallbackXYConnections
  const normalizedInput = normalizeGraphProblemInput(
    problemInput,
    xyConnections,
  )

  const scored = viaTileCandidates
    .map((candidate) => scoreViaTileForProblem(normalizedInput, candidate))
    .sort((a, b) => {
      if (a.acceptedAsReliable !== b.acceptedAsReliable) {
        return a.acceptedAsReliable ? -1 : 1
      }
      if (a.acceptedAsReliable && b.acceptedAsReliable) {
        if (a.estimatedIterationCost !== b.estimatedIterationCost) {
          return a.estimatedIterationCost - b.estimatedIterationCost
        }
      } else if (a.predictedReliability !== b.predictedReliability) {
        return b.predictedReliability - a.predictedReliability
      }
      return a.estimatedIterationCost - b.estimatedIterationCost
    })

  const predictedViaRegionName =
    predictViaRegionFromSolveMatrix(normalizedInput)
  const predictedCandidate = scored.find(
    (candidate) => candidate.viaRegionName === predictedViaRegionName,
  )
  if (predictedCandidate) {
    return {
      recommendedViaRegionName: predictedCandidate.viaRegionName,
      inputFeatures: normalizedInput,
      candidates: [
        predictedCandidate,
        ...scored.filter(
          (candidate) => candidate.viaRegionName !== predictedViaRegionName,
        ),
      ],
    }
  }

  return {
    recommendedViaRegionName: scored[0].viaRegionName,
    inputFeatures: normalizedInput,
    candidates: scored,
  }
}

export const selectViaTileForProblemInput = (
  problemInput: ViaTileRecommendationProblemInput,
  xyConnections: XYConnection[],
): ViaTile => {
  const recommendation = recommendViaTileFromGraphInput(
    problemInput,
    xyConnections,
  )
  const selectedCandidate = DEFAULT_VIA_TILE_CANDIDATES.find(
    (candidate) =>
      candidate.viaRegionName === recommendation.recommendedViaRegionName,
  )
  return selectedCandidate?.viaTile ?? (defaultViaTile as ViaTile)
}
