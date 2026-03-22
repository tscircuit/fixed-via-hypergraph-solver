#!/usr/bin/env bun

import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(
  SCRIPT_DIR,
  "..",
  "assets",
  "FixedViaHypergraphSolver",
)

const SOURCE_TILES = [
  "3-via-regions.kicad_pcb",
  "4-via-regions.kicad_pcb",
  "5-via-regions.kicad_pcb",
  "6-via-regions.kicad_pcb",
]

function runScript(scriptName: string, args: string[]): void {
  execFileSync("bun", [path.join(SCRIPT_DIR, scriptName), ...args], {
    stdio: "inherit",
  })
}

function main(): void {
  for (const sourceName of SOURCE_TILES) {
    const sourcePath = path.join(ASSETS_DIR, sourceName)
    const netCount = sourceName.split("-")[0]
    const outName = `via-tile-${netCount}-regions`
    runScript("parse-kicad-pcb-via-tile.ts", [sourcePath, outName])
  }

  runScript("generate-baked-via-tiles.ts", [])
}

main()
