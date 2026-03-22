import type { JPort, JRegion } from "../type"
import {
  chordsCross,
  getPortPerimeterTInRegion,
  getRegionPerimeter,
  perimeterTPolygon,
} from "../graph-utils/perimeterChordUtils"
import type { RegionPortAssignment } from "../type"

type Point = { x: number; y: number }

/**
 * Check if two 2D line segments intersect (excluding shared endpoints).
 * Uses the cross product method for robust intersection detection.
 * Also detects T-intersections where one segment's endpoint lies on the other segment.
 */
function lineSegmentsIntersect(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
  eps = 1e-9,
): boolean {
  // Check if points are coincident (shared endpoint)
  const pointsCoincident = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps

  if (
    pointsCoincident(p1, p3) ||
    pointsCoincident(p1, p4) ||
    pointsCoincident(p2, p3) ||
    pointsCoincident(p2, p4)
  ) {
    return false
  }

  // Cross product of vectors
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)

  // Check if segments straddle each other (proper crossing)
  if (d1 * d2 < 0 && d3 * d4 < 0) {
    return true
  }

  // Check for T-intersections: one segment's endpoint lies ON the other segment
  // This happens when one cross product is ~0 and the point is within segment bounds
  const pointOnSegment = (
    point: Point,
    segStart: Point,
    segEnd: Point,
    crossProduct: number,
  ) => {
    if (Math.abs(crossProduct) > eps) return false
    // Point is on the line, check if it's within segment bounds
    const minX = Math.min(segStart.x, segEnd.x) - eps
    const maxX = Math.max(segStart.x, segEnd.x) + eps
    const minY = Math.min(segStart.y, segEnd.y) - eps
    const maxY = Math.max(segStart.y, segEnd.y) + eps
    return (
      point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    )
  }

  // Check if p1 or p2 lies on segment p3-p4 (but not at endpoints, already checked)
  if (pointOnSegment(p1, p3, p4, d1)) {
    // p1 is on segment p3-p4, check it's not at the endpoints
    if (!pointsCoincident(p1, p3) && !pointsCoincident(p1, p4)) {
      return true
    }
  }
  if (pointOnSegment(p2, p3, p4, d2)) {
    if (!pointsCoincident(p2, p3) && !pointsCoincident(p2, p4)) {
      return true
    }
  }

  // Check if p3 or p4 lies on segment p1-p2 (but not at endpoints)
  if (pointOnSegment(p3, p1, p2, d3)) {
    if (!pointsCoincident(p3, p1) && !pointsCoincident(p3, p2)) {
      return true
    }
  }
  if (pointOnSegment(p4, p1, p2, d4)) {
    if (!pointsCoincident(p4, p1) && !pointsCoincident(p4, p2)) {
      return true
    }
  }

  return false
}

/**
 * Maps a point to a 1D coordinate along a polygon's perimeter.
 *
 * Finds the closest edge of the polygon to the point, projects the point
 * onto that edge, then returns the cumulative distance along the polygon
 * perimeter up to that projection.
 *
 * This is the polygon-aware equivalent of `perimeterT` which only works
 * with axis-aligned bounding boxes.
 */
export function polygonPerimeterT(
  p: { x: number; y: number },
  polygon: { x: number; y: number }[],
): number {
  return perimeterTPolygon(p, polygon)
}

/**
 * Check if two chords cross, using both perimeter-based and geometric checks.
 * The perimeter-based check works for chords that span across a region,
 * but fails when both endpoints of a chord are on the same edge.
 * In that case, we fall back to actual 2D line segment intersection.
 */
function chordsIntersect(
  newChord: [number, number],
  existingChord: [number, number],
  perimeter: number,
  newPort1: JPort,
  newPort2: JPort,
  existingPort1: JPort,
  existingPort2: JPort,
): boolean {
  // First try the perimeter-based crossing check
  if (chordsCross(newChord, existingChord, perimeter)) {
    return true
  }

  // If perimeter check didn't find a crossing, also check 2D line segment
  // intersection. This catches cases where ports are on the same edge.
  return lineSegmentsIntersect(
    newPort1.d,
    newPort2.d,
    existingPort1.d,
    existingPort2.d,
  )
}

/**
 * Compute the number of crossings between a new port pair and existing
 * assignments in a polygon region.
 *
 * Uses polygon perimeter mapping instead of bounding-box mapping.
 * Also performs 2D line segment intersection check as fallback for
 * cases where both ports of a chord are on the same polygon edge.
 */
export function computeDifferentNetCrossingsForPolygon(
  region: JRegion,
  port1: JPort,
  port2: JPort,
): number {
  const polygon = region.d.polygon
  if (!polygon || polygon.length < 3) {
    // Fallback: no polygon, use 0 crossings (shouldn't happen for via regions)
    return 0
  }

  const perimeter = getRegionPerimeter(region)
  const t1 = getPortPerimeterTInRegion(port1, region)
  const t2 = getPortPerimeterTInRegion(port2, region)
  const newChord: [number, number] = [t1, t2]

  let crossings = 0
  const assignments = region.assignments ?? []

  for (const assignment of assignments) {
    const existingPort1 = assignment.regionPort1 as JPort
    const existingPort2 = assignment.regionPort2 as JPort
    const existingT1 = getPortPerimeterTInRegion(existingPort1, region)
    const existingT2 = getPortPerimeterTInRegion(existingPort2, region)
    const existingChord: [number, number] = [existingT1, existingT2]

    if (
      chordsIntersect(
        newChord,
        existingChord,
        perimeter,
        port1,
        port2,
        existingPort1,
        existingPort2,
      )
    ) {
      crossings++
    }
  }

  return crossings
}

/**
 * Compute the assignments that would cross with a new port pair in a
 * polygon region.
 *
 * Uses polygon perimeter mapping instead of bounding-box mapping.
 * Also performs 2D line segment intersection check as fallback for
 * cases where both ports of a chord are on the same polygon edge.
 */
export function computeCrossingAssignmentsForPolygon(
  region: JRegion,
  port1: JPort,
  port2: JPort,
): RegionPortAssignment[] {
  const polygon = region.d.polygon
  if (!polygon || polygon.length < 3) {
    return []
  }

  const perimeter = getRegionPerimeter(region)
  const t1 = getPortPerimeterTInRegion(port1, region)
  const t2 = getPortPerimeterTInRegion(port2, region)
  const newChord: [number, number] = [t1, t2]

  const crossingAssignments: RegionPortAssignment[] = []
  const assignments = region.assignments ?? []

  for (const assignment of assignments) {
    const existingPort1 = assignment.regionPort1 as JPort
    const existingPort2 = assignment.regionPort2 as JPort
    const existingT1 = getPortPerimeterTInRegion(existingPort1, region)
    const existingT2 = getPortPerimeterTInRegion(existingPort2, region)
    const existingChord: [number, number] = [existingT1, existingT2]

    if (
      chordsIntersect(
        newChord,
        existingChord,
        perimeter,
        port1,
        port2,
        existingPort1,
        existingPort2,
      )
    ) {
      crossingAssignments.push(assignment)
    }
  }

  return crossingAssignments
}
