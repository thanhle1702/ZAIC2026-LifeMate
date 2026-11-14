"""Durable JSON snapshots with bounded retries for Windows file-sharing contention."""
import json
import os
from pathlib import Path
import time
from uuid import uuid4


def atomic_json(path: Path, value, attempts=7):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    try:
        with temporary.open('w', encoding='utf-8', newline='\n') as output:
            json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.flush()
            os.fsync(output.fileno())
        for attempt in range(attempts):
            try:
                os.replace(temporary, path)
                return
            except OSError as exc:
                sharing_error = getattr(exc, 'winerror', None) in (5, 32, 33)
                if not sharing_error or attempt + 1 == attempts:
                    raise
                time.sleep(min(.02 * 2**attempt, .32))
    finally:
        # An unsuccessful replacement leaves the previous snapshot intact.
        temporary.unlink(missing_ok=True)
