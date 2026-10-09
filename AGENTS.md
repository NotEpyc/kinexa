# AGENTS.md: Explainable Exercise Form Assessment Platform

## Tech Stack
- **Frontend:** Next.js (TypeScript, Tailwind, Recharts)
- **Backend:** FastAPI (Python) + Uvicorn
- **Pose estimation:** MediaPipe Pose (recommended — Apache 2.0, free commercial use)
- **ML models:** Random Forest baseline, XGBoost comparison, optional logistic regression sanity-check
- **Database:** PostgreSQL
- **Processing:** Synchronous for short clips (v1); job queue if latency increases
- **Note on frame extraction:** Use every frame at a known fps; do not decode to keyframes. Rep timing, smoothness and tempo features need every frame. Decode with OpenCV.VideoCapture, normalise to fixed fps, handle phone rotation metadata.

## Pipeline Flow (source of truth: PRD §6, §8)
1. Upload video (MP4/MOV/WebM, default ≤100 MB, ≤60 s) → FR-1.1
2. MediaPipe Pose on every frame → landmarks + visibility → FR-2.1
   - **Important:** Use `pose_world_landmarks` (metric 3D, hip-centred) for angle computation, not normalised `x,y` alone. Normalised coordinates distort on non-square video. If using normalised landmarks, multiply `x` by frame width and `y` by frame height before computing angles. Better: use the newer `mediapipe.tasks.vision.PoseLandmarker` API which provides both.
3. Convert to common skeleton format (subject_id, exercise, frame, joint, x, y, z, visibility) → FR-2.2
4. Light smoothing (Savitzky-Golay or moving average) → FR-2.3
5. Per-frame angles: knee (hip-knee-ankle), hip (shoulder-hip-knee), trunk lean → FR-3.1
   - **Angle convention:** 180° = straight leg (full extension), 0° = fully flexed. Use same-side joints: angle(left_hip, left_knee, left_ankle) or angle(right_hip, right_knee, right_ankle).
6. Rep detection from knee-angle signal (peak detection, min depth/min spacing) → FR-4.1
7. Feature extractor `extract_squat_features(skeleton)` per rep → FR-5
8. Therapist ROM rules take precedence over ML → FR-7.2 (decision table in PRD §6.7)
9. ML model (RF/XGBoost) → per-rep quality + top contributing features → FR-6.1, FR-6.2
10. Scoring, movement graph, result JSON → FR-8, output to Next.js → FR-8.1..FR-8.4

## Suggested Repository Layout (PRD §8.4)
```
kinexa/
  frontend/        (Next.js app, components, lib, types)
  backend/
    app/           (main.py, routes/, pose/, exercises/, features/, models/, rules/)
    ml/            (training/, evaluation/, datasets/)
  data/            (raw/, processed/, features/)
  models/          (versioned model artefacts)
  README.md
```
Create folders progressively as needed.

## Key Commands
- **Start backend:** `cd backend && uvicorn app.main:app --reload` (or as defined in `pyproject.toml`/`Makefile`)
- **Start frontend:** `cd frontend && npm run dev` (Next.js dev server)
- **Install deps:** `cd frontend && npm install`; `cd backend && pip install -r requirements.txt`
- **Run tests:** `cd <package> && pytest` or equivalent
- **Lint/typecheck:** check respective config files
- **MediaPipe quick start:** `pip install mediapipe==0.10.14; python -c "import mediapipe as mp; from mediapipe.tasks import python; from mediapipe.tasks.python import vision; print('MediaPipe Tasks API available')" — verify Tasks API works before writing the feature extractor. Note: Tasks `PoseLandmarker` requires a `.task` model bundle downloaded separately.

## API Endpoints (PRD §9)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/analyze` | Upload video + patient_id + exercise; returns analysis |
| GET | `/api/analyses/{id}` | Fetch a stored analysis |
| GET | `/api/patients/{id}/analyses` | History for a patient |
| POST/GET/PUT | `/api/patients` | Manage patients |
| POST/GET/PUT | `/api/patients/{id}/plans` | Manage exercise plans and ROM constraints |
| GET | `/api/health` | Service and model-version status |

**Error codes:** `NO_PERSON_DETECTED`, `LOW_LANDMARK_VISIBILITY`, `NO_REPS_FOUND`, `VIDEO_TOO_LONG`

## Database Schema (PRD §10)
- `users`: id, role, name, email, password_hash
- `patients`: id, therapist_id, name, age, notes
- `exercise_plans`: id, patient_id, exercise, active, created_at
- `patient_exercise_parameters`: id, plan_id, metric, side, phase, min_value, max_value, unit, tolerance, effective_from, effective_to, version — metric-based rows extend to new exercises without schema changes; metric covers joint angles, trunk lean, asymmetry, tempo; side: left, right, either; phase: at_bottom, at_peak, whole_rep; explicit angle convention (180° = straight leg); version reference on each analysis so old results stay interpretable
- `analyses`: id, patient_id, plan_id, constraints_snapshot, video_ref, model_version, score, created_at
- `rep_results`: id, analysis_id, rep_index, status, measurements (JSON), ml_output (JSON), issues (JSON)

The `patient_exercise_parameters` table is the editable ROM source read by the Exercise Quality Scoring Engine. It supersedes `rom_constraints` — metric-based rows scale to new exercises without schema changes, store metric type, phase, and side, and include an explicit angle convention (180° = straight leg).

## ML Requirements (PRD §7)
- **Models:** Random Forest (baseline), XGBoost (comparison), optional logistic regression sanity-check baseline.
- **Evaluation:** Subject-independent only — grouped splits, GroupKFold / leave-one-subject-out. Never random-rep splits.
- **Label granularity decision:** KIMORE provides one continuous clinical score per exercise execution (rep count to be confirmed from files; scores include PO_S and CF_S on a 0–50 scale), not per rep. UI-PRMD provides per-rep correct/incorrect labels (files with `_inc` extension). Your product outputs per-rep verdicts. You must choose one of two approaches:
  1. **Train at session level:** model predicts per-execution quality score; per-rep verdicts come from rules and measurements, not the model alone.
  2. **Train at rep level:** copy the execution-level score from KIMORE onto every rep in that exercise execution, accepting noisy labels. Document this approximation explicitly.
  Do not merge KIMORE (execution-level) and UI-PRMD (per-rep) datasets naively. They use different exercise types (squat vs. deep squat), different skeleton definitions, different capture systems, and different label granularity. KIMORE is a starting point; UI-PRMD provides a binary check. The choice of primary dataset depends on which labels better match the product's per-rep output — decide after inspecting the actual files.
- **Metrics:** accuracy, precision, recall, F1 (macro), confusion matrix (classification); MAE + correlation (regression)
- **Sample sizes are small:** UI-PRMD has ~10 subjects; KIMORE squat recording count inferred from dataset survey (~353 samples ÷ 5 exercises ≈ 70 squat recordings). Subject-independent cross-validation on this will give wide confidence intervals. XGBoost can overfit easily. Start with a simple model (logistic regression or shallow forest), report confidence intervals / bootstrap CIs rather than a single number, and treat results as preliminary until a larger self-collected MediaPipe dataset is available.
- **Reporting:** Separately on (a) dataset skeletons and (b) MediaPipe videos of new people
- **Class imbalance:** handle with class weights
- **Explainability:** global feature importance + per-rep top contributing factors (SHAP optional later)
  - **Explainability caveat:** Per-rep explanations are approximations if training at session level. Document the mapping approach clearly to users. If using approach 2 (copy session score onto each rep), explain that per-rep scores are approximations of the execution-level score.
- **Acceptance:** macro-F1 with CI; physiotherapist agreement ≥80% on clear-cut cases (clearly good vs. clearly bad)

## Testing Strategy (PRD §18)
- **Unit tests:** angle function (known coords), rep detection (synthetic sine-wave), feature extractor, rule layer boundary values
- **Integration tests:** video in → JSON out, with fixture videos
- **Model tests:** regression check that a saved model reproduces stored metrics on a fixed validation set
- **Robustness tests:** different lighting, clothing, distance, camera heights, angles; document failure patterns

## v1 Scope (PRD §5, §7)
- **In scope:** squat only; side-view (primary) + front-view (secondary) video; MP4/MOV/WebM up to ~60 s; therapist-set ROM per patient; Random Forest + XGBoost comparison; basic auth (therapist/patient/admin)
- **Out of scope:** exercises other than bodyweight squat; live streaming; deep learning models (v2); billing, clinic hierarchies; real-time camera; 3D reconstruction; multi-camera

## Design Principles
1. One common skeleton format for all sources (datasets and MediaPipe).
2. One shared feature extractor across training and inference (prevents train/serve drift).
3. Exercise modules are pluggable: each exercise defines its landmarks, angles, rep logic, features, and rules.
4. Therapist rules sit outside the ML model and always take precedence.

## Authentication & Roles (PRD §11)
- **Roles:** therapist, patient, admin
- **Therapist:** sees only their own patients
- **Patient:** sees only their own data
- **All endpoints:** auth required; role-based access

## Important Notes
- This repo is at the PRD stage — no production code exists yet. The AGENTS.md will need updating once the codebase is initialized.
- The PRD is the source of truth for requirements; code should align with §6–§10 above.
- v1 is squat-only; plan for pluggable exercise modules per design principle #3.
- Privacy: health video is sensitive — consent, encryption, retention policy, user data deletion on request (PRD §12).
- Disclaimer: "not a medical device" — visible disclaimers in UI (PRD §15).