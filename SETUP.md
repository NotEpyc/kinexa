# Kinexa - Setup Guide

## Prerequisites

- **Node.js 20+** and npm
- **Python 3.13+** (needed only for the FastAPI backend)
- **Git**
- **Windows/Linux/macOS**

PostgreSQL is **not connected to the current application yet**. SQLAlchemy/PostgreSQL packages are present, but there is no configured database engine, schema/migrations, or persistent CRUD implementation. You do not need to install a database to run the current prototype.

## Quick Start

```bash
git clone https://github.com/NotEpyc/kinexa.git
cd kinexa
npm install
npm run dev
```

Open **http://localhost:3000** and allow camera access. Live squat feedback runs in the browser. It requires `backend/models/pose_landmarker_full.task`; this file is ignored by Git, so obtain the MediaPipe Pose Landmarker Full model bundle from the [official MediaPipe guide](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) and save it at that path. The browser also downloads MediaPipe WASM assets from jsDelivr, so it needs network access on first load.

### Optional: start the FastAPI backend

Use a second terminal from the repository root:

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux (use this instead of the Windows activation command):
# source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The backend is available at **http://localhost:8000** and its API docs at **http://localhost:8000/docs**. The current live page does not require the backend; upload analysis and backend API work do. No `.env` or database setup is currently required. The backend uses default in-code ROM limits for upload analysis; patient-specific values are not persisted yet.

## Datasets

### Optional Training Datasets (Download Manually)

| Dataset | Source | Extract To |
|---------|--------|------------|
| **KIMORE** | [Google Drive](https://drive.google.com/drive/folders/1S_y95vxwIQFYxrNNzNODqVnxaKakNcXb) | `data/raw/kimore/` |
| **UI-PRMD** | [Google Drive](https://drive.google.com/drive/folders/1yOUSuvhm-LePn5zrwZ4cWAs5EqETWsFz) | `data/raw/ui-prmd/` |

### Extraction Structure
```
data/
  raw/
    kimore/
      KIMORE.zip
      KIMORE_DATASET/
        Kimore ex1/ ... Kimore ex5/
    ui-prmd/
      UI-PRMD.zip
      UI-PRMD/
        UI_PRMD_ex1/ ... UI_PRMD_ex10/
```

### Dataset Details

| Dataset | Exercise | Format | Key Files |
|---------|----------|--------|-----------|
| **KIMORE** (ex5 = squat) | 5 exercises, 78 subjects | CSV (no headers) | `Train_X.csv` (100 cols), `Train_Y.csv` (0-50 clinical score) |
| **UI-PRMD** (ex4 = deep squat) | 10 exercises, 10 subjects | CSV (no headers) | `Data_Correct/Incorrect.csv`, `Labels_Correct/Incorrect.csv`, `_inc` files |

## Backend Configuration

### Environment Variables

No environment variables are needed to run the current prototype. The optional backend quality-model loader can be selected with `KINEXA_QUALITY_MODEL`, but no trained quality model artifact is currently shipped.

### Run Backend
```bash
cd backend
python -m uvicorn app.main:app --reload
# Server at http://localhost:8000
# API docs at http://localhost:8000/docs
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analyze` | Upload video + patient_id + exercise |
| GET | `/api/analyses/{id}` | Fetch stored analysis |
| GET | `/api/patients/{id}/analyses` | Patient history |
| GET | `/api/health` | Service status |

### Test Endpoint
```bash
curl -X POST "http://localhost:8000/api/analyze" \
  -F "video=@test_squat.mp4" \
  -F "patient_id=test_patient" \
  -F "exercise=squat"
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Frontend at http://localhost:3000
```

## MediaPipe Model

The `.task` model bundle is not downloaded automatically or included in Git. Download the Pose Landmarker Full bundle from the [official MediaPipe guide](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) and place it at `backend/models/pose_landmarker_full.task`. The live frontend loads it through `/api/pose-model`.

## Database Status

PostgreSQL is the planned database, but it is **not implemented or used by the current code**. Patient and plan create routes return generated IDs without storing records; list, update, and analysis-history routes are unfinished. SQLite is not currently wired either. Database setup instructions will be added when the database layer and migrations exist.

## Development Workflow

### Run Tests
```bash
cd backend
pytest -v
```

### Code Quality
```bash
# Format
black .
isort .

# Lint
flake8 .
mypy .
```

## Project Structure
```
kinexa/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── routes/              # API endpoints
│   │   ├── pose/                # MediaPipe integration
│   │   ├── exercises/           # Exercise-specific logic
│   │   ├── features/            # Feature extraction
│   │   ├── rules/               # ROM rules engine
│   │   ├── models/              # ML model loading
│   │   └── routes/              # API routes
│   ├── ml/                      # Training scripts (Phase C)
│   ├── requirements.txt
│   └── download_model.py
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
├── data/
│   ├── raw/           # Datasets (gitignored)
│   ├── processed/     # Processed data (gitignored)
│   └── features/      # Extracted features (gitignored)
├── models/            # MediaPipe .task model (gitignored)
├── PRD.md             # Product Requirements
├── AGENTS.md          # Agent instructions
└── SETUP.md           # This file
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `pg_config not found` | Install PostgreSQL dev tools or use SQLite (`aiosqlite`) |
| `Microsoft Visual C++ 14.0 required` | Install [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or use `--only-binary :all:` |
| `MediaPipe model not found` | Run `python download_model.py` |
| `No module named 'mediapipe'` | `pip install mediapipe==0.10.35` |
| `pydantic-core` Rust error | Use `pydantic==2.10.0` with `pydantic-core==2.27.0` (has wheels) |

### Python 3.13 Compatibility
All dependencies pinned to versions with Python 3.13 wheels:
- `numpy>=2.2.6`, `scipy>=1.14.1`, `scikit-learn>=1.5.2`
- `pydantic>=2.10.0`, `pydantic-core>=2.27.0`
- `psycopg>=3.2.8`, `asyncpg>=0.30.0`

## Phase Overview

| Phase | Status | Description |
|-------|--------|-------------|
| **A** | ✅ | Research, datasets, MediaPipe validation |
| **B** | ✅ | Rules-first pipeline (rules → ML) |
| **C** | 🔄 | ML prototype (RF/XGBoost on KIMORE/UI-PRMD) |
| **D** | 🔄 | Backend API and optional model inference scaffold; no trained quality model shipped |
| **E** | 🔄 | Live browser squat prototype with therapist-entered ROM; live ML bridge is not implemented |
| **F** | ⏳ | PostgreSQL persistence, auth, and analysis history |
| **G** | ⏳ | Subject-independent and physiotherapist validation |

## License
Student project - see PRD.md for licensing details on datasets.
