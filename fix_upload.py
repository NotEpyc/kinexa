with open('C:/Users/ASUS/Documents/Final Year Project/kinexa/backend/app/routes/analyze.py', 'r') as f:
    content = f.read()

old = '''# 2. Check file size (max 100 MB) - read in chunks to avoid loading entire file
    max_size = 100 * 1024 * 1024  # 100 MB
    content = bytearray()
    chunk_size = 1024 * 1024  # 1 MB chunks
    while True:
        chunk = await video.read(chunk_size)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > max_size:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: 100 MB. Got: {len(content) / (1024*1024):.1f} MB"
            )
    
    # 3. Validate video duration (max 60 seconds) - quick check via OpenCV
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"kinexa_{uuid.uuid4().hex}_{video.filename}")
    
    try:
        with open(temp_path, "wb") as f:
            f.write(content)
        
        # Quick duration check
        cap = cv2.VideoCapture(temp_path)
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if fps > 0 and frame_count > 0:
                duration = frame_count / fps
                if duration > 60:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Video too long. Maximum duration: 60 seconds. Got: {duration:.1f} seconds"
                    )
            cap.release()'''

new = '''# 2. Stream upload to temp file with size check
    max_size = 100 * 1024 * 1024  # 100 MB
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, f"kinexa_{uuid.uuid4().hex}_{video.filename}")
    
    try:
        total_size = 0
        chunk_size = 1024 * 1024  # 1 MB
        with open(temp_path, "wb") as f:
            while True:
                chunk = await video.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                total_size += len(chunk)
                if total_size > max_size:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: 100 MB. Got: {total_size / (1024*1024):.1f} MB"
                    )
        
        # 3. Validate video duration (max 60 seconds) - quick check via OpenCV
        cap = cv2.VideoCapture(temp_path)
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if fps > 0 and frame_count > 0:
                duration = frame_count / fps
                if duration > 60:
                    cap.release()
                    raise HTTPException(
                        status_code=400,
                        detail=f"Video too long. Maximum duration: 60 seconds. Got: {duration:.1f} seconds"
                    )
            cap.release()'''

if old in content:
    content = content.replace(old, new)
    with open('C:/Users/ASUS/Documents/Final Year Project/kinexa/backend/app/routes/analyze.py', 'w') as f:
        f.write(content)
    print('SUCCESS: Upload streaming fix applied')
else:
    print('OLD STRING NOT FOUND')
    idx = content.find('content = bytearray()')
    if idx >= 0:
        print('Found at:', idx)
        print(repr(content[idx:idx+500]))
    else:
        print('Not found')