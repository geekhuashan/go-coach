#!/usr/bin/env python3
"""Build the cloud catalog from validated local catalogs, retaining legacy IDs."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
for book in ('data/gogameguru/lessons.json','data/original-extra/lessons.json'):
    if not (ROOT/book).is_file(): raise SystemExit(f'Required bundled catalog is missing: {book}')
import curriculum
lessons=curriculum.catalog()+[curriculum.get_lesson(identity) for identity in ('escape','capture','connect')]
(ROOT/'cloud/builtin-lessons.json').write_text(json.dumps(lessons,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(f'Cloud catalog: {len(lessons)} total, {sum(curriculum.available_lesson(l) for l in lessons)} available')
