#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { visualizeViaGraph } from "../lib/graph-utils/visualizeRegionPortGraph"
import type { ViaTile } from "../lib/type"
import { generateViaTopologyRegions } from "../lib/FixedViaHypergraphSolver/via-graph-generator/generateViaTopologyRegions"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_INPUT_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "FixedViaHypergraphSolver",
  "via-tile.json",
)
const DEFAULT_OUTPUT_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "FixedViaHypergraphSolver",
  "via-topology.svg",
)

function buildViaTopologySvg(viaTile: ViaTile): string {
  const topology = generateViaTopologyRegions(viaTile, {
    graphSize: 5,
    idPrefix: "via",
  })

  // Assign a distinct color to each net
  const netNames = Object.keys(viaTile.viasByNet)
  const netColors: Record<string, string> = {}
  const colorPalette = [
    "rgba(231, 76, 60, 0.35)",
    "rgba(46, 204, 113, 0.35)",
    "rgba(52, 152, 219, 0.35)",
    "rgba(243, 156, 18, 0.35)",
    "rgba(155, 89, 182, 0.35)",
    "rgba(26, 188, 156, 0.35)",
    "rgba(241, 196, 15, 0.35)",
    "rgba(230, 126, 34, 0.35)",
  ]
  for (let i = 0; i < netNames.length; i++) {
    netColors[netNames[i]] = colorPalette[i % colorPalette.length]
  }

  const graphics = visualizeViaGraph({
    ports: topology.ports,
    regions: topology.regions,
  })

  // Override polygon fills for per-net regions with distinct colors
  const regionPrefix = topology.regions[0]?.regionId.split(":")[0]
  if (regionPrefix && graphics.polygons) {
    for (let i = 0; i < topology.regions.length; i++) {
      const regionId = topology.regions[i].regionId
      const netName = regionId.replace(`${regionPrefix}:`, "")
      if (netName in netColors) {
        graphics.polygons[i].fill = netColors[netName]
      }
    }
  }

  // Overlay via circles with matching net colors
  for (const [netName, vias] of Object.entries(viaTile.viasByNet)) {
    for (const via of vias) {
      graphics.circles!.push({
        center: via.position,
        radius: via.diameter / 2,
        fill: netColors[netName].replace("0.35", "0.5"),
        label: netName,
      })
    }
  }

  return getSvgFromGraphicsObject(graphics)
}

export async function writeViaTopologySvg(
  viaTile: ViaTile,
  outputPath: string,
): Promise<void> {
  const svg = buildViaTopologySvg(viaTile)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, svg)
}

async function main() {
  const inputArg = process.argv[2]
  const outputArg = process.argv[3]
  const inputPath = inputArg
    ? path.isAbsolute(inputArg)
      ? inputArg
      : path.resolve(process.cwd(), inputArg)
    : DEFAULT_INPUT_PATH
  const outputPath = outputArg
    ? path.isAbsolute(outputArg)
      ? outputArg
      : path.resolve(process.cwd(), outputArg)
    : DEFAULT_OUTPUT_PATH

  const viaTile: ViaTile = JSON.parse(await fs.readFile(inputPath, "utf8"))
  await writeViaTopologySvg(viaTile, outputPath)
  console.log(`Written ${outputPath}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
