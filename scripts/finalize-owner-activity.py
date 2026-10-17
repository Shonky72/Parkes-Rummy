from pathlib import Path
p=Path('.github/workflows/ci.yml');s=p.read_text();old='      - run: npm run build';new='      - run: node tests/activity-fixture.mjs && npm run build\n      - run: rm -rf app/__activity_ui_fixture'
if old in s:s=s.replace(old,new)
p.write_text(s)
p=Path('db/activity.ts');s=p.read_text();s=s.replace('  private retryAfter = 0;','  private retryAfter = 0;\n  private nextCleanup = 0;');s=s.replace('  private async cleanup(now: number) {','  private async cleanup(now: number) {\n    if (now < this.nextCleanup) return;\n    this.nextCleanup = now + 300_000;');s=s.replace('activity_presence.last_seen <= $1-1000','activity_presence.last_seen <= $1-20000');p.write_text(s)
