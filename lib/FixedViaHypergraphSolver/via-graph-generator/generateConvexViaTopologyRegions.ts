import { ConvexRegionsSolver } from "@tscircuit/find-convex-regions"
import type { JPort, JRegion, ViaGraph } from "../../type"
import type { RouteSegment, ViaTile } from "../../type"
import { createPortsAlongEdge, findSharedEdges } from "./findSharedEdges"

/**
 * Default port pitch (mm) for distributing ports along shared boundaries.
 */
const DEFAULT_PORT_PITCH = 0.4

/**
 * Default clearance (mm) around via regions for convex region computation.
 */
const DEFAULT_CLEARANCE = 0.1

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Unit tile template containing convex regions computed once.
 * This is centered at (0,0) with dimensions tileWidth x tileHeight.
 */
interface UnitTileTemplate {
  /** Via regions within the tile (centered at origin) */
  viaRegions: Array<{
    templateRegionId: string
    netName: string
    polygon: Point[]
    bounds: Bounds
    center: Point
  }>
  /** Convex regions computed by ConvexRegionsSolver (centered at origin) */
  convexRegions: Array<{
    templateRegionId: string
    polygon: Point[]
    bounds: Bounds
    center: Point
  }>
  /** Internal (within-tile) ports from baked templates when available */
  internalPorts: Array<{
    templatePortId: string
    templateRegion1Id: string
    templateRegion2Id: string
    position: Point
  }>
  /** Tile dimensions */
  tileWidth: number
  tileHeight: number
}

type BakedViaTileRegion = {
  regionId: string
  polygon: Point[]
  bounds: Bounds
  center: Point
  isViaRegion: boolean
  netName?: string
}

type BakedViaTilePort = {
  portId: string
  region1Id: string
  region2Id: string
  position: Point
}

type BakedViaTile = ViaTile & {
  regions: BakedViaTileRegion[]
  ports?: BakedViaTilePort[]
}

type HorizontalSegment = { xStart: number; xEnd: number; y: number }
type VerticalSegment = { x: number; yStart: number; yEnd: number }

/**
 * Remove consecutive duplicate points from a polygon.
 * Points are considered duplicates if they are within tolerance distance.
 */
function deduplicateConsecutivePoints(
  points: Point[],
  tolerance = 0.001,
): Point[] {
  if (points.length <= 1) return points

  const result: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2)
    if (dist > tolerance) {
      result.push(curr)
    }
  }

  // Also check if last point equals first point (for closed polygons)
  if (result.length > 1) {
    const first = result[0]
    const last = result[result.length - 1]
    const dist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2)
    if (dist < tolerance) {
      result.pop()
    }
  }

  return result
}

/**
 * Compute bounding box from polygon points.
 */
function boundsFromPolygon(points: Point[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Compute centroid of polygon.
 */
function centroid(points: Point[]): Point {
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / points.length, y: cy / points.length }
}

/**
 * Create a JRegion from a polygon.
 */
function createRegionFromPolygon(
  regionId: string,
  polygon: Point[],
  opts?: { isViaRegion?: boolean },
): JRegion {
  const bounds = boundsFromPolygon(polygon)
  return {
    regionId,
    ports: [],
    d: {
      bounds,
      center: centroid(polygon),
      polygon,
      isPad: false,
      isViaRegion: opts?.isViaRegion,
    },
  }
}

/**
 * Generate a via region polygon for a single net's vias.
 * The polygon wraps around all vias for that net.
 */
function generateViaRegionPolygon(
  vias: Array<{ viaId: string; diameter: number; position: Point }>,
): Point[] {
  if (vias.length === 0) return []

  // Find extreme vias
  const topVia = vias.reduce((best, v) =>
    v.position.y > best.position.y ? v : best,
  )
  const bottomVia = vias.reduce((best, v) =>
    v.position.y < best.position.y ? v : best,
  )
  const leftVia = vias.reduce((best, v) =>
    v.position.x < best.position.x ? v : best,
  )
  const rightVia = vias.reduce((best, v) =>
    v.position.x > best.position.x ? v : best,
  )

  // Compute edge segments
  const topSeg: HorizontalSegment = {
    xStart: topVia.position.x - topVia.diameter / 2,
    xEnd: topVia.position.x + topVia.diameter / 2,
    y: topVia.position.y + topVia.diameter / 2,
  }
  const botSeg: HorizontalSegment = {
    xStart: bottomVia.position.x - bottomVia.diameter / 2,
    xEnd: bottomVia.position.x + bottomVia.diameter / 2,
    y: bottomVia.position.y - bottomVia.diameter / 2,
  }
  const leftSeg: VerticalSegment = {
    x: leftVia.position.x - leftVia.diameter / 2,
    yStart: leftVia.position.y - leftVia.diameter / 2,
    yEnd: leftVia.position.y + leftVia.diameter / 2,
  }
  const rightSeg: VerticalSegment = {
    x: rightVia.position.x + rightVia.diameter / 2,
    yStart: rightVia.position.y - rightVia.diameter / 2,
    yEnd: rightVia.position.y + rightVia.diameter / 2,
  }

  // Build polygon (clockwise):
  // top-left -> top-right -> right-top -> right-bottom ->
  // bottom-right -> bottom-left -> left-bottom -> left-top -> close
  const rawPolygon = [
    { x: topSeg.xStart, y: topSeg.y },
    { x: topSeg.xEnd, y: topSeg.y },
    { x: rightSeg.x, y: rightSeg.yEnd },
    { x: rightSeg.x, y: rightSeg.yStart },
    { x: botSeg.xEnd, y: botSeg.y },
    { x: botSeg.xStart, y: botSeg.y },
    { x: leftSeg.x, y: leftSeg.yStart },
    { x: leftSeg.x, y: leftSeg.yEnd },
  ]

  // Remove consecutive duplicate points (happens when same via is extreme in multiple directions)
  return deduplicateConsecutivePoints(rawPolygon)
}

/**
 * Translate via positions by (dx, dy).
 */
function translateVias(
  vias: Array<{ viaId: string; diameter: number; position: Point }>,
  dx: number,
  dy: number,
  prefix: string,
): Array<{ viaId: string; diameter: number; position: Point }> {
  return vias.map((v) => ({
    viaId: `${prefix}:${v.viaId}`,
    diameter: v.diameter,
    position: {
      x: v.position.x + dx,
      y: v.position.y + dy,
    },
  }))
}

function translateRouteSegments(
  routeSegments: RouteSegment[],
  dx: number,
  dy: number,
  prefix: string,
): RouteSegment[] {
  return routeSegments.map((segment) => ({
    routeId: `${prefix}:${segment.routeId}`,
    fromPort: `${prefix}:${segment.fromPort}`,
    toPort: `${prefix}:${segment.toPort}`,
    layer: segment.layer,
    segments: segment.segments.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    })),
  }))
}

function isBakedViaTile(viaTile: ViaTile): viaTile is BakedViaTile {
  return (
    "regions" in viaTile &&
    Array.isArray((viaTile as { regions?: unknown }).regions)
  )
}

function hasBakedViaTilePorts(
  viaTile: BakedViaTile,
): viaTile is BakedViaTile & { ports: BakedViaTilePort[] } {
  return Array.isArray((viaTile as { ports?: unknown }).ports)
}

function extractViaNetNameFromRegionId(regionId: string): string | null {
  const marker = ":v:"
  const markerIndex = regionId.lastIndexOf(marker)
  if (markerIndex === -1) return null
  return regionId.slice(markerIndex + marker.length)
}

function replaceTilePrefix(templateRegionId: string, prefix: string): string {
  const colonIndex = templateRegionId.indexOf(":")
  if (colonIndex === -1) return `${prefix}:${templateRegionId}`
  return `${prefix}${templateRegionId.slice(colonIndex)}`
}

/**
 * Translate a polygon by (dx, dy).
 */
function translatePolygon(polygon: Point[], dx: number, dy: number): Point[] {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

/**
 * Create rectangular polygon from bounds.
 */
function rectPolygonFromBounds(b: Bounds): Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]
}

/**
 * Find the port positions on each side (top, bottom, left, right) of a via region polygon.
 * Each side gets 1 port at the midpoint of the segment that defines that side's extreme.
 *
 * @param polygon - The via region polygon
 * @returns Object with port positions for each side (may be null if no segment exists on that side)
 */
function findViaRegionSidePorts(polygon: Point[]): {
  top: Point | null
  bottom: Point | null
  left: Point | null
  right: Point | null
} {
  if (polygon.length < 3) {
    return { top: null, bottom: null, left: null, right: null }
  }

  const bounds = boundsFromPolygon(polygon)
  const tolerance = 0.001

  let topPort: Point | null = null
  let bottomPort: Point | null = null
  let leftPort: Point | null = null
  let rightPort: Point | null = null

  // Find segments on each side of the bounding box
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]
    const p2 = polygon[(i + 1) % polygon.length]

    // Check if this segment is on the top edge (maxY)
    if (
      Math.abs(p1.y - bounds.maxY) < tolerance &&
      Math.abs(p2.y - bounds.maxY) < tolerance
    ) {
      // Segment is on top edge, port at midpoint
      topPort = { x: (p1.x + p2.x) / 2, y: bounds.maxY }
    }

    // Check if this segment is on the bottom edge (minY)
    if (
      Math.abs(p1.y - bounds.minY) < tolerance &&
      Math.abs(p2.y - bounds.minY) < tolerance
    ) {
      // Segment is on bottom edge, port at midpoint
      bottomPort = { x: (p1.x + p2.x) / 2, y: bounds.minY }
    }

    // Check if this segment is on the left edge (minX)
    if (
      Math.abs(p1.x - bounds.minX) < tolerance &&
      Math.abs(p2.x - bounds.minX) < tolerance
    ) {
      // Segment is on left edge, port at midpoint
      leftPort = { x: bounds.minX, y: (p1.y + p2.y) / 2 }
    }

    // Check if this segment is on the right edge (maxX)
    if (
      Math.abs(p1.x - bounds.maxX) < tolerance &&
      Math.abs(p2.x - bounds.maxX) < tolerance
    ) {
      // Segment is on right edge, port at midpoint
      rightPort = { x: bounds.maxX, y: (p1.y + p2.y) / 2 }
    }
  }

  return { top: topPort, bottom: bottomPort, left: leftPort, right: rightPort }
}

/**
 * Extend via region polygon to tile boundary when extremely close (< threshold).
 * Only extends polygon edges that are within threshold of the tile boundary.
 * This prevents thin convex regions from being created in small gaps.
 */
function extendViaRegionToTileEdge(
  polygon: Point[],
  tileBounds: Bounds,
  threshold = 0.1,
): Point[] {
  if (polygon.length === 0) return polygon

  const polyBounds = boundsFromPolygon(polygon)

  // Calculate distance from polygon edges to tile edges
  const distToLeft = polyBounds.minX - tileBounds.minX
  const distToRight = tileBounds.maxX - polyBounds.maxX
  const distToBottom = polyBounds.minY - tileBounds.minY
  const distToTop = tileBounds.maxY - polyBounds.maxY

  // Only extend if extremely close (< threshold)
  const extendLeft = distToLeft > 0 && distToLeft < threshold
  const extendRight = distToRight > 0 && distToRight < threshold
  const extendBottom = distToBottom > 0 && distToBottom < threshold
  const extendTop = distToTop > 0 && distToTop < threshold

  if (!extendLeft && !extendRight && !extendBottom && !extendTop) {
    return polygon
  }

  const result = polygon.map((p) => {
    let x = p.x
    let y = p.y

    // Extend points on polygon's left edge to tile's left boundary
    if (extendLeft && Math.abs(p.x - polyBounds.minX) < 0.001) {
      x = tileBounds.minX
    }
    // Extend points on polygon's right edge to tile's right boundary
    if (extendRight && Math.abs(p.x - polyBounds.maxX) < 0.001) {
      x = tileBounds.maxX
    }
    // Extend points on polygon's bottom edge to tile's bottom boundary
    if (extendBottom && Math.abs(p.y - polyBounds.minY) < 0.001) {
      y = tileBounds.minY
    }
    // Extend points on polygon's top edge to tile's top boundary
    if (extendTop && Math.abs(p.y - polyBounds.maxY) < 0.001) {
      y = tileBounds.maxY
    }

    return { x, y }
  })

  return deduplicateConsecutivePoints(result)
}

/**
 * Check if a point is inside or on the boundary of a polygon.
 */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    // Check if point is on edge
    const onEdge =
      Math.abs((point.y - yi) * (xj - xi) - (point.x - xi) * (yj - yi)) <
        0.001 &&
      point.x >= Math.min(xi, xj) - 0.001 &&
      point.x <= Math.max(xi, xj) + 0.001 &&
      point.y >= Math.min(yi, yj) - 0.001 &&
      point.y <= Math.max(yi, yj) + 0.001

    if (onEdge) return true

    if (yi > point.y !== yj > point.y) {
      const intersectX = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
      if (point.x < intersectX) {
        inside = !inside
      }
    }
  }
  return inside
}

/**
 * Find the region that contains the given point.
 */
function findRegionContainingPoint(
  point: Point,
  regions: JRegion[],
): JRegion | null {
  for (const region of regions) {
    if (region.d.polygon && pointInPolygon(point, region.d.polygon)) {
      return region
    }
  }
  return null
}

/**
 * Compute the unit tile template by running ConvexRegionsSolver once.
 * The tile is centered at (0, 0).
 */
function computeUnitTileTemplate(
  viaTile: ViaTile,
  tileWidth: number,
  tileHeight: number,
  clearance: number,
  concavityTolerance: number,
): UnitTileTemplate {
  const halfWidth = tileWidth / 2
  const halfHeight = tileHeight / 2

  // Tile bounds centered at origin
  const tileBounds: Bounds = {
    minX: -halfWidth,
    maxX: halfWidth,
    minY: -halfHeight,
    maxY: halfHeight,
  }

  // Generate via region polygons for the unit tile (centered at origin)
  const viaRegions: UnitTileTemplate["viaRegions"] = []

  for (const [netName, vias] of Object.entries(viaTile.viasByNet)) {
    if (vias.length === 0) continue

    const polygon = generateViaRegionPolygon(vias)
    if (polygon.length === 0) continue

    viaRegions.push({
      templateRegionId: `t0_0:v:${netName}`,
      netName,
      polygon,
      bounds: boundsFromPolygon(polygon),
      center: centroid(polygon),
    })
  }

  // Extend via region polygons to tile edge when extremely close (< 0.1mm)
  // This prevents thin convex regions from being created in small gaps
  const obstaclePolygons = viaRegions.map((r) => ({
    points: extendViaRegionToTileEdge(r.polygon, tileBounds),
  }))

  const solver = new ConvexRegionsSolver({
    bounds: tileBounds,
    polygons: obstaclePolygons,
    clearance,
    concavityTolerance,
  })

  solver.solve()
  const solverOutput = solver.getOutput()

  if (!solverOutput) {
    throw new Error("ConvexRegionsSolver failed to compute unit tile regions")
  }

  // Convert solver output to template format
  const convexRegions: UnitTileTemplate["convexRegions"] =
    solverOutput.regions.map((polygon: Point[], index: number) => ({
      templateRegionId: `t0_0:convex:${index}`,
      polygon,
      bounds: boundsFromPolygon(polygon),
      center: centroid(polygon),
    }))

  return {
    viaRegions,
    convexRegions,
    internalPorts: [],
    tileWidth,
    tileHeight,
  }
}

function computeUnitTileTemplateFromBakedViaTile(
  viaTile: BakedViaTile,
  tileWidth: number,
  tileHeight: number,
): UnitTileTemplate {
  const insideRegions = viaTile.regions.filter(
    (region) => region.polygon.length >= 3,
  )
  const insideRegionById = new Map(
    insideRegions.map((region) => [region.regionId, region]),
  )

  const viaRegions = insideRegions
    .filter((region) => region.isViaRegion)
    .map((region) => ({
      templateRegionId: region.regionId,
      netName:
        region.netName ??
        extractViaNetNameFromRegionId(region.regionId) ??
        "unknown",
      polygon: region.polygon,
      bounds: region.bounds,
      center: region.center,
    }))

  const convexRegions = insideRegions
    .filter((region) => !region.isViaRegion)
    .map((region) => ({
      templateRegionId: region.regionId,
      polygon: region.polygon,
      bounds: region.bounds,
      center: region.center,
    }))

  let internalPorts: UnitTileTemplate["internalPorts"] = []
  if (hasBakedViaTilePorts(viaTile)) {
    const bakedInternalPorts: UnitTileTemplate["internalPorts"] = []
    for (const port of viaTile.ports) {
      const region1 = insideRegionById.get(port.region1Id)
      const region2 = insideRegionById.get(port.region2Id)
      if (!region1 || !region2) {
        throw new Error(
          `Baked via tile port ${port.portId} references missing regions (${port.region1Id}, ${port.region2Id}).`,
        )
      }

      // Keep convex<->convex ports from baked data. Via-side ports are kept on
      // runtime generation path for solver reliability.
      if (region1.isViaRegion || region2.isViaRegion) {
        continue
      }

      bakedInternalPorts.push({
        templatePortId: port.portId,
        templateRegion1Id: port.region1Id,
        templateRegion2Id: port.region2Id,
        position: port.position,
      })
    }
    internalPorts = bakedInternalPorts
  }

  return {
    viaRegions,
    convexRegions,
    internalPorts,
    tileWidth,
    tileHeight,
  }
}

/**
 * Generates a via topology using convex regions computed by ConvexRegionsSolver.
 *
 * New tiled approach:
 * 1. Compute convex regions for a single unit tile (centered at origin)
 * 2. Replicate the tile's regions across the grid by translation
 * 3. Create rectangular filler regions for outer areas:
 *    - Top/bottom regions extend horizontally across full bounds width
 *    - Left/right regions extend vertically between top/bottom regions
 * 4. Create ports between adjacent tiles and between tiles and filler regions
 */
export function generateConvexViaTopologyRegions(opts: {
  viaTile: ViaTile
  bounds: Bounds
  tileWidth?: number
  tileHeight?: number
  tileSize?: number
  portPitch?: number
  clearance?: number
  concavityTolerance?: number
}): {
  regions: JRegion[]
  ports: JPort[]
  viaTile: ViaTile
  tileCount: { rows: number; cols: number }
} {
  const tileWidth = opts.tileWidth ?? opts.tileSize ?? opts.viaTile.tileWidth
  const tileHeight = opts.tileHeight ?? opts.tileSize ?? opts.viaTile.tileHeight

  if (tileWidth === undefined || tileHeight === undefined) {
    throw new Error(
      "tileWidth and tileHeight must be provided either in opts or in viaTile",
    )
  }
  const portPitch = opts.portPitch ?? DEFAULT_PORT_PITCH
  const clearance = opts.clearance ?? DEFAULT_CLEARANCE
  const concavityTolerance = opts.concavityTolerance ?? 0
  const { bounds, viaTile: inputViaTile } = opts
  const { viasByNet, routeSegments } = inputViaTile

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  const cols = Math.floor(width / tileWidth)
  const rows = Math.floor(height / tileHeight)

  const allRegions: JRegion[] = []
  const allPorts: JPort[] = []
  const viaTile: ViaTile = { viasByNet: {}, routeSegments: [] }
  const viaRegions: JRegion[] = []
  const convexRegions: JRegion[] = []

  // Calculate tile grid position (centered within bounds)
  const gridWidth = cols * tileWidth
  const gridHeight = rows * tileHeight
  const gridMinX = bounds.minX + (width - gridWidth) / 2
  const gridMinY = bounds.minY + (height - gridHeight) / 2
  const gridMaxX = gridMinX + gridWidth
  const gridMaxY = gridMinY + gridHeight
  const halfWidth = tileWidth / 2
  const halfHeight = tileHeight / 2

  let portIdCounter = 0

  // Track used port positions to prevent duplicates
  // Duplicates can occur when a via region shares edges with multiple convex
  // regions that meet at the same corner point
  const usedPortPositions = new Set<string>()
  const getPortPosKey = (x: number, y: number) =>
    `${x.toFixed(4)},${y.toFixed(4)}`

  // Helper to create a port between two regions (skips if position already used)
  const createPort = (
    portId: string,
    region1: JRegion,
    region2: JRegion,
    pos: { x: number; y: number },
  ): JPort | null => {
    const posKey = getPortPosKey(pos.x, pos.y)
    if (usedPortPositions.has(posKey)) {
      return null
    }
    usedPortPositions.add(posKey)
    const port: JPort = {
      portId,
      region1,
      region2,
      d: { x: pos.x, y: pos.y },
    }
    region1.ports.push(port)
    region2.ports.push(port)
    allPorts.push(port)
    return port
  }

  // Step 1: Compute unit tile template (only once)
  let unitTileTemplate: UnitTileTemplate | null = null
  if (rows > 0 && cols > 0) {
    unitTileTemplate = isBakedViaTile(inputViaTile)
      ? computeUnitTileTemplateFromBakedViaTile(
          inputViaTile,
          tileWidth,
          tileHeight,
        )
      : computeUnitTileTemplate(
          inputViaTile,
          tileWidth,
          tileHeight,
          clearance,
          concavityTolerance,
        )
  }
  const useBakedInternalPorts = Boolean(
    unitTileTemplate && unitTileTemplate.internalPorts.length > 0,
  )

  // Step 2: Replicate tiles across the grid
  if (rows > 0 && cols > 0 && unitTileTemplate) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileCenterX = gridMinX + col * tileWidth + halfWidth
        const tileCenterY = gridMinY + row * tileHeight + halfHeight
        const prefix = `t${row}_${col}`
        const tileRegionByTemplateId = new Map<string, JRegion>()

        // Create via regions for this tile (translated from template)
        for (const templateViaRegion of unitTileTemplate.viaRegions) {
          const translatedPolygon = translatePolygon(
            templateViaRegion.polygon,
            tileCenterX,
            tileCenterY,
          )

          const viaRegionId = replaceTilePrefix(
            templateViaRegion.templateRegionId,
            prefix,
          )
          const viaRegion = createRegionFromPolygon(
            viaRegionId,
            translatedPolygon,
            { isViaRegion: true },
          )
          viaRegions.push(viaRegion)
          allRegions.push(viaRegion)
          tileRegionByTemplateId.set(
            templateViaRegion.templateRegionId,
            viaRegion,
          )
        }

        // Create convex regions for this tile (translated from template)
        for (const templateConvexRegion of unitTileTemplate.convexRegions) {
          const translatedPolygon = translatePolygon(
            templateConvexRegion.polygon,
            tileCenterX,
            tileCenterY,
          )

          const convexRegionId = replaceTilePrefix(
            templateConvexRegion.templateRegionId,
            prefix,
          )
          const convexRegion = createRegionFromPolygon(
            convexRegionId,
            translatedPolygon,
          )
          convexRegions.push(convexRegion)
          allRegions.push(convexRegion)
          tileRegionByTemplateId.set(
            templateConvexRegion.templateRegionId,
            convexRegion,
          )
        }

        // Create tile-internal ports directly from baked template ports
        if (useBakedInternalPorts) {
          for (const templatePort of unitTileTemplate.internalPorts) {
            const region1 = tileRegionByTemplateId.get(
              templatePort.templateRegion1Id,
            )
            const region2 = tileRegionByTemplateId.get(
              templatePort.templateRegion2Id,
            )
            if (!region1 || !region2) {
              throw new Error(
                `Missing region for baked port template ${templatePort.templatePortId} in tile ${prefix}.`,
              )
            }
            createPort(
              `${prefix}:baked:${templatePort.templatePortId}:${portIdCounter++}`,
              region1,
              region2,
              {
                x: templatePort.position.x + tileCenterX,
                y: templatePort.position.y + tileCenterY,
              },
            )
          }
        }

        // Add vias to output viaTile
        for (const [netName, vias] of Object.entries(viasByNet)) {
          if (vias.length === 0) continue

          const translatedVias = translateVias(
            vias,
            tileCenterX,
            tileCenterY,
            prefix,
          )

          if (!viaTile.viasByNet[netName]) {
            viaTile.viasByNet[netName] = []
          }
          viaTile.viasByNet[netName].push(...translatedVias)
        }

        viaTile.routeSegments.push(
          ...translateRouteSegments(
            routeSegments,
            tileCenterX,
            tileCenterY,
            prefix,
          ),
        )
      }
    }
  }

  // Step 3: Create rectangular filler regions for outer areas
  // - Top/bottom: height = margin, width = portPitch (trace width)
  // - Left/right: width = margin, height = portPitch (trace width)
  // - Corner assignment: if top/bottom margin >= left/right margin, top/bottom get corners
  const fillerRegions: JRegion[] = []

  const topMargin = bounds.maxY - gridMaxY
  const bottomMargin = gridMinY - bounds.minY
  const leftMargin = gridMinX - bounds.minX
  const rightMargin = bounds.maxX - gridMaxX

  // Determine which direction gets corners based on larger margins
  const verticalMargin = Math.max(topMargin, bottomMargin)
  const horizontalMargin = Math.max(leftMargin, rightMargin)
  const topBottomGetCorners = verticalMargin >= horizontalMargin

  // Filler regions are multiple small rectangles (strips) along each edge:
  // - Top edge: multiple strips (portPitch width x topMargin height)
  // - Bottom edge: multiple strips (portPitch width x bottomMargin height)
  // - Left edge: multiple strips (leftMargin width x portPitch height)
  // - Right edge: multiple strips (rightMargin width x portPitch height)
  //
  // Corner assignment determines which edges extend to include corners:
  // - If topBottomGetCorners: top/bottom strips extend into corner areas
  // - Otherwise: left/right strips extend into corner areas

  // Calculate the extent for each edge (including corners if applicable)
  const topMinX = topBottomGetCorners ? bounds.minX : gridMinX
  const topMaxX = topBottomGetCorners ? bounds.maxX : gridMaxX
  const bottomMinX = topBottomGetCorners ? bounds.minX : gridMinX
  const bottomMaxX = topBottomGetCorners ? bounds.maxX : gridMaxX
  const leftMinY = topBottomGetCorners ? gridMinY : bounds.minY
  const leftMaxY = topBottomGetCorners ? gridMaxY : bounds.maxY
  const rightMinY = topBottomGetCorners ? gridMinY : bounds.minY
  const rightMaxY = topBottomGetCorners ? gridMaxY : bounds.maxY

  // Create top filler strips
  // Strip width = margin (same as height), but at least portPitch (trace width)
  if (topMargin > 0.001) {
    const topWidth = topMaxX - topMinX
    const targetStripWidth = Math.max(topMargin, portPitch)
    const numTopStrips = Math.max(1, Math.floor(topWidth / targetStripWidth))
    const stripWidth = topWidth / numTopStrips

    for (let i = 0; i < numTopStrips; i++) {
      const fillerBounds: Bounds = {
        minX: topMinX + i * stripWidth,
        maxX: topMinX + (i + 1) * stripWidth,
        minY: gridMaxY,
        maxY: bounds.maxY,
      }
      const regionId = `filler:top:${i}`
      const filler = createRegionFromPolygon(
        regionId,
        rectPolygonFromBounds(fillerBounds),
      )
      fillerRegions.push(filler)
      allRegions.push(filler)
    }
  }

  // Create bottom filler strips
  // Strip width = margin (same as height), but at least portPitch (trace width)
  if (bottomMargin > 0.001) {
    const bottomWidth = bottomMaxX - bottomMinX
    const targetStripWidth = Math.max(bottomMargin, portPitch)
    const numBottomStrips = Math.max(
      1,
      Math.floor(bottomWidth / targetStripWidth),
    )
    const stripWidth = bottomWidth / numBottomStrips

    for (let i = 0; i < numBottomStrips; i++) {
      const fillerBounds: Bounds = {
        minX: bottomMinX + i * stripWidth,
        maxX: bottomMinX + (i + 1) * stripWidth,
        minY: bounds.minY,
        maxY: gridMinY,
      }
      const regionId = `filler:bottom:${i}`
      const filler = createRegionFromPolygon(
        regionId,
        rectPolygonFromBounds(fillerBounds),
      )
      fillerRegions.push(filler)
      allRegions.push(filler)
    }
  }

  // Create left filler strips
  // Strip height = margin (same as width), but at least portPitch (trace width)
  if (leftMargin > 0.001) {
    const leftHeight = leftMaxY - leftMinY
    const targetStripHeight = Math.max(leftMargin, portPitch)
    const numLeftStrips = Math.max(
      1,
      Math.floor(leftHeight / targetStripHeight),
    )
    const stripHeight = leftHeight / numLeftStrips

    for (let i = 0; i < numLeftStrips; i++) {
      const fillerBounds: Bounds = {
        minX: bounds.minX,
        maxX: gridMinX,
        minY: leftMinY + i * stripHeight,
        maxY: leftMinY + (i + 1) * stripHeight,
      }
      const regionId = `filler:left:${i}`
      const filler = createRegionFromPolygon(
        regionId,
        rectPolygonFromBounds(fillerBounds),
      )
      fillerRegions.push(filler)
      allRegions.push(filler)
    }
  }

  // Create right filler strips
  // Strip height = margin (same as width), but at least portPitch (trace width)
  if (rightMargin > 0.001) {
    const rightHeight = rightMaxY - rightMinY
    const targetStripHeight = Math.max(rightMargin, portPitch)
    const numRightStrips = Math.max(
      1,
      Math.floor(rightHeight / targetStripHeight),
    )
    const stripHeight = rightHeight / numRightStrips

    for (let i = 0; i < numRightStrips; i++) {
      const fillerBounds: Bounds = {
        minX: gridMaxX,
        maxX: bounds.maxX,
        minY: rightMinY + i * stripHeight,
        maxY: rightMinY + (i + 1) * stripHeight,
      }
      const regionId = `filler:right:${i}`
      const filler = createRegionFromPolygon(
        regionId,
        rectPolygonFromBounds(fillerBounds),
      )
      fillerRegions.push(filler)
      allRegions.push(filler)
    }
  }

  // Step 4: Fallback runtime generation for convex<->convex tile-internal ports.
  // When baked internal ports are available, they are created in Step 2.
  if (unitTileTemplate && rows > 0 && cols > 0 && !useBakedInternalPorts) {
    const regionsPerTile = unitTileTemplate.convexRegions.length

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileIndex = row * cols + col
        const tileStartIdx = tileIndex * regionsPerTile

        // Create ports between convex regions within this tile
        for (let i = 0; i < regionsPerTile; i++) {
          for (let j = i + 1; j < regionsPerTile; j++) {
            const region1 = convexRegions[tileStartIdx + i]
            const region2 = convexRegions[tileStartIdx + j]

            const sharedEdges = findSharedEdges(
              region1.d.polygon!,
              region2.d.polygon!,
              clearance * 2,
            )

            for (const edge of sharedEdges) {
              const portPositions = createPortsAlongEdge(edge, portPitch)

              for (const pos of portPositions) {
                createPort(
                  `t${row}_${col}:convex:${i}-${j}:${portIdCounter++}`,
                  region1,
                  region2,
                  pos,
                )
              }
            }
          }
        }
      }
    }
  }

  // Step 5: Create ports between adjacent tiles (horizontal and vertical neighbors)
  // Use fixed port positions along tile boundaries to ensure connectivity even when
  // convex regions don't perfectly align at tile edges
  // Include both convex and via regions since via regions may extend to tile boundaries
  if (unitTileTemplate && rows > 0 && cols > 0) {
    const convexPerTile = unitTileTemplate.convexRegions.length
    const viasPerTile = unitTileTemplate.viaRegions.length

    // Generate port y-positions along vertical tile boundary
    const numVerticalPorts = Math.floor(tileHeight / portPitch)
    const verticalPortYOffsets: number[] = []
    for (let i = 0; i < numVerticalPorts; i++) {
      verticalPortYOffsets.push(-halfHeight + (i + 0.5) * portPitch)
    }

    // Generate port x-positions along horizontal tile boundary
    const numHorizontalPorts = Math.floor(tileWidth / portPitch)
    const horizontalPortXOffsets: number[] = []
    for (let i = 0; i < numHorizontalPorts; i++) {
      horizontalPortXOffsets.push(-halfWidth + (i + 0.5) * portPitch)
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileIndex = row * cols + col
        const convexStartIdx = tileIndex * convexPerTile
        const viaStartIdx = tileIndex * viasPerTile
        const tileCenterX = gridMinX + col * tileWidth + halfWidth
        const tileCenterY = gridMinY + row * tileHeight + halfHeight

        // Get all regions for this tile (convex + via)
        const tileConvexRegions = convexRegions.slice(
          convexStartIdx,
          convexStartIdx + convexPerTile,
        )
        const tileViaRegions = viaRegions.slice(
          viaStartIdx,
          viaStartIdx + viasPerTile,
        )
        const tileAllRegions = [...tileConvexRegions, ...tileViaRegions]

        // Check right neighbor - create ports along vertical boundary
        if (col + 1 < cols) {
          const rightTileIndex = row * cols + (col + 1)
          const rightConvexStartIdx = rightTileIndex * convexPerTile
          const rightViaStartIdx = rightTileIndex * viasPerTile

          const rightTileConvexRegions = convexRegions.slice(
            rightConvexStartIdx,
            rightConvexStartIdx + convexPerTile,
          )
          const rightTileViaRegions = viaRegions.slice(
            rightViaStartIdx,
            rightViaStartIdx + viasPerTile,
          )
          const rightTileAllRegions = [
            ...rightTileConvexRegions,
            ...rightTileViaRegions,
          ]

          // Boundary x-coordinate (right edge of current tile)
          const boundaryX = tileCenterX + halfWidth

          for (const yOffset of verticalPortYOffsets) {
            const portY = tileCenterY + yOffset
            // Point slightly inside current tile (left of boundary)
            const pointInCurrentTile = { x: boundaryX - 0.01, y: portY }
            // Point slightly inside right tile (right of boundary)
            const pointInRightTile = { x: boundaryX + 0.01, y: portY }

            const region1 = findRegionContainingPoint(
              pointInCurrentTile,
              tileAllRegions,
            )
            const region2 = findRegionContainingPoint(
              pointInRightTile,
              rightTileAllRegions,
            )

            if (region1 && region2) {
              createPort(
                `tile:${row}_${col}-${row}_${col + 1}:${portIdCounter++}`,
                region1,
                region2,
                { x: boundaryX, y: portY },
              )
            }
          }
        }

        // Check top neighbor - create ports along horizontal boundary
        if (row + 1 < rows) {
          const topTileIndex = (row + 1) * cols + col
          const topConvexStartIdx = topTileIndex * convexPerTile
          const topViaStartIdx = topTileIndex * viasPerTile

          const topTileConvexRegions = convexRegions.slice(
            topConvexStartIdx,
            topConvexStartIdx + convexPerTile,
          )
          const topTileViaRegions = viaRegions.slice(
            topViaStartIdx,
            topViaStartIdx + viasPerTile,
          )
          const topTileAllRegions = [
            ...topTileConvexRegions,
            ...topTileViaRegions,
          ]

          // Boundary y-coordinate (top edge of current tile)
          const boundaryY = tileCenterY + halfHeight

          for (const xOffset of horizontalPortXOffsets) {
            const portX = tileCenterX + xOffset
            // Point slightly inside current tile (below boundary)
            const pointInCurrentTile = { x: portX, y: boundaryY - 0.01 }
            // Point slightly inside top tile (above boundary)
            const pointInTopTile = { x: portX, y: boundaryY + 0.01 }

            const region1 = findRegionContainingPoint(
              pointInCurrentTile,
              tileAllRegions,
            )
            const region2 = findRegionContainingPoint(
              pointInTopTile,
              topTileAllRegions,
            )

            if (region1 && region2) {
              createPort(
                `tile:${row}_${col}-${row + 1}_${col}:${portIdCounter++}`,
                region1,
                region2,
                { x: portX, y: boundaryY },
              )
            }
          }
        }
      }
    }
  }

  // Step 6: Create ports between tile edge regions and filler regions
  // Check both convex regions and via regions (via regions may touch tile edge when extended)
  // Ports are placed at the CENTER of each filler strip to prevent diagonal routes
  // Track port positions per filler region to ensure minimum spacing of portPitch
  //
  // Instead of using findSharedEdges (which can fail with short tile edges),
  // we directly check for bounds adjacency based on the filler region's edge.
  const fillerPortPositions = new Map<string, Array<{ x: number; y: number }>>()
  for (const fillerRegion of fillerRegions) {
    fillerPortPositions.set(fillerRegion.regionId, [])
    const fillerBounds = fillerRegion.d.bounds
    const stripWidth = fillerBounds.maxX - fillerBounds.minX
    const stripHeight = fillerBounds.maxY - fillerBounds.minY
    const isHorizontalStrip = stripWidth > stripHeight

    // Calculate the number of ports and their positions along the filler strip
    // For horizontal strips (top/bottom): ports at evenly-spaced X positions
    // For vertical strips (left/right): ports at evenly-spaced Y positions
    const stripSize = isHorizontalStrip ? stripWidth : stripHeight
    const numPorts = Math.max(1, Math.floor(stripSize / portPitch))
    const actualPitch = stripSize / numPorts

    // Determine which edge of the filler region is adjacent to the tile grid
    // based on the filler region's position relative to the grid
    const adjacencyTolerance = clearance * 2
    const isTopFiller = fillerRegion.regionId.startsWith("filler:top:")
    const isBottomFiller = fillerRegion.regionId.startsWith("filler:bottom:")
    const isLeftFiller = fillerRegion.regionId.startsWith("filler:left:")
    const isRightFiller = fillerRegion.regionId.startsWith("filler:right:")

    // Find which tile regions (convex or via) are adjacent to this filler region
    const tileRegions = [...convexRegions, ...viaRegions]
    for (const tileRegion of tileRegions) {
      const tileBounds = tileRegion.d.bounds
      const eps = 0.001

      // Check if the tile region is adjacent to this filler region
      // based on bounds overlap and edge proximity
      let isAdjacent = false
      let edgeX: number | null = null
      let edgeY: number | null = null

      if (isHorizontalStrip) {
        // For horizontal strips (top/bottom), check X overlap and Y adjacency
        const overlapMinX = Math.max(fillerBounds.minX, tileBounds.minX)
        const overlapMaxX = Math.min(fillerBounds.maxX, tileBounds.maxX)
        const hasXOverlap = overlapMaxX > overlapMinX + eps

        if (hasXOverlap) {
          if (isTopFiller) {
            // Top filler: tile should be adjacent to filler's bottom edge (minY)
            isAdjacent =
              Math.abs(tileBounds.maxY - fillerBounds.minY) < adjacencyTolerance
            edgeY = fillerBounds.minY
          } else if (isBottomFiller) {
            // Bottom filler: tile should be adjacent to filler's top edge (maxY)
            isAdjacent =
              Math.abs(tileBounds.minY - fillerBounds.maxY) < adjacencyTolerance
            edgeY = fillerBounds.maxY
          }
        }
      } else {
        // For vertical strips (left/right), check Y overlap and X adjacency
        const overlapMinY = Math.max(fillerBounds.minY, tileBounds.minY)
        const overlapMaxY = Math.min(fillerBounds.maxY, tileBounds.maxY)
        const hasYOverlap = overlapMaxY > overlapMinY + eps

        if (hasYOverlap) {
          if (isLeftFiller) {
            // Left filler: tile should be adjacent to filler's right edge (maxX)
            isAdjacent =
              Math.abs(tileBounds.minX - fillerBounds.maxX) < adjacencyTolerance
            edgeX = fillerBounds.maxX
          } else if (isRightFiller) {
            // Right filler: tile should be adjacent to filler's left edge (minX)
            isAdjacent =
              Math.abs(tileBounds.maxX - fillerBounds.minX) < adjacencyTolerance
            edgeX = fillerBounds.minX
          }
        }
      }

      if (!isAdjacent) continue

      // Create ports based on the overlap region between filler and tile
      // Calculate the overlap region first
      let overlapMin: number
      let overlapMax: number
      if (isHorizontalStrip) {
        overlapMin = Math.max(fillerBounds.minX, tileBounds.minX)
        overlapMax = Math.min(fillerBounds.maxX, tileBounds.maxX)
      } else {
        overlapMin = Math.max(fillerBounds.minY, tileBounds.minY)
        overlapMax = Math.min(fillerBounds.maxY, tileBounds.maxY)
      }

      const overlapSize = overlapMax - overlapMin
      if (overlapSize < eps) continue

      // Calculate number of ports based on overlap size, ensuring at least 1 port
      const overlapNumPorts = Math.max(1, Math.floor(overlapSize / portPitch))
      const overlapActualPitch = overlapSize / overlapNumPorts

      for (let i = 0; i < overlapNumPorts; i++) {
        let pos: { x: number; y: number }

        if (isHorizontalStrip) {
          // Port X is centered within each segment of the overlap region
          const x = overlapMin + (i + 0.5) * overlapActualPitch
          pos = { x, y: edgeY! }
        } else {
          // Port Y is centered within each segment of the overlap region
          const y = overlapMin + (i + 0.5) * overlapActualPitch
          pos = { x: edgeX!, y }
        }

        // Verify the port position is actually within the tile region's polygon
        // (bounding box overlap doesn't guarantee polygon overlap for non-rectangular polygons)
        if (tileRegion.d.polygon) {
          // Test a point inside the tile region's polygon
          // The test point needs to be far enough from the edge to be inside the polygon,
          // accounting for the gap between the filler and tile region
          // Use the gap distance + a small margin to ensure we're inside the tile polygon
          let testPoint: Point
          if (isTopFiller) {
            // Gap is fillerBounds.minY - tileBounds.maxY, test point should be inside tile
            const gap = fillerBounds.minY - tileBounds.maxY
            const testOffset = gap + 0.01
            testPoint = { x: pos.x, y: pos.y - testOffset }
          } else if (isBottomFiller) {
            const gap = tileBounds.minY - fillerBounds.maxY
            const testOffset = gap + 0.01
            testPoint = { x: pos.x, y: pos.y + testOffset }
          } else if (isLeftFiller) {
            const gap = tileBounds.minX - fillerBounds.maxX
            const testOffset = gap + 0.01
            testPoint = { x: pos.x + testOffset, y: pos.y }
          } else {
            // isRightFiller
            const gap = fillerBounds.minX - tileBounds.maxX
            const testOffset = gap + 0.01
            testPoint = { x: pos.x - testOffset, y: pos.y }
          }

          if (!pointInPolygon(testPoint, tileRegion.d.polygon)) {
            continue // Skip this port position as it's outside the tile region's polygon
          }
        }

        // Check if this position is too close to an existing port in this filler region
        const existingPositions = fillerPortPositions.get(
          fillerRegion.regionId,
        )!
        const tooClose = existingPositions.some((existing) => {
          const dist = Math.sqrt(
            (pos.x - existing.x) ** 2 + (pos.y - existing.y) ** 2,
          )
          return dist < portPitch
        })

        if (tooClose) {
          continue
        }

        // Track this position
        existingPositions.push(pos)

        createPort(
          `filler:${tileRegion.regionId}-${fillerRegion.regionId}:${portIdCounter++}`,
          tileRegion,
          fillerRegion,
          pos,
        )
      }
    }
  }

  // Step 7: Create ports between adjacent filler regions
  // Always create at least one port at the midpoint for connectivity,
  // even if the edge is shorter than portPitch
  for (let i = 0; i < fillerRegions.length; i++) {
    for (let j = i + 1; j < fillerRegions.length; j++) {
      const region1 = fillerRegions[i]
      const region2 = fillerRegions[j]

      const sharedEdges = findSharedEdges(
        region1.d.polygon!,
        region2.d.polygon!,
        0.01,
      )

      for (const edge of sharedEdges) {
        // Calculate edge length
        const edgeLength = Math.sqrt(
          (edge.to.x - edge.from.x) ** 2 + (edge.to.y - edge.from.y) ** 2,
        )

        // Skip edges that are essentially zero-length
        if (edgeLength < 0.01) {
          continue
        }

        // For short edges, just create one port at the midpoint
        // For longer edges, distribute ports along the edge
        let portPositions: Array<{ x: number; y: number }>
        if (edgeLength < portPitch) {
          // Single port at midpoint for short edges
          portPositions = [
            {
              x: (edge.from.x + edge.to.x) / 2,
              y: (edge.from.y + edge.to.y) / 2,
            },
          ]
        } else {
          portPositions = createPortsAlongEdge(edge, portPitch)
        }

        for (const pos of portPositions) {
          createPort(
            `filler:${region1.regionId}-${region2.regionId}:${portIdCounter++}`,
            region1,
            region2,
            pos,
          )
        }
      }
    }
  }

  // Step 8: Via-side ports (legacy runtime generation path).
  // Keep this enabled even with baked convex<->convex ports to preserve
  // established solver behavior for via-side connectivity.
  //
  // Create ports between via regions and adjacent regions (convex or filler)
  // Each via region gets exactly 1 port on each side (top, bottom, left, right)
  // at the midpoint of the segment that defines that side's extreme
  // Search all non-via regions (convex + filler) for adjacency
  const nonViaRegions = allRegions.filter((r) => !r.d.isViaRegion)
  const createdViaSidePorts = new Set<string>() // Track "viaRegionId:side" to avoid duplicates

  for (const viaRegion of viaRegions) {
    const sidePorts = findViaRegionSidePorts(viaRegion.d.polygon!)
    const viaBounds = viaRegion.d.bounds

    // For each side, find adjacent regions and create a single port
    const sides = ["top", "bottom", "left", "right"] as const
    for (const side of sides) {
      const portPos = sidePorts[side]
      if (!portPos) continue

      // Skip if we already created a port for this via region side
      const sideKey = `${viaRegion.regionId}:${side}`
      if (createdViaSidePorts.has(sideKey)) continue

      // Find adjacent region by checking bounds adjacency and containment of test point
      // We look for a region that:
      // 1. Has bounds adjacent to the via region's side
      // 2. Contains a test point just outside the via region on that side
      const adjacencyTolerance = 0.2 // Allow small gap between regions (clearance)
      const testOffset = adjacencyTolerance // Test point must be beyond any clearance gap

      let testPoint: Point
      switch (side) {
        case "top":
          testPoint = { x: portPos.x, y: viaBounds.maxY + testOffset }
          break
        case "bottom":
          testPoint = { x: portPos.x, y: viaBounds.minY - testOffset }
          break
        case "left":
          testPoint = { x: viaBounds.minX - testOffset, y: portPos.y }
          break
        case "right":
          testPoint = { x: viaBounds.maxX + testOffset, y: portPos.y }
          break
      }

      for (const adjacentRegion of nonViaRegions) {
        const adjBounds = adjacentRegion.d.bounds

        // Check if bounds are potentially adjacent on this side
        let boundsAdjacent = false
        switch (side) {
          case "top":
            // Adjacent region should be above (its minY near our maxY)
            boundsAdjacent =
              Math.abs(adjBounds.minY - viaBounds.maxY) < adjacencyTolerance &&
              adjBounds.minX < portPos.x &&
              adjBounds.maxX > portPos.x
            break
          case "bottom":
            // Adjacent region should be below (its maxY near our minY)
            boundsAdjacent =
              Math.abs(adjBounds.maxY - viaBounds.minY) < adjacencyTolerance &&
              adjBounds.minX < portPos.x &&
              adjBounds.maxX > portPos.x
            break
          case "left":
            // Adjacent region should be to the left (its maxX near our minX)
            boundsAdjacent =
              Math.abs(adjBounds.maxX - viaBounds.minX) < adjacencyTolerance &&
              adjBounds.minY < portPos.y &&
              adjBounds.maxY > portPos.y
            break
          case "right":
            // Adjacent region should be to the right (its minX near our maxX)
            boundsAdjacent =
              Math.abs(adjBounds.minX - viaBounds.maxX) < adjacencyTolerance &&
              adjBounds.minY < portPos.y &&
              adjBounds.maxY > portPos.y
            break
        }

        if (!boundsAdjacent) continue

        // Verify the test point is inside the adjacent region's polygon
        if (
          adjacentRegion.d.polygon &&
          pointInPolygon(testPoint, adjacentRegion.d.polygon)
        ) {
          createPort(
            `via-side:${viaRegion.regionId}:${side}:${portIdCounter++}`,
            viaRegion,
            adjacentRegion,
            portPos,
          )
          createdViaSidePorts.add(sideKey)
          break // Only one port per side per via region
        }
      }
    }
  }

  return {
    regions: allRegions,
    ports: allPorts,
    viaTile,
    tileCount: { rows, cols },
  }
}
