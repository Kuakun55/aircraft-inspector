const MODEL_URL = "/model/best.onnx"
const INPUT_SIZE = 640
const CONF_THRESHOLD = 0.02
const IOU_THRESHOLD = 0.45
const CLASS_NAMES = ["missing-head", "paint-off", "rust", "scratch"]

let session: any = null

async function ensureOrtLoaded(): Promise<any> {
  if ((globalThis as any).ort) return (globalThis as any).ort
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/ort.min.js"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Cannot load ONNX Runtime"))
    document.head.appendChild(script)
  })
  return (globalThis as any).ort
}

export async function loadYoloModel(): Promise<void> {
  if (session) return
  const ort = await ensureOrtLoaded()
  ort.env.wasm.wasmPaths = "/"

  const resp = await fetch(MODEL_URL, { cache: "no-store" })
  if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`)
  const modelBuffer = await resp.arrayBuffer()

  try {
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["webgl"],
    })
  } catch {
    ort.env.wasm.numThreads = 1
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
    })
  }
}

export function isModelLoaded(): boolean {
  return session !== null
}

interface YoloPrediction {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
  class_id: number
}

export async function runYoloInference(imageElement: HTMLImageElement): Promise<{
  predictions: YoloPrediction[]
  time: number
  image: { width: number; height: number }
}> {
  if (!session) throw new Error("Model not loaded")

  const startTime = performance.now()
  const { tensor, scale, padX, padY } = preprocessImage(imageElement)

  const feeds: Record<string, any> = {}
  feeds[session.inputNames[0]] = tensor

  const results = await session.run(feeds)
  const output = results[session.outputNames[0]]
  const predictions = postprocess(output, scale, padX, padY)

  const time = (performance.now() - startTime) / 1000
  return { predictions, time, image: { width: imageElement.width, height: imageElement.height } }
}

function preprocessImage(img: HTMLImageElement): {
  tensor: any; scale: number; padX: number; padY: number
} {
  const canvas = document.createElement("canvas")
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  const ctx = canvas.getContext("2d")!

  const scale = Math.min(INPUT_SIZE / img.width, INPUT_SIZE / img.height)
  const scaledW = Math.round(img.width * scale)
  const scaledH = Math.round(img.height * scale)
  const padX = Math.floor((INPUT_SIZE - scaledW) / 2)
  const padY = Math.floor((INPUT_SIZE - scaledH) / 2)

  ctx.fillStyle = "#808080"
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  ctx.drawImage(img, padX, padY, scaledW, scaledH)

  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const float32Data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32Data[i] = imageData[i * 4] / 255.0
    float32Data[INPUT_SIZE * INPUT_SIZE + i] = imageData[i * 4 + 1] / 255.0
    float32Data[2 * INPUT_SIZE * INPUT_SIZE + i] = imageData[i * 4 + 2] / 255.0
  }

  const ort = (globalThis as any).ort
  const tensor = new ort.Tensor("float32", float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE])
  return { tensor, scale, padX, padY }
}

function postprocess(output: any, scale: number, padX: number, padY: number): YoloPrediction[] {
  const data = output.data as Float32Array
  const numBoxes = output.dims[2]
  const numClasses = output.dims[1] - 4

  // Detect if outputs are logits (many negative/>1 values) or probabilities
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
  let negCount = 0, overOneCount = 0
  const step = Math.max(1, Math.floor(numBoxes / 50))
  for (let i = 0; i < numBoxes; i += step) {
    for (let c = 0; c < numClasses; c++) {
      const v = data[(4 + c) * numBoxes + i]
      if (v < 0) negCount++
      if (v > 1) overOneCount++
    }
  }
  const needsSigmoid = negCount > 5 || overOneCount > 5
  const getScore = (raw: number) => needsSigmoid ? sigmoid(raw) : raw

  const boxes: Array<{ x1: number; y1: number; x2: number; y2: number; score: number; classId: number }> = []

  for (let i = 0; i < numBoxes; i++) {
    let maxScore = 0, classId = 0
    for (let c = 0; c < numClasses; c++) {
      const score = getScore(data[(4 + c) * numBoxes + i])
      if (score > maxScore) { maxScore = score; classId = c }
    }
    if (maxScore < CONF_THRESHOLD) continue

    const cx = data[0 * numBoxes + i]
    const cy = data[1 * numBoxes + i]
    const w  = data[2 * numBoxes + i]
    const h  = data[3 * numBoxes + i]
    boxes.push({
      x1: (cx - w / 2 - padX) / scale,
      y1: (cy - h / 2 - padY) / scale,
      x2: (cx + w / 2 - padX) / scale,
      y2: (cy + h / 2 - padY) / scale,
      score: maxScore,
      classId,
    })
  }

  return nms(boxes, IOU_THRESHOLD).map(b => ({
    x: (b.x1 + b.x2) / 2,
    y: (b.y1 + b.y2) / 2,
    width:  b.x2 - b.x1,
    height: b.y2 - b.y1,
    confidence: b.score,
    class: CLASS_NAMES[b.classId] ?? `class_${b.classId}`,
    class_id: b.classId,
  }))
}

function iou(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1)
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  return inter / ((a.x2-a.x1)*(a.y2-a.y1) + (b.x2-b.x1)*(b.y2-b.y1) - inter + 1e-6)
}

function nms<T extends { x1: number; y1: number; x2: number; y2: number; score: number }>(
  boxes: T[], threshold: number
): T[] {
  boxes.sort((a, b) => b.score - a.score)
  const kept: T[] = []
  const suppressed = new Set<number>()
  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue
    kept.push(boxes[i])
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed.has(j) && iou(boxes[i], boxes[j]) > threshold) suppressed.add(j)
    }
  }
  return kept
}
