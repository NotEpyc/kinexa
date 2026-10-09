# Product Requirements Document: Explainable Exercise Form Assessment Platform

**Version:** 1.1 (draft) | **Status:** Ready for review | **Scope of v1:** Squat only

---

## 1. Overview

### 1.1 Summary
An AI-powered platform where a physiotherapist defines patient-specific exercise limits and a patient uploads a video of prescribed exercises. The system tracks body movement via pose estimation, scores rep-by-rep deviation from the patient's own target form (not a generic "ideal" template), and returns a per-rep assessment with explanations.

**v1 scope:** upload-only (max 60 s, max 100 MB MP4/MOV/WebM). **v2+ path:** real-time camera feedback via MediaPipe on navigator.mediaDevices.getUserMedia.

### 1.2 Problem statement
- Home-based rehabilitation depends on patients performing exercises correctly, but therapists cannot watch every session.
- Incorrect form reduces recovery benefit and can cause re-injury.
- Existing AI form checkers give generic feedback ("your squat is wrong") without accounting for each patient's prescribed limits, and are black boxes to clinicians.

### 1.3 Product vision
A personalised, explainable exercise assessment tool that integrates existing pose estimation and public rehabilitation datasets with interpretable ML and therapist-defined constraints, keeping the therapist in control.

### 1.4 What this is not
- **Not a medical device.** It provides form guidance and decision support only. It does not diagnose or prescribe.
- Not a novel pose-estimation or deep-learning research project. It reuses existing components (MediaPipe, public datasets, scikit-learn) and builds the integration, personalisation, and explainability around them.

---

## 2. Goals and Non-Goals

### 2.1 Goals (v1)
1. Accept a squat video and return a per-rep verdict (correct / needs attention) plus an overall score.
2. Explain each flagged rep using human-checkable measurements (knee angle, trunk lean, symmetry, tempo, smoothness).
3. Let a therapist set per-patient ROM limits that override the general model's verdict.
4. Evaluate the ML model with subject-independent validation and report honest metrics.
5. Deliver a working end-to-end system: Next.js frontend, FastAPI backend, stored analysis history.

### 2.2 Non-goals (v1)
- Exercises other than the bodyweight squat.
- Real-time/live camera feedback (upload-only in v1) **; real-time feedback is a v2+ goal**.
- Deep-learning models such as ST-GCN (a v2 option only if the baseline misses real errors).
- Regulatory clearance, payments, multi-clinic tenancy, native mobile apps.
- 3D reconstruction or multi-camera setups.

---

## 3. Users and Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Therapist (Dana)** | Physiotherapist managing 20-50 patients | Set patient limits quickly, review flagged sessions, trust and understand why something was flagged |
| **Patient (John)** | Recovering from a knee or hip issue, exercising at home | Simple upload flow, clear feedback, encouragement, knowing what to fix |
| **Admin / Developer** | Project owner during v1 | Manage users, monitor failures, retrain and swap models |

---

## 4. User Stories

**Therapist**
- As a therapist, I can create a patient and assign an exercise plan with ROM limits (min/max knee angle, max trunk lean).
- As a therapist, I can see a list of recent analyses and which ones were flagged.
- As a therapist, I can open a session and see each rep, its measurements, and the reason for any flag.
- As a therapist, I can view a patient's progress over time.

**Patient**
- As a patient, I can upload a video of my squats and get results within a minute or two.
- As a patient, I get plain-language feedback such as "Your knees didn't bend enough on reps 3 and 7."
- As a patient, I get filming guidance (camera angle, distance, lighting) before I upload.

**System**
- The system rejects unusable videos (no person detected, too short, body out of frame) with a helpful message instead of a wrong result.

---

## 5. Scope of v1

| In scope | Out of scope |
|---|---|
| Squat, single person in frame | Multiple exercises |
| Side-view (primary) and front-view (secondary) video | Moving cameras, multi-person scenes |
| Video upload (MP4/MOV), up to ~60 s | Live streaming |
| Therapist-set ROM per patient | Automated ROM recommendations |
| Random Forest and XGBoost comparison | Deep learning |
| Basic auth, patients, plans, history | Billing, clinic hierarchies |

---

## 6. Functional Requirements

### 6.1 Video intake and validation (FR-1)
- FR-1.1 Accept MP4/MOV/WebM up to a configurable size (default 100 MB) and duration (default 60 s).
- FR-1.2 Validate that a person is detected in at least a minimum share of frames (default 80%).
- FR-1.3 Reject or warn when key landmarks (hips, knees, ankles, shoulders) have low visibility.
- FR-1.4 Show a pre-upload checklist: full body in frame, camera at hip height, side view, good lighting, fitted clothing.

### 6.2 Pose extraction (FR-2)
- FR-2.1 Run MediaPipe Pose on every frame; store landmarks with visibility scores.
- FR-2.2 Convert output into a **common skeleton format** (subject_id, exercise, frame, joint, x, y, z, visibility) shared with dataset loaders.
- FR-2.3 Apply light smoothing (e.g., Savitzky-Golay or moving average) to reduce jitter.

### 6.3 Angle computation (FR-3)
- FR-3.1 Compute per frame: left/right knee angle (hip-knee-ankle), left/right hip angle (shoulder-hip-knee), trunk lean (shoulder-hip line vs. vertical). **Angle convention**: 180° = straight leg (full extension), 0° = fully flexed. Knee angle = angle(left_hip, left_knee, left_ankle) or angle(right_hip, right_knee, right_ankle).
- FR-3.2 Mask frames where the relevant landmarks fall below a visibility threshold.

### 6.4 Rep detection (FR-4)
- FR-4.1 Detect reps from the knee-angle signal (valleys via peak detection, with minimum depth and minimum spacing parameters).
- FR-4.2 Define each rep as standing, descent, bottom, ascent, standing.
- FR-4.3 Return start/bottom/end frame and timestamps per rep.
- FR-4.4 Handle partial reps and false positives by requiring a minimum range of motion; report ignored segments.

### 6.5 Feature extraction (FR-5)
A single function `extract_squat_features(skeleton)` must work on dataset skeletons and MediaPipe output alike. Per rep:

| Feature | Meaning |
|---|---|
| min_left_knee_angle, min_right_knee_angle | Depth reached |
| knee_asymmetry | Left vs. right difference at bottom |
| min_hip_angle | Hip flexion at bottom |
| max_trunk_lean | Forward lean (worst point) and at bottom |
| duration, descent_time, ascent_time | Tempo |
| smoothness | Variability of angular velocity / jerk |

Final feature list is confirmed after dataset exploration (Phase A/B).

### 6.6 ML assessment (FR-6)
- FR-6.1 Load a trained model (Random Forest baseline; XGBoost comparison) and output per-rep quality (class and probability, or a score depending on the label type).
- FR-6.2 Return the top contributing features per prediction (feature importance for v1; SHAP optional later).
- FR-6.3 Model artefacts are versioned; the model version is stored with every analysis.

### 6.7 Patient-specific rules layer (FR-7)
- FR-7.1 **Patient-specific ROM customisation**: Target ROM range (min–max angle) for each tracked joint in the prescribed exercise, per patient. E.g., knee angle 100–120° instead of the population "ideal." Tolerance band — how much deviation from the target counts as a flag (tighter for advanced patients, looser for early post-op). 
- FR-7.2 **Decision logic:** the therapist's rules take precedence. A rep is flagged if it violates any patient limit, even when the ML model says "good". If the rep is inside the patient's limits, the ML result is shown as advisory (e.g., "general form concern: smoothness") and does not override the therapist's range.
- FR-7.3 **Decision table** (relax vs. tighten). Applies when the model produces per-rep verdicts; under session-level training (approach 1 in §7.4) the model gives one session score and per-rep verdicts come from rules and measurements only.

| ML verdict | Inside patient limits? | ML complaints covered by therapist limits? | Outcome |
|---|---|---|---|
| Incorrect | Yes | Yes | Rep passes; ML advisory only ("general form concern: ...") |
| Incorrect | Yes | No | Rep flagged — uncovered ML complaint escalates |
| Incorrect | No | Yes | Rep flagged — therapist violation takes precedence |
| Incorrect | No | No | Rep flagged — both therapist violation and uncovered ML complaint |
| Correct | Yes | N/A | Rep passes |
| Correct | No | N/A | Rep flagged — therapist violation takes precedence |
| N/A | No | N/A | Not assessable (poor visibility) |
| N/A | N/A | N/A | No therapist limits set — default population limits apply |

- FR-7.4 Each flag carries a machine-readable code and a plain-language message (e.g., `knee_rom_below_min`: "Knee bent less than the prescribed minimum depth").
- FR-7.5 **Patient exercise parameters table** (database): `patient_exercise_parameters` stores (plan_id, metric, side, phase, min_value, max_value, unit, tolerance, effective_from, effective_to, version). Metric covers joint angles, trunk lean, asymmetry, tempo. Side: left, right, either. Phase: at_bottom, at_peak, whole_rep. Angle convention documented separately (180° = straight leg). Editable from the dashboard, read by the Exercise Quality Scoring Engine instead of a single hard-coded reference.
- **v2 / future** (not in v1): Progression schedule — therapist raises target over successive weeks (e.g., 100° week 1 → 90° week 4). Contraindicated-movement flags — hard stop if joint crosses unsafe angle. Symmetry-relative scoring — compare injured limb to percentage of healthy limb's range.

### 6.8 Results and scoring (FR-8)
- FR-8.1 Overall score (0-100) defined transparently, e.g., share of reps passing weighted by severity. Document the formula in the UI.
- FR-8.2 Per-rep detail: measurements vs. targets, status, issues, ML confidence.
- FR-8.3 Movement graph (knee angle vs. time) with the patient's allowed range overlaid and reps marked.
- FR-8.4 Result states: Correct, Needs attention, Not assessable (poor visibility).

### 6.9 Patient and plan management (FR-9)
- FR-9.1 CRUD for patients, exercise plans, and ROM constraints.
- FR-9.2 Plan history is retained: each analysis references the constraints active at the time.

### 6.10 History and progress (FR-10)
- FR-10.1 Store every analysis and rep result.
- FR-10.2 Show trends: average score, depth, trunk lean across sessions.
- FR-10.3 Therapist dashboard lists flagged sessions first.

### 6.11 Authentication and roles (FR-11)
- FR-11.1 Roles: therapist, patient, admin.
- FR-11.2 A therapist sees only their own patients; a patient sees only their own data.

---

## 7. Machine Learning Requirements

### 7.1 Data sources
- **KIMORE** ✅ Free dataset (check terms before commercial use). Contains 5 exercises: arm lifting, lateral trunk tilt, trunk rotation, pelvis rotation, and squatting. Squat is included; there is no hip abduction or knee extension. Exercises are scored on a continuous quality scale by physical therapists. One score per exercise execution (rep count to be confirmed from files), not per rep. **Use:** primary training set for regression-style quality score — but label granularity is execution-level; rep-level labels must be approximated. **KIMORE includes RGB video** — running MediaPipe on those videos trains on MediaPipe features, reducing the Kinect-versus-MediaPipe mismatch. Note: KIMORE appears to use a front-facing Kinect (to be confirmed); 2D knee flexion from front view is unreliable.
- **UI-PRMD** ✅ Free to all users under Open Data Commons PDDL v1.0 (public-domain dedication; confirm if distributing). Exercises: deep squat, hurdle step, inline lunge, side lunge, sit to stand, standing active straight leg raise, and four standing shoulder movements. Labels are provided both as whole-episode files and as segmented per-rep files with `_inc` extension for incorrect movements. Per-rep correct/incorrect files exist. Use as a secondary baseline check only. Labels are "acted errors" — may not look like real patient mistakes.
- **Domain gap:** Self-collected data required to measure the Kinect/motion-capture vs. MediaPipe skeleton mismatch. Target 100-200+ labelled reps from several people, recorded on phone/webcam, with correct and deliberately incorrect variants (shallow, knee valgus, excessive forward lean, fast/jerky). Labelled by a physiotherapist where possible; otherwise clearly marked as self-labelled.
- **Reduced dataset:** A cleaned, Vicon-only version of UI-PRMD with movement quality scores and CSV files is also available from the UI-PRMD page.
- **Licensing:** MediaPipe Pose (Apache 2.0 — free commercial use) recommended primary pose backbone. KIMORE: check originating university's terms for commercial use. UI-PRMD: public-domain dedication; confirm if distributing. YOLOv8-Pose requires Enterprise License for closed-source commercial use. Commercial usability of models trained on KIMORE/UI-PRMD must be verified case-by-case; state explicitly if this is a student project with no commercial distribution planned.

### 7.2 Label strategy
Decided only after inspecting what the dataset provides:
- **Binary** (good / needs attention) if labels are categorical.
- **Regression** (quality score) if clinical scores are continuous.
- **Ordinal** (good / needs improvement / poor) via documented score thresholds if useful.

The meaning of any score and the threshold choice must be written down and justified.

### 7.3 Self-collected data
- Target 100-200+ labelled reps from several people, recorded on phone/webcam, with correct and deliberately incorrect variants (shallow, knee valgus, excessive forward lean, fast/jerky).
- Labelled by a physiotherapist where possible; otherwise clearly marked as self-labelled.
- Required to measure the **domain gap** between Kinect/motion-capture skeletons and MediaPipe skeletons.

### 7.4 Training and evaluation
- Models: Random Forest (baseline), XGBoost (comparison), optional logistic regression as a sanity-check baseline.
- **Subject-independent evaluation only**: grouped splits and grouped cross-validation (GroupKFold / leave-one-subject-out). Never split reps randomly.
- Metrics: accuracy, precision, recall, F1 (macro), confusion matrix; for regression, MAE and correlation with clinical score.
- Report results separately on (a) dataset skeletons and (b) MediaPipe videos of new people.
- Report class balance and handle imbalance (class weights).
- **Label granularity decision:** KIMORE provides one continuous clinical score per exercise execution (rep count to be confirmed from files; scores include PO_S and CF_S on a 0–50 scale), not per rep. UI-PRMD provides per-rep correct/incorrect labels (files with `_inc` extension). Your product outputs per-rep verdicts. You must choose one of two approaches:
  1. **Train at session level:** model predicts per-execution quality score; per-rep verdicts come from rules and measurements, not the model alone.
  2. **Train at rep level:** copy the execution-level score from KIMORE onto every rep in that exercise execution, accepting noisy labels. Document this approximation explicitly.
  Do not attempt to merge KIMORE (execution-level) and UI-PRMD (per-rep) datasets naively. They use different exercise types (squat vs. deep squat), different skeleton definitions, different capture systems, and different label granularity. KIMORE is a starting point; UI-PRMD provides a binary check. The choice of primary dataset depends on which labels better match the product's per-rep output — decide after inspecting the actual files.
- **Sample sizes are small:** UI-PRMD has ~10 subjects; KIMORE squat recording count inferred from dataset survey (~353 samples ÷ 5 exercises ≈ 70 squat recordings). Subject-independent cross-validation on this will give wide confidence intervals. XGBoost can overfit easily. Start with a simple model (logistic regression or shallow forest), report confidence intervals / bootstrap CIs rather than a single number, and treat results as preliminary until a larger self-collected MediaPipe dataset is available.
- **Model architecture:** Use XGBoost/RF on engineered features (min/max knee angle, hip asymmetry, smoothness, rep tempo, completeness) — not end-to-end deep learning in v1. Fine-tune/validate on self-collected MediaPipe data to bridge the domain gap. If KIMORE includes RGB video (it does), run MediaPipe on those videos and train on MediaPipe features — this reduces the Kinect-versus-MediaPipe mismatch. Note: KIMORE appears to use a front-facing Kinect (to be confirmed); 2D knee flexion from front view is unreliable.

### 7.5 Explainability
- Global feature importance reported in the evaluation.
- Per-rep top contributing factors shown to users; SHAP optional later.
- **Score breakdown per joint/metric**: output per-joint measurements vs. targets + flags instead of one final number. Feeds into the UX requirements (plain-language feedback with numbers) and the Reports system — output format change, not a new model.
- **Explainability caveat:** Per-rep explanations are approximations if training at session level. Document the mapping approach clearly to users. If using approach 2 (copy session score onto each rep), explain that per-rep scores are approximations of the execution-level score.

### 7.6 Acceptance targets (to be calibrated after the first baseline)
- Subject-independent macro-F1 reported with confidence intervals; target set after the baseline is measured rather than promised up front.
- Agreement with a physiotherapist's per-rep labels on a held-out set of new people: target >= 80% for the clear-cut cases (clearly good vs. clearly bad).


## 8. System Architecture

```
User / Therapist
      |
  Next.js (TypeScript, Tailwind, Recharts)
      |  upload video, patient config
  FastAPI (Python)
      |
  Pipeline: MediaPipe -> landmarks -> angles -> rep detection -> features -> ML model
      |                                                                  |
      +--------------- Patient ROM rules <-------------------------------+
      |
  Final assessment JSON -> Next.js UI
      |
  PostgreSQL (patients, plans, constraints, analyses, reps)
```

### 8.1 Components
- **Frontend:** Next.js + TypeScript + Tailwind + Recharts.
- **Backend:** FastAPI + Uvicorn; OpenCV, MediaPipe, NumPy, SciPy, scikit-learn, XGBoost.
- **Storage:** PostgreSQL for records; object/file storage for uploaded videos and optional overlay renders.
- **Processing:** synchronous for short clips in v1; move to a job queue (e.g., background tasks, then Celery/RQ) if processing exceeds acceptable latency.

### 8.2 Design principles

1. One common skeleton format for all sources (datasets and MediaPipe).
2. One feature extractor shared across training and inference (prevents train/serve drift).
3. Exercise modules are pluggable: each exercise defines its landmarks, angles, rep logic, features, and rules.
4. Therapist rules sit outside the ML model and always take precedence.

### 8.3 Angle computation — important

MediaPipe's normalised `x,y` coordinates are scaled by image width and height separately, so computing angles from them directly distorts the angle on non-square video (different width/height scaling). Two correct options:

1. **Use `pose_world_landmarks`** (recommended): 3D metric coordinates in meters, hip-centred. Compute angles from these — they are invariant to image aspect ratio. Example: knee angle = angle(left_hip, left_knee, left_ankle) using world coordinates. **Note**: use the same-side joints (left hip, left knee, left ankle; or right hip, right knee, right ankle). Do not mix left knee with right ankle. **Angle convention**: 180° = straight leg (full extension), 0° = fully flexed.
2. **If using normalised landmarks**: multiply `x` by frame width and `y` by frame height before computing angles, so the x and y scalings are consistent with the image geometry. Better: use the newer `mediapipe.tasks.vision.PoseLandmarker` API, which provides both normalised and world landmarks.

**Do not** compute angles from normalised `x,y` alone without correcting for aspect ratio — the result will be systematically distorted.

### 8.4 Suggested repository layout
```
exercise-analysis/
  frontend/ (app, components, lib, types)
  backend/
    app/ (main.py, routes/, pose/, exercises/, features/, models/, rules/)
    ml/ (training/, evaluation/, datasets/)
  data/ (raw/, processed/, features/)
  models/ (versioned model artefacts)
  README.md
```
Create folders progressively as needed.

---

## 9. API Specification (v1)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/analyze` | Upload video + `patient_id` + `exercise`; returns analysis |
| GET | `/api/analyses/{id}` | Fetch a stored analysis |
| GET | `/api/patients/{id}/analyses` | History for a patient |
| POST/GET/PUT | `/api/patients` | Manage patients |
| POST/GET/PUT | `/api/patients/{id}/plans` | Manage exercise plans and ROM constraints |
| GET | `/api/health` | Service and model-version status |

**Example `/api/analyze` response**
```json
{
  "analysis_id": "a_123",
  "exercise": "squat",
  "model_version": "squat_rf_v1",
  "total_reps": 8,
  "correct_reps": 6,
  "incorrect_reps": 2,
  "score": 78,
  "reps": [
    {
      "rep": 1,
      "status": "correct",
      "start_s": 0.8, "bottom_s": 1.9, "end_s": 3.0,
      "measurements": {"min_knee_angle": 88, "max_trunk_lean": 14, "asymmetry": 3},
      "ml": {"label": "good", "confidence": 0.91, "top_factors": ["min_knee_angle"]},
      "issues": []
    },
    {
      "rep": 2,
      "status": "incorrect",
      "measurements": {"min_knee_angle": 112, "max_trunk_lean": 27, "asymmetry": 4},
      "issues": ["knee_rom_below_min", "excessive_trunk_lean"]
    }
  ],
  "warnings": []
}
```

**Errors:** structured codes such as `NO_PERSON_DETECTED`, `LOW_LANDMARK_VISIBILITY`, `NO_REPS_FOUND`, `VIDEO_TOO_LONG`, each with a user-facing message.

---

## 10. Data Model (PostgreSQL)

| Table | Key fields |
|---|---|
| `users` | id, role, name, email, password_hash |
| `patients` | id, therapist_id, name, age, notes |
| `exercise_plans` | id, patient_id, exercise, active, created_at |
| `patient_exercise_parameters` | id, plan_id, metric, side, phase, min_value, max_value, unit, tolerance, effective_from, effective_to, version |
| `analyses` | id, patient_id, plan_id, constraints_snapshot, video_ref, model_version, score, created_at |
| `rep_results` | id, analysis_id, rep_index, status, measurements (JSON), ml_output (JSON), issues (JSON) |

Store a **snapshot of constraints** on each analysis so old results stay interpretable after a therapist edits limits. The `patient_exercise_parameters` table supersedes `rom_constraints` — metric-based rows scale to new exercises without schema changes, store metric type, phase, and side. Angle convention (180° = straight leg) is documented separately.

---

## 11. UX Requirements

### 11.1 Screens
1. **Dashboard:** patients, recent analyses, flagged sessions, average scores.
2. **Patient page:** profile, exercise plans, ROM limits, "Analyze exercise" button, history.
3. **Plan editor:** knee angle min/max, trunk lean max, optional extras, with validation (min < max, sensible ranges).
4. **Upload page:** filming checklist, file picker, progress stages (pose detection, rep detection, features, assessment, patient rules).
5. **Results page:** score, rep list, rep detail panel (measurement vs. target bars), movement graph with allowed band, issues list.
6. **Progress page:** trends across sessions.

### 11.2 UX principles
- Always show the reason behind a flag, in plain language and with numbers.
- Distinguish clearly between *therapist-limit violations* and *general form advice*.
- Use cautious wording: "form guidance", never "diagnosis".
- Accessible: readable contrast, keyboard navigation, not colour-only status indicators (use icons and text).
- Mobile-friendly upload (patients will use phones).

---

## 12. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Typical 30 s clip analysed in under ~60 s on a standard CPU server; progress feedback shown |
| Reliability | Graceful failures with actionable messages; no silent wrong results |
| Accuracy honesty | Display "not assessable" when landmark visibility is low |
| Security | Auth on all endpoints, role-based access, signed URLs for video access, input validation, file type/size limits |
| Privacy | Health-related video is sensitive: explicit consent, encryption in transit and at rest, retention policy (e.g., delete raw video after N days, keep only landmarks and results), user data deletion on request |
| Maintainability | Typed APIs (Pydantic / TypeScript types), unit tests for angle/rep/feature code, versioned models |
| Reproducibility | Fixed seeds, saved training configs, dataset version notes |
| Compatibility | Latest Chrome, Safari, Edge; iOS/Android browsers |

---

## 13. Success Metrics

**Model quality**
- Subject-independent macro-F1 and confusion matrix reported for both models.
- Agreement with physiotherapist on held-out new people.

**Pipeline quality**
- Rep count accuracy against manual count (target: exact on >= 90% of clean videos).
- Share of uploads successfully analysed vs. rejected (and rejection reasons).

**Product**
- Time from upload to result.
- Therapist-rated usefulness and trust of explanations (small usability test, e.g., 3-5 clinicians or students).
- Patient task completion: upload to understanding feedback without help.

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Domain gap** between Kinect/mocap skeletons and MediaPipe | Model underperforms on real videos | Collect own MediaPipe data; fine-tune/validate on it; report gap openly; consider training on MediaPipe-derived features from self-collected data |
| Dataset labels don't map cleanly to "correct/incorrect" | Misleading classifier | Inspect labels first; choose regression/ordinal where appropriate; document thresholds |
| Squat not available or limited in a dataset | Weak training data | Check availability early; fall back to another exercise present in both datasets and in the product, or lean on self-collected data |
| 2D video can't capture depth | Angle error, especially from front view | Recommend side view; fixed camera guidance; label results as approximate |
| Poor lighting, loose clothing, occlusion | Landmark errors | Visibility checks; "not assessable" state; capture guidance |
| Overfitting to person-specific style | Inflated metrics | Subject-grouped evaluation only |
| Small self-collected dataset | Unstable results | Use cross-validation, report confidence intervals, avoid overclaiming |
| Users treat it as medical advice | Safety/liability | Clear disclaimers, therapist in the loop, no diagnostic language |
| Privacy of health video | Legal/ethical exposure | Consent flow, minimal retention, encryption, access control |
| Scope creep (many exercises, real-time) | Missed deadline | Strict v1 scope; expand only after squat is validated |

---

## 15. Compliance, Ethics, and Disclaimers
- Positioned as an educational/decision-support tool, **not a medical device**. If ever deployed clinically, regulatory requirements for the relevant region would need to be reviewed.
- Obtain informed consent from anyone who contributes video; follow dataset license terms; cite datasets and papers.
- Be transparent about limitations (single camera, dataset bias, small sample sizes).
- Evaluate for bias where possible (body size, age, clothing, skin tone effects on pose detection).

---

## 16. Build vs. Reuse

**Not reusable:** the commercial products themselves (Hinge Health, Sword Health, Kaia Health, Kemtai). These are proprietary — no public code, no public model weights, no legal way to plug into or copy them.

**Legitimately reusable** — the open building blocks underneath products like these:

| Resource | Where to find it | License / cost |
|---|---|---|
| MediaPipe Pose (BlazePose) | `pip install mediapipe` / `github.com/google-ai-edge/mediapipe` | Apache 2.0 — free, fine for commercial use |
| YOLOv8-Pose | `github.com/ultralytics/ultralytics` | Free under AGPL-3.0 (requires open-sourcing your own code), or paid Ultralytics Enterprise License for closed-source commercial use |
| OpenPose | `github.com/CMU-Perceptual-Computing-Lab/openpose` | Free for research only — commercial use requires a separate paid license from Carnegie Mellon |
| KIMORE dataset | Search "KIMORE dataset" (hosted by its originating university research group) | Free for research/academic use — check terms for commercial use |
| UI-PRMD dataset | Search "UI-PRMD dataset University of Idaho" | Free to all users |
| Published research code | Papers With Code (`paperswithcode.com`) and GitHub, searching "KIMORE exercise assessment" / "rehabilitation exercise quality assessment" | Varies by repo — check each license individually before commercial use |

**Recommended path:** use MediaPipe (safest free commercial license) for the pose backbone → fine-tune/validate the scoring logic on KIMORE and UI-PRMD (free, clinician-assigned scores for KIMORE, acted errors for UI-PRMD) → build the ROM Customisation and scoring layers as original work on top. This is genuine reuse of the free, public parts of the ecosystem — not a copy of any company's finished product.

**UI-PRMD details** (from the dataset page): See §7.1 for license and exercise list. Labels are provided both as whole-episode files and as segmented per-rep files with `_inc` extension for incorrect movements. There is also a reduced dataset with movement quality scores and CSV files.

**KIMORE details** (from the dataset page): Contains 5 exercises: arm lifting, lateral trunk tilt, trunk rotation, pelvis rotation, and squatting. One continuous clinical quality score per exercise execution (rep count to be confirmed from files), not per rep. License: check originating university's terms for commercial use. RGB video is included — running MediaPipe on those videos trains on MediaPipe features, reducing the Kinect-versus-MediaPipe mismatch.

---

## 17. Milestones and Plan

| Phase | Focus | Exit criteria |
|---|---|---|
| **A. Research and reuse** | Survey repos and papers; obtain KIMORE and UI-PRMD; document formats, labels, subjects; run an existing pipeline unchanged | Dataset data-dictionary written; reference pipeline runs locally; MediaPipe pose backbone validated |
| **B. Rules & upload pipeline** | Build rule-based checker (ROM limits, measurements, flags); upload flow; video → MediaPipe → features → rules → JSON | End-to-end upload works; rule flags generated correctly; per-rep measurements match manual count |
| **C. ML prototype** | Pick squat; common skeleton format; angles; rep detection; features; train RF and XGBoost on KIMORE; **optional: validate on UI-PRMD** (different skeleton, deep squat, binary labels); subject-independent evaluation | Reproducible notebook/scripts; comparison table on held-out subjects; domain gap measured between dataset skeletons and MediaPipe |
| **D. Core contribution** | Explainability; ROM customisation module; decision layer; test on own MediaPipe videos | Rules layer unit-tested; patient_exercise_parameters table designed; ROM flags generated correctly with therapist overrides |
| **E. Backend** | FastAPI, model loading, `/analyze`, structured JSON, validation errors | API returns correct output on test videos; upload pipeline (video → MediaPipe → features → rules → model → ROM override → JSON) works end-to-end |
| **F. Frontend** | Dashboard, patients, plan editor, upload, results, graphs | End-to-end flow works in browser: patient uploads video → gets per-rep assessment with ROM-based flags and explanations |
| **G. Database** | PostgreSQL, auth, history, progress | Analyses persisted and retrievable; constraints snapshot stored with each analysis; patient exercise parameters editable |
| **H. Validation and expansion** | Unseen people, camera-angle tests, physiotherapist comparison; then second exercise; **v2: real camera feedback** | Validation report; v1 sign-off; v2 prototype with MediaPipe on navigator.mediaDevices.getUserMedia confirmed working |

**Rough timeline (one developer):** A: 1-2 weeks, B: 1-2 weeks, C: 2-3 weeks, D: 1-2 weeks, E: 1 week, F: 2-3 weeks, G: 1-2 weeks, H: ongoing. Roughly 9-14 weeks to a validated v1; adjust after Phase A once the dataset reality is known.

**Immediate first task:** do not start the frontend. Identify the best reusable pipeline and dataset, and get it running locally. **v1: upload-only pipeline. v2: real-time camera feedback added after v1 validated.**

**Rules-first build order:** Build the rule-based checker (ROM limits, measurements, flags) and the upload flow first. Treat the ML model as a hypothesis to test — run the rules pipeline on your own videos with physiotherapist labels, measure precision/recall of therapist limits vs. ground truth, then add the model if it catches issues the rules miss. This validates the product before committing to model accuracy.

---

## 18. Testing Strategy
- **Unit tests:** angle function (known coordinates), rep detection (synthetic sine-wave signals), feature extractor, rule layer (boundary values).
- **Integration tests:** video in, JSON out, with a small set of fixture videos.
- **Model tests:** regression check that a saved model reproduces stored metrics on a fixed validation set.
- **Usability tests:** short task-based sessions with therapists or physiotherapy students.
- **Robustness tests:** different lighting, clothing, distance, camera heights, angles; document failure patterns.

---

## 19. Open Questions
1. Exactly which dataset exercises, joints, and labels are usable for squat, and what does each score mean?
2. Will the final model train on dataset skeletons only, on self-collected MediaPipe data only, or a combination?
3. Which rep-counting/exercise-analysis repositories are reliable enough to adapt?
4. Who will provide physiotherapist labels or review, and how many reps can they label?
5. Is hosting needed for the final demo (and thus a retention/consent policy), or will it run locally?
6. Should therapists be able to set limits per rep phase (e.g., depth only) or only global limits in v1?

---

## 20. Definition of Done for v1
- A therapist can create a patient, set squat ROM limits, and review a patient's uploaded squat video.
- The system returns a per-rep assessment with explanations, a score, and a movement graph with the allowed range.
- Therapist limits demonstrably override the general model in tests.
- Model comparison and subject-independent evaluation are documented, including MediaPipe-domain results.
- Known limitations, privacy handling, and disclaimers are documented and visible in the product.
