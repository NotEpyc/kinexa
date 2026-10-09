# Kinexa: Explainable Exercise Form Assessment Platform

An AI-powered platform where physiotherapists define patient-specific exercise limits, patients upload exercise videos, and the system returns per-rep form assessments with explanations — combining pose estimation, ML quality scoring, and therapist-defined ROM rules.

## Architecture

```
Patient uploads video
        ↓
FastAPI backend (Python)
        ↓
Pipeline: MediaPipe Pose → landmarks → angles → rep detection → features
        ↓
Rule-based checker (patient_exercise_parameters) → flags
        ↓
ML model (RF/XGBoost) → quality score + top factors
        ↓
Decision layer (therapist limits override ML) → final verdict
        ↓
JSON response → Next.js frontend
        ↓
PostgreSQL (patients, plans, parameters, analyses, reps)
```

## Repository Structure

```
kinexa/
├── frontend/          # Next.js + TypeScript + Tailwind + Recharts
├── backend/
│   ├── app/           # FastAPI application
│   │   ├── routes/    # API endpoints
│   │   ├── pose/      # MediaPipe pose extraction
│   │   ├── exercises/ # Exercise-specific logic (squat v1)
│   │   ├── features/  # Feature extraction
│   │   ├── models/    # ML model loading/inference
│   │   └── rules/     # ROM rules engine
│   └── ml/            # Training & evaluation scripts
├── data/              # Raw, processed, feature data (gitignored)
├── models/            # Versioned model artefacts (gitignored)
├── PRD.md             # Product Requirements Document
└── AGENTS.md          # Agent instructions
```

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### MediaPipe Test
```bash
pip install mediapipe==0.10.14
python -c "import mediapipe as mp; from mediapipe.tasks import python; from mediapipe.tasks.python import vision; print('MediaPipe Tasks API available')"
```

## Development Phases

| Phase | Focus |
|-------|-------|
| A | Research & reuse: obtain KIMORE/UI-PRMD, validate MediaPipe |
| B | **Rules & upload pipeline**: video → MediaPipe → angles → reps → rule flags |
| C | ML prototype: train on KIMORE, optional validate on UI-PRMD |
| D | Core contribution: explainability, ROM customisation, decision layer |
| E | Backend API: `/analyze`, model loading, structured JSON |
| F | Frontend: dashboard, patients, plan editor, upload, results |
| G | Database: PostgreSQL, auth, history, progress |
| H | Validation: unseen people, camera angles, physiotherapist comparison |

## Key Design Principles

1. **One common skeleton format** for all sources (datasets + MediaPipe)
2. **One shared feature extractor** across training and inference
3. **Exercise modules are pluggable** (squat v1, extensible)
4. **Therapist rules override ML** — decision table in PRD §6.7

## Documentation

- [PRD.md](PRD.md) — Product Requirements Document (v1.1)
- [AGENTS.md](AGENTS.md) — Agent instructions & development commands

## License

Student project — see PRD for dataset licensing details (KIMORE: check terms; UI-PRMD: PDDL v1.0).