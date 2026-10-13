# Exercise quality model training

The shared trainer accepts one row per repetition with the canonical feature columns registered for an exercise in `backend/app/features/registry.py`, plus a target and a subject identifier. It compares Random Forest and XGBoost with `GroupKFold`; it refuses missing subject IDs and requires at least three subjects. Classification metrics include macro-F1 with a subject-cluster bootstrap 95% interval. Regression reports MAE and correlation with an interval for MAE. Model artifacts are written to `models/quality/`; raw source datasets and extracted feature tables remain ignored by Git.

## First model: REHAB24-6 squat

The preparation script reads the official 3D joint archive and segmentation table, extracts the squat repetitions, derives the registered FR-5 features, and preserves `person_id` for subject-grouped validation:

```powershell
cd backend
python -m ml.datasets.prepare_rehab246_squat
python -m ml.training.train_exercise ..\data\features\rehab246_squat.csv --exercise squat --task classification --target label --group subject_id --models rf xgb
```

The official REHAB24-6 dataset is restricted to academic/nonprofit, non-commercial research and must be cited. Its motion-capture skeletons are not MediaPipe estimates: the resulting grouped metrics measure performance on source skeletons and do not establish accuracy on live camera input. Validate the runtime pose-to-feature path on subject-labelled MediaPipe recordings before presenting live model outputs as reliable.

The local squat run produced 191 reps from 9 participants (130 correct, 61 incorrect). Five-fold subject-grouped evaluation scored RF macro-F1 0.672 (95% subject-bootstrap interval 0.554–0.746) and XGBoost 0.717 (0.634–0.793); majority-class baseline macro-F1 was 0.405. These results are preliminary and uncertain because only nine participant groups are available. Experimental artifacts are under `models/experiments/rehab246-squat-skeleton/`; they are not camera-validated and are not wired into live feedback. The local `data/raw/rehab24-6/` contains the 3D joint archive and annotations, but not the source record's `videos.zip`, so a MediaPipe-on-RGB evaluation still requires that file.

### Live-camera readiness gate

The currently checked-in `squat_rf_v1` is an advisory model because it was trained on REHAB24-6 motion-capture features. Training a new artifact with the shared trainer does not by itself make it camera-validated. Camera training rows must be derived from MediaPipe with the same feature names, units, angle convention, and extractor used by live inference; they must include therapist-reviewed `correct`/`incorrect` labels, a pseudonymous `subject_id`, and a `dataset` value identifying the capture source. Keep all reps from one person in the same validation fold.

`GET /api/quality/exercises` reports `rules_only`, `model_advisory`, or `camera_validated`. The API only reports the last status when model metadata contains a `camera_validation` object with `status: "passed"`, `validation_domain: "mediapipe_live"`, `subject_independent: true`, and `therapist_agreement_percent` of at least 80. That evidence must come from held-out camera sessions and physiotherapist review; do not add the metadata before the evaluation is actually completed. The UI displays the server-reported readiness and reason.

The Mendeley multi-view dataset now supplies MediaPipe-derived **video-level** squat examples. Its experimental session classifier is not the per-rep model used by live inference and is not camera-validated clinical evidence. The product's per-rep model still needs therapist-reviewed MediaPipe rep labels before it can be promoted beyond advisory status.

### Mendeley squat multi-view session experiment

The [Mendeley dataset](https://data.mendeley.com/datasets/kgbb3yn47p/3) contains whole-video good/bad labels, so training stays at one row per video. The adapter uses MediaPipe world landmarks and a consistent 3D angle schema across side, front, and diagonal views. Do not copy these labels onto repetitions or load these artifacts into the per-rep quality endpoint.

```powershell
cd backend
python -m ml.datasets.prepare_mendeley_squat_sessions
python -m ml.training.train_mendeley_session ..\data\features\mendeley_squat_sessions_3d.csv --output-dir ..\models\experiments\mendeley-squat-multiview-session
```

The current extraction yielded 150 videos from 25 subjects (75 good, 75 bad), with 50 videos per view. Five-fold `StratifiedGroupKFold` keeps each participant entirely within one fold. Random Forest macro-F1 was 0.571 (subject-bootstrap 95% interval 0.486–0.645) across all views; the same model scored 0.679 (0.554–0.800) on side-only and 0.660 on front-only, but only 0.420 on diagonal-only. A side+front pooled RF scored 0.610. A pre-specified logistic baseline on all views scored 0.613. These small, correlated video-level samples and wide intervals do not support a reliable general-purpose quality model; camera view materially changes performance. Treat these as experimental findings, not evidence of live per-rep accuracy.

Artifacts are stored separately under `models/experiments/mendeley-squat-multiview-session/` and `models/experiments/mendeley-squat-side-3d-session/`. The training feature schema and label granularity differ from live per-rep inference. No artifact is integrated into the API.

The local KIMORE extract still cannot be used for subject-independent validation because it has no subject/sequence map. The local UI-PRMD flat files do not retain subject IDs or a confirmed per-rep-to-frame mapping. Do not merge these datasets or copy an execution-level KIMORE score onto each rep without explicitly recording that approximation.

## Adding another exercise

Implement an analyzer, exercise-specific rules/defaults, rep feature extractor, and canonical ordered feature tuple; register the analyzer/rules in `backend/app/exercises/registry.py` and feature schema in `backend/app/features/registry.py`. Add a dataset adapter that outputs one row per rep with the registered features, target, and subject ID. The same upload dispatch, quality inference endpoint, and trainer then support `--exercise <registered-name>` and exercise-specific artifacts. Add the exercise's live-camera feature producer before enabling it in the frontend; never train on a different exercise's rows just to fill a schema.

The artifact metadata records the exact feature order, task, labels, grouped cross-validation metrics, confidence interval, confusion matrix (classification), and global model feature importance. Global importance is not presented as a per-rep explanation; local attribution such as SHAP is a later task.
