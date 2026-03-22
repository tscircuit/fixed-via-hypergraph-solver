#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { visualizeViaGraph } from "../lib/graph-utils/visualizeRegionPortGraph"
import type { JPort, JRegion, ViaTile } from "../lib/type"
import { generateConvexViaTopologyRegions } from "../lib/FixedViaHypergraphSolver/via-graph-generator/generateConvexViaTopologyRegions"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "FixedViaHypergraphSolver",
)
const DEFAULT_INPUT_FILES = [
  "via-tile-3-regions.json",
  "via-tile-4-regions.json",
  "via-tile-5-regions.json",
  "via-tile-6-regions.json",
]
const NET_COLOR_PALETTE = [
  "rgba(231, 76, 60, 0.35)",
  "rgba(46, 204, 113, 0.35)",
  "rgba(52, 152, 219, 0.35)",
  "rgba(243, 156, 18, 0.35)",
  "rgba(155, 89, 182, 0.35)",
  "rgba(26, 188, 156, 0.35)",
  "rgba(241, 196, 15, 0.35)",
  "rgba(230, 126, 34, 0.35)",
]

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

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
  ports: BakedViaTilePort[]
}

const parseViaNetName = (regionId: string): string | undefined => {
  const marker = ":v:"
  const markerIndex = regionId.lastIndexOf(marker)
  if (markerIndex === -1) return undefined
  return regionId.slice(markerIndex + marker.length)
}

const serializeRegion = (region: JRegion): BakedViaTileRegion => ({
  regionId: region.regionId,
  polygon: region.d.polygon ?? [],
  bounds: {
    minX: region.d.bounds.minX,
    maxX: region.d.bounds.maxX,
    minY: region.d.bounds.minY,
    maxY: region.d.bounds.maxY,
  },
  center: { x: region.d.center.x, y: region.d.center.y },
  isViaRegion: Boolean(region.d.isViaRegion),
  netName: parseViaNetName(region.regionId),
})

const serializePort = (port: JPort): BakedViaTilePort => ({
  portId: port.portId,
  region1Id: port.region1.regionId,
  region2Id: port.region2.regionId,
  position: { x: port.d.x, y: port.d.y },
})

type BakedPortStats = {
  total: number
  convexToConvex: number
  viaToConvex: number
  viaToVia: number
  unknown: number
}

function getBakedPortStats(bakedViaTile: BakedViaTile): BakedPortStats {
  const regionById = new Map(
    bakedViaTile.regions.map((region) => [region.regionId, region]),
  )

  const stats: BakedPortStats = {
    total: bakedViaTile.ports.length,
    convexToConvex: 0,
    viaToConvex: 0,
    viaToVia: 0,
    unknown: 0,
  }

  for (const port of bakedViaTile.ports) {
    const region1 = regionById.get(port.region1Id)
    const region2 = regionById.get(port.region2Id)
    if (!region1 || !region2) {
      stats.unknown += 1
      continue
    }

    if (region1.isViaRegion && region2.isViaRegion) {
      stats.viaToVia += 1
    } else if (region1.isViaRegion || region2.isViaRegion) {
      stats.viaToConvex += 1
    } else {
      stats.convexToConvex += 1
    }
  }

  return stats
}

function buildHydratedGraphFromBakedViaTile(bakedViaTile: BakedViaTile): {
  regions: JRegion[]
  ports: JPort[]
} {
  const regions: JRegion[] = bakedViaTile.regions.map((region) => ({
    regionId: region.regionId,
    ports: [],
    d: {
      bounds: region.bounds,
      center: region.center,
      polygon: region.polygon,
      isPad: false,
      isViaRegion: region.isViaRegion,
    },
  }))

  const regionById = new Map(regions.map((region) => [region.regionId, region]))
  const ports: JPort[] = []

  for (const bakedPort of bakedViaTile.ports) {
    const region1 = regionById.get(bakedPort.region1Id)
    const region2 = regionById.get(bakedPort.region2Id)
    if (!region1 || !region2) {
      throw new Error(
        `Baked port ${bakedPort.portId} references missing regions (${bakedPort.region1Id}, ${bakedPort.region2Id}).`,
      )
    }

    const port: JPort = {
      portId: bakedPort.portId,
      region1,
      region2,
      d: {
        x: bakedPort.position.x,
        y: bakedPort.position.y,
      },
    }
    region1.ports.push(port)
    region2.ports.push(port)
    ports.push(port)
  }

  return { regions, ports }
}

function bakeViaTile(
  viaTile: ViaTile,
  opts?: {
    tileWidth?: number
    tileHeight?: number
    portPitch?: number
    clearance?: number
    concavityTolerance?: number
  },
): {
  bakedViaTile: BakedViaTile
  totalGeneratedPortCount: number
  droppedPortCount: number
} {
  const tileWidth = opts?.tileWidth ?? viaTile.tileWidth
  const tileHeight = opts?.tileHeight ?? viaTile.tileHeight

  if (tileWidth === undefined || tileHeight === undefined) {
    throw new Error(
      "Cannot bake via tile without tileWidth and tileHeight (in input or opts).",
    )
  }

  const singleTileBounds = {
    minX: -tileWidth / 2,
    maxX: tileWidth / 2,
    minY: -tileHeight / 2,
    maxY: tileHeight / 2,
  }

  const singleTile = generateConvexViaTopologyRegions({
    viaTile,
    bounds: singleTileBounds,
    tileWidth,
    tileHeight,
    portPitch: opts?.portPitch,
    clearance: opts?.clearance,
    concavityTolerance: opts?.concavityTolerance,
  })

  const insideRegions = singleTile.regions.filter(
    (region) => !region.regionId.startsWith("filler:"),
  )
  const insideRegionIds = new Set(
    insideRegions.map((region) => region.regionId),
  )
  const insidePorts = singleTile.ports.filter(
    (port) =>
      insideRegionIds.has(port.region1.regionId) &&
      insideRegionIds.has(port.region2.regionId),
  )

  const bakedViaTile: BakedViaTile = {
    ...viaTile,
    tileWidth,
    tileHeight,
    regions: insideRegions.map(serializeRegion),
    ports: insidePorts.map(serializePort),
  }

  return {
    bakedViaTile,
    totalGeneratedPortCount: singleTile.ports.length,
    droppedPortCount: singleTile.ports.length - insidePorts.length,
  }
}

function buildBakedViaTileSvg(bakedViaTile: BakedViaTile): string {
  const tileWidth = bakedViaTile.tileWidth
  const tileHeight = bakedViaTile.tileHeight
  if (tileWidth === undefined || tileHeight === undefined) {
    throw new Error(
      "Cannot render baked via tile SVG without tileWidth and tileHeight.",
    )
  }

  const { regions, ports } = buildHydratedGraphFromBakedViaTile(bakedViaTile)

  const graphics = visualizeViaGraph(
    { regions, ports },
    {
      hideRegionPortLines: false,
      hideConnectionLines: true,
      hidePortPoints: false,
    },
  ) as Required<ReturnType<typeof visualizeViaGraph>>

  for (const polygon of graphics.polygons) {
    polygon.stroke = "rgba(120, 120, 120, 0.55)"
    polygon.strokeWidth = 0.009
  }

  const outerIds = new Set(["T", "B", "L", "R"])
  const netColorMap = new Map<string, string>()
  let netColorIndex = 0
  let polyIndex = 0
  for (const bakedRegion of bakedViaTile.regions) {
    const hasPolygon = bakedRegion.polygon.length >= 3
    if (!hasPolygon) continue

    const suffix = bakedRegion.regionId.split(":").pop() ?? ""
    const isOuter = outerIds.has(suffix)
    if (!isOuter) {
      if (!netColorMap.has(suffix)) {
        netColorMap.set(
          suffix,
          NET_COLOR_PALETTE[netColorIndex % NET_COLOR_PALETTE.length],
        )
        netColorIndex++
      }
      if (graphics.polygons[polyIndex]) {
        graphics.polygons[polyIndex].fill = netColorMap.get(suffix)!
      }
    }
    polyIndex++
  }

  if (!graphics.circles) graphics.circles = []
  for (const [netName, vias] of Object.entries(bakedViaTile.viasByNet)) {
    const fill = (netColorMap.get(netName) ?? "rgba(255, 0, 0, 0.35)").replace(
      "0.35",
      "0.5",
    )
    for (const via of vias) {
      graphics.circles.push({
        center: via.position,
        radius: via.diameter / 2,
        fill,
        label: netName,
      })
    }
  }

  return getSvgFromGraphicsObject(graphics)
}

function toAbsPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input)
}

function outputPathsForInput(inputPath: string): {
  bakedJsonPath: string
  bakedSvgPath: string
} {
  const ext = path.extname(inputPath)
  const base = ext ? inputPath.slice(0, -ext.length) : inputPath
  return {
    bakedJsonPath: `${base}-baked.json`,
    bakedSvgPath: `${base}-baked.svg`,
  }
}

async function writeBakedOutputs(
  bakedViaTile: BakedViaTile,
  bakedJsonPath: string,
  bakedSvgPath: string,
): Promise<void> {
  const svg = buildBakedViaTileSvg(bakedViaTile)
  await fs.mkdir(path.dirname(bakedJsonPath), { recursive: true })
  await fs.writeFile(
    bakedJsonPath,
    `${JSON.stringify(bakedViaTile, null, 2)}\n`,
    "utf8",
  )
  await fs.mkdir(path.dirname(bakedSvgPath), { recursive: true })
  await fs.writeFile(bakedSvgPath, `${svg}\n`, "utf8")
}

async function main() {
  const inputArgs = process.argv.slice(2)
  const inputPaths =
    inputArgs.length > 0
      ? inputArgs.map(toAbsPath)
      : DEFAULT_INPUT_FILES.map((name) => path.join(ASSETS_DIR, name))

  for (const inputPath of inputPaths) {
    const fileContent = await fs.readFile(inputPath, "utf8")
    const viaTile: ViaTile = JSON.parse(fileContent)
    const { bakedViaTile, totalGeneratedPortCount, droppedPortCount } =
      bakeViaTile(viaTile)
    const { bakedJsonPath, bakedSvgPath } = outputPathsForInput(inputPath)

    await writeBakedOutputs(bakedViaTile, bakedJsonPath, bakedSvgPath)

    const regionCount = bakedViaTile.regions.length
    const viaRegionCount = bakedViaTile.regions.filter(
      (r) => r.isViaRegion,
    ).length
    const convexRegionCount = regionCount - viaRegionCount
    const portStats = getBakedPortStats(bakedViaTile)
    const regionsWithPorts = bakedViaTile.regions.filter((region) =>
      bakedViaTile.ports.some(
        (port) =>
          port.region1Id === region.regionId ||
          port.region2Id === region.regionId,
      ),
    ).length

    console.log(
      `Baked ${path.basename(inputPath)} -> ${path.basename(bakedJsonPath)} (${regionCount} regions: ${convexRegionCount} convex + ${viaRegionCount} via)`,
    )
    console.log(
      `Ports: ${portStats.total} total (convex<->convex=${portStats.convexToConvex}, via<->convex=${portStats.viaToConvex}, via<->via=${portStats.viaToVia}${portStats.unknown > 0 ? `, unknown=${portStats.unknown}` : ""})`,
    )
    console.log(
      `Port coverage: generated=${totalGeneratedPortCount}, baked=${bakedViaTile.ports.length}, dropped=${droppedPortCount}, regionsWithPorts=${regionsWithPorts}/${regionCount}`,
    )
    console.log(`SVG: ${bakedSvgPath}`)
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
