#!/usr/bin/env python3
"""Make a portable Mac snapshot, or install it as a paused collector."""
import argparse
import contextlib
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from collector import now
from worker import config_at, get_state, set_state, write_json


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def backup(source, destination):
    reader=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)
    writer=sqlite3.connect(destination)
    try:
        reader.backup(writer)
    finally:
        writer.close();reader.close()


def validate(data):
    manifest=json.loads((data/'transfer-manifest.json').read_text())
    if manifest.get('format') != 1:
        raise ValueError('Unsupported transfer format')
    required={'pilot.sqlite','usage.sqlite','candidates.jsonl','control.json'}
    if not required.issubset(manifest['sha256']):
        raise ValueError('Transfer is missing required files')
    for name, expected in manifest['sha256'].items():
        if Path(name).name != name or digest(data/name) != expected:
            raise ValueError('Transfer integrity check failed: '+name)
    config_at(data)
    return manifest


def relocate(data):
    """Pool bytes were verified before copying; only its local identity changes."""
    pool=data/'candidates.jsonl'
    with sqlite3.connect(data/'pilot.sqlite') as db:
        offset=get_state(db,'pool_offset',0)
        if not isinstance(offset,int) or not 0 <= offset <= pool.stat().st_size:
            raise ValueError('Invalid saved candidate checkpoint')
        set_state(db,'pool_signature',[str(pool.resolve()),pool.stat().st_size,pool.stat().st_mtime_ns])
    write_json(data/'control.json',{**config_at(data),'paused':True})


def command_script(action):
    # Prefer an installed Python, but never install software automatically.
    return '''#!/bin/bash
cd "$(dirname "$0")" || exit 1
PYTHON=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3)"; do
  if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,11))' 2>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Python 3.11 or newer is required. Install Python for macOS from https://www.python.org/downloads/macos/ and try again."
else
  "$PYTHON" '''+action+'''
fi
read -r -p "Press Return to close this window. "
'''


def package(source, destination):
    """SQLite online backups include WAL commits without interrupting collection."""
    destination=destination.resolve()
    if destination.exists():
        raise ValueError('Choose a new output ZIP name; existing packages are preserved')
    if destination.suffix != '.zip':
        raise ValueError('Output must end in .zip')
    for name in ('pilot.sqlite','usage.sqlite','candidates.jsonl','control.json'):
        if not (source/name).is_file():
            raise ValueError('Missing live source file: '+name)
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='goodeats-transfer-',dir=destination.parent) as temporary:
        root=Path(temporary)/'GoodEats-Mac-Transfer';data=root/'data';code=root/'collector'
        data.mkdir(parents=True);code.mkdir()
        for path in Path(__file__).parent.glob('*.py'):
            if not path.name.startswith('test_'):
                shutil.copy2(path,code/path.name)
        backup(source/'pilot.sqlite',data/'pilot.sqlite')
        backup(source/'usage.sqlite',data/'usage.sqlite')
        pool=source/'candidates.jsonl';stat=pool.stat()
        with sqlite3.connect(data/'pilot.sqlite') as db:
            prior=get_state(db,'pool_signature')
            # Finder can move the whole service folder before export. Its saved
            # absolute path then differs, but the immutable pool must still
            # match the original size and nanosecond modification time.
            if prior and prior[1:] != [stat.st_size,stat.st_mtime_ns]:
                raise ValueError('Source pool no longer matches its saved checkpoint')
        for name in ('candidates.jsonl','source-manifest.json','throughput.json'):
            if (source/name).exists(): shutil.copy2(source/name,data/name)
        if (pool.stat().st_size,pool.stat().st_mtime_ns) != (stat.st_size,stat.st_mtime_ns):
            raise ValueError('Candidate file changed during transfer preparation; retry')
        write_json(data/'control.json',{**config_at(source),'paused':True})
        from pilot import connect
        from exports import export_finished
        db=connect(data/'pilot.sqlite')
        try:
            with contextlib.redirect_stdout(__import__('io').StringIO()):
                summary=export_finished(db,data)
        finally: db.close()
        write_json(data/'transfer-manifest.json',{
            'format':1,'created_at':now(),'export_does_not_stop_source':True,
            'complete_restaurants':summary['complete_restaurants'],
            'sha256':{p.name:digest(p) for p in data.iterdir() if p.is_file() and p.suffix not in ('.partial',) and not p.name.endswith(('-wal','-shm'))}})
        scripts={'Install.command':'collector/transfer.py install --source "$PWD/data"',
                 'Pause.command':'"$HOME/Library/Application Support/GoodEatsCollector/runtime/background.py" pause',
                 'Resume.command':'"$HOME/Library/Application Support/GoodEatsCollector/runtime/background.py" resume',
                 'Status.command':'"$HOME/Library/Application Support/GoodEatsCollector/runtime/background.py" status'}
        for name,action in scripts.items():
            path=root/name;path.write_text(command_script(action));path.chmod(0o755)
        exported_config=config_at(data)
        (root/'START HERE.txt').write_text('''GOODEATS COLLECTOR — MOVE TO ANOTHER MAC

1. AirDrop/copy this ZIP to the new Mac, then unzip it.
2. Open Install.command. Python 3.11+ must be installed (python.org).
   If Finder will not launch it, open Terminal, type bash followed by a space,
   drag Install.command into Terminal, then press Return.
3. The service installs PAUSED. Open Status.command to check it.
4. Pause the collector on the OLD Mac before opening Resume.command on the new Mac.
   On the old Mac, paste this in Terminal:
   python3 "$HOME/Library/Application Support/GoodEatsCollector/runtime/background.py" pause
5. Use Pause.command / Resume.command on the new Mac whenever needed.

This is a point-in-time snapshot. The old Mac continues collecting after it was
created. Later results will NOT sync into this package. For a final transfer with
all recent progress, pause the old collector, wait until Status says phase paused,
and export a fresh package using collector/transfer.py export --output NEW.zip.
Do not run both copies: they have separate queues and separate request counters.

The installer refuses to overwrite an existing collector data directory.
It retains restaurant evidence, pending queue, candidate cursor, settings, and
the request allowance used as of the snapshot. It adjusts paths for the new Mac.
It preserves the resource settings in the source snapshot (listed in SETTINGS.txt).
The updated worker prevents idle system sleep only while actively crawling.
The screen can still lock and turn off. Use a power adapter and leave the lid open.
Manual sleep, shutdown, logout, or closing a laptop lid can still stop collection.
No Codex, Google API key, app repository, or paid API is required.
The Mac must be awake and logged in; the service starts again after login.

The live spreadsheet on the new Mac is:
~/Library/Application Support/GoodEatsCollector/data/restaurants.csv
You may delete the unpacked transfer folder after installation; keep the ZIP as
a backup. Pause/resume/status commands also exist in the installed runtime.
''')
        (root/'SETTINGS.txt').write_text(json.dumps(exported_config,indent=2)+'\n\nRequests are not completed restaurants. See data/throughput.json when available.\n')
        if (source/'throughput.json').exists(): shutil.copy2(source/'throughput.json',root/'LAST PERFORMANCE TEST.json')
        archive=shutil.make_archive(str(Path(temporary)/'package'),'zip',temporary,root.name)
        Path(archive).replace(destination)
    print(json.dumps({'package':str(destination),'complete_restaurants':summary['complete_restaurants'],'source_unchanged':True},indent=2))


def install(source):
    import background
    source=source.resolve()
    if background.DATA.exists() or background.PLIST.exists():
        raise ValueError('A collector already exists on this Mac. No data or service was changed.')
    validate(source)
    background.SERVICE.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='import-',dir=background.SERVICE) as temporary:
        staged=Path(temporary)/'data'
        shutil.copytree(source,staged)
        # Check offsets before committing the imported directory.
        relocate(staged)
        staged.rename(background.DATA)
    relocate(background.DATA)
    background.install(background.DATA)
    print('Installed PAUSED. Pause the old Mac before opening Resume.command here.')


def main():
    import background
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    export=sub.add_parser('export');export.add_argument('--source',type=Path,default=background.DATA)
    export.add_argument('--output',type=Path,required=True)
    restore=sub.add_parser('install');restore.add_argument('--source',type=Path,required=True)
    args=parser.parse_args()
    if sys.version_info < (3,11): parser.error('Python 3.11+ is required')
    if args.command=='export': package(args.source,args.output)
    else: install(args.source)


if __name__=='__main__': main()
