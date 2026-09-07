"""Enable catalog growth independently of crawl-queue size."""
from pathlib import Path
from catalog_upgrade import upgrade

if __name__=='__main__':
    runtime=Path.home()/'Library/Application Support/GoodEatsCollector/runtime'
    if not (runtime/'national_source.py').exists():
        raise SystemExit('This update requires the installed nationwide collector. Run the nationwide update first.')
    upgrade(runtime_updates=('worker.py','catalog_growth.py'),config_updates={'catalog_growth_enabled':True})
