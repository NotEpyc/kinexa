# Kinexa: Explainable Exercise Form Assessment Platform

An AI-powered platform where physiotherapists define patient-specific exercise limits, patients upload exercise videos, and the system returns per-rep form assessments with explanations — combining pose estimation, ML quality scoring, and therapist-defined ROM rules.

## Current Prototype: Live Squat Feedback

The frontend supports a browser-camera live squat session using MediaPipe Pose Landmarker. It smooths the live knee-angle signal, detects completed reps, and summarizes bottom knee angle, trunk lean, knee asymmetry, and rep duration, with a rolling two-knee angle graph, prescribed ROM band, and counted-rep markers during the session. Rep detection uses a separate minimum knee-movement setting (20° by default), a minimum cycle duration, and minimum rep spacing so custom ROM limits cannot make tiny movements count as reps. Both knee angles must be available at the rep start and during movement, and each knee must travel at least half the configured minimum movement (at least 10°), and the weaker knee must reach at least 35% of the stronger knee travel, so strongly one-sided movement is rejected. Low-confidence knee traces are omitted. The graph labels anatomical sides and notes that the camera preview is mirrored. An expandable detector log shows left/right travel, thresholds, duration, and whether each attempted cycle was counted or rejected; the same events go to the browser console. Therapist limits can be saved to PostgreSQL patient plans; each live rep can receive a cue tied to the active plan and measured values. Per-rep features (never camera frames) can also be sent to the backend quality model for a separate general research advisory; therapist ROM rules remain authoritative. The `.task` pose bundle must be present at `backend/models/pose_landmarker_full.task`; Next.js serves it to the browser at `/api/pose-model`. MediaPipe's browser WASM assets load from jsDelivr, so the browser needs network access on first load. Run the frontend at `http://localhost:3000`; run the backend for database persistence and quality-model inference.

Therapist limits can now be saved to patient-specific PostgreSQL plans and loaded back into the live session. After each rep, a backend coaching layer compares the measured knee range, trunk lean, and asymmetry with those active limits and returns a cue that includes the measured value and prescribed boundary. This is plan-personalized rule feedback, not a separately trained patient-specific ML model. The Random Forest remains a general research advisory and its global feature importance is not a per-rep explanation. Live sessions can be saved to patient history; upload analyses and their rep results are also persisted. Database setup is in [SETUP.md](SETUP.md). Camera angle, visibility, and fixed rep-motion thresholds can affect estimates; therapist guidance remains authoritative. Authentication and access control are still outstanding.

### Phase C: ML prototype status

The backend dispatches uploads through a pluggable exercise registry, with exercise-specific analyzers, rules, and feature schemas behind shared upload, inference, and training contracts. Squat is the only implemented exercise today. A squat Random Forest model is trained from REHAB24-6 and can provide per-rep advisory feedback in live sessions; therapist ROM remains authoritative. Its motion-capture skeletons differ from live MediaPipe estimates, so subject-grouped cross-validation does not establish live-camera accuracy. Other exercises can be added by implementing and registering their analyzer/rules/features and adding a matching dataset adapter; the shared trainer and inference contract can then be reused. See [dataset audit and candidate sources](DATASETS.md) and the [training instructions](backend/ml/training/README.md).

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
Exercise-specific ML model (RF/XGBoost) → advisory quality + global factors
        ↓
Decision layer (therapist limits override ML) → final ROM verdict
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
| C | Squat ML prototype trained and integrated; live-camera validation still required |
| D | Core contribution: explainability, ROM customisation, decision layer |
| E | Backend API: `/analyze`, model loading, structured JSON |
| F | Frontend: dashboard, patients, plan editor, upload, results |
| G | PostgreSQL persistence and history are implemented; auth and longitudinal progress remain |
| H | Validation: unseen people, camera angles, physiotherapist comparison |

The phase table above describes the original upload/ML roadmap; live camera feedback is now being built as the primary interaction.

## Key Design Principles

1. **One common skeleton format** for all sources (datasets + MediaPipe)
2. **One shared feature extractor** across training and inference
3. **Exercise modules are pluggable** (squat is registered today; shared API and training contracts are extensible)
4. **Therapist rules override ML** — decision table in PRD §6.7

## Documentation

- [PRD.md](PRD.md) — Product Requirements Document (v1.1)
- [AGENTS.md](AGENTS.md) — Agent instructions & development commands

## License

Student project — see PRD for dataset licensing details (KIMORE: check terms; UI-PRMD: PDDL v1.0).
