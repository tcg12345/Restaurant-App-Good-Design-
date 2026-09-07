"""Install the faster collector and its one-time nationwide background importer."""
from pathlib import Path
import plistlib
import subprocess
import sys

import background
from repair import repair
from worker import config_at,write_json,NATIONAL_CONFIG


def upgrade():
    if not background.PLIST.exists() or not (background.DATA/'pilot.sqlite').exists():
        raise SystemExit('Run this update on the Mac mini where the collector is already installed.')
    # Isolated dependency for source downloads; the crawler stays stdlib-only.
    environment=background.SERVICE/'source-python'
    python=environment/'bin/python'
    if not python.exists(): subprocess.run([sys.executable,'-m','venv',str(environment)],check=True)
    check=subprocess.run([str(python),'-c','import duckdb; assert duckdb.__version__=="1.5.5"'],capture_output=True)
    if check.returncode:
        subprocess.run([str(python),'-m','pip','install','duckdb==1.5.5'],check=True)
    def configure(data,saved):
        write_json(data/'control.json',{**config_at(data),**NATIONAL_CONFIG,'paused':True})
    repair(before_install=configure)
    label='com.goodeats.restaurant-source'
    target=background.TARGET.rsplit('/',1)[0]+'/'+label
    background.launch('bootout',target)
    plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
    definition={'Label':label,'ProgramArguments':[str(python),str(background.SERVICE/'runtime/national_source.py'),'--output',str(background.DATA)],
                'RunAtLoad':True,'KeepAlive':False,'ProcessType':'Background','Nice':15,'LowPriorityIO':True,
                'WorkingDirectory':str(background.SERVICE/'runtime'),
                'StandardOutPath':str(background.DATA/'source-download.log'),
                'StandardErrorPath':str(background.DATA/'source-download.stderr.log'),
                'EnvironmentVariables':{'PYTHONUNBUFFERED':'1','PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'}}
    plist.write_bytes(plistlib.dumps(definition))
    result=background.launch('bootstrap',background.TARGET.rsplit('/',1)[0],str(plist))
    if result.returncode: raise SystemExit('Collector updated, but nationwide downloader failed to start: '+result.stderr)
    print('Faster collector resumed. Nationwide download is running separately in the background.')
    print('Monitor source-status.json for download progress. Existing collection continues during the download.')


if __name__=='__main__': upgrade()
