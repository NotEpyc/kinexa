# Kinexa: Explainable Exercise Form Assessment Platform

An AI-powered platform where physiotherapists define patient-specific exercise limits, patients upload exercise videos, and the system returns per-rep form assessments with explanations — combining pose estimation, ML quality scoring, and therapist-defined ROM rules.

## Current Prototype: Live Squat Feedback

The frontend supports a browser-camera live squat session using MediaPipe Pose Landmarker. It smooths the live knee-angle signal, detects completed reps, and summarizes bottom knee angle, trunk lean, knee asymmetry, and rep duration. Rep detection uses a separate minimum knee-movement setting (20° by default), a minimum cycle duration, and minimum rep spacing so custom ROM limits cannot make tiny movements count as reps. An expandable detector log shows the baseline, bottom angle, angular travel, thresholds, duration, and whether each attempted cycle was counted or rejected; the same events go to the browser console. Therapist-entered thresholds for knee range, trunk lean, and asymmetry are evaluated locally in the browser; a configured-but-unmeasurable metric is marked not assessable. Settings remain in the browser and are not linked to patient plans. The `.task` pose bundle must be present at `backend/models/pose_landmarker_full.task`; Next.js serves it to the browser at `/api/pose-model`, so the backend is not required for browser-side pose tracking. MediaPipe's browser WASM assets load from jsDelivr, so the browser needs network access on first load. Run the frontend and open `http://localhost:3000`.

The ROM inputs are currently session-local and are not saved to patient plans. Live camera feedback uses browser-side pose tracking and configured ROM rules; it does not yet call a trained ML model. Camera angle, visibility, and the fixed rep-motion thresholds can affect estimates; therapist guidance remains authoritative.

### Phase C: ML prototype status

The backend now has a shared FR-5 squat feature schema, subject-grouped RF/XGBoost training scaffolding, artifact metadata, optional per-rep inference, and therapist-rule precedence. **No quality model has been trained or shipped yet.** Training requires a per-rep feature table with correct/incorrect labels and subject IDs; the current local KIMORE/UI-PRMD extracts are not sufficient for defensible video-to-MediaPipe training. See [dataset audit and candidate sources](DATASETS.md) and the [training instructions](backend/ml/training/README.md). When a validated model artifact is available, set `KINEXA_QUALITY_MODEL=squat_rf_v1` for backend inference. The current live browser session remains rules-only until a compatible trained model is available and live feature-to-model integration is completed.

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

This is a polyglot monorepo: the root npm workspace manages the Next.js frontend, while the FastAPI backend keeps its Python dependencies in `backend/requirements.txt`.

## Quick Start

Install and run from the repository root:

```bash
npm install
npm run dev                 # Next.js frontend
npm run backend:dev         # FastAPI backend (separate terminal)
```

Install Python dependencies once before starting FastAPI:

```bash
python -m venv .venv
# Activate .venv, then:
npm run backend:install
```

The browser live-feedback prototype works with the frontend and pose bundle; start the backend as well when using backend API features. For production frontend checks use `npm run build` from the repository root.

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
| C | ML prototype: subject-independent training scaffold and optional inference are implemented; training/validation awaits a suitable subject-labelled feature table |
| D | Core contribution: explainability, ROM customisation, decision layer |
| E | Backend API: `/analyze`, model loading, structured JSON |
| F | Frontend: dashboard, patients, plan editor, upload, results |
| G | Database: PostgreSQL, auth, history, progress |
| H | Validation: unseen people, camera angles, physiotherapist comparison |

The phase table above describes the original upload/ML roadmap; live camera feedback is now being built as the primary interaction.

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
