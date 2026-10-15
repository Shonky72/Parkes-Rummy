"""Temporary branch-only follow-up; removed before merge."""
from pathlib import Path
import subprocess
assert subprocess.check_output(['git','branch','--show-current'], text=True).strip() == 'fix/mobile-play-and-ai-turns'
p=Path('app/mobile-usability.css')
s=p.read_text()
a='grid-template-columns: 1fr 1fr; align-items: center; overflow: hidden;'
b='grid-template-columns: 1fr 1fr; grid-template-rows: minmax(0, 1fr); align-items: center; overflow: hidden;'
assert a in s or b in s
s=s.replace(a,b).replace('  .parkes-app > .home-main .account-intro p { display: none; }','  .parkes-app > .home-main .account-intro { display: none; }')
p.write_text(s)
