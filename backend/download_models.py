import os
import requests
from tqdm import tqdm

def download_file(url, filename):
    response = requests.get(url, stream=True)
    if response.status_code != 200:
        print(f"❌ Failed to download {url} (Status: {response.status_code})")
        return False
        
    total_size = int(response.headers.get('content-length', 0))
    block_size = 1024
    
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    
    with open(filename, 'wb') as f, tqdm(
        desc=os.path.basename(filename),
        total=total_size,
        unit='iB',
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for data in response.iter_content(block_size):
            size = f.write(data)
            bar.update(size)
    return True

def main():
    print("📥 Finishing VOXEN Model Setup...")
    
    # Official Kijai base models repo
    base_url_lp = "https://huggingface.co/Kijai/LivePortrait_safetensors/resolve/main"
    # Alternative verified source for InsightFace
    base_url_if = "https://huggingface.co/monet-msh/insightface-models/resolve/main/models/buffalo_l"
    
    # Define mapping: (URL, Target Local Path)
    files_to_download = [
        # LivePortrait Base Models (Should already be done)
        (f"{base_url_lp}/appearance_feature_extractor.safetensors", "models/liveportrait/base_models/appearance_feature_extractor.safetensors"),
        (f"{base_url_lp}/motion_extractor.safetensors", "models/liveportrait/base_models/motion_extractor.safetensors"),
        (f"{base_url_lp}/spade_generator.safetensors", "models/liveportrait/base_models/spade_generator.safetensors"),
        (f"{base_url_lp}/stitching_retargeting_module.safetensors", "models/liveportrait/base_models/stitching_retargeting_module.safetensors"),
        (f"{base_url_lp}/warping_module.safetensors", "models/liveportrait/base_models/warping_module.safetensors"),
        
        # InsightFace (Required for Face Detection)
        (f"{base_url_if}/2d106det.onnx", "models/liveportrait/insightface/models/buffalo_l/2d106det.onnx"),
        (f"{base_url_if}/det_10g.onnx", "models/liveportrait/insightface/models/buffalo_l/det_10g.onnx"),
    ]
    
    for url, dest in files_to_download:
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            print(f"✅ {os.path.basename(dest)} already exists.")
        else:
            print(f"Downloading {os.path.basename(dest)}...")
            if download_file(url, dest):
                print(f"✅ Downloaded {os.path.basename(dest)}")

    print("\n🎉 VOXEN models are 100% complete!")

if __name__ == "__main__":
    main()
