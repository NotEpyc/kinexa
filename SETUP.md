# Kinexa - Setup Guide

## Prerequisites

- **Python 3.13+** (tested on 3.13)
- **PostgreSQL 15+** (for production) or SQLite (for development)
- **Git**
- **Windows/Linux/macOS**

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/NotEpyc/kinexa.git
cd kinexa

# 2. Download datasets (see "Datasets" section below)
# Extract to data/raw/kimore/ and data/raw/ui-prmd/

# 3. Backend setup
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt

# 4. Download MediaPipe model
python download_model.py

# 5. Configure environment
cp .env.example .env  # Edit with your database URL

# 6. Run backend
python -m uvicorn app.main:app --reload

# 7. Frontend setup (separate terminal)
cd ../frontend
npm install
npm run dev
```

## Datasets

### Required Datasets (Download Manually)

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

### Environment Variables (.env)
```bash
# Database (SQLite for dev, PostgreSQL for prod)
DATABASE_URL=sqlite+aiosqlite:///./kinexa.db
# DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/kinexa

# MediaPipe
MEDIAPIPE_MODEL_PATH=backend/models/pose_landmarker_full.task

# App
SECRET_KEY=your-secret-key-here
DEBUG=true
```

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
# Proxies API calls to backend at http://localhost:8000
```

## MediaPipe Model

The model is downloaded automatically:
```bash
python download_model.py
# Downloads to backend/models/pose_landmarker_full.task
```

Or manually from: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker

## Database

### Development (SQLite)
```bash
# Automatic - creates kinexa.db on first run
DATABASE_URL=sqlite+aiosqlite:///./kinexa.db
```

### Production (PostgreSQL)
```bash
# 1. Create database
createdb kinexa

# 2. Run migrations
alembic upgrade head

# 2. Set environment
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/kinexa
```

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
| **D** | ⏳ | Backend API + model integration |
| **E** | ⏳ | Frontend (Next.js + Tailwind) |
| **F** | ⏳ | Database + auth + history |
| **G** | ⏳ | Validation + v2 (real-time camera) |

## License
Student project - see PRD.md for licensing details on datasets.