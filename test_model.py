import onnxruntime as rt
import numpy as np
from PIL import Image
import sys, os

MODEL = r"C:\Users\gorku\OneDrive\Desktop\KoppaZZZ\aircraft-inspector\public\model\best.onnx"
CLASS_NAMES = ["missing-head", "paint-off", "rust", "scratch"]

sess = rt.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
print(f"Input:  {sess.get_inputs()[0].name}  shape={sess.get_inputs()[0].shape}")
print(f"Output: {sess.get_outputs()[0].name} shape={sess.get_outputs()[0].shape}")

# ถ้าส่ง path รูปมาเป็น argument ใช้รูปนั้น ไม่งั้นสร้างรูปทดสอบ
if len(sys.argv) > 1:
    img_path = sys.argv[1]
    img = Image.open(img_path).convert("RGB")
    print(f"Testing with: {img_path}  ({img.size})")
else:
    img = Image.fromarray(np.random.randint(100, 200, (640, 640, 3), dtype=np.uint8))
    print("Testing with: random noise image")

# Letterbox resize
W, H = img.size
scale = min(640/W, 640/H)
nW, nH = int(W*scale), int(H*scale)
img_resized = img.resize((nW, nH), Image.BILINEAR)
canvas = Image.new("RGB", (640, 640), (128, 128, 128))
px, py = (640-nW)//2, (640-nH)//2
canvas.paste(img_resized, (px, py))

arr = np.array(canvas).astype(np.float32) / 255.0          # [640,640,3]
arr = arr.transpose(2, 0, 1)[np.newaxis]                    # [1,3,640,640]

out = sess.run(None, {sess.get_inputs()[0].name: arr})[0]   # [1,8,8400]
print(f"Output shape: {out.shape}")

# Max confidence
scores = out[0, 4:, :]   # [4, 8400]
max_conf = scores.max()
max_cls  = int(np.unravel_index(scores.argmax(), scores.shape)[0])
print(f"Max confidence: {max_conf:.4f}  (class={CLASS_NAMES[max_cls]})")

# Detections > 0.1
mask = scores.max(axis=0) > 0.1
n = mask.sum()
print(f"Detections > 0.10 threshold: {n}")

if n > 0:
    for i in np.where(mask)[0][:10]:
        cls = scores[:, i].argmax()
        conf = scores[cls, i]
        cx, cy, w, h = out[0, :4, i]
        print(f"  [{CLASS_NAMES[cls]}] conf={conf:.3f}  box=({cx:.0f},{cy:.0f},{w:.0f},{h:.0f})")

# Raw output comparison (สำหรับ debug เทียบกับ browser)
print("\n--- RAW VALUES (เอาไปเทียบกับ browser) ---")
print(f"First 12 cx values (data[0..11]):  {out[0,0,:12].tolist()}")
print(f"First 5 class-0 scores (data[33600..33604]): {out[0,4,:5].tolist()}")
print(f"First 5 class-1 scores (data[42000..42004]): {out[0,5,:5].tolist()}")
print(f"Max class-0 score: {out[0,4,:].max():.6f}")
print(f"Max class-1 score: {out[0,5,:].max():.6f}")
print(f"Max class-2 score: {out[0,6,:].max():.6f}")
print(f"Max class-3 score: {out[0,7,:].max():.6f}")
