# Dataset Sources

## Video-capable datasets beyond squat

### REHAB24-6 — recommended first video source
- **Source**: [Zenodo record](https://zenodo.org/records/13305826) (DOI: 10.5281/zenodo.13305826)
- **Exercises**: 6 including squat, leg lunge, leg abduction, push-up, arm abduction, and arm V/W movement.
- **Data**: RGB video from two views, 2D/3D motion-capture joints and markers, and repetition boundaries with binary correctness annotations. The release describes 65 recordings, 10 people, and 1,072 annotated repetitions.
- **Why useful**: video allows us to run the same MediaPipe pose extractor used by Kinexa; annotations/joint ground truth allow comparison against the source labels. Subject and repetition fields support grouped evaluation.
- **Limitations**: small cohort; controlled lab capture; not a post-operative patient dataset. The Zenodo record restricts use to academic/nonprofit research and says commercial use requires contacting the authors. Review current terms before distributing results or using commercially.
- **Plan**: start with its squat and leg-lunge clips; derive Kinexa's FR-5 features from RGB using MediaPipe so model inputs match runtime. Use provided motion capture joints for pose-estimator analysis/quality checks, not as a mixed feature source in the same model.

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
