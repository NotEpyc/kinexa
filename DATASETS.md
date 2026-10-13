# Dataset Sources

## Video-capable datasets beyond squat

### Mendeley multi-view fitness exercises
- **Source**: [Mendeley Data v3](https://data.mendeley.com/datasets/kgbb3yn47p/3) (DOI: 10.17632/kgbb3yn47p.3)
- **Exercises**: seven fitness movements, including bodyweight squat, push-up, dumbbell row/curl/press, side bend, and triceps extension.
- **Data/labels**: raw MP4 videos, each labeled good or bad for the whole execution, with subject IDs and front/side/diagonal views. The record lists CC BY 4.0; retain attribution and review the license before redistribution.
- **Local archive**: `data/raw/mendeley-seven-exercises/dataset-subject-wise.zip` (gitignored; do not commit the multi-gigabyte archive).
- **Local audit**: 1,042 MP4 files across 26 subject folders; the squat subset has 150 videos for 25 subjects (subject_025 has no squat clips), balanced across good/bad and three views (50 per view). Kinexa extracted all 150 with MediaPipe world landmarks.
- **Preparation/training**: `backend/ml/datasets/prepare_mendeley_squat_sessions.py` extracts one MediaPipe 3D feature row per video; `backend/ml/training/train_mendeley_session.py` trains an experimental Random Forest using five-fold `StratifiedGroupKFold`, keeping participants separate across folds. Labels remain at video granularity.
- **Limitations/results**: all-view RF macro-F1 is 0.571 (95% subject-bootstrap interval 0.486–0.645); side-only 0.679 (0.554–0.800); front-only 0.660; diagonal-only 0.420; pooled side+front RF 0.610. The small cohort, repeated clips within participants, view sensitivity, and broad video labels make these preliminary results. The artifact has a different feature schema and label granularity and cannot serve per-rep live feedback. It provides neither therapist-set ROM labels nor clinical validation.

### REHAB24-6 — recommended first video source
- **Source**: [Zenodo record](https://zenodo.org/records/13305826) (DOI: 10.5281/zenodo.13305826)
- **Exercises**: 6 including squat, leg lunge, leg abduction, push-up, arm abduction, and arm V/W movement.
- **Data**: RGB video from two views, 2D/3D motion-capture joints and markers, and repetition boundaries with binary correctness annotations. The release describes 65 recordings, 10 people, and 1,072 annotated repetitions.
- **Why useful**: video allows us to run the same MediaPipe pose extractor used by Kinexa; annotations/joint ground truth allow comparison against the source labels. Subject and repetition fields support grouped evaluation.
- **Limitations**: small cohort; controlled lab capture; not a post-operative patient dataset. The Zenodo record restricts use to academic/nonprofit research and says commercial use requires contacting the authors. Review current terms before distributing results or using commercially.
- **Plan**: start with its squat and leg-lunge clips; derive Kinexa's FR-5 features from RGB using MediaPipe so model inputs match runtime. Use provided motion capture joints for pose-estimator analysis/quality checks, not as a mixed feature source in the same model.
- **Local run**: this checkout currently has `3d_joints.zip`, `joints_names.txt`, and `Segmentation.csv`, but no `videos.zip`. The skeleton adapter extracted 191 squat reps from 9 participants (130 correct, 61 incorrect). Five-fold subject-grouped macro-F1 was 0.672 for RF (95% subject-bootstrap interval 0.554–0.746) and 0.717 for XGBoost (0.634–0.793). These are motion-capture feature results only; they do not test MediaPipe or live video. Experimental artifacts are saved locally under `models/experiments/rehab246-squat-skeleton/` and are not integrated into live inference.

### UCOPhyRehab++ — multi-exercise RGB-derived modalities
- **Source**: [Zenodo record](https://zenodo.org/records/17935737)
- **Exercises / modalities**: multi-view rehabilitation recordings; release includes RGB-derived silhouettes, optical flow, segmentation, and metadata. Check its record and metadata for the exact exercise/subject subset before selecting it.
- **Potential use**: exercise recognition or robustness experiments across views/modalities; assess whether original RGB is available in this release before planning MediaPipe extraction.
- **Caution**: do not treat it as a labeled Kinexa quality dataset until its scoring annotations and licensing are verified for the intended task.

### Upper-limb stroke rehabilitation video dataset
- **Source**: [Data in Brief article](https://doi.org/10.1016/j.dib.2026.112819); data is linked from its Data Availability section on Mendeley Data.
- **Coverage**: 491 RGB videos of four upper-limb strengthening exercises performed by 10 volunteers.
- **Potential use**: a future shoulder/arm module and camera/lighting robustness work. It does not directly add squat labels; inspect the linked repository for annotations, subject IDs, and terms before use.

## Skeleton/CSV or motion-capture datasets

### IntelliRehabDS
- **Source**: [Zenodo record](https://zenodo.org/records/4610859)
- **Data**: CSV/text 3D Kinect skeleton sequences for 15 patients and 14 healthy participants, with exercise and correct/incorrect annotations from two annotators.
- **Potential use**: additional labeled movements and patient variation if its exercises overlap with Kinexa. It is not an RGB video source, so it cannot directly validate MediaPipe extraction from camera footage.

## KIMORE Dataset
- **Source**: https://drive.google.com/drive/folders/1S_y95vxwIQFYxrNNzNODqVnxaKakNcXb
- **Description**: 5 exercises (arm lifting, lateral trunk tilt, trunk rotation, pelvis rotation, squatting) performed by 78 subjects (healthy + mobility impaired)
- **Original modalities**: RGB/depth video, Kinect skeleton data, and clinician scores (PO_S, CF_S on a 0-50 scale). The local `KIMORE.zip` inspected for this project contains only `Train_X.csv`/`Train_Y.csv` for exercises 1-5; it contains no video files. The KIMORE paper says RGB recordings are available by contacting the authors ([Capecci et al., 2019](https://doi.org/10.1109/TNSRE.2019.2923060)).
- **License**: Check originating university terms for commercial use
- **Local squat files**: `Kimore ex5/Train_X.csv` has 37,300 rows × 100 columns and `Train_Y.csv` has 373 scores. The exact 100:1 row ratio indicates 100 frame rows per scored execution in these files; confirm against the source data dictionary before extracting features. Subject IDs are not present in these two files.

## UI-PRMD Dataset
- **Source**: https://drive.google.com/drive/folders/1yOUSuvhm-LePn5zrwZ4cWAs5EqETWsFz
- **Description**: 10 movements (deep squat, hurdle step, inline lunge, side lunge, sit to stand, standing active straight leg raise, 4 standing shoulder movements)
- **Data**: Kinect + Vicon motion capture, per-rep correct/incorrect labels (`_inc` extension), reduced Vicon-only dataset with quality scores
- **License**: Open Data Commons PDDL v1.0 (public domain)
- **Note**: ~10 subjects, acted errors, deep squat (not plain squat)

## Download Instructions

### KIMORE
1. Access the Google Drive folder (may require permission request)
2. Download all squat-related files
3. Extract to `data/raw/kimore/`

### UI-PRMD
1. Access the Google Drive folder
2. Download all files (including reduced dataset with quality scores)
3. Extract to `data/raw/ui-prmd/`

## Notes
- KIMORE was recorded with RGB/depth, but RGB is not included in the local zip; request it from the dataset authors before planning MediaPipe extraction
- UI-PRMD provides per-rep correct/incorrect labels (`_inc` files)
- KIMORE scores: PO_S (performance) and CF_S (clinical) on 0-50 scale
- UI-PRMD reduced dataset: cleaned Vicon-only version with quality scores in CSV
- For commercial use: check KIMORE license; UI-PRMD is PDDL v1.0 (public domain)
- Public rehabilitation data is a mix: some releases contain RGB video plus labels and motion-capture ground truth (REHAB24-6); others are primarily CSV skeleton trajectories (UI-PRMD, IntelliRehabDS). A CSV can still train the feature model if it contains time-series joint coordinates and usable labels, but it cannot validate the full camera-to-pose pipeline.
- No listed public dataset represents patient-specific post-surgery ROM prescriptions adequately. Therapist-configured ROM must remain an independent rule layer; clinical evaluation needs consented, therapist-reviewed patient data.

## Local Data Audit (2026-10-09)

- The KIMORE zip in this workspace has 10 members, all exercise `Train_X.csv`/`Train_Y.csv` files; no RGB, depth, or video asset was found. MediaPipe extraction from KIMORE video therefore cannot start with the current local files.
- KIMORE ex5 has 37,300 frame rows and 373 execution scores. The 100 rows per score are sequence structure, not 37,300 independent examples. The supplied files contain no subject identifier or subject-to-sequence map, so a valid subject-independent split cannot be constructed from them alone.
- UI-PRMD ex4 contains 10,530 rows × 240 columns in each of `Data_Correct.csv` and `Data_Incorrect.csv`, with 90 values in each corresponding `Labels_*.csv`. This is 117 data rows per label entry. The files separate correct and incorrect examples, but the numeric label values overlap and their meaning needs confirmation from the dataset data dictionary before they are used as targets.
- Do not train or report subject-independent performance until the subject grouping and sequence/feature semantics are available. Keep KIMORE execution-level regression and UI-PRMD correct/incorrect checks as separate tasks.
