"""ML model loading and inference."""

import joblib
import numpy as np
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, fields


@dataclass
class ModelMetadata:
    version: str
    exercise: str
    model_type: str  # 'rf', 'xgb', 'lr'
    feature_names: List[str]
    trained_at: str
    metrics: Dict[str, float]
    task: str = "classification"
    class_labels: Optional[List[str]] = None
    source_datasets: Optional[List[str]] = None
    camera_validation: Optional[Dict[str, Any]] = None


class ModelLoader:
    """Load and run ML models for exercise quality scoring."""
    
    def __init__(self, models_dir: Optional[str] = None):
        project_root = Path(__file__).resolve().parents[3]
        self.models_dir = Path(models_dir) if models_dir else project_root / "models" / "quality"
        self._model = None
        self._metadata: Optional[ModelMetadata] = None
    
    def load(self, version: str) -> bool:
        """Load model by version."""
        if self._model is not None and self._metadata and self._metadata.version == version:
            return True

        model_path = self.models_dir / f"{version}.joblib"
        meta_path = self.models_dir / f"{version}.json"
        
        if not model_path.exists():
            self._model = None
            self._metadata = None
            return False
        
        self._model = joblib.load(model_path)
        
        if meta_path.exists():
            import json
            with open(meta_path) as f:
                meta = json.load(f)
            allowed = {field.name for field in fields(ModelMetadata)}
            self._metadata = ModelMetadata(**{key: value for key, value in meta.items() if key in allowed})
        else:
            self._metadata = None
        
        return True
    
    def predict(self, features: np.ndarray) -> np.ndarray:
        """Predict quality scores (0-100) or class labels."""
        if self._model is None:
            raise RuntimeError("No model loaded")
        return self._model.predict(features)
    
    def predict_proba(self, features: np.ndarray) -> Optional[np.ndarray]:
        """Predict class probabilities if classifier."""
        if self._model is None:
            raise RuntimeError("No model loaded")
        if hasattr(self._model, 'predict_proba'):
            return self._model.predict_proba(features)
        return None
    
    def feature_importance(self) -> Optional[Dict[str, float]]:
        """Get global feature importance."""
        if self._model is None or self._metadata is None:
            return None
        
        estimator = self._model.named_steps.get("model", self._model) if hasattr(self._model, "named_steps") else self._model
        if hasattr(estimator, 'feature_importances_'):
            return dict(zip(self._metadata.feature_names, estimator.feature_importances_))
        elif hasattr(estimator, 'coef_'):
            coefficients = np.asarray(estimator.coef_)
            return dict(zip(self._metadata.feature_names, np.mean(np.abs(coefficients), axis=0)))
        return None
    
    def top_factors(self, features: np.ndarray, top_k: int = 3) -> List[str]:
        """Return globally important features (not per-rep explanations)."""
        importance = self.feature_importance()
        if not importance:
            return []
        
        # Sort by importance, return top-k feature names
        sorted_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)
        return [f for f, _ in sorted_features[:top_k]]

    def assess(self, feature_values: Dict[str, float]) -> Optional[Dict[str, Any]]:
        """Predict from named canonical features, preserving the saved model's feature order."""
        if self._model is None or self._metadata is None:
            return None

        missing = [name for name in self._metadata.feature_names if name not in feature_values]
        if missing:
            raise ValueError(f"Missing model features: {', '.join(missing)}")

        row = np.asarray(
            [[feature_values[name] for name in self._metadata.feature_names]],
            dtype=np.float64,
        )
        prediction = self._model.predict(row)[0]
        if isinstance(prediction, np.generic):
            prediction = prediction.item()
        if self._metadata.task == "classification" and self._metadata.class_labels:
            class_index = int(prediction)
            if 0 <= class_index < len(self._metadata.class_labels):
                prediction = self._metadata.class_labels[class_index]

        result: Dict[str, Any] = {
            "model_version": self._metadata.version,
            "task": self._metadata.task,
            "prediction": prediction,
        }
        probabilities = self.predict_proba(row)
        if probabilities is not None:
            result["confidence"] = float(np.max(probabilities[0]))
            estimator = self._model.named_steps.get("model", self._model) if hasattr(self._model, "named_steps") else self._model
            labels = self._metadata.class_labels or [str(label) for label in estimator.classes_]
            result["class_probabilities"] = {
                str(labels[int(label)] if self._metadata.class_labels else label): float(probability)
                for label, probability in zip(estimator.classes_, probabilities[0])
            }

        importance = self.feature_importance()
        if importance:
            result["global_top_features"] = [
                {"name": name, "importance": float(value)}
                for name, value in sorted(importance.items(), key=lambda item: item[1], reverse=True)[:3]
            ]
            result["explanation_scope"] = "global model importance; not a per-rep attribution"
        return result
    
    @property
    def metadata(self) -> Optional[ModelMetadata]:
        return self._metadata
    
    @property
    def is_loaded(self) -> bool:
        return self._model is not None


# Global instance
_model_loader: Optional[ModelLoader] = None


def get_model_loader() -> ModelLoader:
    """Get global model loader instance."""
    global _model_loader
    if _model_loader is None:
        _model_loader = ModelLoader()
    return _model_loader
