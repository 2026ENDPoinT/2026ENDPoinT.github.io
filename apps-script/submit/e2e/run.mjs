// 실제 브라우저로 제출 · 현황판을 끝에서 끝까지 돌려 본다.  (쓰는 법: README.md)
//   node apps-script/submit/e2e/run.mjs [시나리오 이름의 일부]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { startWorld, openBrowser, newPage, login, reporter, SITE, sha256, md5hex, sleep } from './lib.mjs';
import { bytesOf } from '../test/harness.mjs';

// SHOTS 에 폴더를 주면 장면마다 화면을 찍어 둔다
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
};
const only = process.argv[2] || '';
const R = reporter();
const browser = await openBrowser();

const ROSTER = [
  ['03', '가나다', 'a1@x.com', '101', '조장', ''], ['03', '라마바', 'a2@x.com', '102', '', ''],
  ['12', '사아자', 'b1@x.com', '201', '조장', ''], ['05', '차카타', 'c1@x.com', '301', '조장', ''],
];
const pdf = (n, seed) => { const b = bytesOf(n, seed); b.write('%PDF-1.4\n'); return b; };
const file = (name, buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer });
const text = (page, sel) => page.locator(sel).first().innerText();
const driveFile = (w, re) => [...w.b.drive.files.values()].find((f) => re.test(f.name) && !f.trashed);
const folderOf = (w, f) => w.b.drive.folders.get(f.parents[0]);

async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  console.log('\n■ ' + name);
  const w = await startWorld();
  w.b.roster(ROSTER);
  try { await fn(w); } catch (e) { R.check(name + ' — 예외 없이 끝남', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); }
  await w.close();
}

/* ---------------------------------------------------------------- */
await scenario('참가자: 로그인 → 저장 → 올리기 → 다시 올리기 → 받기 → 내리기', async (w) => {
  // 다른 팀이 먼저 낸 것 — 03팀 화면에는 절대 오면 안 된다
  const b1 = w.account('b1@x.com', '201', '사아자');
  w.b.post({ action: 'info.save', idToken: b1, data: { title: 'SECRET-TEAM-12', url: 'https://secret12.example.com' } });

  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  R.match('로그인 전에는 로그인 안내만 보인다', await text(page, '#gate'), /구글 계정으로 로그인/);
  R.eq('로그인 전에는 제출 화면이 숨겨져 있다', await page.locator('#app').isHidden(), true);

  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#steps:not([hidden])');
  R.match('계정으로 팀을 찾아 준다', await text(page, '#h-team'), /^03팀 · 구현과제$/);
  R.match('남은 시간이 서버 시계 기준으로 보인다 (마감 2시간 전)', await text(page, '#h-left'), /^1:5\d:\d\d$/);

  // 글자 저장
  await page.fill('#f-title', '분실물 찾기 지도');
  await page.fill('#f-desc', '캠퍼스에서 잃어버린 물건을 지도에 올립니다.');
  await page.fill('#f-url', 'team03.example.app');
  await page.click('#save');
  await page.waitForSelector('#msg.ok');
  const row = w.b.rows('팀').find((r) => r['팀'] === '03');
  R.eq('시트 `팀` 탭에 적힌다', [row['프로젝트'], row['배포 주소'], row['제출자']], ['분실물 찾기 지도', 'https://team03.example.app', 'a1@x.com']);
  R.eq('주소에 https:// 를 붙여 돌려준다', await page.inputValue('#f-url'), 'https://team03.example.app');
  // 다시 열면 저장한 글자가 칸에 채워져 있어야 한다 (11-14 07시: 이름만 저장한 팀이 다시 열었더니 빈 칸으로 보였다)
  await page.reload();
  await page.waitForSelector('#steps:not([hidden])');
  R.eq('다시 열어도 저장한 프로젝트 이름 · 설명 · 주소가 채워져 있다',
    [await page.inputValue('#f-title'), await page.inputValue('#f-desc'), await page.inputValue('#f-url')],
    ['분실물 찾기 지도', '캠퍼스에서 잃어버린 물건을 지도에 올립니다.', 'https://team03.example.app']);
  R.eq('다시 열었을 때 저장할 것이 남았다고 하지 않는다', await page.locator('#save').isDisabled(), true);

  // 발표 자료: 20MB → 8MB 조각 셋으로 Drive 에 직접
  const deck1 = pdf(20 * 1024 * 1024 + 123, 3);
  await page.setInputFiles('#in-deck', file('최종 발표 (1).pdf', deck1, 'application/pdf'));
  await page.waitForSelector('#slot-deck .file.now', { timeout: 60000 });
  const name1 = await text(page, '#slot-deck .file.now .nm');
  R.match('올린 파일 이름이 규칙대로 바뀐다', name1, /^team03_발표_v1_1114-\d{4}\.pdf$/);
  const puts = w.log.filter((x) => x.action === 'PUT');
  R.eq('브라우저가 Drive 로 직접, 조각 셋으로 보냈다', puts.map((x) => x.code), [308, 308, 200]);
  R.eq('서버를 거친 조각은 없다', w.log.filter((x) => x.action === 'upload.put').length, 0);
  const f1 = driveFile(w, /^team03_발표_v1_/);
  R.eq('Drive 의 파일이 올린 것과 같다', f1 && md5hex(f1.bytes), md5hex(deck1));
  R.eq('team03 폴더에 있다', f1 && folderOf(w, f1).name, 'team03');
  R.match('상태 띠: 제출 완료', await text(page, '#state .verdict'), /제출 완료/);
  await shot(page, 'e2e-submit-1-uploaded');

  // 다시 올리기 → v2, 먼젓번은 옛날 자료
  const deck2 = pdf(300 * 1024, 9);
  await page.setInputFiles('#in-deck', file('발표_수정.pdf', deck2, 'application/pdf'));
  await page.waitForFunction(() => /_v2_/.test(document.querySelector('#slot-deck .file.now .nm')?.textContent || ''), null, { timeout: 30000 });
  const old = driveFile(w, /^team03_발표_v1_/);
  R.eq('먼젓번 파일은 옛날 자료 폴더로', old && folderOf(w, old).name, '옛날 자료');
  R.match('화면의 옛날 자료에 보인다', await text(page, '#hist'), /team03_발표_v1_/);
  const idx = w.b.rows('파일').filter((r) => r['팀'] === '03').map((r) => [r['버전'], r['상태'], r['경로']]);
  R.eq('색인: v1 이전(옛날 자료) · v2 현재', idx, [[1, '이전', '/team03/옛날 자료/'], [2, '현재', '/team03/']]);

  // 받아서 확인
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#slot-deck [data-act="get"]')]);
  R.eq('받은 파일이 올린 것과 같다', md5hex(readFileSync(await dl.path())), md5hex(deck2));
  R.match('받는 이름도 규칙대로', dl.suggestedFilename(), /^team03_발표_v2_.*\.pdf$/);

  // 프로그램: 직접 올리기가 막힌 환경 → 서버를 거쳐 올라간다
  w.fault.noCorsUpload = true;
  const before = w.log.length;
  const zip = bytesOf(9 * 1024 * 1024 + 77, 5);
  await page.setInputFiles('#in-program', file('app-release.zip', zip, 'application/zip'));
  await page.waitForSelector('#slot-program .file.now', { timeout: 90000 });
  const fz = driveFile(w, /^team03_프로그램_v1_/);
  R.eq('막힌 환경에서도 끝까지 올라간다 (우회 경로)', fz && md5hex(fz.bytes), md5hex(zip));
  R.eq('우회 경로로 조각 셋 (4MB 씩)', w.log.filter((x) => x.action === 'upload.put' && x.ok).length, 3);
  const since = w.log.slice(before);
  R.eq('직접 올리기는 두 번 해 보고 그만둔다 (조각은 한 번도 Drive 로 직접 가지 않았다)', [since.filter((x) => x.action === 'OPTIONS').length, since.filter((x) => x.action === 'PUT').length], [2, 0]);
  w.fault.noCorsUpload = false;

  // 내리기
  page.once('dialog', (d) => d.accept());
  await page.click('#slot-program [data-act="withdraw"]');
  await page.waitForSelector('#slot-program .drop');
  R.eq('내린 파일은 옛날 자료로 (지우지 않는다)', folderOf(w, driveFile(w, /^team03_프로그램_v1_/)).name, '옛날 자료');

  // 로그인 유지 · 다른 팀 자료
  const by = w.log.filter((x) => x.by && x.by !== 'none' && x.by !== 'key').map((x) => x.by);
  R.eq('구글 토큰은 처음 한 번만 보낸다 (그 뒤는 세션 값)', [by[0], [...new Set(by.slice(1))].join()], ['idToken', 'sid']);
  const all = w.bodies.map((x) => x.res).join('\n');
  R.check('다른 팀 자료는 응답 어디에도 없다', !/SECRET-TEAM-12|secret12/.test(all));
  R.check('응답에 Drive 주소 · 폴더 ID 가 없다', !/drive\.google\.com|"folderUrl"|"driveUrl"/.test(all));
  R.eq('화면 오류 없음', page.errs, []);
  await shot(page, 'e2e-submit-2-final');
  await page.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('명단에 없는 계정 · 서버가 잠깐 막힐 때', async (w) => {
  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('none@x.com', '999', '외부인'));
  await page.waitForSelector('#gate-out');
  R.match('명단에 없으면 안내와 함께 자기 주소를 보여 준다', await text(page, '#gate'), /팀 명단에 없습니다[\s\S]*none@x\.com/);
  R.eq('제출 화면은 열리지 않는다', await page.locator('#app').isHidden(), true);
  R.check('명단에 없는 계정에는 세션을 주지 않는다', ![...w.b.cache.keys()].some((k) => k.startsWith('ss1:')));
  await shot(page, 'e2e-submit-3-notmember');

  // 운영진이 명단에 넣어 주면 '다시 확인' 으로 바로 들어온다
  w.b.roster([...ROSTER, ['12', '외부인', 'none@x.com', '', '', '']]);
  await page.click('#gate-again');
  await page.waitForSelector('#steps:not([hidden])');
  R.match('명단에 넣으면 바로 들어온다', await text(page, '#h-team'), /^12팀 · 해커톤$/);

  // Apps Script 가 HTML 오류 페이지를 돌려줘도 다시 보내서 된다
  w.fault.html = 1;
  await page.fill('#f-title', '다시 보내기');
  await page.click('#save');
  await page.waitForSelector('#msg.ok');
  R.eq('서버가 한 번 막혀도 다시 보내서 저장된다 (한 번만 적힌다)', w.b.rows('기록').filter((r) => r['동작'] === 'info.save').length, 1);
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('로그인 유지: 구글 토큰이 끝나도 이어지고, 세션이 끊기면 다시 로그인해서 이어 간다', async (w) => {
  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다', { expInSec: 34 }));     // 곧 끝나는 구글 토큰
  await page.waitForSelector('#steps:not([hidden])');
  await sleep(6000);                                                              // 구글 토큰이 "곧 만료"가 된 뒤
  await page.fill('#f-title', '토큰이 끝난 뒤에 저장');
  await page.click('#save');
  await page.waitForSelector('#msg.ok');
  R.eq('구글 토큰이 끝나도 세션 값으로 저장된다', w.log.at(-1), { action: 'info.save', by: 'sid', ok: true });

  // 올리는 도중에 서버에서 세션이 사라진다 (캐시가 비워진 경우)
  w.fault.noCorsUpload = true; w.fault.slowRelay = 12000;       // 조각 하나에 12초씩 걸리는 느린 길
  const zip = bytesOf(13 * 1024 * 1024, 4);
  await page.fill('#f-desc', '저장하지 않은 설명');
  await page.setInputFiles('#in-program', file('big.zip', zip, 'application/zip'));
  await page.waitForFunction(() => /우회 경로/.test(document.querySelector('#pm-program')?.textContent || ''), null, { timeout: 30000 });
  await sleep(30000);                                                             // 구글 토큰도 완전히 끝나게
  w.killSessions();
  await page.waitForSelector('#gate #fake-gsi', { timeout: 30000 });
  R.match('올리는 중에 로그인이 끊기면: 버리지 않았다고 알려 준다', await text(page, '#gate'), /로그인 시간이 지났습니다[\s\S]*올리던 파일은 버려지지 않았습니다/);
  await shot(page, 'e2e-submit-4-expired');
  R.eq('색인에는 아직 올리는 중으로 남아 있다', w.b.rows('파일').map((r) => r['상태']), ['업로드 중']);

  w.fault.slowRelay = 0;
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#slot-program .file.now', { timeout: 90000 });
  const fz = driveFile(w, /^team03_프로그램_v1_/);
  R.eq('다시 로그인하면 이어서 끝까지 올라간다', fz && md5hex(fz.bytes), md5hex(zip));
  R.eq('새로 시작하지 않고 같은 표로 마무리했다', w.b.rows('파일').map((r) => [r['번호'], r['상태']]), [[1, '현재']]);
  R.eq('저장하지 않은 글자가 남아 있다', await page.inputValue('#f-desc'), '저장하지 않은 설명');

  // 다른 계정으로 바꿔 로그인하면 앞사람이 쓰던 글자는 지운다
  await page.click('#top-auth button');
  await page.waitForSelector('#gate #fake-gsi');
  R.eq('로그아웃하면 서버의 세션도 지운다', await (async () => { await sleep(400); return [...w.b.cache.keys()].filter((k) => k.startsWith('ss1:')).length; })(), 0);
  await login(page, w.account('b1@x.com', '201', '사아자'));
  await page.waitForSelector('#steps:not([hidden])');
  R.eq('다른 계정으로 들어오면 그 팀이 보이고 앞사람의 글자는 없다', [await text(page, '#h-team'), await page.inputValue('#f-desc'), await page.inputValue('#f-title')], ['12팀 · 해커톤', '', '']);
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('직접 올리기: 끊겨도 이어 올리고, 마지막 확인 때 로그인이 끝나 있어도 버리지 않는다', async (w) => {
  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#steps:not([hidden])');

  // 첫 조각은 잘 가고, 둘째 조각은 가다가 사라지고(서버가 못 받음), 다시 보낸 둘째 조각은 도착했는데 응답이 안 온다
  const deck = pdf(20 * 1024 * 1024, 8);
  w.putDelay = 150;
  let armed = 0;
  const arm = setInterval(() => {
    const puts = w.log.filter((x) => x.action === 'PUT');
    if (armed === 0 && puts.length === 1) { w.fault.dropPut = 1; armed = 1; }
    if (armed === 1 && puts.some((x) => x.code === 'dropped')) { w.fault.lostReply = 1; armed = 2; }
  }, 10);
  await page.setInputFiles('#in-deck', file('deck.pdf', deck, 'application/pdf'));
  await page.waitForSelector('#slot-deck .file.now', { timeout: 90000 });
  clearInterval(arm);
  const f = driveFile(w, /^team03_발표_v1_/);
  R.eq('조각이 사라지거나 응답이 끊겨도 이어 올려 같은 파일이 된다', f && md5hex(f.bytes), md5hex(deck));
  R.eq('Drive 로 간 조각: 성공 · 사라짐 · 응답 끊김 · 나머지', w.log.filter((x) => x.action === 'PUT').map((x) => x.code), [308, 'dropped', 'reply-lost', 200]);
  R.eq('끊길 때마다 서버에 어디까지 갔는지 물었다', w.log.filter((x) => x.action === 'upload.status' && x.ok).length, 2);
  R.eq('우회 경로로 넘어가지 않았다', w.log.filter((x) => x.action === 'upload.put').length, 0);

  // 다 보낸 뒤 마지막 확인(finish) 직전에 세션이 사라진다
  w.putDelay = 600;
  const deck2 = pdf(2 * 1024 * 1024, 6);
  await page.setInputFiles('#in-deck', file('deck2.pdf', deck2, 'application/pdf'));
  await page.waitForFunction(() => !!document.querySelector('#pf-deck'), null, { timeout: 20000 });
  w.killSessions();
  await page.evaluate(() => { const r = JSON.parse(sessionStorage.getItem('endpoint.session.v1') || 'null'); if (r) { r.exp = 1; sessionStorage.setItem('endpoint.session.v1', JSON.stringify(r)); } });
  await page.waitForSelector('#gate #fake-gsi', { timeout: 30000 }).catch(() => {});
  const gate = await text(page, '#gate').catch(() => '');
  R.check('마지막 확인 때 로그인이 끝나 있으면 로그인 화면으로 (구글 토큰이 살아 있으면 그대로 진행)', /버려지지 않았습니다/.test(gate) || await page.locator('#slot-deck .file.now').count() > 0, gate);
  if (/버려지지 않았습니다/.test(gate)) await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForFunction(() => /_v2_/.test(document.querySelector('#slot-deck .file.now .nm')?.textContent || ''), null, { timeout: 60000 });
  const f2 = driveFile(w, /^team03_발표_v2_/);
  R.eq('다시 로그인한 뒤 마무리된다', f2 && md5hex(f2.bytes), md5hex(deck2));
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('마감: 올리던 것만 유예 안에 마무리되고, 그 뒤에는 운영진만 대신 올릴 수 있다', async (w) => {
  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#steps:not([hidden])');

  w.at('2026-11-14T09:59:50+09:00');
  await page.reload();                                   // 서버 시계를 다시 받는다 (로그인은 탭에 남아 있다)
  await page.waitForSelector('#steps:not([hidden])');
  R.match('새로 고쳐도 로그인이 남아 있고, 남은 시간이 서버 시계 기준으로 보인다', await text(page, '#h-left'), /^0:00:0\d$/);
  await page.fill('#f-title', '마감 직전');
  await page.click('#save');
  await page.waitForSelector('#msg.ok');

  // 마감 4초 전에 올리기 시작 → 마감을 넘겨 끝난다
  w.fault.noCorsUpload = true; w.fault.slowRelay = 2500;
  const zip = bytesOf(9 * 1024 * 1024, 2);
  await page.setInputFiles('#in-program', file('late.zip', zip, 'application/zip'));
  await page.waitForSelector('#slot-program .file.now', { timeout: 90000 });
  const last = w.b.rows('기록').at(-1);
  R.match('마감 전에 시작한 것은 마감을 넘겨도 받아 준다 (기록에 표시)', last['메모'], /마감 직후 도착/);
  R.match('마감되면 화면이 닫힌다', await text(page, '#state .verdict'), /마감됨/);
  R.eq('입력 칸이 잠긴다', await page.locator('#f-title').isDisabled(), true);
  R.eq('다시 올리기 · 내리기 단추가 없다', await page.locator('#slot-program [data-act="pick"], #slot-program [data-act="withdraw"]').count(), 0);
  await shot(page, 'e2e-submit-5-closed');

  // 화면을 고쳐서 보내도 서버가 막는다
  const tryAfter = await page.evaluate(async () => {
    const a = await EP.api('info.save', { data: { title: '몰래 고치기' } });
    const b = await EP.api('upload.start', { kind: 'deck', name: 'x.pdf', size: 10, origin: location.origin });
    const c = await EP.api('file.withdraw', { kind: 'program' });
    return [a.error, b.error, c.error];
  });
  R.eq('마감 뒤의 저장 · 올리기 · 내리기는 서버가 거부한다', tryAfter, ['CLOSED', 'CLOSED', 'CLOSED']);
  await page.context().close();

  // 운영진: 팀을 골라 대신 올린다 (마감 뒤에도)
  w.fault.noCorsUpload = false; w.fault.slowRelay = 0;
  w.shift(3600);
  const op = await newPage(browser);
  await op.goto(SITE + '/submit/');
  await op.waitForSelector('#fake-gsi');
  await login(op, w.account('op@x.com', '900', '운영진'));
  await op.waitForSelector('#pick:not([hidden])');
  R.match('운영진은 팀을 고르는 칸이 보인다', await text(op, '#h-team'), /팀을 골라 주세요/);
  await op.selectOption('#pick-team', '05');
  await op.waitForSelector('#steps:not([hidden])');
  R.match('고른 팀을 대신한다', await text(op, '#h-team'), /^05팀 · 구현과제 \(대리\)$/);
  const deck = pdf(500 * 1024, 1);
  await op.setInputFiles('#in-deck', file('team05.pdf', deck, 'application/pdf'));
  await op.waitForSelector('#slot-deck .file.now', { timeout: 30000 });
  const f5 = driveFile(w, /^team05_발표_v1_/);
  R.eq('마감 뒤에도 운영진은 대신 올릴 수 있다', f5 && folderOf(w, f5).name, 'team05');
  R.match('기록에 운영진 대리로 남는다', w.b.rows('기록').at(-1)['누가'], /op@x\.com \(운영진 대리\)/);
  await shot(op, 'e2e-submit-6-proxy');
  R.eq('화면 오류 없음', [...page.errs, ...op.errs], []);
  await op.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('현황판: 열람 링크 · 자료 보기 · 받기 · 새로 고침', async (w) => {
  const a1 = w.account('a1@x.com', '101', '가나다'), b1 = w.account('b1@x.com', '201', '사아자');
  const up = (idToken, kind, name, bytes) => {
    const s = w.b.post({ action: 'upload.start', idToken, kind, name, size: bytes.length, origin: SITE });
    w.b.putDirect(s.url, bytes);
    return w.b.post({ action: 'upload.finish', idToken, id: s.id });
  };
  const deck = pdf(9 * 1024 * 1024 + 5, 7), zip = bytesOf(3 * 1024 * 1024, 2);
  w.b.post({ action: 'info.save', idToken: a1, data: { title: '분실물 찾기 지도', desc: '<b>굵게</b> & "따옴표"', url: 'https://team03.example.app', video: 'https://youtu.be/abc' } });
  up(a1, 'deck', 'old.pdf', pdf(1000, 1)); up(a1, 'deck', 'final.pdf', deck);
  w.b.post({ action: 'info.save', idToken: b1, data: { title: '코드 리뷰 도우미' } });
  const zipId = up(b1, 'program', 'app.zip', zip).state.program.id;
  const judgeKey = w.b.viewer('김교수', '심사위원'), staffKey = w.b.viewer('운영 담당', '운영진');

  const page = await newPage(browser);
  await page.goto(SITE + '/judge/');
  await page.waitForSelector('#key-form');
  R.match('링크 없이 오면 안내만 보인다', await text(page, '#gate'), /참여 토큰을 입력해 주세요/);
  // 공개 현황판: 팀 번호 · 낸 것의 유무 · 투표한 사람 수만 (프로젝트 이름은 없다)
  await page.waitForSelector('#pub-submit .tchip');
  R.match('공개 현황판: 제출 현황(해커톤 → 구현과제) · 투표 현황', await text(page, '#pub'), /제출 현황[\s\S]*5분마다 갱신[\s\S]*해커톤[\s\S]*구현과제[\s\S]*투표 현황[\s\S]*1분마다 갱신[\s\S]*12:12 시작[\s\S]*투표한 사람 0/);
  R.eq('다 낸 팀은 완료, 일부만 낸 팀은 일부로', [await page.locator('#pub .tchip.done[data-no="03"]').count(), await page.locator('#pub .tchip.part[data-no="12"]').count(), await page.locator('#pub .tchip.none[data-no="01"]').count()], [1, 1, 1]);
  R.match('머리 요약도 채운다', await text(page, '#s-done'), /^1 \/ 20팀$/);
  R.check('공개 현황판에 프로젝트 이름이 없다', !/분실물 찾기 지도|코드 리뷰 도우미/.test(await text(page, '#pub')));
  await shot(page, 'e2e-judge-0-public');
  await page.fill('#key-in', 'x'.repeat(40));
  await page.click('#key-form button');
  await page.waitForFunction(() => /만료됐거나 올바르지 않습니다/.test(document.querySelector('#gate')?.textContent || ''));
  R.check('틀린 코드로는 열리지 않는다', true);

  // 이미 열어 둔 창에서 링크를 열면 주소의 # 뒤만 바뀐다 — 그래도 열려야 한다
  await page.goto(SITE + '/judge/#k=' + judgeKey);
  await page.waitForSelector('#list .post');
  R.check('열어 둔 창에 링크를 붙여 넣어도 열린다', true);
  const firsts = await page.$$eval('#list .trk', (secs) => secs.map((x) => {
    const p = x.querySelector('.post');
    return [p?.querySelector('.no')?.textContent, p?.querySelector('.pord')?.textContent || ''];
  }));
  R.eq('발표 순서대로 — 트랙마다 낸 팀이 맨 앞 · 발표 1', firsts, [['12', '발표 1'], ['03', '발표 1']]);
  R.match('트랙 머리에 발표 순서 안내', await text(page, '#list .trk-hd'), /발표 순서대로 · 마지막 제출이 늦은 팀부터 · 마감 때 확정/);
  R.eq('주소창에서 토큰을 지운다', await page.evaluate(() => location.hash), '');
  R.eq('열람 링크로 들어오면 공개 현황판은 감춘다', await page.locator('#pub').isHidden(), true);
  R.eq('팀 카드 20장', await page.locator('#list .post').count(), 20);
  R.match('요약: 제출 완료 팀 수', await text(page, '#s-done'), /^1 \/ 20팀$/);
  R.match('심사위원에게는 둘째 칸이 내 평가 진행', await text(page, '#s-parts'), /^0 \/ 20팀$/);
  R.match('낸 팀의 카드', await text(page, '#card-03'), /분실물 찾기 지도[\s\S]*서비스 열기[\s\S]*발표 자료 보기[\s\S]*데모 영상[\s\S]*코드/);
  R.match('참가자가 적은 글자는 글자 그대로 보인다 (태그로 해석하지 않는다)', await text(page, '#card-03 .txt'), /^<b>굵게<\/b> & "따옴표"$/);
  R.match('일부만 낸 팀', await text(page, '#card-12'), /발표 자료 없음[\s\S]*프로그램 받기/);
  R.match('안 낸 팀', await text(page, '#card-01'), /제출 전/);
  await shot(page, 'e2e-judge-1-list');

  // 자료 보기: 심사위원은 왼쪽에 발표 자료, 오른쪽에 그 팀 평가를 나란히
  await page.click('#card-03 [data-act="view"]');
  // PDF 보기가 있는 브라우저는 화면 안에(iframe), 없는 브라우저는 '새 탭에서 열기' 로 같은 자료를 준다
  await page.waitForSelector('#rv-body iframe, #rv-body a.btn', { timeout: 60000 });
  R.eq('나란히 보기: 오른쪽에 그 팀 평가 칸이 옮겨 온다', await page.evaluate(() => [!!document.querySelector('#rv-side form.jscore[data-no="03"]'), !!document.querySelector('#card-03 .jghost')]), [true, true]);
  const got = await page.evaluate(async () => {
    const el = document.querySelector('#rv-body iframe, #rv-body a.btn');
    const src = (el.src || el.href).split('#')[0];
    const buf = await (await fetch(src)).arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  });
  R.eq('화면에 연 자료가 올린 파일과 같다 (9MB, 조각을 나란히 받아 이어 붙임)', got, sha256(deck));
  R.match('보는 창에 팀과 파일 이름', await text(page, '.rv-bar'), /03팀 · 분실물 찾기 지도[\s\S]*team03_발표_v2_/);
  await shot(page, 'e2e-judge-2-viewer');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^01팀/.test(document.getElementById('rv-title').textContent));   // 발표 순서: 03(낸 팀) → 01 → 02 → 04 …
  R.eq('→ 로 발표 순서상 다음 팀 (평가 칸도 그 팀 것으로)', await page.evaluate(() => [!!document.querySelector('#rv-side form.jscore[data-no="01"]'), !!document.querySelector('#card-03 form.jscore')]), [true, true]);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('review').hidden);
  R.eq('Esc 로 닫히고 평가 칸은 제자리로', await page.evaluate(() => [!!document.querySelector('#card-01 form.jscore'), document.querySelectorAll('.jghost').length]), [true, 0]);

  // 프로그램 받기
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#card-12 [data-act="get"]')]);
  R.eq('프로그램 파일을 받는다', md5hex(readFileSync(await dl.path())), md5hex(zip));
  // 색인의 형식이 HTML 로 바뀌어 있어도(누가 시트를 고쳤거나) 이 사이트 주소에서 HTML 로 열리지 않는다 — 토큰을 읽는 스크립트가 돌 수 없게
  const ft = w.b.tab('파일'), fh = ft.cells[0];
  ft.cells.forEach((row, i) => { if (i && Number(row[fh.indexOf('번호')]) === zipId) row[fh.indexOf('형식')] = 'text/html'; });
  w.b.run('cacheClear');
  const type = await page.evaluate(async ([k, id]) => (await EP.download(id, { key: k })).blob.type, [judgeKey, zipId]);
  R.eq('받은 파일의 형식은 PDF · 영상이 아니면 내려받기 전용(octet-stream)', type, 'application/octet-stream');
  // 이전 자료
  await page.click('#card-03 [data-act="hist"]');
  R.match('이전 자료를 펼쳐 볼 수 있다', await text(page, '#card-03 .old'), /team03_발표_v1_/);

  // 새 제출이 들어오면 새로 고침으로 그 카드만 바뀐다
  await page.evaluate(() => { document.querySelector('#card-01').dataset.keep = '1'; });
  up(b1, 'deck', 'd.pdf', pdf(2000, 3));
  await page.click('#reload');
  await page.waitForFunction(() => /발표 자료 받기|발표 자료 보기/.test(document.querySelector('#card-12')?.textContent || ''));
  R.eq('바뀐 팀의 카드만 다시 그린다 (다른 카드는 그대로)', await page.evaluate(() => document.querySelector('#card-01').dataset.keep), '1');
  R.match('요약도 바뀐다', await text(page, '#s-done'), /^2 \/ 20팀$/);

  // 탭 · 낸 팀만
  await page.click('#tabs [data-tab="해커톤"]');
  R.eq('트랙 탭: 해커톤 10팀', await page.locator('#list .post').count(), 10);
  await page.click('#only');
  R.eq('제출한 팀만 보기', await page.locator('#list .post').count(), 1);

  const res = w.bodies.filter((x) => x.action === 'view.list').map((x) => x.res).join('\n');
  R.check('심사위원 응답에 이메일 · Drive 주소 · 폴더가 없다', !/@x\.com|drive\.google\.com|driveUrl|folderUrl|"by"/.test(res), (res.match(/@x\.com|drive\.google\.com|driveUrl|folderUrl|"by"/) || [])[0]);
  R.eq('화면 오류 없음', page.errs, []);

  // 링크를 꺼 두면 바로 닫힌다
  const sheet = w.b.tab('열람');
  sheet.cells[1][5] = '';
  w.b.cache.delete('views1');
  await page.click('#reload');
  await page.waitForSelector('#key-form');
  R.match('링크를 끄면 보던 화면도 닫힌다', await text(page, '#gate'), /만료됐거나 올바르지 않습니다/);
  await page.context().close();

  // 운영진 링크
  const st = await newPage(browser);
  await st.goto(SITE + '/judge/#k=' + staffKey);
  await st.waitForSelector('#list .post');
  R.match('운영진 링크는 Drive 로 가는 링크가 보인다', await text(st, '#card-03'), /발표 Drive[\s\S]*폴더/);
  R.match('헤더에 이름과 역할', await text(st, '#top-auth'), /운영 담당 · 운영진/);
  await shot(st, 'e2e-judge-3-staff');
  R.eq('화면 오류 없음', st.errs, []);
  await st.context().close();

  // 제출 마감(10:00) + 유예(5분)가 지나면 공개 현황판 맨 위에 발표 순서 (확정)
  w.at('2026-11-14T10:06:00+09:00');
  const pb = await newPage(browser);
  await pb.goto(SITE + '/judge/');
  await pb.waitForSelector('#pub-order .porder li');
  R.match('공개 현황판: 마감 뒤 발표 순서 · 확정', await text(pb, '#pub-order'), /발표 순서[\s\S]*마지막 제출이 늦은 팀부터 · 확정[\s\S]*해커톤[\s\S]*1\s*12팀[\s\S]*구현과제[\s\S]*1\s*03팀/);
  R.eq('안 낸 팀은 맨 뒤에 흐리게 · 제출 없음', await pb.locator('#pub-order li.none').count(), 18);
  R.eq('발표 순서가 제출 · 투표 현황보다 위', await pb.$eval('#pub', (el) => el.firstElementChild.id), 'pub-order');
  await shot(pb, 'e2e-judge-4-order');
  R.eq('화면 오류 없음 (공개 현황판)', pb.errs, []);
  await pb.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('휴대폰 화면', async (w) => {
  const page = await newPage(browser, { mobile: true });
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#steps:not([hidden])');
  await page.fill('#f-title', '분실물 찾기 지도');
  await page.fill('#f-url', 'https://team03.example.app');
  await page.click('#save');
  await page.waitForSelector('#msg.ok');
  await page.setInputFiles('#in-deck', file('발표.pdf', pdf(700 * 1024, 2), 'application/pdf'));
  await page.waitForSelector('#slot-deck .file.now', { timeout: 30000 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  R.check('가로로 넘치지 않는다', wide <= 0, 'overflow ' + wide);
  await shot(page, 'e2e-mobile-submit');
  if (SHOTS) for (let y = 0; y < 3; y++) { await page.evaluate((n) => window.scrollTo(0, n * 700), y); await page.screenshot({ path: path.join(SHOTS, `e2e-mobile-submit-view${y}.png`) }); }
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('인기투표: 명단에 있는 참가자만 · 트랙별 1인 3표 · 시간표대로 · 운영진이 열고 닫는다', async (w) => {
  const opTok = w.account('op@x.com', '900', '운영진');
  const op = await newPage(browser);
  await op.goto(SITE + '/judge/vote/');
  await op.waitForSelector('#fake-gsi');
  await login(op, opTok);
  await op.waitForSelector('#admin:not([hidden])');
  R.match('운영진에게는 발표 순서(해커톤 → 구현과제)로 시간표의 투표 시간과 버튼이 보인다', await text(op, '#admin'),
    /해커톤[\s\S]*12:12 – 12:27[\s\S]*지금 열기[\s\S]*5분 늦추기[\s\S]*구현과제[\s\S]*14:15 – 14:25[\s\S]*지금 열기/);
  R.match('머리에는 해커톤이 먼저, 여는 시각과 함께', await text(op, '#h-H'), /12:12 시작/);

  const out = await newPage(browser);
  await out.goto(SITE + '/judge/vote/');
  await out.waitForSelector('#fake-gsi');
  await login(out, w.account('none@x.com', '999', '외부인'));
  await out.waitForSelector('#gate-out');
  R.match('신청서(명단)와 맞지 않는 계정은 들어오지 못한다', await text(out, '#gate'), /참가자 명단에 없습니다[\s\S]*none@x\.com/);
  R.eq('그 화면에는 투표지가 없다', await out.locator('#app').isHidden(), true);
  await out.context().close();

  const page = await newPage(browser);
  await page.goto(SITE + '/judge/vote/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('.vcard');
  await page.click('[data-tab="A"]');
  R.match('열기 전에는 여는 시각만 보인다', await text(page, '#ballot'), /구현과제 투표는 14:15에 열립니다/);
  R.eq('열기 전에는 고르기 단추가 없다', await page.locator('.vcard .pick').count(), 0);

  op.once('dialog', (d) => d.accept());
  await op.click('[data-act="admin"][data-op="open"][data-track="A"]');
  await op.waitForFunction(() => /투표 중 · 14:25까지/.test(document.querySelector('#h-A')?.textContent || ''));
  await page.waitForSelector('.vcard .pick', { timeout: 45000 });
  R.check('운영진이 열면 참가자 화면이 저절로 바뀐다 (새로 고치지 않아도)', true);
  R.eq('우리 팀(03)은 고를 수 없다', await page.locator('.vcard[data-no="03"] .pick').count(), 0);
  for (const no of ['01', '02', '04']) await page.click(`.vcard[data-no="${no}"] .pick`);
  R.eq('3팀을 고르면 나머지는 막힌다', await page.locator('.vcard[data-no="05"] .pick[disabled]').count(), 1);
  await page.click('[data-act="submit"]');
  await page.waitForSelector('.vcard .code');
  const codes = await page.$$eval('.vcard .code b', (l) => l.map((e) => e.textContent).sort());
  const rows = w.b.rows('투표');
  R.eq('시트 `투표` 탭에 표 3장', rows.length, 3);
  R.check('시트에는 누가 냈는지(이메일 · 이름)가 없다', !/a1@x\.com|가나다/.test(JSON.stringify(w.b.tab('투표').cells)));
  R.eq('확인 코드 = 그 표의 검증값 앞 6자리', codes, rows.map((r) => String(r['검증']).slice(0, 6).toUpperCase()).sort());
  await shot(page, 'e2e-vote-1-done');

  await page.click('[data-act="edit"]');
  await page.click('.vcard[data-no="04"] .pick');
  page.once('dialog', (d) => d.accept());                    // 2팀만 골랐다는 확인
  await page.click('[data-act="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.vcard .code').length === 2);
  const tally = () => w.b.post({ action: 'vote.me', idToken: opTok }).tally.find((t) => t.key === 'A');
  R.eq('다시 내면 마지막 투표지만 센다', tally().rows.filter((r) => r.votes).map((r) => [r.no, r.votes]), [['01', 1], ['02', 1]]);
  R.eq('한 사람으로 센다', tally().voters, 1);

  await op.waitForFunction(() => /투표한 사람 1/.test(document.querySelector('#admin')?.textContent || ''), null, { timeout: 20000 });
  await op.click('[data-act="res"][data-track="A"]');
  R.match('운영진은 결과(표 · 참가자 점수)를 펼쳐 본다', await text(op, '.vres'), /01[\s\S]*1[\s\S]*15\.00/);
  await shot(op, 'e2e-vote-2-admin');

  op.once('dialog', (d) => d.accept());
  await op.click('[data-act="admin"][data-op="close"][data-track="A"]');
  await page.waitForFunction(() => /마감되었습니다/.test(document.querySelector('#ballot')?.textContent || ''), null, { timeout: 45000 });
  R.check('마감하면 참가자 화면도 닫힌다', true);
  const late = await page.evaluate(async () => (await EP.api('vote.submit', { track: 'A', teams: ['05'] })).error);
  R.eq('마감 뒤에 보내도 서버가 거절한다', late, 'VOTE_CLOSED');
  const forged = await page.evaluate(async () => (await EP.api('vote.admin', { track: 'A', op: 'open' })).error);
  R.eq('참가자가 화면을 고쳐 열려고 해도 거절한다', forged, 'NOT_ADMIN');

  // 시간표의 투표 시간이 되면 운영진이 누르지 않아도 열린다 (화면도 그 시각에 저절로 새로 읽는다)
  w.at('2026-11-14T12:11:56+09:00');
  await page.reload();
  await page.waitForSelector('.vcard');
  await page.click('[data-tab="H"]');
  R.match('해커톤은 12:12 에 열린다고 보인다', await text(page, '#ballot'), /해커톤 투표는 12:12에 열립니다/);
  await page.waitForSelector('.vcard .pick', { timeout: 25000 });
  R.match('12:12 가 되면 저절로 열린다', await text(page, '#h-H'), /투표 중 · 12:27까지/);
  R.eq('다른 트랙의 팀은 우리 팀이 아니므로 모두 고를 수 있다', await page.locator('.vcard .pick').count(), 10);
  R.eq('화면 오류 없음', [...page.errs, ...op.errs], []);
  await page.context().close();
  await op.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('심사: 교수님 토큰으로 4문항 점수(소수점) · 코멘트 → 운영진 종합', async (w) => {
  w.b.run('setup');                                         // 심사위원 폴더 · 심사 시트
  const prof = w.b.viewer('가 교수님', '심사위원'), prof2 = w.b.viewer('나 교수님', '심사위원'), staffKey = w.b.viewer('운영 담당', '운영진');
  const page = await newPage(browser);
  await page.goto(SITE + '/judge/#k=' + prof);
  await page.waitForSelector('form.jscore');
  R.eq('심사위원 화면은 팀마다 세로로 한 줄 (20팀)', await page.locator('.jrow').count(), 20);
  const f = 'form.jscore[data-no="03"]';
  for (const [k, v] of [['idea', '21.5'], ['done', '18.25'], ['ux', '20'], ['arch', '22.75']]) await page.fill(`${f} input[name="${k}"]`, v);
  await page.fill(`${f} textarea[name="comment"]`, '구조 설명이 분명했습니다.');
  R.eq('합계가 바로 보인다', await text(page, `${f} [data-sum]`), '82.5');
  R.match('저장 전에는 저장하지 않았다고 알린다', await text(page, `${f} [data-state]`), /저장하지 않은 내용/);
  await page.click(`${f} button[type="submit"]`);
  await page.waitForFunction((sel) => /저장됨/.test(document.querySelector(sel + ' [data-state]')?.textContent || ''), f);
  const rows = w.b.scoreBook().getSheetByName('점수').objects();
  R.eq('심사 시트 `점수` 탭에 한 줄 (숫자는 숫자로)', rows.map((r) => [r['심사위원'], r['팀'], r['문제 정의 · 아이디어'], r['완성도'], r['합계'], r['코멘트']]),
    [['가 교수님', '03', 21.5, 18.25, 82.5, '구조 설명이 분명했습니다.']]);
  R.match('내 평가 진행이 늘어난다', await text(page, '#s-parts'), /^1 \/ 20팀$/);
  const g = 'form.jscore[data-no="05"]';
  await page.fill(`${g} input[name="idea"]`, '26');
  R.match('25 를 넘으면 바로 알리고', await text(page, `${g} [data-state]`), /0 – 25 사이[\s\S]*저장할 수 없습니다/);
  R.eq('저장 단추를 잠근다', await page.locator(`${g} button[type="submit"]`).isDisabled(), true);
  await page.focus(`${g} input[name="idea"]`);
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(400);
  R.eq('잘못된 점수는 시트에 들어가지 않는다', w.b.scoreBook().getSheetByName('점수').objects().length, 1);
  await page.reload();
  await page.waitForSelector('form.jscore');
  R.eq('다시 열어도 내가 낸 점수가 채워져 있다', await page.inputValue(`${f} input[name="arch"]`), '22.75');
  await shot(page, 'e2e-score-1-judge');

  // 마감 전에는 다른 팀이 낼 때마다 발표 순서가 바뀐다 — 입력 중이던(저장 전) 점수는 그대로 남아야 한다
  const h = 'form.jscore[data-no="12"]';
  await page.fill(`${h} input[name="idea"]`, '19');
  await page.fill(`${h} textarea[name="comment"]`, '적는 중');
  await page.focus(`${h} input[name="idea"]`);
  w.b.post({ action: 'info.save', idToken: w.account('b1@x.com', '201', '사아자'), data: { title: '순서를 바꾸는 팀' } });
  await page.evaluate(() => document.getElementById('reload').click());   // 저절로 새로 읽는 것처럼 (커서를 옮기지 않고)
  await page.waitForFunction(() => document.querySelector('#list .trk .jrow')?.getAttribute('data-no') === '12');
  R.eq('순서가 바뀌어 12팀이 해커톤 맨 앞 (발표 1)', await text(page, '#card-12 .pord'), '발표 1');
  R.eq('입력 중이던 점수 · 코멘트가 그대로 · 커서도 그 칸에',
    [await page.inputValue(`${h} input[name="idea"]`), await page.inputValue(`${h} textarea[name="comment"]`), await page.evaluate(() => document.activeElement?.closest('form')?.getAttribute('data-no'))],
    ['19', '적는 중', '12']);
  R.match('저장하지 않았다는 표시도 그대로', await text(page, `${h} [data-state]`), /저장하지 않은 내용/);
  await page.fill(`${h} input[name="idea"]`, '');
  await page.fill(`${h} textarea[name="comment"]`, '');

  // 9팀을 해커톤으로 옮기면(스크립트 속성 TRACK_MOVES) 목록을 통째로 다시 그린다 — 입력 중이던 점수 · 커서는 남아야 한다
  const k5 = 'form.jscore[data-no="05"]';
  await page.fill(`${k5} input[name="done"]`, '17.5');
  await page.focus(`${k5} input[name="done"]`);
  w.b.store.TRACK_MOVES = '09:H'; w.b.run('cacheClear');
  await page.evaluate(() => document.getElementById('reload').click());
  await page.waitForFunction(() => !!document.querySelector('#list .trk')?.querySelector('.jrow[data-no="09"]'));
  R.check('9팀 카드가 해커톤 칸으로 옮겨진다', true);
  R.eq('통째로 다시 그려도 입력 중이던 점수와 커서는 그대로',
    [await page.inputValue(`${k5} input[name="done"]`), await page.evaluate(() => document.activeElement?.closest('form')?.getAttribute('data-no'))], ['17.5', '05']);
  R.match('저장하지 않았다는 표시도 그대로 (옮길 때)', await text(page, `${k5} [data-state]`), /저장하지 않은 내용/);
  R.eq('저장해 둔 03팀 점수도 그대로', await page.inputValue(`${f} input[name="arch"]`), '22.75');
  delete w.b.store.TRACK_MOVES; w.b.run('cacheClear');                    // 되돌리기
  await page.fill(`${k5} input[name="done"]`, '');
  await page.evaluate(() => document.getElementById('reload').click());
  await page.waitForFunction(() => !document.querySelector('#list .trk')?.querySelector('.jrow[data-no="09"]'));

  // 제출 마감(10:00)이 지나면 그 자리에 심사 마감(14:25)이 보이고, 14:25 가 지나면 입력 칸이 저절로 닫힌다
  w.at('2026-11-14T14:24:50+09:00');
  await page.reload();
  await page.waitForSelector('form.jscore');
  R.match('심사 마감 시각과 남은 시간', await page.locator('#s-deadline').locator('xpath=..').innerText(), /심사 마감[\s\S]*14:25 · 0:00:\d\d 남음/);
  await page.evaluate(() => { window.__t0 = Date.now(); });
  w.at('2026-11-14T14:25:00+09:00');
  await page.waitForFunction(() => document.querySelector('form.jscore input[name="idea"]')?.disabled, null, { timeout: 30000 });
  R.match('14:25 가 지나면 새로 고치지 않아도 닫힌다', await text(page, `${f} [data-state]`), /심사가 마감되었습니다/);
  w.at('2026-11-14T13:00:00+09:00');                         // 아래 종합 화면은 마감 전 시각으로
  await page.reload();
  await page.waitForSelector('form.jscore');

  // 다른 교수님 한 분 더 (서버로 바로)
  w.b.post({ action: 'score.save', key: prof2, team: '03', scores: { idea: 20, done: 20, ux: 20, arch: 20 }, comment: '데모가 좋았습니다' });

  const p2 = await newPage(browser);
  await p2.goto(SITE + '/judge/score/#k=' + prof);
  await p2.waitForSelector('tr.row');
  R.eq('심사위원 토큰으로도 종합을 본다 (읽기만 — 마감 · 결과 발표 단추 없음)', [await p2.isVisible('#lock'), await p2.isVisible('#res')], [false, false]);
  await p2.context().close();

  const sp = await newPage(browser);
  await sp.goto(SITE + '/judge/score/#k=' + staffKey);
  await sp.waitForSelector('tr.row');
  R.match('종합도 발표 순서대로 해커톤 탭이 먼저', await text(sp, '#tabs'), /^해커톤[\s\S]*구현과제/);
  await sp.click('[data-tab="A"]');
  const r03 = sp.locator('tr.row[data-no="03"]');
  R.match('종합: 교수님별 합계(이름순) · 평균 J · 최종 S', await r03.innerText(), /82\.50[\s\S]*80\.00[\s\S]*81\.25[\s\S]*69\.06/);
  R.match('1등', await r03.innerText(), /^1/);
  await r03.click();
  R.match('줄을 누르면 문항별 점수와 코멘트', await text(sp, 'tr.more'), /22\.75[\s\S]*구조 설명이 분명했습니다[\s\S]*데모가 좋았습니다/);
  await shot(sp, 'e2e-score-2-summary');

  sp.once('dialog', (d) => d.accept());
  await sp.click('#lock');
  await sp.waitForFunction(() => /마감됨/.test(document.querySelector('#s-state')?.textContent || ''));
  const closed = await page.evaluate(async (k) => (await EP.api('score.save', { team: '03', scores: { idea: 1 } }, { key: k })).error, prof);
  R.eq('운영진이 마감하면 서버가 저장을 거절한다', closed, 'SCORE_CLOSED');
  R.eq('화면 오류 없음', [...page.errs, ...sp.errs], []);
  await page.context().close();
  await sp.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('결과 발표: 심사 마감 단추(투표도 마감) → 메인에 해커톤 1 – 3등 · 구현과제 1 – 4등, 교수님 종합 보기, 시상 화면 (스페이스로 4 → 1, 3 → 1)', async (w) => {
  w.b.run('setup');
  const prof = w.b.viewer('가 교수님', '심사위원'), staffKey = w.b.viewer('운영 담당', '운영진');
  w.at('2026-11-14T13:00:00+09:00');
  const four = (n) => ({ idea: n, done: n, ux: n, arch: n });
  for (const [no, n] of [['11', 24], ['12', 23], ['13', 22], ['14', 21], ['15', 20], ['16', 19], ['17', 18], ['01', 25], ['02', 22], ['03', 20], ['04', 18], ['05', 10]]) {
    w.b.post({ action: 'score.save', key: prof, team: no, scores: four(n) });
  }
  // 브라우저 시계도 그 시각으로 (메인 페이지는 14:00 전에는 서버에 묻지 않는다)
  const clock = (page, iso) => page.addInitScript((t) => { const d = t - Date.now(), N = Date.now.bind(Date); Date.now = () => N() + d; }, Date.parse(iso));
  const mainHidden = async (iso) => {
    const p = await newPage(browser);
    await clock(p, iso);
    await p.goto(SITE + '/');
    await p.waitForTimeout(1500);
    const hidden = await p.locator('#results').isHidden();
    await p.context().close();
    return hidden;
  };

  // 14:20 — 운영진이 심사 종합에서 '심사 마감 · 결과 발표' (구현과제 투표는 14:25 까지)
  w.at('2026-11-14T14:20:00+09:00');
  const sp = await newPage(browser);
  await sp.goto(SITE + '/judge/score/#k=' + staffKey);
  await sp.waitForSelector('.stable');
  R.match('마감 전: 메인 결과 발표 칸 · 단추 이름', [await text(sp, '#s-res'), await text(sp, '#lock')].join(' | '), /심사 마감을 누르면 메인에 \| 심사 마감 · 결과 발표/);
  sp.once('dialog', (d) => d.accept());
  await sp.click('#lock');
  await sp.waitForFunction(() => /다시 열기/.test(document.getElementById('lock').textContent));
  R.match('누르면 열려 있던 구현과제 투표도 마감되고 바로 공개', await text(sp, '#s-res'), /메인에 공개 중/);
  R.eq('시상 화면으로 가는 단추는 어디에도 없다 (운영진이 주소로 연다)', await sp.locator('a[href*="award"]').count(), 0);
  R.eq('투표를 기다리지 않고 메인에 바로 뜬다 (14:21)', await mainHidden('2026-11-14T14:21:00+09:00'), false);
  R.eq('투표도 마감됐다', w.b.ctx.voteState_('A'), 'closed');

  // 14:26 — 메인 화면 내용
  w.at('2026-11-14T14:26:00+09:00');
  const page = await newPage(browser);
  await clock(page, '2026-11-14T14:26:00+09:00');
  await page.goto(SITE + '/');
  await page.waitForSelector('#results:not([hidden]) .res-trk');
  const got = await page.$$eval('#results .res-trk', (ts) => ts.map((t) => [t.dataset.track,
    [...t.querySelectorAll('.pl')].map((p) => [p.querySelector('b').textContent, [...p.querySelectorAll('.tm .no')].map((x) => x.textContent)])]));
  R.eq('메인: 해커톤 1등 1 · 2등 2 · 3등 3팀, 구현과제 1 – 4등 (최종 S 순서)', got, [
    ['H', [['1등', ['11팀']], ['2등', ['12팀', '13팀']], ['3등', ['14팀', '15팀', '16팀']]]],
    ['A', [['1등', ['01팀']], ['2등', ['02팀']], ['3등', ['03팀']], ['4등', ['04팀']]]]]);
  R.eq('맨 위 단추가 결과 보기로', (await page.locator('#v-home .hero-cta a.btn').first().textContent()).trim(), '결과 보기');
  R.check('메인에는 점수 · 심사위원 이름이 없다', !/교수님|\d+\.\d\d/.test(await text(page, '#results-grid')));
  await shot(page, 'e2e-results-main');

  // 교수님도 종합을 본다 (읽기만 — 마감 · 결과 발표 단추 없음)
  const pp = await newPage(browser);
  await pp.goto(SITE + '/judge/#k=' + prof);
  await pp.waitForSelector('#to-score');
  R.eq('교수님 현황판에도 심사 종합 → 이 있다', await pp.getAttribute('#to-score', 'href'), './score/');
  await pp.click('#to-score');
  await pp.waitForSelector('.stable');
  R.eq('교수님 종합: 표는 보이고 마감 · 결과 발표 단추와 결과 칸은 없다',
    [await pp.locator('tr.row').count() > 0, await pp.isVisible('#lock'), await pp.isVisible('#res'), await pp.isVisible('#s-res')], [true, false, false, false]);
  R.eq('화면 오류 없음 (교수님 종합)', pp.errs, []);
  await pp.context().close();

  // 시상 화면: 운영진이 주소로 직접 연다 (토큰은 주소에서 지운다)
  const aw = await newPage(browser);
  await aw.goto(SITE + '/judge/award/#k=' + staffKey);
  await aw.waitForSelector('.aw-slide.cover.in, #gate-wrap:not([hidden]) .t', { timeout: 30000 });
  R.eq('시상 화면이 열린다 (토큰 안내 없이)', await aw.evaluate(() => document.getElementById('gate-wrap').hidden ? '' : document.getElementById('gate').textContent), '');
  R.eq('시상 화면은 /judge/award/ 이고 주소에서 토큰을 지운다', await aw.evaluate(() => location.pathname + location.hash), '/judge/award/');
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await aw.waitForTimeout(150);
    seen.push(await aw.evaluate(() => { const x = [...document.querySelectorAll('.aw-slide')].pop();
      const q = (c) => x.querySelector(c)?.textContent.trim() || '';
      return x.classList.contains('team') ? q('.trk').slice(0, 2) + ' ' + q('.place').replace(/\s+/g, '') + ' ' + q('.no') : x.className.replace('aw-slide ', '').replace(' in', ''); }));
    await aw.keyboard.press('Space');
  }
  R.eq('스페이스로: 표지 → 구현과제 4 · 3 · 2 · 1등 → 해커톤 3등(S 낮은 팀부터) · 2등 · 1등 → 축하합니다', seen, [
    'cover', 'sec', '구현 4등 04팀', '구현 3등 03팀', '구현 2등 02팀', '구현 1등 01팀', 'sec',
    'Ha 3등 16팀', 'Ha 3등 15팀', 'Ha 3등 14팀', 'Ha 2등 13팀', 'Ha 2등 12팀', 'Ha 1등 11팀', 'end']);
  await aw.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await aw.keyboard.press('ArrowRight');
  await aw.waitForTimeout(2600);                                    // 점수가 0 에서 올라가 멈출 때까지
  R.eq('구현과제 1등 장면: 최종 S', await text(aw, '.aw-slide.first .score b'), '85.00');
  await shot(aw, 'e2e-award-1st');
  await aw.keyboard.press('ArrowLeft');
  await aw.waitForTimeout(200);
  R.match('← 로 이전 장면', await text(aw, '.aw-slide:last-child .place'), /^2/);
  R.eq('화면 오류 없음', [...page.errs, ...sp.errs, ...aw.errs], []);

  // 운영진이 결과를 내리면 메인에서 사라진다 (화면은 1분마다 다시 묻는다 — 여기서는 탭을 다시 보는 것으로 바로)
  sp.once('dialog', (d) => d.accept());
  await sp.click('#res');
  await sp.waitForFunction(() => /공개 전/.test(document.getElementById('s-res').textContent));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.getElementById('results').hidden);
  R.check('결과 내리기 → 메인에서 사라진다', true);
  await page.context().close(); await sp.context().close(); await aw.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('발표 PPT → 보기용 PDF: 올리면 저절로 바뀌고, 심사위원은 PDF 로 바로 본다', async (w) => {
  const page = await newPage(browser);
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('#fake-gsi');
  await login(page, w.account('a1@x.com', '101', '가나다'));
  await page.waitForSelector('#steps:not([hidden])');
  const ppt = bytesOf(300 * 1024, 4);
  await page.setInputFiles('#in-deck', file('발표.pptx', ppt, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
  await page.waitForFunction(() => /보기용 PDF 준비됨/.test(document.querySelector('#slot-deck')?.textContent || ''), null, { timeout: 30000 });
  R.check('올리고 나면 보기용 PDF 를 저절로 만든다', true);
  const row = w.b.rows('파일').find((r) => r['상태'] === '현재' && r['종류'] === '발표');
  R.check('`파일` 탭에 PDF ID · 크기', !!row && !!row['PDF ID'] && Number(row['PDF 크기']) > 0);
  R.match('Keynote 는 PDF 로 내보내라고 안내', await text(page, '#steps'), /Keynote 는 PDF 로 내보내 주세요/);
  await page.context().close();

  const judge = await newPage(browser);
  await judge.goto(SITE + '/judge/#k=' + w.b.viewer('나 교수님', '심사위원'));
  await judge.waitForSelector('#card-03 [data-act="view"]');
  R.eq('PPT 발표도 "발표 자료 보기"', await text(judge, '#card-03 [data-act="view"]'), '발표 자료 보기');
  await judge.click('#card-03 [data-act="view"]');
  await judge.waitForSelector('#rv-body iframe, #rv-body a.btn', { timeout: 30000 });
  const head = await judge.evaluate(async () => {
    const el = document.querySelector('#rv-body iframe, #rv-body a.btn');
    const buf = new Uint8Array(await (await fetch((el.src || el.href).split('#')[0])).arrayBuffer());
    return new TextDecoder().decode(buf.slice(0, 8));
  });
  R.eq('왼쪽에 뜨는 것은 보기용 PDF', head, '%PDF-1.7');
  R.match('보는 창에 "보기용 PDF"', await text(judge, '#rv-sub'), /보기용 PDF/);
  R.eq('화면 오류 없음', judge.errs, []);
  await judge.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('메뉴: 행사 페이지 네 곳이 같은 메뉴 · 메인과 정책 문서에서도 바로 간다', async (w) => {
  const want = ['/', '/#prize', '/judge/', '/submit/', '/judge/vote/'];
  const navOf = (page) => page.$$eval('header.top nav a, #top-bar nav a', (l) => l.filter((a) => !a.hidden && a.offsetParent !== null)
    .map((a) => ({ t: a.innerText.trim(), h: new URL(a.href).pathname + new URL(a.href).hash, on: a.getAttribute('aria-current') === 'page' })));
  const page = await newPage(browser);
  for (const [path, cur] of [['/submit/', '/submit/'], ['/judge/', '/judge/'], ['/judge/vote/', '/judge/vote/'], ['/judge/score/', '/judge/score/']]) {
    await page.goto(SITE + path);
    const nav = await navOf(page);
    R.eq(path + ' 메뉴: 홈 · 심사안내 · 제출·투표 현황 · 결과물 제출 · 투표', nav.slice(0, 5).map((x) => x.h), want);
    R.eq(path + ' 메뉴 이름', nav.slice(0, 5).map((x) => x.t), ['홈', '심사안내', '제출·투표 현황', '결과물 제출', '투표']);
    R.eq(path + ' 지금 페이지 표시', nav.filter((x) => x.on).map((x) => x.h), [cur]);
    R.check(path + ' 바닥에 심사안내 · 정책 문서', /심사안내[\s\S]*개인정보처리방침[\s\S]*이용약관/.test(await text(page, 'footer .f-links')));
  }
  await page.goto(SITE + '/judge/');
  R.match('현황 페이지 제목', await text(page, 'h1') + ' ' + await page.title(), /제출 · 투표 현황[\s\S]*제출 · 투표 현황 · ENDPoinT/);
  // 메인 (행사 기간): 신청 안내 대신 심사안내 · 결과물 제출 · 투표. 로컬에서는 ?gate=after&submit=on 이 행사 기간 모습이다
  const EVENT = '?gate=after&submit=on';
  await page.goto(SITE + '/' + EVENT);
  await page.waitForFunction(() => document.documentElement.classList.contains('ep-event'));
  const main = (await navOf(page)).map((x) => x.t);
  R.check('메인 메뉴에 심사안내 · 제출·투표 현황 · 결과물 제출 · 투표', ['심사안내', '제출·투표 현황', '결과물 제출', '투표'].every((t) => main.includes(t)), main.join(','));
  R.check('메인 메뉴에서 신청 안내는 감춘다 (모집 끝)', !main.includes('신청 안내'), main.join(','));
  await page.goto(SITE + '/en/' + EVENT);
  await page.waitForFunction(() => document.documentElement.classList.contains('ep-event'));
  const en = (await navOf(page)).map((x) => x.t);
  R.check('영문 메인: Judging · Submissions & votes · Submit · Vote', ['Judging', 'Submissions & votes', 'Submit', 'Vote'].every((t) => en.includes(t)) && !en.includes('How to apply'), en.join(','));
  // 정책 문서: 참가 신청 자리에 제출·투표 현황
  for (const [path, label] of [['/privacy/', '제출·투표 현황'], ['/terms/', '제출·투표 현황'], ['/en/privacy/', 'Submissions & votes']]) {
    await page.goto(SITE + path);
    const nav = await navOf(page);
    R.check(path + ' 참가 신청 대신 ' + label + ' → /judge/', nav.some((x) => x.t === label && x.h === '/judge/') && !nav.some((x) => /참가 신청|^Apply$/.test(x.t)), JSON.stringify(nav.map((x) => x.t)));
  }
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
  // 휴대폰: 긴 이름은 접고 (현황 · 제출 · 투표), 머리가 한 줄
  const m = await newPage(browser, { mobile: true });
  for (const path of ['/', '/submit/', '/judge/', '/judge/vote/']) {
    await m.goto(SITE + path + (path === '/' ? '?gate=after&submit=on' : ''));
    if (path === '/') await m.waitForFunction(() => document.documentElement.classList.contains('ep-event'));
    const nav = (await navOf(m)).map((x) => x.t);
    R.check('휴대폰 ' + path + ' 메뉴: 현황 · 제출 · 투표', ['현황', '제출', '투표'].every((t) => nav.includes(t)), nav.join(','));
    const fit = await m.evaluate(() => {
      const h = document.querySelector('header.top, #top-bar'), n = h && h.querySelector('nav');
      return { wide: document.documentElement.scrollWidth - innerWidth, navRight: n ? Math.round(n.getBoundingClientRect().right) : 0, w: innerWidth, h: h ? Math.round(h.getBoundingClientRect().height) : 0 };
    });
    R.check('휴대폰 ' + path + ' 가로 넘침 없고 메뉴가 화면 안', fit.wide <= 0 && fit.navRight <= fit.w, JSON.stringify(fit));
  }
  await shot(m, 'e2e-nav-mobile-main');
  await m.context().close();
});

/* ---------------------------------------------------------------- */
await scenario('화면 테마: 해 · 달 단추로 밝은 화면 ↔ 어두운 화면, 다른 페이지에서도 이어진다', async (w) => {
  const page = await newPage(browser);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).color + ' / ' + getComputedStyle(document.documentElement).backgroundImage.slice(0, 40));
  const state = () => page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme') || 'dark',
    label: document.querySelector('.theme-tg')?.getAttribute('aria-label'), meta: document.querySelector('meta[name="theme-color"]')?.content,
    saved: (() => { try { return localStorage.getItem('ep-theme'); } catch (e) { return 'x'; } })() }));
  await page.goto(SITE + '/submit/');
  await page.waitForSelector('.theme-tg');
  R.eq('처음에는 어두운 화면 (기본)', await state(), { theme: 'dark', label: '밝은 화면으로', meta: '#191919', saved: null });
  const dark = await bg();
  await page.click('.theme-tg');
  R.eq('누르면 밝은 화면 · 단추는 달 · 기억한다', await state(), { theme: 'light', label: '어두운 화면으로', meta: '#F7F7F6', saved: 'light' });
  R.check('글자 · 바탕 색이 바뀐다', (await bg()) !== dark, await bg());
  for (const path of ['/judge/', '/judge/vote/', '/judge/score/', '/privacy/', '/?gate=after&submit=on']) {
    await page.goto(SITE + path);
    await page.waitForSelector('.theme-tg');
    R.eq(path + ' 에서도 밝은 화면으로 열린다', (await state()).theme, 'light');
  }
  R.eq('메인: 단추는 EN 바로 옆', await page.evaluate(() => document.querySelector('#top-bar nav a.lang')?.nextElementSibling?.className), 'theme-tg');
  await page.click('.theme-tg');
  R.eq('다시 누르면 어두운 화면', await state(), { theme: 'dark', label: '밝은 화면으로', meta: '#191919', saved: 'dark' });
  await page.goto(SITE + '/judge/vote/');
  await page.waitForSelector('.theme-tg');
  R.eq('어두운 화면도 이어진다', (await state()).theme, 'dark');
  R.eq('화면 오류 없음', page.errs, []);
  await page.context().close();
});

await browser.close();
process.exit(R.done() ? 1 : 0);
