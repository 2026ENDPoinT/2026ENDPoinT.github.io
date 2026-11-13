// 화면 파일(assets/*.css · *.js)을 고친 뒤 HTML 의 주소 끝 ?v= 를 그 파일 내용의 해시로 다시 매긴다.
// GitHub Pages 는 파일을 10분 동안 브라우저에 두게 해서(max-age=600), 주소가 그대로면 배포 직후
// 새 HTML 이 예전 CSS · JS 와 섞여 보일 수 있다. 내용이 바뀌면 주소도 바뀌게 해 그 틈을 없앤다.
//   node tools/asset-version.mjs           고친다
//   node tools/asset-version.mjs --check   맞는지만 본다 (틀리면 1 로 끝남 — 시험이 쓴다)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = /((?:href|src)=")((?:\.\.\/)*)assets\/([\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]*)?(")/g;

export function hashOf(name) {
  return createHash('sha256').update(readFileSync(path.join(root, 'assets', name))).digest('hex').slice(0, 8);
}
export function htmlFiles() {
  return execFileSync('git', ['ls-files', '*.html'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => f && !f.startsWith('Claude outputs/'));
}
/** 고쳐야 할 곳 목록. fix 면 파일을 고친다 */
export function run(fix) {
  const stale = [];
  for (const f of htmlFiles()) {
    const full = path.join(root, f), src = readFileSync(full, 'utf8');
    const out = src.replace(REF, (all, a, up, name, q) => {
      if (!existsSync(path.join(root, 'assets', name))) return all;
      const want = `${a}${up}assets/${name}?v=${hashOf(name)}${q}`;
      if (want !== all) stale.push(`${f}: ${name}`);
      return want;
    });
    if (fix && out !== src) writeFileSync(full, out);
  }
  return stale;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const check = process.argv.includes('--check');
  const stale = run(!check);
  if (check) {
    if (stale.length) { console.log('주소의 ?v= 가 파일과 다릅니다 — node tools/asset-version.mjs 를 실행하세요\n  ' + stale.join('\n  ')); process.exit(1); }
    console.log('모두 맞습니다');
  } else console.log(stale.length ? '고쳤습니다\n  ' + stale.join('\n  ') : '고칠 것이 없습니다');
}
