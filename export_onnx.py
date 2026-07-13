from ultralytics import YOLO
import shutil, os

model_path = r"C:\Users\gorku\OneDrive\Desktop\KoppaZZZ\best 2.pt"
output_dir = r"C:\Users\gorku\OneDrive\Desktop\KoppaZZZ\aircraft-inspector\public\model"

print("Loading model...")
model = YOLO(model_path)

print("Exporting to ONNX...")
export_path = model.export(format="onnx", imgsz=640, simplify=False, opset=12, dynamic=False)
print(f"Exported to: {export_path}")

dest = os.path.join(output_dir, "best.onnx")
shutil.copy(export_path, dest)
print(f"Copied to: {dest}")
print("Done! ONNX model ready.")
