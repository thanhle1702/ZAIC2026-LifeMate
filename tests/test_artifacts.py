import json
import pytest
from lifemate import artifacts


def test_retries_windows_sharing_lock_without_partial_reader_snapshot(tmp_path, monkeypatch):
    path=tmp_path/'job.json'; path.write_text('{"processed": 3}')
    replace=artifacts.os.replace; attempts=[]
    def locked(source, target):
        assert json.loads(path.read_text())=={'processed':3}
        attempts.append(1)
        if len(attempts)<3:
            exc=PermissionError('sharing lock');exc.winerror=5;raise exc
        replace(source,target)
    monkeypatch.setattr(artifacts.os,'replace',locked)
    monkeypatch.setattr(artifacts.time,'sleep',lambda _: None)
    artifacts.atomic_json(path,{'processed':4})
    assert len(attempts)==3 and json.loads(path.read_text())=={'processed':4}
    assert not list(tmp_path.glob('*.tmp'))


def test_permanent_lock_is_bounded_and_preserves_old_checkpoint(tmp_path, monkeypatch):
    path=tmp_path/'checkpoint.json';path.write_text('[]');attempts=[]
    def locked(*_):
        attempts.append(1);exc=PermissionError('persistent lock');exc.winerror=32;raise exc
    monkeypatch.setattr(artifacts.os,'replace',locked)
    monkeypatch.setattr(artifacts.time,'sleep',lambda _: None)
    with pytest.raises(PermissionError): artifacts.atomic_json(path,[{'new':1}],attempts=3)
    assert len(attempts)==3 and path.read_text()=='[]' and not list(tmp_path.glob('*.tmp'))
