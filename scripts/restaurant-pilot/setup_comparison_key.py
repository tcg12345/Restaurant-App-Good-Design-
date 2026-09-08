"""Store a benchmark-only API key locally, with owner-only permissions."""
import getpass
import os
from pathlib import Path

if __name__ == '__main__':
    target = Path(__file__).resolve().parents[2] / 'data/restaurant-pilot/ai-comparison/openai-api-key'
    target.parent.mkdir(parents=True, exist_ok=True)
    key = getpass.getpass('Paste your OpenAI API key (hidden), then press Return: ').strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit('No valid key entered; nothing saved.')
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(key)
    print('Key saved in the git-ignored comparison folder. No API request was made.')
