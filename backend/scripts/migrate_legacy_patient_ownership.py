"""Safely reassign legacy manually-labelled patients to a therapist account.

Run from backend/ with --legacy-therapist-id and --therapist-email. The default
mode is a dry run; pass --apply only after verifying that the account owner is
the person who originally owned that legacy ID.
"""

import argparse

from sqlalchemy import select

from app.db import Patient, SessionLocal, User


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-therapist-id", required=True, help="Exact therapist_id value on old patient rows")
    parser.add_argument("--therapist-email", required=True, help="Email of the verified therapist account to assign")
    parser.add_argument("--apply", action="store_true", help="Commit the reassignment (default is preview only)")
    args = parser.parse_args()

    with SessionLocal() as db:
        therapist = db.scalar(select(User).where(User.email == args.therapist_email.strip().lower()))
        if therapist is None or therapist.role != "therapist":
            parser.error("No therapist account found for that email")

        patients = list(db.scalars(select(Patient).where(Patient.therapist_id == args.legacy_therapist_id)))
        print(f"Matched {len(patients)} patient record(s) for legacy owner ID {args.legacy_therapist_id!r}.")
        print(f"Target therapist account: {therapist.name} <{therapist.email}> (ID {therapist.id}).")
        if not args.apply:
            print("Dry run only. Review the owner mapping, then rerun with --apply to update these records.")
            return 0
        if not patients:
            print("Nothing to update.")
            return 0

        for patient in patients:
            patient.therapist_id = therapist.id
        db.commit()
        print(f"Reassigned {len(patients)} patient record(s). Their plans and analyses remain linked to those patients.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
