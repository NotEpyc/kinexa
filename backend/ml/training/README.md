# Squat ML prototype

The trainer accepts one row per repetition with the canonical FR-5 feature columns exported by `backend/app/features/squat.py`, plus a target and a subject identifier. It compares Random Forest and XGBoost with `GroupKFold`; it refuses missing subject IDs and requires at least three subjects. Classification metrics include macro-F1 with a subject-cluster bootstrap 95% interval. Regression reports MAE and correlation with an interval for MAE. Artifacts are written to the repository-root `models/` directory, which is intentionally gitignored.

Example after preparing a validated per-rep feature table:

```powershell
cd backend
python -m ml.training.train_squat ..\data\features\ui_prmd_squat.csv --task classification --target label --group subject_id
python -m ml.training.train_squat ..\data\features\kimore_squat.csv --task regression --target clinical_score --group subject_id --models rf xgb
```

Do not run the current raw local CSV files directly through this trainer. The KIMORE extract has no subject/sequence mapping and no RGB videos; the local UI-PRMD flat files do not retain subject IDs or a confirmed per-rep-to-frame mapping. The PRD requires subject-independent evaluation. A valid feature adapter and subject map (or newly collected subject-labelled MediaPipe reps) are prerequisites for a defensible trained model. Do not copy an execution-level KIMORE score to each rep without recording that approximation.

The artifact metadata records the exact feature order, task, labels, grouped cross-validation metrics, confidence interval, confusion matrix (classification), and global model feature importance. Global importance is not presented as a per-rep explanation; local attribution such as SHAP is a later task.
