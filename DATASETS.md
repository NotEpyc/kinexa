# Dataset Sources

## KIMORE Dataset
- **Source**: https://drive.google.com/drive/folders/1S_y95vxwIQFYxrNNzNODqVnxaKakNcXb
- **Description**: 5 exercises (arm lifting, lateral trunk tilt, trunk rotation, pelvis rotation, squatting) performed by 78 subjects (healthy + mobility impaired)
- **Data**: RGB video + Vicon motion capture + clinical scores (PO_S, CF_S on 0-50 scale)
- **License**: Check originating university terms for commercial use
- **Note**: ~70 squat recordings (inferred from 353 total samples / 5 exercises)

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
- KIMORE includes RGB video - run MediaPipe on these to train on MediaPipe features
- UI-PRMD provides per-rep correct/incorrect labels (`_inc` files)
- KIMORE scores: PO_S (performance) and CF_S (clinical) on 0-50 scale
- UI-PRMD reduced dataset: cleaned Vicon-only version with quality scores in CSV
- For commercial use: check KIMORE license; UI-PRMD is PDDL v1.0 (public domain)