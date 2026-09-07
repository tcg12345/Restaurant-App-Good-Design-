"""Prevent idle system sleep during collection without keeping the display on."""
import contextlib
import os
from pathlib import Path
import subprocess
import threading


@contextlib.contextmanager
def active_awake(output, stopped, enabled):
    process=None;done=threading.Event();monitor=None
    if enabled and Path('/usr/bin/caffeinate').exists():
        process=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(os.getpid())],
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def watch():
            from worker import config_at
            while not done.wait(1):
                if stopped.is_set() or config_at(output)['paused'] or not config_at(output)['keep_awake']:
                    if process.poll() is None: process.terminate()
                    return
        monitor=threading.Thread(target=watch,daemon=True);monitor.start()
    try:
        yield bool(process and process.poll() is None)
    finally:
        done.set()
        if monitor: monitor.join(timeout=2)
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill();process.wait()
