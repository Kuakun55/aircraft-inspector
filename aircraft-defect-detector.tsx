"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, CameraOff, Database, Scan, AlertTriangle } from 'lucide-react'
import { loadYoloModel, runYoloInference, isModelLoaded } from "@/lib/yolo-inference"

interface Detection {
  x: number; y: number; width: number; height: number
  confidence: number; class: string; class_id: number
}
interface DetectionResult {
  predictions?: Detection[]; time?: number; image?: { width: number; height: number }
}

const CLASS_COLORS: Record<string, string> = {
  "missing-head": "#ef4444",
  "paint-off":    "#f97316",
  "rust":         "#a78bfa",
  "scratch":      "#facc15",
}

export default function Component() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>("")
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [detectionResults, setDetectionResults] = useState<DetectionResult | null>(null)
  const [resultCanvas, setResultCanvas] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")

  const displayImage = capturedImage || uploadedImage

  const loadModel = async () => {
    if (isModelLoaded()) { setModelStatus("ready"); return }
    setModelStatus("loading")
    try {
      await loadYoloModel()
      setModelStatus("ready")
    } catch (err) {
      console.error("[YOLO] load failed:", err)
      setModelStatus("error")
    }
  }

  useEffect(() => { loadModel() }, [])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string)
        setCapturedImage(null)
        setDetectionResults(null)
        setResultCanvas(null)
        setError(null)
      }
      reader.readAsDataURL(file)
    }
  }

  const startCamera = async () => {
    try {
      const constraints = { video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } }

      let stream: MediaStream | null = null

      if (navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } else {
        // Legacy fallback
        const legacyGetUserMedia = (navigator as any).getUserMedia
          || (navigator as any).webkitGetUserMedia
          || (navigator as any).mozGetUserMedia
        if (!legacyGetUserMedia) throw new Error("กล้องไม่รองรับในเบราว์เซอร์นี้ กรุณาเปิดผ่าน http://localhost:3000")
        stream = await new Promise<MediaStream>((resolve, reject) =>
          legacyGetUserMedia.call(navigator, constraints, resolve, reject)
        )
      }

      streamRef.current = stream
      setIsCameraActive(true)
      setError(null)
    } catch (err) {
      let msg = ""
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") msg = "กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์"
        else if (err.name === "NotFoundError") msg = "ไม่พบกล้อง"
        else if (err.name === "NotReadableError") msg = "กล้องถูกใช้งานโดย app อื่นอยู่"
        else msg = err.message
      }
      setError(msg)
      setIsCameraActive(false)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsCameraActive(false)
    setError(null)
  }

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const imageData = canvas.toDataURL("image/png")
        setCapturedImage(imageData)
        setUploadedImage(imageData)
        setFileName("camera-capture.png")
        setDetectionResults(null)
        setResultCanvas(null)
        setError(null)
        stopCamera()
      }
    }
  }

  const renderResultCanvas = useCallback((img: HTMLImageElement, predictions: Detection[]): string => {
    const c = document.createElement("canvas")
    c.width = img.naturalWidth || img.width
    c.height = img.naturalHeight || img.height
    const ctx = c.getContext("2d")!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const lw = Math.max(3, c.width / 200)
    const fs = Math.max(18, c.width / 40)
    predictions.forEach(d => {
      const x = d.x - d.width / 2, y = d.y - d.height / 2
      const color = CLASS_COLORS[d.class] ?? "#00ff00"
      const label = `${d.class}  ${(d.confidence * 100).toFixed(1)}%`
      ctx.strokeStyle = color; ctx.lineWidth = lw
      // Draw box with glow effect
      ctx.shadowColor = color; ctx.shadowBlur = 8
      ctx.strokeRect(x, y, d.width, d.height)
      ctx.shadowBlur = 0
      ctx.font = `bold ${fs}px monospace`
      const tw = ctx.measureText(label).width
      const lh = fs + 10
      const ly = y > lh ? y - lh : y + d.height
      ctx.fillStyle = color + "dd"; ctx.fillRect(x, ly, tw + 14, lh)
      ctx.fillStyle = "#000"; ctx.fillText(label, x + 7, ly + fs)
    })
    return c.toDataURL("image/png")
  }, [])

  const analyzeImage = async () => {
    if (!displayImage) { setError("No image to analyze"); return }
    setIsAnalyzing(true)
    setError(null)
    setDetectionResults(null)
    setResultCanvas(null)
    try {
      if (!isModelLoaded()) await loadModel()
      if (!isModelLoaded()) throw new Error("Model not ready")
      const img = new Image()
      if (!displayImage.startsWith("data:")) img.crossOrigin = "anonymous"
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("Image load failed"))
        img.src = displayImage
      })
      const data = await runYoloInference(img)
      setDetectionResults(data)
      setResultCanvas(renderResultCanvas(img, data.predictions ?? []))
    } catch (err) {
      console.error("[YOLO] inference failed:", err)
      setError("วิเคราะห์ภาพไม่สำเร็จ กรุณาลองใหม่")
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => {
    if (isCameraActive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(() => setError("Failed to start video playback"))
      }
    }
  }, [isCameraActive])

  useEffect(() => { return () => { stopCamera() } }, [])

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono relative overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,0,0.03)_1px,transparent_1px)] bg-[size:20px_20px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent animate-pulse" />

      <div className="relative z-10 p-6">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2 text-cyan-400 tracking-wider">AIRCRAFT DEFECT ANALYZER</h1>
          <div className="text-green-300 text-sm tracking-widest">{">"} NEURAL NETWORK v2.1.7 {"<"}</div>
          <div className="mt-2 flex justify-center items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>SYSTEM ONLINE</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                modelStatus === "ready" ? "bg-green-400" :
                modelStatus === "loading" ? "bg-yellow-400" :
                modelStatus === "error" ? "bg-red-400" : "bg-gray-500"
              }`} />
              <span>AI CORE: {modelStatus.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-[1800px] mx-auto">
          <div className="lg:col-span-2 space-y-6">
            {/* Live Camera */}
            <Card className="bg-gray-900/50 border-pink-500/30 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-pink-400 flex items-center gap-2 text-xl">
                  <Camera className="w-6 h-6" />LIVE CAMERA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="aspect-[16/10] bg-black border-2 border-pink-500/30 rounded relative overflow-hidden">
                  {isCameraActive ? (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-pink-400" />
                      <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-pink-400" />
                      <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-pink-400" />
                      <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-pink-400" />
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-pink-400 text-sm animate-pulse">LIVE FEED ACTIVE</div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <Camera className="w-20 h-20 text-pink-400 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Camera inactive</p>
                        <p className="text-gray-500 text-sm mt-2">Click START CAMERA to begin</p>
                        {error && (
                          <div className="mt-4 bg-red-900/20 border border-red-500/50 rounded p-3 max-w-md mx-auto">
                            <p className="text-red-400 text-sm">{error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex gap-3">
                  {!isCameraActive ? (
                    <Button onClick={startCamera} className="flex-1 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold py-6 text-lg">
                      <Camera className="w-5 h-5 mr-2" />START CAMERA
                    </Button>
                  ) : (
                    <>
                      <Button onClick={capturePhoto} className="flex-1 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold py-6 text-lg">
                        <Camera className="w-5 h-5 mr-2" />CAPTURE
                      </Button>
                      <Button onClick={stopCamera} variant="outline" className="border-pink-500/50 text-pink-400 hover:bg-pink-500/10 bg-transparent py-6 px-8">
                        <CameraOff className="w-5 h-5 mr-2" />STOP
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Upload */}
            <Card className="bg-gray-900/50 border-purple-500/30 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-purple-400 flex items-center gap-2 text-xl">
                  <Database className="w-6 h-6" />IMAGE UPLOAD
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-purple-500/50 rounded-lg p-8">
                  <div className="text-center">
                    <div className="text-5xl mb-3 text-purple-400">📁</div>
                    <p className="text-gray-400 mb-4 text-base">Upload aircraft surface image for analysis</p>
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" id="file-upload" />
                    <label htmlFor="file-upload" className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-4 px-8 rounded cursor-pointer inline-block text-lg">
                      SELECT IMAGE
                    </label>
                    {fileName && <div className="mt-4 text-base text-cyan-400 font-semibold">Loaded: {fileName}</div>}
                  </div>
                </div>

                {displayImage && (
                  <div className="border-2 border-purple-500/30 rounded-lg overflow-hidden">
                    <img
                      src={resultCanvas ?? displayImage}
                      alt="Aircraft surface analysis"
                      className="w-full h-auto block"
                    />
                  </div>
                )}

                {displayImage && (
                  <Button
                    onClick={analyzeImage}
                    disabled={isAnalyzing || modelStatus === "loading"}
                    className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-6 text-lg"
                  >
                    {isAnalyzing ? (
                      <><Scan className="w-5 h-5 mr-2 animate-spin" />ANALYZING...</>
                    ) : (
                      <><Scan className="w-5 h-5 mr-2" />ANALYZE DEFECTS</>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="bg-gray-900/50 border-cyan-500/30 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-cyan-400 flex items-center gap-2 text-xl">
                  <AlertTriangle className="w-6 h-6" />DETECTION RESULTS
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!detectionResults && !error && !isAnalyzing && (
                  <div className="text-center py-12">
                    <Scan className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-500 text-lg">No analysis performed yet</p>
                    <p className="text-gray-600 text-sm mt-2">Upload or capture an image and click ANALYZE</p>
                  </div>
                )}

                {isAnalyzing && (
                  <div className="text-center py-12">
                    <Scan className="w-16 h-16 text-cyan-400 mx-auto mb-4 animate-spin" />
                    <p className="text-cyan-400 text-lg animate-pulse">SCANNING FOR DEFECTS...</p>
                    <p className="text-gray-500 text-sm mt-2">YOLO local inference</p>
                  </div>
                )}

                {error && (
                  <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center">
                    <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <p className="text-red-400 font-semibold">{error}</p>
                  </div>
                )}

                {detectionResults && !isAnalyzing && (
                  <div className="space-y-4">
                    <div className="bg-cyan-900/20 border border-cyan-500/50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-cyan-400 font-semibold">DETECTIONS:</span>
                        <span className="text-2xl font-bold text-cyan-300">{detectionResults.predictions?.length || 0}</span>
                      </div>
                      {detectionResults.time && (
                        <div className="text-gray-400 text-sm">Analysis time: {(detectionResults.time * 1000).toFixed(0)}ms</div>
                      )}
                    </div>

                    {detectionResults.predictions && detectionResults.predictions.length > 0 ? (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {detectionResults.predictions.map((d, i) => {
                          const color = CLASS_COLORS[d.class] ?? "#00ff00"
                          return (
                            <div key={i} className="bg-gray-800/50 rounded-lg p-4 border" style={{ borderColor: color + "60" }}>
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                                  <span className="font-semibold uppercase" style={{ color }}>{d.class}</span>
                                </div>
                                <span className="text-green-400 font-mono text-sm">{(d.confidence * 100).toFixed(1)}%</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-sm text-gray-400">
                                <div>X: {d.x.toFixed(0)}px</div>
                                <div>Y: {d.y.toFixed(0)}px</div>
                                <div>W: {d.width.toFixed(0)}px</div>
                                <div>H: {d.height.toFixed(0)}px</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-6 text-center">
                        <div className="text-4xl mb-3">✓</div>
                        <p className="text-green-400 font-semibold text-lg">NO DEFECTS DETECTED</p>
                        <p className="text-gray-400 text-sm mt-2">Aircraft surface appears normal</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
