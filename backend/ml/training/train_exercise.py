"""Generic exercise-aware entry point for grouped quality-model training."""

from ml.training.train_squat import parse_args, train


if __name__ == "__main__":
    try:
        train(parse_args())
    except (ValueError, FileNotFoundError) as exc:
        raise SystemExit(f"Training stopped: {exc}") from exc
