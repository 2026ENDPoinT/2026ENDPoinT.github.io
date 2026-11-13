// PARAMS.md(사람이 고치는 값 목록)가 코드와 같은지 본다. 어긋나면 어느 값이 어디서 다른지 알려 준다.
//   node --test apps-script/submit/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const md = readFileSync(path.join(root, 'PARAMS.md'), 'utf8');
const rows = md.split('\n').filter((l) => /^\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const code = (c) => { const m = /^`([^`]*)`$/.exec(c); return m ? m[1] : (c === '(비움)' ? '' : null); };
const CONFIG = JSON.parse(JSON.stringify(loadBackend().ctx.CONFIG));   // vm 안의 객체를 이쪽 객체로 (deepEqual 이 프로토타입까지 보므로)

test('PARAMS.md 의 Submit.gs 값 = CONFIG', () => {
  const seen = [];
  for (const r of rows) {
    const name = code(r[1] || ''), val = code(r[2] || '');
    if (!name || val === null || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    assert.ok(name in CONFIG, `PARAMS.md 의 ${name} 은 Submit.gs CONFIG 에 없습니다`);
    assert.equal(String(CONFIG[name]), val, `${name}: PARAMS.md 는 ${val}, Submit.gs 는 ${CONFIG[name]}`);
    seen.push(name);
  }
  // 시각 컷은 빠짐없이 적혀 있어야 한다
  for (const k of ['DEADLINE', 'GRACE_MIN', 'OPEN_AT', 'VOTE_H_FROM', 'VOTE_H_UNTIL', 'VOTE_A_FROM', 'VOTE_A_UNTIL', 'SCORE_UNTIL', 'REOPEN_MIN', 'VIEW_UNTIL',
                   'JUDGE_WEIGHT', 'POP_FULL_X', 'VOTE_MAX', 'VOTE_SELF', 'TIE_KEY', 'TEAM_MAX_GB', 'BOARD_SUBMIT_SEC', 'BOARD_VOTE_SEC']) {
    assert.ok(seen.includes(k), `PARAMS.md 에 ${k} 줄이 없습니다`);
  }
});

test('PARAMS.md 의 사이트 값 = 그 파일 (영문 페이지도 같은 시각)', () => {
  let n = 0;
  for (const r of rows) {
    const m = /^`([\w./-]+):(\w+)`$/.exec(r[1] || ''), val = code(r[2] || '');
    if (!m || val === null) continue;
    const [, file, name] = m;
    const files = file === 'index.html' && name !== 'DUE' ? ['index.html', 'en/index.html'] : [file];
    for (const f of files) {
      const text = readFileSync(path.join(root, f), 'utf8');
      const hit = new RegExp(`\\b${name}\\s*[:=]\\s*'([^']*)'`).exec(text);
      assert.ok(hit, `${f} 에서 ${name} 을 찾지 못했습니다`);
      assert.equal(hit[1], val, `${f} 의 ${name}: PARAMS.md 는 ${val}, 파일은 ${hit[1]}`);
      n++;
    }
  }
  assert.ok(n >= 5, '사이트 값 줄이 너무 적습니다');
});

test('PARAMS.md 의 트랙 · 심사 문항 = CONFIG (순서까지)', () => {
  const tracks = rows.filter((r) => /^\d+$/.test(r[0]) && /^`[A-Z]`$/.test(r[1] || ''))
    .map((r) => { const m = /^(\d+)\s*[–-]\s*(\d+)$/.exec(r[3]); return { key: code(r[1]), name: r[2], from: Number(m[1]), to: Number(m[2]) }; });
  assert.deepEqual(tracks, CONFIG.TRACKS.map((t) => ({ key: t.key, name: t.name, from: t.from, to: t.to })));
  const crit = rows.filter((r) => /^`[a-z]+`$/.test(r[0] || '') && /^\d+$/.test(r[2] || ''))
    .map((r) => ({ key: code(r[0]), name: r[1], max: Number(r[2]) }));
  assert.deepEqual(crit, CONFIG.CRITERIA.map((c) => ({ key: c.key, name: c.name, max: c.max })));
});

test('시각 컷의 순서가 맞다 (제출 마감 → 해커톤 투표 → 구현과제 투표 → 심사 마감)', () => {
  const t = (k) => Date.parse(CONFIG[k]);
  assert.ok(t('DEADLINE') < t('VOTE_H_FROM') && t('VOTE_H_FROM') < t('VOTE_H_UNTIL'));
  assert.ok(t('VOTE_H_UNTIL') <= t('VOTE_A_FROM') && t('VOTE_A_FROM') < t('VOTE_A_UNTIL'));
  assert.ok(t('VOTE_A_UNTIL') <= t('SCORE_UNTIL') && t('SCORE_UNTIL') < t('VIEW_UNTIL'));
});
