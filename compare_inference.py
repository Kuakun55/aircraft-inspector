"""
Compare PyTorch (.pt) vs ONNX inference confidence.
Run: python compare_inference.py path\to\image.jpg
"""
import sys
import numpy as np
from PIL import Image
import onnxruntime as rt

PT_MODEL   = r"C:\Users\gorku\OneDrive\Desktop\KoppaZZZ\best 2.pt"
ONNX_MODEL = r"C:\Users\gorku\OneDrive\Desktop\KoppaZZZ\aircraft-inspector\public\model\best.onnx"
CLASS_NAMES = ["missing-head", "paint-off", "rust", "scratch"]

img_path = sys.argv[1] if len(sys.argv) > 1 else None

# ─── PyTorch (Ultralytics native) ────────────────────────────────────────────
print("=" * 60)
print("PyTorch (.pt) inference — Ultralytics native")
print("=" * 60)
try:
    from ultralytics import YOLO
    pt = YOLO(PT_MODEL)
    if img_path:
        results = pt.predict(img_path, conf=0.01, iou=0.45, verbose=False)
        boxes = results[0].boxes
        if len(boxes) == 0:
            print("  No detections")
        for b in boxes:
            cls  = int(b.cls[0])
            conf = float(b.conf[0])
            xy   = b.xywh[0].tolist()
            print(f"  {CLASS_NAMES[cls]:15s}  conf={conf*100:.1f}%  box=(cx={xy[0]:.0f},cy={xy[1]:.0f},w={xy[2]:.0f},h={xy[3]:.0f})")
    else:
        # test with random noise
        import torch, tempfile, os
        noise = (np.random.randint(100, 200, (640, 640, 3), dtype=np.uint8))
        tmp = tempfile.mktemp(suffix=".jpg")
        Image.fromarray(noise).save(tmp)
        results = pt.predict(tmp, conf=0.01, iou=0.45, verbose=False)
        boxes = results[0].boxes
        print(f"  Random noise test — {len(boxes)} detections")
        for b in boxes[:5]:
            cls  = int(b.cls[0])
            conf = float(b.conf[0])
            print(f"  {CLASS_NAMES[cls]:15s}  conf={conf*100:.1f}%")
        os.unlink(tmp)
except Exception as e:
    print(f"  ERROR: {e}")

# ─── ONNX (same as browser) ──────────────────────────────────────────────────
print()
print("=" * 60)
print("ONNX inference — same as browser")
print("=" * 60)
try:
    sess = rt.InferenceSession(ONNX_MODEL, providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    def letterbox(img_pil):
        W, H = img_pil.size
        scale = min(640/W, 640/H)
        nW, nH = int(W*scale), int(H*scale)
        canvas = Image.new("RGB", (640, 640), (128, 128, 128))
        resized = img_pil.resize((nW, nH), Image.BILINEAR)
        px, py = (640-nW)//2, (640-nH)//2
        canvas.paste(resized, (px, py))
        arr = np.array(canvas).astype(np.float32) / 255.0
        return arr.transpose(2,0,1)[np.newaxis], scale, px, py

    if img_path:
        img_pil = Image.open(img_path).convert("RGB")
    else:
        img_pil = Image.fromarray(np.random.randint(100, 200, (640, 640, 3), dtype=np.uint8))
        print("  (using random noise — no image path given)")

    arr, scale, px, py = letterbox(img_pil)
    out = sess.run(None, {input_name: arr})[0]  # [1,8,8400]
    scores = out[0, 4:, :]                        # [4,8400]
    max_conf = scores.max()
    max_cls  = int(np.unravel_index(scores.argmax(), scores.shape)[0])
    print(f"  Max confidence: {max_conf*100:.1f}%  (class={CLASS_NAMES[max_cls]})")

    # All detections > 0.01
    mask = scores.max(axis=0) > 0.01
    print(f"  Detections > 1%: {mask.sum()}")
    for i in np.where(mask)[0][:5]:
        cls  = int(scores[:, i].argmax())
        conf = float(scores[cls, i])
        cx, cy = float(out[0,0,i]), float(out[0,1,i])
        print(f"  {CLASS_NAMES[cls]:15s}  conf={conf*100:.1f}%  cx={cx:.0f} cy={cy:.0f}")

except Exception as e:
    print(f"  ERROR: {e}")

print()
print("=" * 60)
print("CONCLUSION:")
print("  If PyTorch conf >> ONNX conf → re-export ONNX to fix")
print("  If PyTorch conf ≈ ONNX conf  → model needs retraining")
print("=" * 60)
