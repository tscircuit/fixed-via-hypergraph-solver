/**
 * Parallel benchmark for FixedViaHypergraphSolver on a dataset JSON with convex regions.
 *
 * Usage: bun scripts/benchmark-dataset02.ts [options] [via-json-file]
 *
 * This script uses a single file approach where worker code is embedded as a string
 * and executed via eval in the worker thread.
 */
import * as fs from "node:fs"
import { cpus } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import type { ViaTile } from "../lib/type"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = process.argv.slice(2)
const limitArg = args.find((a) => a.startsWith("--limit="))
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="))
const datasetPathArg = args.find((a) => a.startsWith("--dataset-path="))
const samplesArg = args.find((a) => a.startsWith("--samples="))
const parallelArg = args.find((a) => a.startsWith("--parallel="))
const viaTileArg = args.filter((a) => !a.startsWith("--")).at(-1)
const DATASET_PATH_OPT = datasetPathArg?.split("=")[1]
const QUICK_MODE = args.includes("--quick")
const HELP = args.includes("--help") || args.includes("-h")

const parsePositiveInt = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

const SAMPLE_LIMIT =
  parsePositiveInt(limitArg?.split("=")[1]) ??
  parsePositiveInt(samplesArg?.split("=")[1])

const rawConcurrency =
  parsePositiveInt(concurrencyArg?.split("=")[1]) ??
  parsePositiveInt(parallelArg?.split("=")[1]) ??
  cpus().length

if (HELP) {
  console.log(`
Usage: bun scripts/benchmark-dataset02.ts [options] [via-json-file]

Options:
  --limit=N           Only run first N samples (default: all)
  --concurrency=N     Number of parallel workers (default: CPU count = ${cpus().length})
  --dataset-path=P    Dataset JSON path to benchmark (default: lib/datasets/dataset02.json)
  --quick             Use reduced MAX_ITERATIONS for faster but less accurate results
  [via-json-file]     Optional via JSON file path (default: auto-recommended per sample)
  --help, -h          Show this help message

Aliases:
  --samples=N         Alias for --limit=N
  --parallel=N        Alias for --concurrency=N

Examples:
  bun scripts/benchmark-dataset02.ts --limit=100
  bun scripts/benchmark-dataset02.ts --dataset-path=./lib/datasets/dataset02.json --limit=10
  bun scripts/benchmark-dataset02.ts --concurrency=4 --quick
  bun scripts/benchmark-dataset02.ts --limit=200 --concurrency=8
  bun scripts/benchmark-dataset02.ts --quick assets/FixedViaHypergraphSolver/via-tile-4-regions-baked.json
`)
  process.exit(0)
}

type DatasetSample = {
  config: {
    numCrossings: number
    seed: number
    rows: number
    cols: number
    orientation: "vertical" | "horizontal"
  }
  connections: {
    connectionId: string
    startRegionId: string
    endRegionId: string
  }[]
  connectionRegions: {
    regionId: string
    pointIds: string[]
    d: {
      bounds: { minX: number; maxX: number; minY: number; maxY: number }
      center: { x: number; y: number }
      isPad: boolean
      isConnectionRegion: boolean
    }
  }[]
}

type BenchmarkResult = {
  sampleIndex: number
  numCrossings: number
  seed: number
  rows: number
  cols: number
  orientation: "vertical" | "horizontal"
  selectedViaRegionName: string
  solved: boolean
  failed: boolean
  iterations: number
  duration: number
  tileRows: number
  tileCols: number
  convexRegions: number
  viaRegions: number
  error?: string
}

type WorkerMessage = {
  taskId: number
  result: BenchmarkResult
}

const median = (numbers: number[]): number | undefined => {
  if (numbers.length === 0) return undefined
  const sorted = numbers.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted[middle]
}

const percentile = (numbers: number[], p: number): number | undefined => {
  if (numbers.length === 0) return undefined
  const sorted = numbers.slice().sort((a, b) => a - b)
  const index = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[index]
}

const mean = (numbers: number[]): number | undefined => {
  if (numbers.length === 0) return undefined
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length
}

const workerCode = `
const { parentPort, workerData } = require("worker_threads")
const { pathToFileURL } = require("url")

let apiPromise = null

const loadApi = async () => {
  if (!apiPromise) {
    apiPromise = import(pathToFileURL(workerData.distPath).href)
  }
  return apiPromise
}

const toErrorResult = (sampleIndex, sample, viaRegionName, errorMessage) => ({
  sampleIndex,
  numCrossings: sample?.config?.numCrossings ?? 0,
  seed: sample?.config?.seed ?? 0,
  rows: sample?.config?.rows ?? 0,
  cols: sample?.config?.cols ?? 0,
  orientation: sample?.config?.orientation ?? "vertical",
  selectedViaRegionName: viaRegionName || "auto-select-per-sample",
  solved: false,
  failed: true,
  iterations: 0,
  duration: 0,
  tileRows: 0,
  tileCols: 0,
  convexRegions: 0,
  viaRegions: 0,
  error: errorMessage,
})

function extractXYConnections(sample) {
  const regionMap = new Map(
    sample.connectionRegions.map((r) => [r.regionId, r.d.center]),
  )

  return sample.connections.map((conn) => {
    const start = regionMap.get(conn.startRegionId)
    const end = regionMap.get(conn.endRegionId)

    if (!start || !end) {
      throw new Error("Missing region for connection " + conn.connectionId)
    }

    return {
      connectionId: conn.connectionId,
      start,
      end,
    }
  })
}

function getTileCountFromViaTile(viaTile) {
  if (!viaTile || !viaTile.viasByNet) {
    return { rows: 0, cols: 0 }
  }

  let maxRow = -1
  let maxCol = -1
  const prefixRe = /^t(\\d+)_(\\d+):/

  for (const vias of Object.values(viaTile.viasByNet)) {
    for (const via of vias) {
      if (!via || typeof via.viaId !== "string") continue
      const match = via.viaId.match(prefixRe)
      if (!match) continue
      const row = Number.parseInt(match[1], 10)
      const col = Number.parseInt(match[2], 10)
      if (Number.isFinite(row) && row > maxRow) maxRow = row
      if (Number.isFinite(col) && col > maxCol) maxCol = col
    }
  }

  return {
    rows: maxRow >= 0 ? maxRow + 1 : 0,
    cols: maxCol >= 0 ? maxCol + 1 : 0,
  }
}

async function solveSample(sampleIndex, sample) {
  try {
    const mod = await loadApi()
    const {
      FixedViaHypergraphSolver,
      recommendViaTileFromGraphInput,
    } = mod

    const { viaTile, viaRegionName, quickMode } = workerData

    const xyConnections = extractXYConnections(sample)
    const problemInput = { sample }
    const selectedViaRegionName = viaTile
      ? viaRegionName
      : recommendViaTileFromGraphInput(problemInput, xyConnections)
          .recommendedViaRegionName

    const solverOpts = quickMode
      ? {
          inputConnections: xyConnections,
          viaTile,
          options: {
            solver: {
              baseMaxIterations: 50000,
            },
          },
        }
      : {
          inputConnections: xyConnections,
          viaTile,
        }

    const solver = new FixedViaHypergraphSolver(solverOpts)
    const startTime = performance.now()
    solver.solve()
    const duration = performance.now() - startTime

    const convexRegions = solver.graph.regions.filter(
      (r) => typeof r.regionId === "string" && r.regionId.includes(":convex:"),
    ).length
    const viaRegions = solver.graph.regions.filter(
      (r) => r.d && r.d.isViaRegion,
    ).length
    const tileCount = getTileCountFromViaTile(solver.viaTile)

    return {
      sampleIndex,
      numCrossings: sample.config.numCrossings,
      seed: sample.config.seed,
      rows: sample.config.rows,
      cols: sample.config.cols,
      orientation: sample.config.orientation,
      selectedViaRegionName,
      solved: solver.solved,
      failed: solver.failed,
      iterations: solver.iterations,
      duration,
      tileRows: tileCount.rows,
      tileCols: tileCount.cols,
      convexRegions,
      viaRegions,
    }
  } catch (e) {
    return toErrorResult(
      sampleIndex,
      sample,
      workerData.viaRegionName,
      e instanceof Error ? e.message : String(e),
    )
  }
}

parentPort.on("message", async (task) => {
  const { taskId, sampleIndex, sample } = task
  const result = await solveSample(sampleIndex, sample)
  parentPort.postMessage({ taskId, result })
})
`

const createErrorResultFromSample = (
  sampleIndex: number,
  sample: DatasetSample,
  viaRegionName: string,
  error: string,
): BenchmarkResult => ({
  sampleIndex,
  numCrossings: sample.config.numCrossings,
  seed: sample.config.seed,
  rows: sample.config.rows,
  cols: sample.config.cols,
  orientation: sample.config.orientation,
  selectedViaRegionName: viaRegionName,
  solved: false,
  failed: true,
  iterations: 0,
  duration: 0,
  tileRows: 0,
  tileCols: 0,
  convexRegions: 0,
  viaRegions: 0,
  error,
})

async function runParallelBenchmark(
  samples: DatasetSample[],
  viaTile: ViaTile | undefined,
  viaRegionName: string,
  requestedConcurrency: number,
  quickMode: boolean,
  distPath: string,
  onProgress: (completed: number, results: BenchmarkResult[]) => void,
): Promise<BenchmarkResult[]> {
  if (samples.length === 0) return []

  const concurrency = Math.min(
    Math.max(
      1,
      Number.isFinite(requestedConcurrency) ? requestedConcurrency : 1,
    ),
    samples.length,
  )

  const results: Array<BenchmarkResult | undefined> = Array(
    samples.length,
  ).fill(undefined)
  const completedTaskIds = new Set<number>()
  const taskQueue = Array.from({ length: samples.length }, (_, i) => i)

  type WorkerState = {
    id: number
    worker: Worker
    busy: boolean
    currentTaskId: number | null
    alive: boolean
  }

  const workers: WorkerState[] = []
  let completed = 0
  let resolveDone: (() => void) | null = null
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const completeTask = (taskId: number, result: BenchmarkResult) => {
    if (completedTaskIds.has(taskId)) return
    completedTaskIds.add(taskId)
    results[taskId] = result
    completed += 1
    onProgress(completed, results.filter(Boolean) as BenchmarkResult[])
    if (completed >= samples.length) {
      resolveDone?.()
    }
  }

  const assignNextTask = (state: WorkerState) => {
    if (!state.alive || state.busy) return
    const nextTaskId = taskQueue.shift()
    if (nextTaskId == null) return
    state.busy = true
    state.currentTaskId = nextTaskId
    state.worker.postMessage({
      taskId: nextTaskId,
      sampleIndex: nextTaskId,
      sample: samples[nextTaskId],
    })
  }

  const createWorker = (id: number): WorkerState => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        viaTile,
        viaRegionName,
        quickMode,
        distPath,
      },
    })

    const state: WorkerState = {
      id,
      worker,
      busy: false,
      currentTaskId: null,
      alive: true,
    }

    worker.on("message", (msg: WorkerMessage) => {
      const taskId = msg?.taskId
      const result = msg?.result
      if (typeof taskId !== "number" || !result) return

      completeTask(taskId, result)
      state.busy = false
      state.currentTaskId = null
      assignNextTask(state)
    })

    worker.on("error", (err: Error) => {
      const failedTaskId = state.currentTaskId
      if (failedTaskId != null && !completedTaskIds.has(failedTaskId)) {
        completeTask(
          failedTaskId,
          createErrorResultFromSample(
            failedTaskId,
            samples[failedTaskId],
            viaRegionName,
            err.message,
          ),
        )
      }

      state.alive = false
      state.busy = false
      state.currentTaskId = null

      if (completed < samples.length) {
        const replacement = createWorker(state.id)
        workers[state.id] = replacement
        assignNextTask(replacement)
      }
    })

    worker.on("exit", (code) => {
      if (!state.alive) return

      const failedTaskId = state.currentTaskId
      if (
        code !== 0 &&
        failedTaskId != null &&
        !completedTaskIds.has(failedTaskId)
      ) {
        completeTask(
          failedTaskId,
          createErrorResultFromSample(
            failedTaskId,
            samples[failedTaskId],
            viaRegionName,
            `Worker exited with code ${code}`,
          ),
        )
      }

      state.alive = false
      state.busy = false
      state.currentTaskId = null

      if (code !== 0 && completed < samples.length) {
        const replacement = createWorker(state.id)
        workers[state.id] = replacement
        assignNextTask(replacement)
      }
    })

    return state
  }

  for (let i = 0; i < concurrency; i++) {
    workers.push(createWorker(i))
  }

  for (const workerState of workers) {
    assignNextTask(workerState)
  }

  await donePromise

  await Promise.all(
    workers.map(async (state) => {
      if (!state.alive) return
      state.alive = false
      await state.worker.terminate()
    }),
  )

  return results as BenchmarkResult[]
}

const datasetPath = DATASET_PATH_OPT
  ? path.isAbsolute(DATASET_PATH_OPT)
    ? DATASET_PATH_OPT
    : path.resolve(process.cwd(), DATASET_PATH_OPT)
  : path.join(__dirname, "../lib/datasets/dataset02.json")

if (!fs.existsSync(datasetPath)) {
  console.error(`Error: dataset JSON file not found: ${datasetPath}`)
  process.exit(1)
}

const dataset: DatasetSample[] = JSON.parse(
  fs.readFileSync(datasetPath, "utf8"),
)

const viaTilePath = viaTileArg
  ? path.isAbsolute(viaTileArg)
    ? viaTileArg
    : path.resolve(process.cwd(), viaTileArg)
  : undefined

if (viaTilePath && !fs.existsSync(viaTilePath)) {
  console.error(`Error: via JSON file not found: ${viaTilePath}`)
  process.exit(1)
}

const viaTile: ViaTile | undefined = viaTilePath
  ? JSON.parse(fs.readFileSync(viaTilePath, "utf8"))
  : undefined

const viaRegionName = viaTilePath
  ? path.basename(viaTilePath, path.extname(viaTilePath))
  : "auto-select-per-sample"

const distPath = path.join(__dirname, "../dist/index.js")
if (!fs.existsSync(distPath)) {
  console.error(
    "Error: dist/index.js not found. Please run `bun run build` first.",
  )
  process.exit(1)
}

const samplesToRun = SAMPLE_LIMIT ? dataset.slice(0, SAMPLE_LIMIT) : dataset
const totalSamples = samplesToRun.length

const activeWorkers = Math.min(Math.max(1, rawConcurrency), totalSamples || 1)
const initialQueueDepth = Math.max(0, totalSamples - activeWorkers)

console.log(
  "Benchmark: FixedViaHypergraphSolver with Convex Regions (Parallel)",
)
console.log("=".repeat(70))
console.log(`Loaded ${dataset.length} samples from ${datasetPath}`)
console.log(
  viaTilePath
    ? `Via topology loaded from ${viaTilePath}`
    : "Via topology: auto-recommended per sample",
)
console.log(`Concurrency: ${activeWorkers} workers`)
console.log(`Active workers: ${activeWorkers}`)
console.log(`Initial queue depth: ${initialQueueDepth}`)
if (SAMPLE_LIMIT) console.log(`Sample limit: ${SAMPLE_LIMIT}`)
if (QUICK_MODE) console.log("Quick mode: enabled (reduced MAX_ITERATIONS)")
console.log()

const startTime = Date.now()
let lastProgressTime = Date.now()

const printProgress = (completed: number, results: BenchmarkResult[]) => {
  const now = Date.now()
  if (now - lastProgressTime >= 1000 || completed === totalSamples) {
    const solvedCount = results.filter((r) => r.solved).length
    const failedCount = results.filter((r) => r.failed && !r.solved).length
    const elapsed = ((now - startTime) / 1000).toFixed(1)
    const rate =
      completed > 0 ? ((solvedCount / completed) * 100).toFixed(1) : "0.0"
    const samplesPerSec = (completed / ((now - startTime) / 1000)).toFixed(1)

    console.log(
      `[${elapsed}s] ${completed}/${totalSamples} (${samplesPerSec}/s) | Solved: ${solvedCount} | Failed: ${failedCount} | Rate: ${rate}%`,
    )

    lastProgressTime = now
  }
}

const results = await runParallelBenchmark(
  samplesToRun,
  viaTile,
  viaRegionName,
  rawConcurrency,
  QUICK_MODE,
  distPath,
  printProgress,
)
const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\nCompleted in ${totalElapsed}s\n`)

const solvedResults = results.filter((r) => r.solved)
const failedResults = results.filter((r) => r.failed && !r.solved)
const unsolved = results.filter((r) => !r.solved)
const successRate = (solvedResults.length / results.length) * 100

console.log("=".repeat(70))
console.log("Overall Results")
console.log("=".repeat(70))
console.log(`Total samples:  ${results.length}`)
console.log(
  `Solved:         ${solvedResults.length} (${successRate.toFixed(1)}%)`,
)
console.log(
  `Failed:         ${failedResults.length} (${((failedResults.length / results.length) * 100).toFixed(1)}%)`,
)
console.log(
  `Unsolved:       ${unsolved.length} (${((unsolved.length / results.length) * 100).toFixed(1)}%)`,
)

const avgConvexRegions = mean(solvedResults.map((r) => r.convexRegions))
const avgViaRegions = mean(solvedResults.map((r) => r.viaRegions))
console.log(`\nAvg convex regions: ${avgConvexRegions?.toFixed(1) ?? "N/A"}`)
console.log(`Avg via regions:    ${avgViaRegions?.toFixed(1) ?? "N/A"}`)

const solvedIterations = solvedResults.map((r) => r.iterations)
const solvedDurations = solvedResults.map((r) => r.duration)

console.log("\n" + "=".repeat(70))
console.log("Performance Statistics (Solved Samples)")
console.log("=".repeat(70))
console.log(
  `Iterations - Mean: ${mean(solvedIterations)?.toFixed(0) ?? "N/A"}, Median: ${median(solvedIterations)?.toFixed(0) ?? "N/A"}, P90: ${percentile(solvedIterations, 90)?.toFixed(0) ?? "N/A"}, P99: ${percentile(solvedIterations, 99)?.toFixed(0) ?? "N/A"}`,
)
console.log(
  `Duration (ms) - Mean: ${mean(solvedDurations)?.toFixed(1) ?? "N/A"}, Median: ${median(solvedDurations)?.toFixed(1) ?? "N/A"}, P90: ${percentile(solvedDurations, 90)?.toFixed(1) ?? "N/A"}, P99: ${percentile(solvedDurations, 99)?.toFixed(1) ?? "N/A"}`,
)

console.log("\n" + "=".repeat(70))
console.log("Success Rate by Crossing Count")
console.log("=".repeat(70))

const crossingGroups = new Map<
  number,
  { solved: number; total: number; iterations: number[]; durations: number[] }
>()

for (const r of results) {
  const crossings = r.numCrossings
  if (!crossingGroups.has(crossings)) {
    crossingGroups.set(crossings, {
      solved: 0,
      total: 0,
      iterations: [],
      durations: [],
    })
  }
  const group = crossingGroups.get(crossings)!
  group.total++
  if (r.solved) {
    group.solved++
    group.iterations.push(r.iterations)
    group.durations.push(r.duration)
  }
}

const sortedCrossings = Array.from(crossingGroups.entries()).sort(
  (a, b) => a[0] - b[0],
)

for (const [crossings, { solved, total, iterations }] of sortedCrossings) {
  const pct = ((solved / total) * 100).toFixed(0)
  const medIters = median(iterations)?.toFixed(0) ?? "N/A"
  console.log(
    `  ${crossings.toString().padStart(2)} crossings: ${solved.toString().padStart(3)}/${total.toString().padStart(3)} (${pct.padStart(3)}%) | Median iters: ${medIters}`,
  )
}

if (unsolved.length > 0) {
  console.log("\n" + "=".repeat(70))
  console.log("Unsolved Samples")
  console.log("=".repeat(70))
  for (const r of unsolved.slice(0, 30)) {
    console.log(
      `  Sample ${r.sampleIndex}: ${r.numCrossings} crossings, ${r.rows}x${r.cols} ${r.orientation}, seed=${r.seed}${r.error ? ` (error: ${r.error})` : ""}`,
    )
  }
}

console.log("\n" + "=".repeat(70))
console.log("Benchmark Complete")
console.log("=".repeat(70))
