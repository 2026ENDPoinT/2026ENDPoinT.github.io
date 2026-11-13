// HTML 이 부르는 화면 파일(assets/*.css · *.js) 주소의 ?v= 가 지금 파일 내용과 맞는지.
// 틀리면 배포 직후 10분 동안 새 HTML 과 예전 CSS · JS 가 섞여 보인다 → node tools/asset-version.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, htmlFiles } from '../../../tools/asset-version.mjs';

test('화면 파일 주소의 ?v= 가 파일 내용과 맞다 (node tools/asset-version.mjs)', () => {
  assert.ok(htmlFiles().length >= 10);
  assert.deepEqual(run(false), []);
});
