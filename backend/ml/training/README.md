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

The local KIMORE extract still cannot be used for subject-independent validation because it has no subject/sequence map. The local UI-PRMD flat files do not retain subject IDs or a confirmed per-rep-to-frame mapping. Do not merge these datasets or copy an execution-level KIMORE score onto each rep without explicitly recording that approximation.

## Adding another exercise

Implement an analyzer, exercise-specific rules/defaults, rep feature extractor, and canonical ordered feature tuple; register the analyzer/rules in `backend/app/exercises/registry.py` and feature schema in `backend/app/features/registry.py`. Add a dataset adapter that outputs one row per rep with the registered features, target, and subject ID. The same upload dispatch, quality inference endpoint, and trainer then support `--exercise <registered-name>` and exercise-specific artifacts. Add the exercise's live-camera feature producer before enabling it in the frontend; never train on a different exercise's rows just to fill a schema.

The artifact metadata records the exact feature order, task, labels, grouped cross-validation metrics, confidence interval, confusion matrix (classification), and global model feature importance. Global importance is not presented as a per-rep explanation; local attribution such as SHAP is a later task.
