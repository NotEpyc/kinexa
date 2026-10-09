with open('C:/Users/ASUS/Documents/Final Year Project/kinexa/backend/app/routes/analyze.py', 'r') as f:
    lines = f.readlines()

# Find the lines to replace
# Lines 145-180 (0-indexed: 145-180) are the old block
# We'll replace lines 145-180 with the new streaming version

new_lines = [
    '    # 2. Stream upload to temp file with size check\n',
    '    max_size = 100 * 1024 * 1024  # 100 MB\n',
    '    temp_dir = tempfile.gettempdir()\n',
    '    temp_path = os.path.join(temp_dir, f"kinexa_{uuid.uuid4().hex}_{video.filename}")\n',
    '\n',
    '    try:\n',
    '        total_size = 0\n',
    '        chunk_size = 1024 * 1024  # 1 MB\n',
    '        with open(temp_path, "wb") as f:\n',
    '            while True:\n',
    '                chunk = await video.read(chunk_size)\n',
    '                if not chunk:\n',
    '                    break\n',
    '                f.write(chunk)\n',
    '                total_size += len(chunk)\n',
    '                if total_size > max_size:\n',
    '                    raise HTTPException(\n',
    '                        status_code=400,\n',
    '                        detail=f"File too large. Maximum size: 100 MB. Got: {total_size / (1024*1024):.1f} MB"\n',
    '                    )\n',
    '\n',
    '        # 3. Validate video duration (max 60 seconds) - quick check via OpenCV\n',
    '        cap = cv2.VideoCapture(temp_path)\n',
    '        if cap.isOpened():\n',
    '            fps = cap.get(cv2.CAP_PROP_FPS)\n',
    '            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)\n',
    '            if fps > 0 and frame_count > 0:\n',
    '                duration = frame_count / fps\n',
    '                if duration > 60:\n',
    '                    cap.release()\n',
    '                    raise HTTPException(\n',
    '                        status_code=400,\n',
    '                        detail=f"Video too long. Maximum duration: 60 seconds. Got: {duration:.1f} seconds"\n',
    '                    )\n',
    '            cap.release()\n'
]

# Replace lines 145-181 (0-indexed: 144-180) with new lines
# Lines are 1-indexed in the file, so 145 = index 144, 181 = index 180
new_lines_with_newlines = [line + '\n' for line in new_lines]

# Replace
lines[144:181] = new_lines_with_newlines

with open('C:/Users/ASUS/Documents/Final Year Project/kinexa/backend/app/routes/analyze.py', 'w') as f:
    f.writelines(lines)

print('SUCCESS: Upload streaming fix applied')