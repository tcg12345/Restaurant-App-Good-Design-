"""Enable official-page/PDF enrichment without changing the existing daily limit."""
import subprocess
import sys
import background
from repair import repair


def upgrade():
    if not background.PLIST.exists() or not (background.DATA/'pilot.sqlite').exists():
        raise SystemExit('Run this update on the Mac mini with the collector already installed.')
    environment=background.SERVICE/'source-python'
    python=environment/'bin/python'
    if not python.exists(): subprocess.run([sys.executable,'-m','venv',str(environment)],check=True)
    check=subprocess.run([str(python),'-c','import pypdf; assert pypdf.__version__=="6.18.0"'],capture_output=True)
    if check.returncode:
        subprocess.run([str(python),'-m','pip','install','pypdf==6.18.0'],check=True)
    repair()
    print('Official-page and PDF enrichment enabled. Existing settings, records, queue and daily allowance retained.')
    print('Published prices remain in restaurants.csv; menu-derived estimates appear in menu-estimates.csv for review.')


if __name__=='__main__': upgrade()
