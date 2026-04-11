#!/bin/bash
# Process raw HTML corpus into normalized JSON.
# No network — reads from data/raw/, writes to data/processed/.
#
# Usage: ./scripts/process-corpus.sh

set -euo pipefail

RAW_DIR="data/raw"
PROCESSED_DIR="data/processed"

mkdir -p "$PROCESSED_DIR"

FILES=$(ls "$RAW_DIR"/*.html 2>/dev/null | wc -l | tr -d ' ')
echo "Processing $FILES HTML files..."

python3 -c "
import os, json, re, hashlib
from pathlib import Path

RAW = 'data/raw'
OUT = 'data/processed'

def extract_metadata(html):
    meta = {}
    m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.I)
    if m: meta['title'] = m.group(1).strip()
    for m in re.finditer(r'<meta\s+([^>]+?)/?\\s*>', html, re.I):
        attrs = m.group(1)
        nm = re.search(r'(?:name|property)=\"([^\"]+)\"', attrs, re.I)
        cm = re.search(r'content=\"([^\"]+)\"', attrs, re.I)
        if nm and cm: meta[nm.group(1)] = cm.group(1)
    return meta

def strip_emoji(s):
    # Remove leading emoji/ZWJ/variation selectors
    return re.sub(r'^[\s\u200D\uFE00-\uFE0F\u20E3\u2600-\u27BF\u2B05-\u2B55\U0001F000-\U0001FFFF\U000E0020-\U000E007F]+', '', s).strip()

def extract_date(md, meta):
    # Metadata first
    if 'article:published_time' in meta:
        return meta['article:published_time'].split('T')[0]
    # Human-readable date
    m = re.search(r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})', md, re.I)
    if m:
        from datetime import datetime
        cleaned = re.sub(r'(\d+)(?:st|nd|rd|th)', r'\1', m.group(1))
        try:
            d = datetime.strptime(cleaned.replace(',', ''), '%B %d %Y')
            return d.strftime('%Y-%m-%d')
        except:
            try:
                d = datetime.strptime(cleaned.replace(',', ''), '%b %d %Y')
                return d.strftime('%Y-%m-%d')
            except: pass
    return None

def extract_issue_number(url, md):
    m = re.search(r'/p/(\d+)(?:\$|[^0-9])', url)
    if m: return int(m.group(1))
    m = re.search(r'(?:flux-review-|ep-)(\d+)', url, re.I)
    if m: return int(m.group(1))
    m = re.search(r'Ep\.?\s*(\d+)', md, re.I)
    if m: return int(m.group(1))
    return None

def html_to_markdown(html):
    t = html
    t = re.sub(r'<head[\s\S]*?</head>', '', t, flags=re.I)
    t = re.sub(r'<script[\s\S]*?</script>', '', t, flags=re.I)
    t = re.sub(r'<style[\s\S]*?</style>', '', t, flags=re.I)
    t = re.sub(r'<nav[\s\S]*?</nav>', '', t, flags=re.I)
    t = re.sub(r'<footer[\s\S]*?</footer>', '', t, flags=re.I)
    t = re.sub(r'<header[\s\S]*?</header>', '', t, flags=re.I)
    t = re.sub(r'<a[^>]+href=\"([^\"]+)\"[^>]*>([\s\S]*?)</a>', r'[\2](\1)', t, flags=re.I)
    t = re.sub(r'<(?:strong|b\b)[^>]*>([\s\S]*?)</(?:strong|b)>', r'**\1**', t, flags=re.I)
    t = re.sub(r'<(?:em|i\b)[^>]*>([\s\S]*?)</(?:em|i)>', r'*\1*', t, flags=re.I)
    t = re.sub(r'<h1[^>]*>([\s\S]*?)</h1>', r'# \1\n\n', t, flags=re.I)
    t = re.sub(r'<h2[^>]*>([\s\S]*?)</h2>', r'## \1\n\n', t, flags=re.I)
    t = re.sub(r'<h3[^>]*>([\s\S]*?)</h3>', r'### \1\n\n', t, flags=re.I)
    t = re.sub(r'<blockquote[^>]*>([\s\S]*?)</blockquote>', r'> \1\n\n', t, flags=re.I)
    t = re.sub(r'<li[^>]*>([\s\S]*?)</li>', r'- \1\n', t, flags=re.I)
    t = re.sub(r'<p[^>]*>([\s\S]*?)</p>', r'\1\n\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    t = t.replace('&quot;', '\"').replace('&#039;', \"'\").replace('&nbsp;', ' ')
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    return t

processed = 0
errors = 0

for f in sorted(os.listdir(RAW)):
    if not f.endswith('.html'): continue
    slug = f[:-5]
    url = f'https://read.fluxcollective.org/p/{slug}'

    try:
        html = Path(os.path.join(RAW, f)).read_text()
        meta = extract_metadata(html)
        md = html_to_markdown(html)

        issue_num = extract_issue_number(url, md)
        pub_date = extract_date(md, meta)
        year = int(pub_date.split('-')[0]) if pub_date else None

        # Clean title
        raw_title = meta.get('title', meta.get('og:title', ''))
        title = strip_emoji(raw_title)
        title = re.sub(r'\s*-\s*by\s+The\s+FLUX\s+Collective\$', '', title, flags=re.I).strip()

        # Lead essay title from first ## heading
        lead_match = re.search(r'^##\s+(.+)', md, re.M)
        lead_title = strip_emoji(lead_match.group(1)) if lead_match else None

        # Content hash
        content_hash = hashlib.sha256(md.encode()).hexdigest()

        record = {
            'slug': slug,
            'url': url,
            'issue_number': issue_num,
            'title': lead_title or title or 'Untitled',
            'raw_title': raw_title,
            'published_at': pub_date,
            'year': year,
            'lead_essay_title': lead_title,
            'content_hash': content_hash,
            'word_count': len(md.split()),
        }

        with open(os.path.join(OUT, f'{slug}.json'), 'w') as out:
            json.dump(record, out, indent=2)
        processed += 1
    except Exception as e:
        print(f'  ERROR {slug}: {e}')
        errors += 1

print(f'\nProcessed: {processed}, Errors: {errors}')
print(f'Output: {OUT}/')
"