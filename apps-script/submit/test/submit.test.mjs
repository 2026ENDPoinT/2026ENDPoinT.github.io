import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadBackend, token, bytesOf, md5, FakeSheet } from './harness.mjs';

const TOKENS = {
  'tok-a1': token('a1@x.com', '101'),          // 03팀 조장
  'tok-a2': token('a2@x.com', '102'),          // 03팀
  'tok-b1': token('b1@x.com', '201'),          // 12팀
  'tok-new': token('newmail@x.com', '103'),    // 03팀인데 주소가 바뀐 계정 (식별자로 찾는다)
  'tok-alt': token('alt@x.com', '999'),        // 03팀, 이메일만 적혀 있음
  'tok-out': token('out@x.com', '301'),        // 불참
  'tok-none': token('none@x.com', '401'),      // 명단에 없음
  'tok-op': token('op@x.com', '501'),          // 운영진
  'tok-aud': token('a1@x.com', '101', { aud: 'other-site' }),
  'tok-old': token('a1@x.com', '101', { exp: '1000' }),
  'tok-unverified': token('a1@x.com', '101', { email_verified: 'false' }),
};

function backend(extra = {}) {
  const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: TOKENS, ...extra });
  b.roster([
    ['03', '가나다', 'a1@x.com', '101', '조장', ''],
    ['03', '라마바', 'a2@x.com', '102', '', ''],
    ['3', '주소바뀜', 'oldmail@x.com', '103', '', ''],
    ['Team 03', '이메일만', 'ALT@x.com', '', '', ''],
    ['12', '사아자', 'b1@x.com', '201', '조장', ''],
    ['12', '불참자', 'out@x.com', '301', '', '불참'],
  ]);
  return b;
}

/** 03팀으로 파일 하나를 끝까지 올린다 */
function upload(b, { idToken = 'tok-a1', sid, kind = 'deck', name = '발표.pdf', bytes = bytesOf(1000), as } = {}) {
  const start = b.post({ action: 'upload.start', idToken, sid, as, kind, name, size: bytes.length, origin: 'https://2026endpoint.github.io' });
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.equal(b.putDirect(start.url, bytes).code, 200);
  const fin = b.post({ action: 'upload.finish', idToken, sid, as, id: start.id });
  return { start, fin, bytes };
}

describe('공개 응답', () => {
  test('doGet 은 시각과 마감만 알려 주고 비밀은 담지 않는다', () => {
    const b = backend();
    const r = b.get();
    assert.equal(r.ok, true);
    assert.equal(r.deadline, Date.parse('2026-11-14T10:00:00+09:00'));
    assert.equal(r.phase, 'open');
    const text = JSON.stringify(r);
    for (const secret of ['x.com', 'root', 'sheet-', 'cid']) assert.ok(!text.includes(secret), secret);
  });

  test('모르는 action 과 깨진 요청은 거부한다', () => {
    const b = backend();
    assert.equal(b.post({ action: 'nope', idToken: 'tok-a1' }).error, 'UNKNOWN_ACTION');
    assert.equal(b.post({}).error, 'UNKNOWN_ACTION');
    assert.equal(JSON.parse(b.ctx.doPost({ postData: { contents: '{bad json' } }).body).error, 'SERVER_ERROR');
  });
});

describe('누구인가', () => {
  test('토큰이 없거나, 다른 사이트용이거나, 만료됐거나, 확인 안 된 주소면 거부', () => {
    const b = backend();
    for (const idToken of [undefined, '', 'nope', 'tok-aud', 'tok-old', 'tok-unverified', 'x'.repeat(5000), { a: 1 }]) {
      assert.equal(b.post({ action: 'me', idToken }).error, 'AUTH_FAILED', String(idToken));
    }
  });

  test('계정 식별자 → 이메일 순으로 팀을 찾는다', () => {
    const b = backend();
    const me = b.post({ action: 'me', idToken: 'tok-a1' });
    assert.equal(me.ok, true);
    assert.deepEqual(me.team, { no: '03', track: '구현과제', name: '가나다', proxy: false });
    assert.equal(me.admin, false);
    assert.equal(me.teams, undefined);
    assert.equal(b.post({ action: 'me', idToken: 'tok-new' }).team.no, '03');     // 주소가 바뀌어도 식별자가 같다
    assert.equal(b.post({ action: 'me', idToken: 'tok-alt' }).team.no, '03');     // 이메일만 (대소문자 무시)
    assert.equal(b.post({ action: 'me', idToken: 'tok-b1' }).team.track, '해커톤');
  });

  test('명단에 없는 계정 · 불참자는 NOT_MEMBER — 자기 주소만 돌려받는다', () => {
    const b = backend();
    const r = b.post({ action: 'me', idToken: 'tok-none' });
    assert.equal(r.error, 'NOT_MEMBER');
    assert.equal(r.email, 'none@x.com');
    assert.equal(r.state, undefined);
    assert.equal(b.post({ action: 'me', idToken: 'tok-out' }).error, 'NOT_MEMBER');
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-none', data: { title: 'x' } }).error, 'NOT_MEMBER');
  });

  test('토큰 확인은 캐시에 두어 구글에 한 번만 묻는다', () => {
    const b = backend();
    b.post({ action: 'me', idToken: 'tok-a1' });
    b.post({ action: 'me', idToken: 'tok-a1' });
    assert.equal(b.fetched.filter((u) => u.includes('tokeninfo')).length, 1);
  });

  test('로그인 유지: 구글 토큰이 끝난 뒤에도 세션 값으로 이어 쓴다', () => {
    const short = token('a1@x.com', '101', { exp: String(Date.parse('2026-11-14T09:00:00+09:00') / 1000) });
    const b = backend({ tokens: { ...TOKENS, 'tok-short': short } });
    const me = b.post({ action: 'me', idToken: 'tok-short' });
    assert.match(me.sid, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(me.sidLeft, 21600);
    b.advance(3600 + 60);                                    // 09:01 — 구글 토큰은 끝났다
    assert.equal(b.post({ action: 'me', idToken: 'tok-short' }).error, 'AUTH_FAILED');
    const again = b.post({ action: 'me', sid: me.sid });
    assert.equal(again.ok, true);
    assert.equal(again.team.no, '03');
    assert.equal(again.email, 'a1@x.com');
    assert.equal(again.sid, me.sid);
    assert.equal(b.post({ action: 'info.save', sid: me.sid, data: { title: '세션으로 저장' } }).ok, true);
    const up = upload(b, { idToken: undefined, sid: me.sid });
    assert.equal(up.fin.ok, true, JSON.stringify(up.fin));
    assert.equal(b.rows('기록').at(-1)['누가'], 'a1@x.com');
    // 세션 값 자체는 캐시에도 시트에도 남지 않는다 (해시만)
    const dump = JSON.stringify([...b.cache.entries()]) + JSON.stringify(b.ss.getSheets().map((sh) => sh.cells));
    assert.ok(!dump.includes(me.sid));
    assert.equal([...b.cache.keys()].filter((k) => k.startsWith('ss1:')).length, 1);
  });

  test('로그인 유지: 6시간 쓰지 않으면 끝나고, 쓰는 동안에는 늘어나되 18시간을 넘지 못한다', () => {
    const b = backend({ now: '2026-11-13T19:00:00+09:00' });
    const me = b.post({ action: 'me', idToken: 'tok-a1' });
    b.advance(5 * 3600);                                     // 00:00
    const k1 = b.post({ action: 'session.keep', sid: me.sid });
    assert.equal(k1.ok, true);
    assert.equal(k1.sidLeft, 21600);
    b.advance(5 * 3600);                                     // 05:00
    assert.equal(b.post({ action: 'me', sid: me.sid }).sidLeft, 21600);
    b.advance(5 * 3600);                                     // 10:00 — 로그인한 지 15시간
    assert.equal(b.post({ action: 'session.keep', sid: me.sid }).sidLeft, 3 * 3600);
    b.advance(3 * 3600 - 30);
    assert.equal(b.post({ action: 'session.keep', sid: me.sid }).sidLeft, 30);
    b.advance(31);
    assert.equal(b.post({ action: 'me', sid: me.sid }).error, 'AUTH_FAILED');
    assert.equal(b.post({ action: 'session.keep', sid: me.sid }).error, 'AUTH_FAILED');

    const idle = backend({ now: '2026-11-13T19:00:00+09:00' });
    const me2 = idle.post({ action: 'me', idToken: 'tok-b1' });
    idle.advance(6 * 3600 - 5);
    assert.equal(idle.post({ action: 'upload.status', sid: me2.sid, id: 1 }).error, 'SESSION_LOST');   // 아직 살아 있다 (올리던 것이 없을 뿐)
    idle.advance(10);
    assert.equal(idle.post({ action: 'me', sid: me2.sid }).error, 'AUTH_FAILED');
  });

  test('세션 값은 "누구인가"만 대신한다 — 명단에서 빠지면 그때부터 못 쓴다', () => {
    const b = backend();
    const me = b.post({ action: 'me', idToken: 'tok-a2' });
    assert.equal(b.post({ action: 'me', sid: me.sid }).team.no, '03');
    b.roster([['03', '가나다', 'a1@x.com', '101', '조장', ''], ['03', '라마바', 'a2@x.com', '102', '', '불참']]);
    assert.equal(b.post({ action: 'me', sid: me.sid }).error, 'NOT_MEMBER');
    assert.equal(b.post({ action: 'info.save', sid: me.sid, data: { title: 'x' } }).error, 'NOT_MEMBER');
    assert.equal(b.post({ action: 'upload.start', sid: me.sid, kind: 'deck', name: 'a.pdf', size: 10 }).error, 'NOT_MEMBER');
  });

  test('세션 값: 명단에 없는 계정에는 주지 않고, 틀린 값 · 로그아웃한 값은 통하지 않는다', () => {
    const b = backend();
    assert.equal(b.post({ action: 'me', idToken: 'tok-none' }).sid, undefined);
    assert.equal(b.post({ action: 'me', idToken: 'tok-out' }).sid, undefined);
    assert.equal([...b.cache.keys()].filter((k) => k.startsWith('ss1:')).length, 0);
    for (const sid of [undefined, '', 'x', 'a'.repeat(43), 'a'.repeat(200), { a: 1 }, 12345, ['a']]) {
      assert.equal(b.post({ action: 'me', sid }).error, 'AUTH_FAILED', String(sid));
      assert.equal(b.post({ action: 'session.keep', sid }).error, 'AUTH_FAILED', String(sid));
    }
    const me = b.post({ action: 'me', idToken: 'tok-a1' });
    assert.equal(b.post({ action: 'signout', sid: me.sid }).ok, true);
    assert.equal(b.post({ action: 'me', sid: me.sid }).error, 'AUTH_FAILED');
    assert.equal(b.post({ action: 'signout', sid: 'nope' }).ok, true);

    // 참가자의 세션으로 as 를 보내도 남의 팀이 되지 않고, 운영진의 세션은 대리할 수 있다
    const me2 = b.post({ action: 'me', idToken: 'tok-a1' });
    assert.equal(b.post({ action: 'me', sid: me2.sid, as: '12' }).team.no, '03');
    const op = b.post({ action: 'me', idToken: 'tok-op' });
    assert.match(op.sid, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(b.post({ action: 'me', sid: op.sid, as: '12' }).team, { no: '12', track: '해커톤', name: '운영진', proxy: true });
    // 세션 값과 구글 토큰이 같이 오면 세션 값이 가리키는 사람이다 (둘을 섞어 남이 되지 못한다)
    assert.equal(b.post({ action: 'me', sid: me2.sid, idToken: 'tok-b1' }).team.no, '03');
  });

  test('세션은 계정마다 한 시간에 20번까지만 새로 만든다', () => {
    const b = backend();
    let got = 0;
    for (let i = 0; i < 25; i++) if (b.post({ action: 'me', idToken: 'tok-a1' }).sid) got++;
    assert.equal(got, 20);
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).ok, true);          // 세션이 없어도 구글 토큰으로는 계속 된다
    assert.ok(b.post({ action: 'me', idToken: 'tok-a2' }).sid);                  // 다른 계정에는 영향이 없다
  });

  test('지메일 주소는 점과 +꼬리표가 달라도 같은 계정으로 본다 (다른 메일은 그대로 견준다)', () => {
    const b = backend({ tokens: {
      ...TOKENS,
      'tok-g1': token('johndoe@gmail.com', '701'), 'tok-g2': token('Jane.Roe@googlemail.com', '702'),
      'tok-n1': token('ab@naver.com', '703'), 'tok-g3': token('other@gmail.com', '704'),
    } });
    b.roster([
      ['03', '존', 'John.Doe+hack@Gmail.com', '', '', ''],
      ['12', '제인', 'janeroe@gmail.com', '', '', ''],
      ['05', '네이버', 'a.b@naver.com', '', '', ''],
    ]);
    assert.equal(b.post({ action: 'me', idToken: 'tok-g1' }).team.no, '03');
    assert.equal(b.post({ action: 'me', idToken: 'tok-g2' }).team.no, '12');
    assert.equal(b.post({ action: 'me', idToken: 'tok-n1' }).error, 'NOT_MEMBER');     // 네이버는 점이 다르면 다른 주소다
    assert.equal(b.post({ action: 'me', idToken: 'tok-g3' }).error, 'NOT_MEMBER');
  });

  test('구글에 로그인 토큰을 물어보는 횟수에는 한도가 있다 — 걸려도 이미 로그인한 사람은 영향이 없다', () => {
    const b = backend();
    b.ctx.VERIFY_PER_HOUR = 3;
    const me = b.post({ action: 'me', idToken: 'tok-a1' });                            // 1번
    assert.equal(b.post({ action: 'me', idToken: 'junk-1' }).error, 'AUTH_FAILED');    // 2번
    assert.equal(b.post({ action: 'me', idToken: 'junk-2' }).error, 'AUTH_FAILED');    // 3번
    assert.equal(b.post({ action: 'me', idToken: 'junk-3' }).error, 'AUTH_BUSY');      // 한도
    assert.equal(b.post({ action: 'me', idToken: 'tok-b1' }).error, 'AUTH_BUSY');      // 새로 로그인하는 사람은 잠깐 기다려야 한다
    const before = b.fetched.length;
    assert.equal(b.post({ action: 'me', sid: me.sid }).ok, true);                      // 세션으로는 그대로 된다
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).ok, true);                // 방금 확인한 토큰도 다시 묻지 않는다
    assert.equal(b.post({ action: 'info.save', sid: me.sid, data: { title: 'ok' } }).ok, true);
    assert.equal(b.fetched.length, before);
    b.advance(3600);                                                                   // 다음 시간
    assert.equal(b.post({ action: 'me', idToken: 'tok-b1' }).ok, true);
  });

  test('구글에 닿지 못해도 로그아웃시키지 않고, 토큰이 기록이나 응답에 남지 않는다', () => {
    const b = backend();
    const real = b.ctx.UrlFetchApp.fetch;
    b.ctx.UrlFetchApp.fetch = (url, opt) => {
      if (String(url).includes('tokeninfo')) throw new Error('Address unavailable: ' + url);
      return real(url, opt);
    };
    const r = b.post({ action: 'me', idToken: 'SECRET-TOKEN-VALUE' });
    assert.equal(r.error, 'AUTH_BUSY');                                                // AUTH_FAILED 가 아니다 → 화면이 로그인을 버리지 않는다
    assert.ok(!(JSON.stringify(r) + b.logs.join('\n')).includes('SECRET-TOKEN-VALUE'));
  });

  test('서버 오류의 문구에서 주소는 가린다 (올리기 주소 · 토큰이 섞여 있을 수 있다)', () => {
    const b = backend();
    b.post({ action: 'me', idToken: 'tok-a1' });
    b.ctx.UrlFetchApp.fetch = (url) => { throw new Error('Request failed for https://www.googleapis.com/upload/drive/v3/files?upload_id=SECRET-UPLOAD returned code 500'); };
    const r = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 10 });
    assert.equal(r.error, 'SERVER_ERROR');
    assert.match(r.message, /Request failed for \(주소\) returned code 500/);
    assert.ok(!(JSON.stringify(r) + b.logs.join('\n')).includes('SECRET-UPLOAD'));
    assert.equal(b.isLocked(), false);
  });

  test('참가자가 as 를 보내도 남의 팀이 되지 않는다', () => {
    const b = backend();
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1', as: '12' }).team.no, '03');
    b.post({ action: 'info.save', idToken: 'tok-a1', as: '12', data: { title: '침입' } });
    assert.deepEqual(b.rows('팀').map((r) => r['팀']), ['03']);
  });

  test('운영진은 팀을 골라 대신 일할 수 있다', () => {
    const b = backend();
    const me = b.post({ action: 'me', idToken: 'tok-op' });
    assert.equal(me.admin, true);
    assert.equal(me.team, null);
    assert.equal(me.teams.length, 21);                      // 01~20 + 연습용 00
    const as = b.post({ action: 'me', idToken: 'tok-op', as: '12' });
    assert.deepEqual(as.team, { no: '12', track: '해커톤', name: '운영진', proxy: true });
    assert.equal(b.post({ action: 'me', idToken: 'tok-op', as: '77' }).error, 'BAD_TEAM');
  });
});

describe('정보 저장', () => {
  test('보낸 항목만 바뀌고, 시트와 상태에 반영된다', () => {
    const b = backend();
    const r = b.post({ action: 'info.save', idToken: 'tok-a1', nonce: 'n1', data: { title: '  우리 서비스 ', desc: '한 줄\r\n설명', url: 'myapp.vercel.app/x' } });
    assert.equal(r.ok, true);
    assert.equal(r.state.title, '우리 서비스');
    assert.equal(r.state.desc, '한 줄\n설명');
    assert.equal(r.state.url, 'https://myapp.vercel.app/x');
    b.post({ action: 'info.save', idToken: 'tok-a2', data: { video: 'https://youtu.be/abc' } });
    const row = b.rows('팀')[0];
    assert.equal(row['프로젝트'], '우리 서비스');
    assert.equal(row['배포 주소'], 'https://myapp.vercel.app/x');
    assert.equal(row['데모 영상'], 'https://youtu.be/abc');
    assert.equal(row['제출자'], 'a2@x.com');
    assert.equal(row['트랙'], '구현과제');
    assert.equal(b.rows('팀').length, 1);
    assert.equal(b.post({ action: 'me', idToken: 'tok-a2' }).state.by, '라마바');     // 팀원에게는 이름으로
  });

  test('주소는 http · https 만', () => {
    const b = backend();
    const ok = (url, want) => {
      const r = b.post({ action: 'info.save', idToken: 'tok-a1', data: { url } });
      assert.equal(r.ok, true, url);
      assert.equal(r.state.url, want);
    };
    ok('http://1.2.3.4:8080/app', 'http://1.2.3.4:8080/app');
    ok('13.125.1.2:8080', 'http://13.125.1.2:8080');
    ok('localhost:3000/x', 'https://localhost:3000/x');
    ok('HTTPS://Example.com/a?b=c#d', 'HTTPS://Example.com/a?b=c#d');
    ok('', '');
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pw@evil.com', 'https://a b.com', 'https://', 'ftp://x.com', 'https://x.com/<script>', 'x'.repeat(600)]) {
      const r = b.post({ action: 'info.save', idToken: 'tok-a1', data: { url } });
      assert.equal(r.error, 'INVALID', url);
      assert.deepEqual(r.fields, ['url']);
    }
  });

  test('수식은 절대 시트에 들어가지 않는다', () => {
    const b = backend();
    b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: "=IMPORTRANGE(\"x\",\"팀원!A:D\")", desc: '=1+1' } });
    const row = b.rows('팀')[0];
    assert.equal(row['프로젝트'], 'IMPORTRANGE("x","팀원!A:D")');
    assert.equal(row['설명'], '1+1');
  });

  test('길이를 자르고 제어 문자를 지운다', () => {
    const b = backend();
    const r = b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'A'.repeat(100) + '\u0007', desc: 'x'.repeat(999) } });
    assert.equal(r.state.title.length, 60);
    assert.equal(r.state.desc.length, 300);
  });

  test('끊겨서 다시 보낸 요청은 한 번만 처리한다', () => {
    const b = backend();
    b.post({ action: 'info.save', idToken: 'tok-a1', nonce: 'same', data: { title: '처음' } });
    const again = b.post({ action: 'info.save', idToken: 'tok-a1', nonce: 'same', data: { title: '처음' } });
    assert.equal(again.replay, true);
    assert.equal(b.rows('기록').filter((r) => r['동작'] === 'info.save').length, 1);
  });
});

describe('파일 올리기', () => {
  test('직접 올리기: 이어 올리기 주소 → 마무리 → 규칙대로 이름이 바뀌고 색인에 남는다', () => {
    const b = backend();
    const { start, fin, bytes } = upload(b);
    assert.equal(start.direct, true);
    assert.equal(start.chunk % (256 * 1024), 0);
    assert.equal([...b.drive.sessions.values()][0].origin, 'https://2026endpoint.github.io');
    assert.equal(fin.ok, true, JSON.stringify(fin));
    const deck = fin.state.deck;
    assert.match(deck.name, /^team03_발표_v1_1114-0800\.pdf$/);
    assert.equal(deck.size, 1000);
    assert.equal(deck.md5, md5(bytes));
    assert.equal(deck.by, '가나다');
    assert.equal(deck.driveUrl, undefined);                 // 참가자에게 Drive 주소는 주지 않는다
    assert.equal(JSON.stringify(fin).includes('drive.google.com'), false);

    const row = b.rows('파일')[0];
    assert.equal(row['상태'], '현재');
    assert.equal(row['버전'], 1);
    assert.equal(row['경로'], '/team03/');
    assert.equal(row['원래 이름'], '발표.pdf');
    assert.equal(row['올린 사람'], 'a1@x.com');
    assert.match(row['링크'], /^https:\/\/drive\.google\.com\/file\/d\//);
    assert.deepEqual(b.drive.inFolder(b.store.F_03), [deck.name]);
    const team = b.rows('팀')[0];
    assert.equal(team['발표 자료'], deck.name);
    assert.equal(team['폴더'], 'team03');
  });

  test('다시 올리면 먼젓번 파일은 옛날 자료로 옮기고, 색인의 상태와 경로가 바뀐다', () => {
    const b = backend();
    const first = upload(b).fin.state.deck;
    b.advance(600);
    const second = upload(b, { idToken: 'tok-a2', name: '최종.PPTX', bytes: bytesOf(2000, 3) }).fin.state;
    assert.match(second.deck.name, /^team03_발표_v2_1114-0810\.pptx$/);
    assert.equal(second.deck.by, '라마바');
    assert.deepEqual(second.history.map((h) => h.name), [first.name]);
    assert.deepEqual(b.drive.inFolder(b.store.F_03), [second.deck.name]);
    assert.deepEqual(b.drive.inFolder(b.store.O_03), [first.name]);
    const rows = b.rows('파일');
    assert.deepEqual(rows.map((r) => [r['버전'], r['상태'], r['경로']]), [[1, '이전', '/team03/옛날 자료/'], [2, '현재', '/team03/']]);
  });

  test('발표 자료와 프로그램은 따로 센다', () => {
    const b = backend();
    upload(b);
    const prog = upload(b, { kind: 'program', name: 'app.zip', bytes: bytesOf(500) }).fin.state;
    assert.match(prog.program.name, /^team03_프로그램_v1_/);
    assert.ok(prog.deck);
    assert.equal(prog.history.length, 0);
    assert.equal(b.rows('팀')[0]['프로그램'], prog.program.name);
  });

  test('완료 = 프로젝트 이름 + 발표 자료 + (배포 주소 또는 프로그램)', () => {
    const b = backend();
    assert.equal(upload(b).fin.state.complete, false);
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: '이름' } }).state.complete, false);
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { url: 'https://x.com' } }).state.complete, true);
    assert.equal(b.rows('팀')[0]['완료'], 'O');
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { url: '' } }).state.complete, false);
    assert.equal(b.rows('팀')[0]['완료'], '');
    assert.equal(upload(b, { kind: 'program', name: 'a.zip' }).fin.state.complete, true);
  });

  test('중계 올리기: 조각을 스크립트가 받아 Drive 로 넘긴다', () => {
    const b = backend();
    const bytes = bytesOf(300 * 1024, 9);
    const start = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'game.zip', size: bytes.length, origin: 'https://evil.example' });
    assert.equal(start.direct, false);                      // 허용하지 않은 출처에는 CORS 를 열지 않는다
    assert.equal([...b.drive.sessions.values()][0].origin, '');
    const half = 256 * 1024;
    const p1 = b.post({ action: 'upload.put', idToken: 'tok-a1', id: start.id, offset: 0, data: bytes.subarray(0, half).toString('base64') });
    assert.deepEqual(p1, { ok: true, done: false, next: half });
    assert.deepEqual(b.post({ action: 'upload.status', idToken: 'tok-a1', id: start.id }), { ok: true, done: false, next: half });
    const p2 = b.post({ action: 'upload.put', idToken: 'tok-a2', id: start.id, offset: half, data: bytes.subarray(half).toString('base64') });
    assert.deepEqual(p2, { ok: true, done: true, next: bytes.length });
    const fin = b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id });
    assert.equal(fin.state.program.md5, md5(bytes));
  });

  test('다 올라오지 않은 것은 마무리할 수 없다', () => {
    const b = backend();
    const bytes = bytesOf(1000);
    const start = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: bytes.length });
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).error, 'NOT_UPLOADED');
    b.putDirect(start.url, bytes, { to: 400 });
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).error, 'NOT_UPLOADED');
    assert.equal(b.post({ action: 'upload.status', idToken: 'tok-a1', id: start.id }).next, 400);
    b.putDirect(start.url, bytes, { from: 400 });
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).ok, true);
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).already, true);   // 두 번 눌러도 같다
    assert.equal(b.rows('파일').length, 1);
  });

  test('종류 · 형식 · 크기를 검사한다', () => {
    const b = backend();
    const start = (o) => b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 10, ...o });
    assert.equal(start({ kind: 'virus' }).error, 'BAD_KIND');
    assert.equal(start({ name: 'a.exe' }).error, 'BAD_TYPE');
    assert.equal(start({ name: 'noext' }).error, 'BAD_TYPE');
    assert.equal(start({ name: 'a.pdf.sh' }).error, 'BAD_TYPE');
    assert.equal(start({ size: 0 }).error, 'BAD_SIZE');
    assert.equal(start({ size: 1.5 }).error, 'BAD_SIZE');
    assert.equal(start({ size: 'big' }).error, 'BAD_SIZE');
    assert.equal(start({ size: 301 * 1024 * 1024 }).error, 'TOO_LARGE');
    assert.equal(start({ kind: 'program', name: 'a.exe', size: 900 * 1024 * 1024 }).ok, true);
    assert.equal(b.rows('파일').length, 1);
  });

  test('파일 이름에 참가자가 적은 글자는 들어가지 않는다', () => {
    const b = backend();
    const { fin } = upload(b, { name: '../../etc/=cmd|x team12_발표.pdf' });
    assert.match(fin.state.deck.name, /^team03_발표_v1_\d{4}-\d{4}\.pdf$/);
    assert.equal(b.rows('파일')[0]['원래 이름'], 'cmd|x team12_발표.pdf');
  });

  test('선언한 크기와 다르게 올리면 Drive 가 거부한다', () => {
    const b = backend();
    const start = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 100 });
    const res = b.drive.handle('put', start.url, { headers: { 'Content-Range': 'bytes 0-499/500' }, payload: [...bytesOf(500)] });
    assert.equal(res.code, 400);
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).error, 'NOT_UPLOADED');
  });

  test('그만두면 색인은 취소로, Drive 에 올라온 것은 휴지통으로', () => {
    const b = backend();
    const bytes = bytesOf(100);
    const start = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: bytes.length });
    b.putDirect(start.url, bytes);
    assert.deepEqual(b.post({ action: 'upload.cancel', idToken: 'tok-a2', id: start.id }), { ok: true });
    assert.equal(b.rows('파일')[0]['상태'], '취소');
    assert.deepEqual(b.drive.inFolder(b.store.F_03), []);
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: start.id }).error, 'BAD_STATE');
  });

  test('내리기: 지금 파일을 옛날 자료로 옮긴다', () => {
    const b = backend();
    const name = upload(b, { kind: 'program', name: 'a.zip' }).fin.state.program.name;
    const r = b.post({ action: 'file.withdraw', idToken: 'tok-a1', kind: 'program' });
    assert.equal(r.state.program, null);
    assert.deepEqual(r.state.history.map((h) => h.name), [name]);
    assert.deepEqual(b.drive.inFolder(b.store.O_03), [name]);
    assert.equal(b.rows('팀')[0]['프로그램'], '');
    assert.equal(b.post({ action: 'file.withdraw', idToken: 'tok-a1', kind: 'program' }).ok, true);   // 없어도 오류가 아니다
  });

  test('같은 nonce 로 다시 시작하면 같은 표를 돌려준다', () => {
    const b = backend();
    const s1 = b.post({ action: 'upload.start', idToken: 'tok-a1', nonce: 'u1', kind: 'deck', name: 'a.pdf', size: 10 });
    const s2 = b.post({ action: 'upload.start', idToken: 'tok-a1', nonce: 'u1', kind: 'deck', name: 'a.pdf', size: 10 });
    assert.equal(s2.id, s1.id);
    assert.equal(s2.url, s1.url);
    assert.equal(b.rows('파일').length, 1);
  });

  test('너무 자주 시작하면 막는다', () => {
    const b = backend();
    let last;
    for (let i = 0; i < 41; i++) last = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 10 });
    assert.equal(last.error, 'TOO_MANY');
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-b1', kind: 'deck', name: 'a.pdf', size: 10 }).ok, true);   // 다른 팀은 영향 없음
  });

  test('한 팀이 쌓아 둘 수 있는 전체 용량에 한도가 있다 (옛날 자료 포함, 운영진 대리는 예외)', () => {
    const b = backend();
    b.prop('TEAM_MAX_GB', 2500 / 2 ** 30);                           // 2500바이트
    assert.equal(upload(b, { bytes: bytesOf(1000, 1) }).fin.ok, true);
    assert.equal(upload(b, { bytes: bytesOf(1000, 2) }).fin.ok, true);          // 먼젓번 것은 옛날 자료로 — 합쳐서 2000
    const over = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'a.zip', size: 600 });
    assert.equal(over.error, 'TEAM_FULL');
    assert.deepEqual([over.used, over.max], [2000, 2500]);
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'a.zip', size: 500 }).ok, true);   // 딱 맞으면 된다
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-b1', kind: 'deck', name: 'a.pdf', size: 2000 }).ok, true);     // 다른 팀은 따로 센다
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-op', as: '03', kind: 'program', name: 'a.zip', size: 9000 }).ok, true);   // 운영진 대리
    b.prop('TEAM_MAX_GB', 0);                                         // 0 이면 제한하지 않는다
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'b.zip', size: 9000 }).ok, true);
  });

  test('Drive API 가 꺼져 있으면 무엇을 해야 하는지 알려 준다', () => {
    const b = backend();
    b.drive.apiOff = true;
    const r = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 10 });
    assert.equal(r.error, 'DRIVE_API_OFF');
    assert.match(r.message, /Drive API/);
    assert.equal(b.isLocked(), false);
  });
});

describe('다른 팀 것은 보지도 건드리지도 못한다', () => {
  test('상태 · 올리기 · 내려받기 모두 자기 팀으로만', () => {
    const b = backend();
    b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: '03팀 비밀 프로젝트', url: 'https://secret-03.example' } });
    const { fin } = upload(b);
    const pending = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'a.zip', size: 50 });

    const other = b.post({ action: 'me', idToken: 'tok-b1' });
    const text = JSON.stringify(other);
    assert.equal(other.team.no, '12');
    for (const leak of ['03팀 비밀', 'secret-03', 'team03', 'a1@x.com', '가나다']) assert.ok(!text.includes(leak), leak);

    const deckId = fin.state.deck.id;
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-b1', id: deckId }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-b1', id: pending.id }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'upload.cancel', idToken: 'tok-b1', id: pending.id }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'upload.put', idToken: 'tok-b1', id: pending.id, offset: 0, data: 'AAAA' }).error, 'FORBIDDEN');
    assert.equal(b.post({ action: 'upload.status', idToken: 'tok-b1', id: pending.id }).error, 'FORBIDDEN');
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-none', id: deckId }).error, 'NOT_MEMBER');
    assert.equal(b.post({ action: 'file.get', id: deckId }).error, 'AUTH_FAILED');
    assert.equal(b.rows('파일').find((r) => r['번호'] === pending.id)['상태'], '업로드 중');

    // 12팀이 자기 것을 올려도 03팀 폴더는 그대로
    upload(b, { idToken: 'tok-b1' });
    assert.equal(b.drive.inFolder(b.store.F_03).length, 1);
    assert.equal(b.drive.inFolder(b.store.F_12).length, 1);
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).state.deck.id, deckId);
  });

  test('열람 토큰 없이는 전체 현황을 받을 수 없다', () => {
    const b = backend();
    for (const key of [undefined, '', 'short', 'x'.repeat(40), 'tok-a1']) assert.equal(b.post({ action: 'view.list', key }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'view.list', idToken: 'tok-a1' }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'view.list', idToken: 'tok-op' }).error, 'KEY_INVALID');
  });
});

describe('마감', () => {
  test('마감 뒤에는 새로 올리거나 고칠 수 없고, 올리던 것만 유예 안에 마무리된다', () => {
    const b = backend({ now: '2026-11-14T09:59:00+09:00' });
    const bytes = bytesOf(100);
    const s1 = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: bytes.length });
    const s2 = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'program', name: 'a.zip', size: bytes.length });
    b.at('2026-11-14T10:02:00+09:00');
    assert.equal(b.get().phase, 'grace');
    assert.equal(b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'b.pdf', size: 10 }).error, 'CLOSED');
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: '늦음' } }).error, 'CLOSED');
    assert.equal(b.post({ action: 'file.withdraw', idToken: 'tok-a1', kind: 'deck' }).error, 'CLOSED');
    b.putDirect(s1.url, bytes);
    const fin = b.post({ action: 'upload.finish', idToken: 'tok-a1', id: s1.id });
    assert.equal(fin.ok, true);
    assert.match(b.rows('기록').at(-1)['메모'], /마감 직후 도착/);

    b.at('2026-11-14T10:05:01+09:00');
    assert.equal(b.get().phase, 'closed');
    b.putDirect(s2.url, bytes);
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: s2.id }).error, 'LATE');
    assert.equal(b.post({ action: 'upload.put', idToken: 'tok-a1', id: s2.id, offset: 0, data: 'AAAA' }).error, 'LATE');
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).phase, 'closed');          // 보기는 된다
    assert.ok(b.post({ action: 'me', idToken: 'tok-a1' }).state.deck);
  });

  test('운영진 대리는 마감 뒤에도 올릴 수 있고, 기록에 남는다', () => {
    const b = backend({ now: '2026-11-14T11:00:00+09:00' });
    const { fin } = upload(b, { idToken: 'tok-op', as: '03' });
    assert.equal(fin.ok, true);
    assert.equal(fin.state.deck.by, '운영진');
    assert.equal(b.rows('파일')[0]['올린 사람'], 'op@x.com (운영진 대리)');
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-op', as: '03', data: { title: '대신 적음' } }).ok, true);
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-op', data: { title: 'x' } }).error, 'NOT_MEMBER');    // 팀을 고르지 않으면 쓸 곳이 없다
  });

  test('마감은 스크립트 속성으로 재배포 없이 바꿀 수 있다 (늦어도 1분 뒤에 반영)', () => {
    const b = backend({ now: '2026-11-14T10:30:00+09:00' });
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'x' } }).error, 'CLOSED');
    b.prop('DEADLINE', '2026-11-14T11:00:00+09:00', false);            // 편집기에서 속성을 고쳤다
    b.advance(61);
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'x' } }).ok, true);
    assert.equal(b.get().deadline, Date.parse('2026-11-14T11:00:00+09:00'));
    b.prop('DEADLINE', '2026-11-14T10:00:00+09:00', false);
    b.run('cacheClear');                                               // 메뉴의 '현황 새로 읽기' 는 바로 반영한다
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'y' } }).error, 'CLOSED');
  });

  test('스크립트 속성은 요청마다 읽지 않는다 (하루 읽기 한도를 아낀다)', () => {
    const b = backend();
    const me = b.post({ action: 'me', idToken: 'tok-a1' });
    const judge = b.viewer('심사');
    upload(b);                                                         // 폴더를 만드느라 속성을 쓰고 다시 읽는다
    const before = b.counts.props;
    for (let i = 0; i < 40; i++) {
      assert.equal(b.post({ action: 'me', sid: me.sid }).ok, true);
      assert.equal(b.post({ action: 'view.list', key: judge }).ok, true);
      b.get();
    }
    assert.equal(b.counts.props, before);                             // 120번 불러도 한 번도 읽지 않았다
    b.advance(61);
    b.post({ action: 'me', sid: me.sid });
    assert.equal(b.counts.props, before + 1);                         // 1분이 지나면 한 번
  });

  test('여는 시각 전에는 받지 않는다', () => {
    const b = backend({ now: '2026-11-13T18:00:00+09:00', props: { ADMINS: 'op@x.com', OPEN_AT: '2026-11-13T19:00:00+09:00' } });
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'x' } }).error, 'NOT_OPEN_YET');
    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).phase, 'before');
  });

  test('늦게 도착한 파일은 운영진이 골라서 제출로 인정할 수 있다', () => {
    const b = backend({ now: '2026-11-14T09:59:00+09:00' });
    const bytes = bytesOf(100);
    const s = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: bytes.length });
    b.at('2026-11-14T10:20:00+09:00');
    b.putDirect(s.url, bytes);
    assert.equal(b.post({ action: 'upload.finish', idToken: 'tok-a1', id: s.id }).error, 'LATE');
    const said = [];
    b.setUi({ ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'ok' }, alert: (...a) => { said.push(a.join(' ')); return 'ok'; } });
    b.select('파일', 2);
    b.run('acceptSelected');
    assert.match(said.at(-1), /인정했습니다/);
    const deck = b.post({ action: 'me', idToken: 'tok-a1' }).state.deck;
    assert.match(deck.name, /^team03_발표_v1_1114-1020\.pdf$/);
    assert.equal(b.rows('파일')[0]['상태'], '현재');
  });
});

describe('내려받기', () => {
  test('조각을 이으면 원래 파일과 같다', () => {
    const b = backend();
    const { fin, bytes } = upload(b, { bytes: bytesOf(10000, 5) });
    const id = fin.state.deck.id;
    const parts = [];
    for (let off = 0; off < bytes.length; off += 4096) {
      const r = b.post({ action: 'file.get', idToken: 'tok-a2', id, offset: off, length: 4096 });
      assert.equal(r.ok, true);
      assert.equal(r.size, bytes.length);
      assert.equal(r.mime, 'application/pdf');
      parts.push(Buffer.from(r.data, 'base64'));
    }
    assert.equal(md5(Buffer.concat(parts)), md5(bytes));
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-a1', id, offset: 10000 }).error, 'BAD_RANGE');
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-a1', id, offset: -1 }).error, 'BAD_RANGE');
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-a1', id: 999 }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'file.get', idToken: 'tok-a1', id: 'x' }).error, 'NOT_FOUND');
  });

  test('옛날 자료도 받을 수 있다', () => {
    const b = backend();
    const old = upload(b, { bytes: bytesOf(300, 1) });
    upload(b, { bytes: bytesOf(400, 2) });
    const r = b.post({ action: 'file.get', idToken: 'tok-a1', id: old.fin.state.deck.id });
    assert.equal(md5(Buffer.from(r.data, 'base64')), md5(old.bytes));
  });
});

describe('심사위원 · 운영진 현황판', () => {
  function filled() {
    const b = backend();
    b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: '삼팀 서비스', desc: '설명', url: 'https://three.example' } });
    upload(b);
    upload(b, { bytes: bytesOf(50, 2) });
    b.post({ action: 'info.save', idToken: 'tok-b1', data: { title: '십이팀' } });
    upload(b, { idToken: 'tok-op', as: '00', name: 'test.pdf' });
    return b;
  }

  test('심사위원: 전체 팀을 보되 Drive 주소 · 이메일 · 연습용 팀은 없다', () => {
    const b = filled();
    const key = b.viewer('홍길동 교수님');
    const r = b.post({ action: 'view.list', key });
    assert.equal(r.ok, true);
    assert.equal(r.role, '심사위원');
    assert.equal(r.name, '홍길동 교수님');
    assert.deepEqual(r.tracks.map((t) => [t.name, t.teams.length]), [['해커톤', 10], ['구현과제', 10]]);
    assert.deepEqual(r.summary, { teams: 20, complete: 1, deck: 1, product: 1, title: 2 });
    const t3 = r.tracks.find((t) => t.name === '구현과제').teams.find((t) => t.no === '03');
    assert.equal(t3.title, '삼팀 서비스');
    assert.equal(t3.complete, true);
    assert.equal(t3.repo, 'https://github.com/2026ENDPoinT/team03');
    assert.equal(t3.history.length, 1);
    const text = JSON.stringify(r);
    for (const leak of ['drive.google.com', '@x.com', 'folderUrl', 'driveUrl', 'test.pdf', '"00"']) assert.ok(!text.includes(leak), leak);

    const got = b.post({ action: 'file.get', key, id: t3.deck.id });
    assert.equal(got.ok, true);
    assert.equal(got.length, 50);
  });

  test('운영진 토큰: Drive 주소와 연습용 팀까지', () => {
    const b = filled();
    const key = b.viewer('박운영', '운영진');
    const r = b.post({ action: 'view.list', key });
    const t3 = r.tracks.find((t) => t.name === '구현과제').teams.find((t) => t.no === '03');
    assert.match(t3.deck.driveUrl, /^https:\/\/drive\.google\.com\/file\/d\//);
    assert.match(t3.folderUrl, /^https:\/\/drive\.google\.com\/drive\/folders\//);
    assert.equal(t3.deck.by, 'a1@x.com');
    assert.deepEqual(r.tracks.at(-1).teams.map((t) => t.no), ['00']);
    assert.equal(r.tracks.at(-1).name, '연습');
    assert.equal(r.summary.teams, 20);                      // 연습용 팀은 세지 않는다
  });

  test('만료됐거나 꺼 둔 토큰은 통하지 않는다', () => {
    const b = filled();
    const expired = b.viewer('지난 사람', '심사위원', { until: '2026-11-14 07:00:00' });
    const off = b.viewer('꺼 둔 사람', '심사위원', { on: '' });
    const ok = b.viewer('유효', '심사위원', { until: '2026-11-14 23:00:00' });
    assert.equal(b.post({ action: 'view.list', key: expired }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'view.list', key: off }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'view.list', key: ok }).ok, true);
    assert.equal(b.post({ action: 'file.get', key: expired, id: 1 }).error, 'KEY_INVALID');
    // 시트에서 '사용' 을 지우면 1분 안에 막힌다
    b.tab('열람').cells.forEach((row) => { if (row[0] === '유효') row[5] = ''; });
    b.advance(61);
    assert.equal(b.post({ action: 'view.list', key: ok }).error, 'KEY_INVALID');
  });

  test('발표 순서를 적어 두면 그 순서로', () => {
    const b = filled();
    const head = b.tab('팀').cells[0];
    b.tab('팀').cells.forEach((row, i) => { if (i && row[0] === '03') row[head.indexOf('순서')] = 1; });
    b.run('cacheClear');
    const key = b.viewer('심사');
    const teams = b.post({ action: 'view.list', key }).tracks.find((t) => t.name === '구현과제').teams.map((t) => t.no);
    assert.equal(teams[0], '03');
    assert.equal(teams[1], '01');
  });

  test('마지막 접속 시각을 남긴다 (10분에 한 번)', () => {
    const b = filled();
    const key = b.viewer('심사');
    b.post({ action: 'view.list', key });
    assert.equal(b.rows('열람')[0]['마지막 접속'], '2026-11-14 08:00:00');
    b.advance(120);
    b.post({ action: 'view.list', key });
    assert.equal(b.rows('열람')[0]['마지막 접속'], '2026-11-14 08:00:00');
  });

  test('여러 명이 계속 새로 고쳐도 시트는 다시 읽지 않는다', () => {
    const b = filled();
    const key = b.viewer('심사');
    b.post({ action: 'view.list', key });
    const before = ['팀', '파일'].map((n) => b.tab(n).reads);
    for (let i = 0; i < 30; i++) b.post({ action: 'view.list', key });
    for (let i = 0; i < 30; i++) b.post({ action: 'me', idToken: 'tok-a1' });
    assert.deepEqual(['팀', '파일'].map((n) => b.tab(n).reads), before);
    // 새 제출이 생기면 바로 보인다
    upload(b, { idToken: 'tok-b1' });
    assert.ok(b.post({ action: 'view.list', key }).tracks.find((t) => t.name === '해커톤').teams.find((t) => t.no === '12').deck);
  });
});

describe('운영진 메뉴', () => {
  test('처음 설정: 탭과 팀 폴더를 만든다', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.ss.insertSheet('시트1');
    b.run('setup');
    assert.deepEqual([...b.ss.sheets.keys()].sort(), ['기록', '열람', '투표', '팀', '팀원', '파일']);
    assert.match(b.store.VOTE_SALT, /^[A-Za-z0-9_-]{43}$/);           // 투표 검증용 비밀값을 미리 만든다
    const salt = b.store.VOTE_SALT;
    assert.equal(b.drive.childFolders(b.rootId, 'team01').length, 1);
    assert.equal(b.drive.childFolders(b.store.F_20, '옛날 자료').length, 1);
    assert.match(b.logs.at(-1), /준비됐습니다/);
    b.run('setup');                                          // 다시 실행해도 폴더가 늘지 않는다
    assert.equal(b.drive.folders.size, 2 + 21 * 2 + 1);       // 운영 · 제출 폴더 + 팀 폴더 · 옛날 자료 + 심사위원 폴더
    assert.equal(b.store.VOTE_SALT, salt);                    // 비밀값도 바뀌지 않는다
  });

  test('처음 설정: 두 실행이 겹쳐 생긴 같은 이름 폴더는, 쓰던 것만 남기고 빈 것은 휴지통으로', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.run('setup');
    const d = b.drive, keep00 = b.store.F_00, keep15 = b.store.F_15, keepOld06 = b.store.O_06;
    // 겹쳐 돈 실행이 만든 것: team00 · team15 하나씩 더, team06 안에 옛날 자료 하나 더
    const dup00 = d.addFolder('team00', b.rootId); d.addFolder('옛날 자료', dup00);
    const dup15 = d.addFolder('team15', b.rootId); d.addFolder('옛날 자료', dup15);
    const dupOld06 = d.addFolder('옛날 자료', keep15 && b.store.F_06);
    // 무언가 들어 있는 겹친 폴더는 건드리지 않는다
    const dup07 = d.addFolder('team07', b.rootId);
    d.files.set('fx', { id: 'fx', name: 'note.txt', parents: [dup07], mimeType: 'text/plain', bytes: Buffer.from('x'), trashed: false });
    b.run('doctor');
    assert.match(b.logs.at(-1), /같은 이름의 폴더가 겹쳐 있습니다: team06\/옛날 자료, team07, team15, team00/);

    b.run('setup');
    assert.match(b.logs.at(-1), /빈 폴더 3개를 휴지통으로 보냈습니다: team06\/옛날 자료, team15, team00/);
    assert.match(b.logs.at(-1), /안에 무언가 있어 그대로 두었습니다 \(확인해 주세요\): team07/);
    assert.deepEqual([d.folders.get(dup00).trashed, d.folders.get(dup15).trashed, d.folders.get(dupOld06).trashed, d.folders.get(dup07).trashed], [true, true, true, false]);
    assert.deepEqual([b.store.F_00, b.store.F_15, b.store.O_06], [keep00, keep15, keepOld06]);    // 쓰던 것은 그대로
    assert.equal(d.live(b.rootId, 'team00').length, 1);
    // 그 뒤 업로드도 쓰던 폴더로 간다
    b.roster([['00', '연습', 'op@x.com', '501', '', '']]);
  });

  test('처음 설정: 다른 실행이 돌고 있으면 기다리라고 하고 아무것도 만들지 않는다', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.hold(true);
    b.run('setup');
    assert.match(b.logs.at(-1), /다른 실행이 지금 처음 설정을 하고 있습니다/);
    assert.equal(b.drive.folders.size, 2);                     // 운영 · 제출 폴더만
    b.hold(false);
    b.run('setup');
    assert.equal(b.drive.folders.size, 2 + 21 * 2 + 1);
  });

  test('명단 만들기: 신청서와 팀편성을 이름으로 잇는다', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.apply.fill('웹신청', [
      ['', '이메일', '성함', '학번', '계정 식별자'],
      ['t', 'A1@x.com', '가나다', '1', '101'],
      ['t', 'a2@x.com', '라 마바', '2', '102'],
      ['t', 'dup1@x.com', '동명이', '3', '111'],
      ['t', 'twice1@x.com', '두번낸', '4', '121'],
      ['t', 'twice2@x.com', '두번낸', '4', '122'],
      ['t', 'b1@x.com', '사아자', '5', '201'],
      ['t', 'gone@x.com', '빠진사람', '6', '901'],
      ['t', 'skip@x.com', '안오는', '7', '131'],
    ]);
    b.apply.fill('팀편성_현황', [
      ['', '1차 연합 해커톤 팀 편성 및 참가자 현황'],
      ['', '팀 번호', '조장', '통합 팀원 명단', '총 인원'],
      ['', 'Team 03', '가나다', '가나다, 라마바, 동명이, 안오는', '4명'],
      ['', 'Team 12', '사아자', '사아자, 동명이, 두번낸, 이름다름', '4명'],
      ['', '1학년 소계', '10개 팀', '', ''],
    ]);
    b.roster([['12', '손으로 넣음', 'manual@x.com', '', '', '']]);
    b.tab('팀원').cells[1][7] = '수동';

    const r = b.run('rosterBuild_', '안오는');
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(r.none, ['12팀 이름다름']);
    assert.deepEqual(r.dup, ['03팀 동명이', '12팀 동명이']);
    assert.deepEqual(r.multi, ['12팀 두번낸']);
    assert.equal(r.loose, 2);                                // 동명이 · 빠진사람

    const rows = b.rows('팀원');
    const pick = (name) => rows.filter((x) => x['이름'] === name);
    assert.deepEqual(pick('가나다')[0], { '팀': '03', '이름': '가나다', '이메일': 'a1@x.com', '계정 식별자': '101', '역할': '조장', '상태': '', '비고': '', '출처': '신청서' });
    assert.equal(pick('라 마바')[0]['팀'], '03');           // 빈칸이 달라도 같은 사람
    assert.equal(pick('안오는')[0]['상태'], '불참');
    assert.equal(pick('두번낸').length, 2);
    assert.equal(pick('이름다름')[0]['출처'], '확인 필요');
    assert.equal(pick('손으로 넣음')[0]['이메일'], 'manual@x.com');
    assert.equal(pick('빠진사람')[0]['상태'], '미배정');

    assert.equal(b.post({ action: 'me', idToken: 'tok-a1' }).team.no, '03');
    assert.equal(b.post({ action: 'me', idToken: 'tok-b1' }).team.no, '12');

    // 못 찾은 사람 줄에 이메일을 적고 다시 만들어도 그 줄은 남는다
    const head = b.tab('팀원').cells[0];
    b.tab('팀원').cells.forEach((row) => { if (row[1] === '이름다름') row[head.indexOf('이메일')] = 'diff@x.com'; });
    const again = b.run('rosterBuild_', '안오는');
    assert.deepEqual(again.none, []);
    assert.equal(b.rows('팀원').filter((x) => x['이름'] === '이름다름')[0]['이메일'], 'diff@x.com');
    assert.equal(b.rows('팀원').filter((x) => x['이름'] === '가나다').length, 1);
  });

  test('명단 만들기: 신청서에 이름은 있는데 계정 칸이 빈 사람은 "못 찾음"과 구분해 알린다', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.apply.fill('웹신청', [['', '이메일', '성함', '계정 식별자'], ['t', 'a1@x.com', '가나다', '101'], ['', '', '빈계정', ''], ['', '', '운영진줄', '']]);
    b.apply.fill('팀편성_현황', [['', 'Team 03', '가나다', '가나다, 빈계정, 없는이름']]);
    const r = b.run('rosterBuild_', '');
    assert.deepEqual(r.blank, ['03팀 빈계정']);
    assert.deepEqual(r.none, ['03팀 없는이름']);
    assert.equal(r.loose, 0);                                 // 계정이 빈 신청서 줄(운영진줄)은 미배정으로도 적지 않는다
    assert.match(r.message, /이메일 · 계정 식별자가 비어 있는 사람 \(1명\)[\s\S]*03팀 빈계정/);
    const row = b.rows('팀원').find((x) => x['이름'] === '빈계정');
    assert.deepEqual([row['출처'], row['비고']], ['확인 필요', '신청서에 이름은 있지만 이메일 · 계정 식별자가 비어 있습니다 — 이 줄에 이메일을 직접 적어 주세요']);
  });

  test('명단 만들기: 따로 알려 준 주소도 같은 사람의 계정으로 넣는다', () => {
    const b = loadBackend({ tokens: { ...TOKENS, 'tok-kakao': token('kakao-a2@naver.com', '777'), 'tok-diff': token('diff@x.com', '778') } });
    b.apply.fill('웹신청', [['', '이메일', '성함', '계정 식별자'], ['t', 'a1@x.com', '가나다', '101'], ['t', 'a2@x.com', '라마바', '102'], ['t', 'b1@x.com', '사아자', '201']]);
    b.apply.fill('팀편성_현황', [['', 'Team 03', '가나다', '가나다, 라마바'], ['', 'Team 12', '사아자', '사아자, 이름다름']]);
    b.extra.fill('시트1', [
      ['팀', '이름', '이메일', '비고'],
      ['03', '라마바', 'Kakao-A2@naver.com', '단체방'],     // 신청서와 다른 주소
      ['03', '가나다', 'a1@x.com', ''],                     // 신청서와 같은 주소 → 넣지 않는다
      ['12', '이름다름', 'diff@x.com', ''],            // 신청서에서 이름을 못 찾은 사람
      ['12', '가나다', 'a1@x.com', ''],                     // 이미 03팀에 있는 주소 → 넣지 않고 알린다
      ['12', '엉터리', 'not-an-email', ''],
    ]);
    const r = b.run('rosterBuild_', '');
    assert.equal(r.ok, true, r.message);
    assert.equal(r.extra, 2);
    assert.deepEqual(r.none, []);
    assert.deepEqual(r.clash, ['12팀 가나다']);
    const rows = b.rows('팀원');
    assert.deepEqual(rows.filter((x) => x['출처'] === '추가').map((x) => [x['팀'], x['이름'], x['이메일'], x['비고']]),
      [['03', '라마바', 'kakao-a2@naver.com', '단체방'], ['12', '이름다름', 'diff@x.com', '참가자가 따로 알려 준 주소']]);
    assert.equal(b.post({ action: 'me', idToken: 'tok-kakao' }).team.no, '03');
    assert.equal(b.post({ action: 'me', idToken: 'tok-diff' }).team.no, '12');
    assert.equal(b.run('rosterBuild_', '').extra, 2);       // 다시 만들어도 줄이 늘지 않는다
    assert.equal(b.rows('팀원').length, rows.length);
  });

  test('명단 만들기: 추가 계정의 팀 칸이 비어 있으면 이름으로 팀을 찾는다 (한 팀에만 있을 때만)', () => {
    const b = loadBackend({ tokens: { ...TOKENS, 'tok-k': token('k@naver.com', '801'), 'tok-dup': token('dup@x.com', '802'), 'tok-stranger': token('stranger@x.com', '803') } });
    b.apply.fill('웹신청', [['', '이메일', '성함', '계정 식별자'], ['t', 'a1@x.com', '가나다', '101'], ['t', 'b1@x.com', '사아자', '201']]);
    b.apply.fill('팀편성_현황', [['', 'Team 03', '가나다', '가나다, 홍 길동, 동명이'], ['', 'Team 12', '사아자', '사아자, 동명이']]);
    b.extra.fill('시트1', [
      ['이름', '이메일', '팀', '비고'],
      ['홍길동', 'K@naver.com', '', ''],                    // 띄어쓰기만 다른 이름 → 03팀
      ['동명이', 'dup@x.com', '', ''],                      // 두 팀에 있는 이름 → 넣지 않는다
      ['모르는사람', 'stranger@x.com', '', ''],             // 팀편성에 없는 이름 → 넣지 않는다
      ['가나다', 'x@x.com', '30', ''],                      // 없는 팀 번호 → 넣지 않는다
    ]);
    const r = b.run('rosterBuild_', '');
    assert.equal(r.ok, true, r.message);
    assert.equal(r.extra, 1);
    assert.deepEqual(r.extraDup, ['동명이']);
    assert.deepEqual(r.extraNone, ['모르는사람', '30팀 가나다']);
    assert.match(r.message, /팀을 찾지 못해 넣지 않은 줄 \(2개\)/);
    assert.equal(b.post({ action: 'me', idToken: 'tok-k' }).team.no, '03');
    assert.equal(b.post({ action: 'me', idToken: 'tok-dup' }).error, 'NOT_MEMBER');
    assert.equal(b.post({ action: 'me', idToken: 'tok-stranger' }).error, 'NOT_MEMBER');
    assert.ok(!b.rows('팀원').some((x) => x['팀'] === '30'));                // 없는 팀이 생기지 않는다
    assert.deepEqual(b.post({ action: 'view.list', key: b.viewer('심사') }).tracks.map((t) => t.teams.length), [10, 10]);
  });

  test('명단 만들기: 추가 계정은 폴더에 끌어다 놓은 CSV 파일이어도 된다', () => {
    const b = loadBackend({ tokens: { ...TOKENS, 'tok-k': token('k@naver.com', '801') } });
    b.apply.fill('웹신청', [['', '이메일', '성함', '계정 식별자'], ['t', 'a1@x.com', '가나다', '101']]);
    b.apply.fill('팀편성_현황', [['', 'Team 03', '가나다', '가나다, 라마바']]);
    b.drive.plain.set('팀원 추가 계정.csv', '\uFEFF팀,이름,이메일,비고\n,라마바,K@naver.com,"단체방, 11월"\n,=가나다,bad,\n');
    const r = b.run('rosterBuild_', '');
    assert.equal(r.extra, 1, r.message);
    assert.deepEqual(b.rows('팀원').filter((x) => x['출처'] === '추가').map((x) => [x['팀'], x['이름'], x['이메일'], x['비고']]), [['03', '라마바', 'k@naver.com', '단체방, 11월']]);
    assert.equal(b.post({ action: 'me', idToken: 'tok-k' }).team.no, '03');
  });

  test('열람 링크: 이름을 적어 둔 줄마다 만들고, 시트에는 해시만 남긴다', () => {
    const b = backend();
    b.ss.fill('열람', [['이름', '역할', '토큰 해시', '만든 시각', '만료', '사용', '마지막 접속'], ['홍 교수님', '', '', '', '', '', ''], ['박운영', '운영진', '', '', '', '', '']]);
    // 편집기에서 실행하면(창이 없으면) 만들지 않는다 — 실행 기록에 토큰이 남지 않게
    b.run('viewerNew');
    assert.match(b.logs.at(-1), /시트의 메뉴/);
    assert.ok(!b.logs.some((l) => /token_/.test(l)));
    assert.equal(b.rows('열람')[0]['토큰 해시'], '');
    let text = '';
    b.setUi({ ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'ok' }, alert() {}, showModalDialog: (h) => { text = h.html; },
              prompt: () => ({ getSelectedButton: () => 'cancel' }) });
    b.run('viewerNew');
    const keys = [...text.matchAll(/\/judge\/#k=([A-Za-z0-9_-]+)/g)].map((m) => m[1]).filter((k, i, all) => all.indexOf(k) === i);
    assert.equal(keys.length, 2);
    assert.ok(keys.every((k) => /^token_[A-Za-z0-9_-]{40}$/.test(k)), keys.join(','));
    assert.ok(keys.every((k) => text.includes('토큰: ' + k)));      // 사람마다 토큰과 링크를 따로 보여 준다
    const sheetText = JSON.stringify(b.tab('열람').cells);
    assert.ok(keys.every((k) => !sheetText.includes(k)));
    assert.equal(b.post({ action: 'view.list', key: keys[0] }).role, '심사위원');
    assert.equal(b.post({ action: 'view.list', key: keys[1] }).role, '운영진');
    assert.equal(b.rows('열람')[0]['만료'], '2026-11-15 00:00:00');
    b.run('viewerNew');                                      // 이미 만든 줄은 다시 만들지 않는다
    assert.equal(b.post({ action: 'view.list', key: keys[0] }).ok, true);
  });

  test('끊긴 업로드는 표시만 하고 파일은 지우지 않는다', () => {
    const b = backend();
    const bytes = bytesOf(10);
    const s = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: bytes.length });
    b.putDirect(s.url, bytes);
    b.advance(7 * 3600);
    b.run('sweepUploads');
    assert.equal(b.rows('파일')[0]['상태'], '끊김');
    assert.equal(b.drive.inFolder(b.store.F_03).length, 1);
    assert.match(b.logs.at(-1), /Drive 에 다 올라와 있는 파일/);
  });

  test('설정 점검', () => {
    const b = backend();
    b.run('scoreSheetFind_', true);                          // 처음 설정이 하는 일 중 심사 시트만
    b.run('doctor');
    assert.match(b.logs.at(-1), /모두 정상입니다/);
    const empty = loadBackend({});
    empty.drive.apiOff = true;
    empty.run('doctor');
    assert.match(empty.logs.at(-1), /고칠 곳이 4군데/);
    assert.match(empty.logs.at(-1), /심사 시트 — SCORE_SHEET_MISSING/);
  });

  test('저장 공간: 점검에서 남은 공간을 알려 주고, 가득 차면 무슨 일인지 알려 준다', () => {
    const b = backend();
    b.run('doctor');
    assert.match(b.logs.at(-1), /✔ Drive 남은 저장 공간: 80\.0GB/);
    b.drive.quota = { limit: String(15 * 2 ** 30), usage: String(11 * 2 ** 30) };
    b.run('doctor');
    assert.match(b.logs.at(-1), /! Drive 남은 저장 공간: 4\.0GB/);
    b.drive.quota = { usage: String(11 * 2 ** 30) };                   // 한도가 없는 계정
    b.run('doctor');
    assert.match(b.logs.at(-1), /Drive 저장 공간: 제한 없음/);

    b.drive.full = true;
    const r = b.post({ action: 'upload.start', idToken: 'tok-a1', kind: 'deck', name: 'a.pdf', size: 10 });
    assert.equal(r.error, 'DRIVE_FULL');
    assert.equal(b.rows('파일').length, 0);                            // 색인에 헛줄을 남기지 않는다
  });

  test('설정 점검: 브라우저에서 Drive 로 직접 올릴 수 있는지 실제로 해 본다', () => {
    const b = backend();
    b.run('scoreSheetFind_', true);
    b.run('doctor');
    assert.match(b.logs.at(-1), /직접 올리기: 됩니다/);
    assert.deepEqual(b.drive.inFolder('root'), []);                    // 점검용 파일은 남지 않는다
    assert.equal(b.rows('파일').length, 0);
    b.drive.noCors = true;                                             // Drive 가 그 출처를 허용하지 않는 경우
    b.run('doctor');
    assert.match(b.logs.at(-1), /직접 올리기: 안 됩니다/);
    assert.match(b.logs.at(-1), /모두 정상입니다/);                     // 느려질 뿐 제출은 된다
  });
});

describe('기록', () => {
  test('누가 언제 무엇을 했는지 남고, 수식처럼 보이는 글자는 글자로 남는다', () => {
    const b = backend();
    upload(b, { name: '=HYPERLINK(1).pdf' });
    const log = b.rows('기록');
    assert.deepEqual(log.map((r) => r['동작']), ['upload.start', 'upload.finish']);
    assert.equal(log[0]['누가'], 'a1@x.com');
    assert.equal(log[0]['팀'], '03');
    assert.equal(log[0]['메모'], '발표 · =HYPERLINK(1).pdf · 1000B');
    // appendRow 는 글자를 사람이 친 것처럼 해석한다 — 수식으로 읽힐 수 있는 글자는 앞에 ' 를 붙여 넘긴다
    for (const v of ['=1+1', '+1', '-1', '@x', '\tx']) assert.equal(b.ctx.guard_(v), "'" + v);
    assert.equal(b.ctx.guard_('a=1'), 'a=1');
  });

  test('잠금이 겹치거나 남지 않는다', () => {
    const b = backend();
    upload(b);
    b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: 'x' } });
    b.post({ action: 'file.withdraw', idToken: 'tok-a1', kind: 'deck' });
    assert.equal(b.isLocked(), false);
  });
});

describe('참가자 인기투표', () => {
  // 03 · 05 팀은 구현과제(A), 12 · 15 팀은 해커톤(H)
  const VT = {
    ...TOKENS,
    'tok-c1': token('c1@x.com', '601'), 'tok-c2': token('c2@x.com', '602'),
    'tok-d1': token('d1@x.com', '701'), 'tok-a1alt': token('a1.alt@x.com', '109'),
  };
  function vb(extra = {}) {
    const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: VT, ...extra });
    b.roster([
      ['03', '가나다', 'a1@x.com', '101', '조장', ''],
      ['03', '가나다', 'a1.alt@x.com', '109', '', ''],          // 같은 사람의 다른 계정
      ['03', '라마바', 'a2@x.com', '102', '', ''],
      ['05', '차카타', 'c1@x.com', '601', '조장', ''],
      ['05', '파하', 'c2@x.com', '602', '', ''],
      ['12', '사아자', 'b1@x.com', '201', '조장', ''],
      ['12', '불참자', 'out@x.com', '301', '', '불참'],
      ['15', '마바사', 'd1@x.com', '701', '조장', ''],
    ]);
    return b;
  }
  const open = (b, track) => assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-op', track, op: 'open' }).ok, true);
  const close = (b, track) => assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-op', track, op: 'close' }).ok, true);
  const vote = (b, idToken, track, teams, extra = {}) => b.post({ action: 'vote.submit', idToken, track, teams, ...extra });

  test('명단에 없는 계정 · 불참자는 로그인부터 거절한다 (신청서와 맞지 않으면 못 들어온다)', () => {
    const b = vb();
    for (const t of ['tok-none', 'tok-out']) assert.equal(b.post({ action: 'vote.me', idToken: t }).error, 'NOT_MEMBER', t);
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-none' }).email, 'none@x.com');
    assert.equal(b.post({ action: 'vote.me', idToken: 'nope' }).error, 'AUTH_FAILED');
    assert.equal(vote(b, 'tok-none', 'A', ['01']).error, 'NOT_MEMBER');
  });

  test('참가자: 트랙마다 팀 목록과 내 투표지 · 열기 전에는 낼 수 없다', () => {
    const b = vb();
    const me = b.post({ action: 'vote.me', idToken: 'tok-a1' });
    assert.equal(me.ok, true);
    assert.equal(me.admin, false);
    assert.equal(me.tally, undefined);                         // 결과는 운영진만
    assert.deepEqual(me.me, { team: '03', track: '구현과제', trackKey: 'A', name: '가나다' });
    assert.deepEqual(me.tracks.map((t) => [t.key, t.name, t.state, t.teams.length, t.mine.length]), [['H', '해커톤', 'ready', 10, 0], ['A', '구현과제', 'ready', 10, 0]]);
    assert.ok(!me.tracks.some((t) => t.teams.some((x) => x.no === '00')));   // 연습 팀은 없다
    assert.match(me.sid, /^[A-Za-z0-9_-]{43}$/);                // 발표가 길어도 로그인이 이어지게
    assert.equal(me.max, 3);
    assert.equal(vote(b, 'tok-a1', 'A', ['01']).error, 'VOTE_NOT_OPEN');
  });

  test('운영진만 열고 닫는다 · 닫힌 뒤에는 낼 수 없다', () => {
    const b = vb();
    assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-a1', track: 'A', op: 'open' }).error, 'NOT_ADMIN');
    assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-op', track: 'X', op: 'open' }).error, 'BAD_TRACK');
    assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-op', track: 'A', op: 'wipe' }).error, 'BAD_OP');
    open(b, 'A');
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-a1' }).tracks.find((t) => t.key === 'A').state, 'open');     // 캐시가 있어도 바로 보인다
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-a1' }).tracks.find((t) => t.key === 'H').state, 'ready');
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '02']).ok, true);
    close(b, 'A');
    assert.equal(vote(b, 'tok-a2', 'A', ['01']).error, 'VOTE_CLOSED');
    assert.deepEqual(b.post({ action: 'vote.me', idToken: 'tok-a1' }).tracks.find((t) => t.key === 'A').mine, ['01', '02']);   // 낸 것은 남는다
    const op = b.post({ action: 'vote.me', idToken: 'tok-op' });
    assert.equal(op.ok, true);                                   // 운영진은 팀원이 아니어도 들어온다 (투표는 못 함)
    assert.equal(op.me, null);
    assert.equal(vote(b, 'tok-op', 'A', ['01']).error, 'NOT_MEMBER');
    assert.ok(b.rows('기록').some((r) => r['동작'] === 'vote.open' && r['누가'] === 'op@x.com'));
  });

  test('1인 3표 · 한 팀에 1표 · 자기 팀 안 됨 · 그 트랙 팀만', () => {
    const b = vb();
    open(b, 'A'); open(b, 'H');
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '02', '04', '06']).error, 'VOTE_TOO_MANY');
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '01']).error, 'VOTE_DUP');
    assert.equal(vote(b, 'tok-a1', 'A', ['03']).error, 'VOTE_SELF');
    assert.equal(vote(b, 'tok-a1', 'A', ['12']).error, 'VOTE_BAD_TEAM');      // 해커톤 팀을 구현과제 투표지에
    assert.equal(vote(b, 'tok-a1', 'A', ['00']).error, 'VOTE_BAD_TEAM');
    assert.equal(vote(b, 'tok-a1', 'A', ['30']).error, 'VOTE_BAD_TEAM');
    assert.equal(vote(b, 'tok-a1', 'A', []).error, 'VOTE_EMPTY');
    assert.equal(vote(b, 'tok-a1', 'A', 'nope').error, 'VOTE_EMPTY');
    assert.equal(vote(b, 'tok-a1', 'Q', ['01']).error, 'BAD_TRACK');
    const ok = vote(b, 'tok-a1', 'A', ['1', 'team 2', '04']);                // 번호 꼴은 아무렇게나
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.mine, ['01', '02', '04']);
    assert.deepEqual(Object.keys(ok.codes), ['01', '02', '04']);
    assert.match(ok.codes['01'], /^[0-9A-F]{6}$/);                         // 확인 코드
    assert.equal(vote(b, 'tok-a1', 'H', ['12', '15']).ok, true);           // 다른 트랙에는 따로 3표
    assert.equal(vote(b, 'tok-d1', 'H', ['12']).ok, true);
    assert.equal(vote(b, 'tok-d1', 'H', ['15']).error, 'VOTE_SELF');
  });

  test('다시 내면 마지막 투표지만 센다 · 같은 사람의 다른 계정도 한 장을 함께 쓴다', () => {
    const b = vb();
    open(b, 'A');
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '02', '04']).ok, true);
    assert.equal(vote(b, 'tok-a1alt', 'A', ['05', '06']).ok, true);         // 같은 사람(가나다)의 다른 계정
    const me = b.post({ action: 'vote.me', idToken: 'tok-a1' });
    assert.deepEqual(me.tracks.find((t) => t.key === 'A').mine, ['05', '06']);
    const t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');
    assert.equal(t.voters, 1);                                              // 한 사람
    assert.deepEqual(t.rows.filter((r) => r.votes).map((r) => [r.no, r.votes]), [['05', 1], ['06', 1]]);
    assert.ok(b.rows('투표').every((r) => r['상태'] === '유효'));         // 표시는 그대로 — 셀 때 가장 나중 투표지만 센다 (잠그지 않고 붙이므로)
    assert.equal(vote(b, 'tok-a2', 'A', ['05']).ok, true);                  // 같은 팀의 다른 사람은 따로
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A').voters, 2);
  });

  test('시트에는 누가 냈는지 남지 않고, 표마다 검증값이 있다 — 대상 팀을 몰래 바꾸면 세지 않는다', () => {
    const b = vb();
    open(b, 'A');
    vote(b, 'tok-a1', 'A', ['01', '02']);
    vote(b, 'tok-c1', 'A', ['01']);
    const sheet = JSON.stringify(b.tab('투표').cells);
    for (const s of ['a1@x.com', 'c1@x.com', '가나다', '차카타']) assert.ok(!sheet.includes(s), s);
    const cells = b.tab('투표').cells.flat().map(String);
    for (const sub of ['101', '601']) assert.ok(!cells.includes(sub), sub);       // 계정 식별자도 칸에 없다 (해시 속 우연한 숫자는 상관없다)
    assert.ok(!JSON.stringify(b.rows('기록').filter((r) => r['동작'] === 'vote.submit')).match(/0[12]팀|"01"|"02"/));   // 기록에도 대상 팀은 없다
    // 기록에 누가 냈는지(이메일 · 팀)도 없다 — 같은 시각의 `투표` 탭 줄과 맞춰 보는 것만으로 익명이 깨지지 않게
    const vlog = b.rows('기록').filter((r) => r['동작'] === 'vote.submit');
    assert.ok(vlog.length > 0);
    assert.ok(vlog.every((r) => r['누가'] === '(익명 투표)' && r['팀'] === ''), JSON.stringify(vlog));
    const rows = b.rows('투표');
    assert.ok(rows.every((r) => /^[0-9a-f]{32}$/.test(r['검증'])));
    let t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');
    assert.deepEqual([t.rows[0].votes, t.rows[1].votes, t.bad], [2, 1, 0]);
    // 누군가 시트에서 02 를 04 로 바꿨다
    const sh = b.tab('투표'), head = sh.cells[0];
    const r2 = sh.cells.findIndex((row) => row[head.indexOf('대상 팀')] === '02');
    sh.cells[r2][head.indexOf('대상 팀')] = '04';
    b.cache.delete('votes1');
    t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');
    assert.deepEqual([t.rows[1].votes, t.rows[3].votes, t.bad], [0, 0, 1]);   // 02 도 04 도 세지 않고, 검증 실패 1
    assert.equal(t.rows[0].votes, 2);                                          // 나머지는 그대로
    // 줄을 통째로 베껴 한 표를 더 만들어도 (같은 투표지에 같은 팀 두 장) 그 투표지는 세지 않는다
    const copy = [...sh.cells[1]];
    sh.cells.push(copy);
    b.cache.delete('votes1');
    t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');
    assert.equal(t.rows[0].votes, 1);
    assert.ok(t.bad >= 3);
  });

  test('참가자 점수 P = 15 × √min(1, v / 2v̄) — 트랙별로', () => {
    const b = vb();
    b.ctx.popScore_ && assert.equal(b.ctx.popScore_(36, 18), 15);
    assert.equal(b.ctx.popScore_(80, 18), 15);
    assert.equal(b.ctx.popScore_(27, 18), 12.99);
    assert.equal(b.ctx.popScore_(18, 18), 10.61);
    assert.equal(b.ctx.popScore_(9, 18), 7.5);
    assert.equal(b.ctx.popScore_(3, 18), 4.33);
    assert.equal(b.ctx.popScore_(0, 18), 0);
    assert.equal(b.ctx.popScore_(0, 0), 0);
    open(b, 'A');
    vote(b, 'tok-a1', 'A', ['01', '02', '04']);
    vote(b, 'tok-a2', 'A', ['01', '05']);
    vote(b, 'tok-c1', 'A', ['01']);
    const t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');   // 6표 / 10팀 → 평균 0.6, 만점 기준 1.2표
    assert.deepEqual([t.votes, t.teams, t.mean, t.full, t.voters, t.eligible], [6, 10, 0.6, 1.2, 3, 6]);
    const p = Object.fromEntries(t.rows.map((r) => [r.no, r.p]));
    assert.deepEqual([p['01'], p['02'], p['04'], p['05'], p['06']], [15, 13.69, 13.69, 13.69, 0]);   // 1표: 15 × √(1 / 1.2)
    const h = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'H');
    assert.deepEqual([h.votes, h.mean, h.rows.every((r) => r.p === 0)], [0, 0, true]);    // 표가 없으면 모두 0
  });

  test('같은 1/1000초에 같은 난수로 투표지 번호가 겹쳐도 다른 사람의 표를 덮어쓰지 않는다', () => {
    const b = vb();
    open(b, 'A');
    // 시계가 멈춰 있고 꼬리까지 같게 해서 투표지 번호를 일부러 겹친다 (실제로는 거의 없는 일)
    vm.runInContext("Utilities.getUuid = function () { return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; };", b.ctx);
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '02', '04']).ok, true);
    assert.equal(vote(b, 'tok-a2', 'A', ['01', '05']).ok, true);
    assert.equal(vote(b, 'tok-c1', 'A', ['01']).ok, true);
    assert.equal(new Set(b.rows('투표').map((r) => r['투표지'])).size, 1);
    const t = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((x) => x.key === 'A');
    assert.deepEqual([t.votes, t.voters], [6, 3]);
  });

  test('운영진 열람 링크(현황판)에는 결과가 보이고, 심사위원 링크에는 없다', () => {
    const b = vb();
    open(b, 'A');
    vote(b, 'tok-a1', 'A', ['01']);
    const staff = b.post({ action: 'view.list', key: b.viewer('운영', '운영진') });
    assert.equal(staff.votes.find((t) => t.key === 'A').rows[0].votes, 1);
    const judge = b.post({ action: 'view.list', key: b.viewer('심사') });
    assert.equal(judge.votes, undefined);
  });

  test('끊겨서 다시 보낸 투표는 한 번만 들어가고, 여럿이 몰려도 표가 섞이지 않는다', () => {
    const b = vb();
    open(b, 'A');
    const n = 'n-' + Math.random();
    const r1 = vote(b, 'tok-a1', 'A', ['01', '02'], { nonce: n });
    const r2 = vote(b, 'tok-a1', 'A', ['01', '02'], { nonce: n });
    assert.equal(r2.replay, true);
    assert.deepEqual(r1.mine, r2.mine);
    assert.equal(b.rows('투표').length, 2);
    for (const [t, teams] of [['tok-a2', ['01']], ['tok-c1', ['02']], ['tok-c2', ['01', '02', '04']]]) assert.equal(vote(b, t, 'A', teams).ok, true);
    const tl = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'A');
    assert.deepEqual(tl.rows.filter((r) => r.votes).map((r) => [r.no, r.votes]), [['01', 3], ['02', 3], ['04', 1]]);
    assert.equal(b.isLocked(), false);
    assert.equal(new Set(b.rows('투표').map((r) => r['투표지'] + '|' + r['대상 팀'])).size, b.rows('투표').length);   // 줄이 겹치지 않는다
    assert.ok(b.rows('투표').every((r) => /^B\d{13}-[0-9a-f]{8}$/.test(r['투표지'])));                             // 투표지 번호 = 시각(ms) - 겹치지 않는 꼬리 8자리
  });

  test('운영진이 닫는 순간과 겹친 투표는 잠근 뒤 다시 보고 거절한다', () => {
    const b = vb();
    open(b, 'A');
    b.prop('VOTE_A_UNTIL', '2026-11-14T08:00:00+09:00', false);   // 다른 실행이 방금 닫았다 (이 실행의 캐시는 아직 open)
    assert.equal(vote(b, 'tok-a1', 'A', ['01']).error, 'VOTE_CLOSED');
    assert.equal(b.rows('투표').length, 0);
  });

  test('설정으로 표 수와 자기 팀 투표를 바꿀 수 있다', () => {
    const b = vb({ props: { ADMINS: 'op@x.com', VOTE_MAX: '1', VOTE_SELF: 'true' } });
    open(b, 'A');
    assert.equal(vote(b, 'tok-a1', 'A', ['01', '02']).error, 'VOTE_TOO_MANY');
    assert.equal(vote(b, 'tok-a1', 'A', ['03']).ok, true);
  });
});

describe('심사위원 평가', () => {
  function sb() {
    const b = backend();
    b.run('setup');                                            // 심사위원 폴더 · 심사 시트 · `점수` 탭
    return b;
  }
  const judge = (b, name) => b.viewer(name, '심사위원');
  const save = (b, key, team, scores, comment = '') => b.post({ action: 'score.save', key, team, scores, comment });

  test('처음 설정이 제출 폴더 옆 심사위원 폴더에 심사 시트를 만들고, 다시 해도 그것을 쓴다', () => {
    const b = sb();
    const id = b.store.SCORE_SHEET_ID;
    assert.ok(id);
    const folder = [...b.drive.folders.values()].find((f) => f.name === '심사위원');
    assert.equal(folder.parent, 'ops');                        // 제출 폴더와 나란히
    assert.equal(b.books.get(id).parent, folder.id);
    assert.equal(b.books.get(id).name, 'ENDPoinT 2026 심사');
    assert.deepEqual(b.scoreBook().getSheetByName('점수').cells[0],
      ['심사위원', '심사위원 ID', '팀', '트랙', '문제 정의 · 아이디어', '완성도', '사용자 경험', '구조적 이해', '합계', '코멘트', '저장 시각']);
    delete b.store.SCORE_SHEET_ID; b.cache.delete('props1');
    b.run('setup');
    assert.equal(b.store.SCORE_SHEET_ID, id);                  // 이름으로 다시 찾는다 (새로 만들지 않는다)
    assert.match(b.logs.at(-1), /심사 시트: 심사위원 \/ ENDPoinT 2026 심사/);
  });

  test('교수님 토큰: 여러 명을 한꺼번에, token_ 꼴로, 사람마다 따로', () => {
    const b = sb();
    b.setUi({ ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'ok' }, prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '한 교수님, 김 교수님 , 강 교수님\n박운영=운영진' }),
              alert() {}, showModalDialog: (h) => { b.lastModal = h.html; } });
    const links = b.run('viewerNew');
    assert.deepEqual(links.map((l) => [l.name, l.role]), [['한 교수님', '심사위원'], ['김 교수님', '심사위원'], ['강 교수님', '심사위원'], ['박운영', '운영진']]);
    assert.ok(links.every((l) => /^token_[A-Za-z0-9_-]{40}$/.test(l.key) && l.url.endsWith('/judge/#k=' + l.key)));
    assert.equal(new Set(links.map((l) => l.key)).size, 4);
    const sheet = JSON.stringify(b.tab('열람').cells);
    assert.ok(links.every((l) => !sheet.includes(l.key)));    // 시트에는 해시만
    for (const l of links) assert.ok(b.lastModal.includes(l.key));
    assert.equal(b.post({ action: 'view.list', key: links[0].key }).name, '한 교수님');
    assert.equal(b.post({ action: 'view.list', key: links[3].key }).role, '운영진');
  });

  test('토큰은 이름을 넣어 만들고, 시트의 이름을 바꾸면 그 토큰은 더 통하지 않는다', () => {
    const b = sb();
    let modal = '';
    b.setUi({ ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'ok' }, prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '한 교수님, 한 교수님' }),
              alert() {}, showModalDialog: (h) => { modal = h.html; } });
    const links = b.run('viewerNew');
    assert.equal(links.length, 2);
    assert.notEqual(links[0].key, links[1].key);              // 같은 이름이어도 토큰은 다르다 (무작위 값)
    assert.ok(modal.includes('이름을 넣어 만들었기 때문에'));
    const rows = b.rows('열람');
    assert.ok(rows.every((r) => /^[0-9a-f]{32}$/.test(r['검증'])));
    assert.equal(b.post({ action: 'view.list', key: links[0].key }).name, '한 교수님');
    // 누가 시트에서 이름을 바꿨다 → 그 토큰은 통하지 않는다 (다른 사람인 척 못 하게)
    b.tab('열람').cells[1][0] = '김 교수님';
    b.cache.delete('views1');
    assert.equal(b.post({ action: 'view.list', key: links[0].key }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'view.list', key: links[1].key }).name, '한 교수님');   // 다른 줄은 그대로
    // 검증 칸을 지워도 이름 묶음이 없는 예전 줄처럼 받지는 않는다 — 검증 칸이 있는 줄만 묶음을 본다
    b.tab('열람').cells[1][0] = '한 교수님';
    b.cache.delete('views1');
    assert.equal(b.post({ action: 'view.list', key: links[0].key }).name, '한 교수님');   // 되돌리면 다시 통한다
  });

  test('점수: 문항마다 0 – 25, 소수점 둘째 자리까지 · 비워 두고 나중에 채워도 된다 · 다시 저장하면 그 줄을 고친다', () => {
    const b = sb();
    const k = judge(b, '한 교수님');
    let r = save(b, k, '03', { idea: 21.5, done: '18.25', ux: 20.125, arch: '' }, '아이디어가 좋다');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.saved.s, { idea: 21.5, done: 18.25, ux: 20.13, arch: '' });
    assert.equal(r.saved.complete, false);
    r = save(b, k, '03', { idea: 21.5, done: 18.25, ux: 20.13, arch: 22.75 }, '구조 설명이 분명하다');
    assert.equal(r.saved.total, 82.63);
    assert.equal(r.saved.complete, true);
    const rows = b.scoreBook().getSheetByName('점수').objects();
    assert.equal(rows.length, 1);                              // 같은 줄을 고쳤다
    assert.deepEqual([rows[0]['심사위원'], rows[0]['팀'], rows[0]['트랙'], rows[0]['합계'], rows[0]['코멘트']], ['한 교수님', '03', '구현과제', 82.63, '구조 설명이 분명하다']);
    assert.equal(typeof rows[0]['완성도'], 'number');
    assert.equal(b.post({ action: 'view.list', key: k }).mine['03'].total, 82.63);   // 현황판에 내 점수
    for (const [bad, item] of [[{ idea: 25.01 }, 'idea'], [{ done: -1 }, 'done'], [{ ux: 'abc' }, 'ux'], [{ arch: true }, 'arch']]) {
      const e = save(b, k, '03', bad);
      assert.equal(e.error, 'BAD_SCORE', JSON.stringify(bad));
      assert.equal(e.item, item);
    }
    assert.equal(save(b, k, '00', { idea: 1 }).error, 'BAD_TEAM');
    assert.equal(save(b, k, '33', { idea: 1 }).error, 'BAD_TEAM');
    assert.equal(save(b, k, '03', { idea: 25 }, '=HYPERLINK("x")').ok, true);
    assert.equal(b.scoreBook().getSheetByName('점수').objects()[0]['코멘트'], 'HYPERLINK("x")');   // 수식으로 들어가지 않는다
  });

  test('심사위원만 점수를 적고, 자기 점수만 본다 · 운영진은 종합을 본다', () => {
    const b = sb();
    const a = judge(b, '한 교수님'), c = judge(b, '김 교수님'), op = b.viewer('박운영', '운영진');
    save(b, a, '03', { idea: 20, done: 20, ux: 20, arch: 20 });
    assert.deepEqual(Object.keys(b.post({ action: 'view.list', key: c }).mine), []);      // 남의 점수는 안 보인다
    assert.equal(save(b, op, '03', { idea: 1 }).error, 'NOT_JUDGE');
    assert.equal(b.post({ action: 'score.summary', key: a }).error, 'NOT_STAFF');
    assert.equal(b.post({ action: 'score.summary', key: 'x'.repeat(40) }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'score.summary', key: op }).ok, true);
    assert.equal(b.post({ action: 'score.save', idToken: 'tok-a1', team: '03', scores: { idea: 1 } }).error, 'KEY_INVALID');   // 참가자 로그인으로는 안 된다
  });

  test('종합: J = 4문항을 다 채운 심사위원 평균 · P = 인기투표 · S = 0.85J + P · 순위와 동점 처리', () => {
    const b = sb();
    const A = judge(b, '가 교수님'), B = judge(b, '나 교수님'), C = judge(b, '다 교수님'), op = b.viewer('박운영', '운영진');
    // 03: A 80 · B 90 → J 85      05: A 85 · B 85(구조 25) → J 85 (동점, 구조적 이해가 높다)      01: A 60, C 는 작성 중(문항 하나 빔)
    save(b, A, '03', { idea: 20, done: 20, ux: 20, arch: 20 }, '좋다');
    save(b, B, '03', { idea: 22.5, done: 22.5, ux: 22.5, arch: 22.5 }, '아주 좋다');
    save(b, A, '05', { idea: 21.25, done: 21.25, ux: 21.25, arch: 21.25 });
    save(b, B, '05', { idea: 20, done: 20, ux: 20, arch: 25 });
    save(b, A, '01', { idea: 15, done: 15, ux: 15, arch: 15 });
    save(b, C, '01', { idea: 25, done: 25, ux: 25 });
    const s = b.post({ action: 'score.summary', key: op });
    assert.equal(s.ok, true);
    assert.deepEqual(s.judges.map((j) => j.name), ['가 교수님', '나 교수님', '다 교수님']);
    const A_ = s.tracks.find((t) => t.key === 'A');
    const row = (no) => A_.rows.find((r) => r.no === no);
    assert.deepEqual([row('03').J, row('03').S, row('03').scored], [85, 72.25, 2]);
    assert.deepEqual([row('05').J, row('05').avg.arch], [85, 23.13]);
    assert.deepEqual([row('01').J, row('01').scored], [60, 1]);                 // 작성 중인 C 는 평균에서 뺀다
    const cId = s.judges.find((j) => j.name === '다 교수님').id;
    assert.deepEqual(row('01').judges[cId], { total: 75, complete: false, s: { idea: 25, done: 25, ux: 25, arch: '' } });
    assert.deepEqual(A_.rows.slice(0, 3).map((r) => [r.no, r.rank]), [['05', 1], ['03', 2], ['01', 3]]);   // 같은 S 면 구조적 이해 평균 순
    assert.equal(row('02').rank, null);                                          // 점수가 없는 팀은 순위 없음
    assert.deepEqual(row('03').comments, [{ judge: '가 교수님', text: '좋다' }, { judge: '나 교수님', text: '아주 좋다' }]);
    // 인기투표가 더해진다 (트랙 A 에서 03 이 혼자 표를 받으면 P = 15)
    b.post({ action: 'vote.admin', idToken: 'tok-op', track: 'A', op: 'open' });
    b.roster([['03', '가나다', 'a1@x.com', '101', '조장', ''], ['05', '차카타', 'c1@x.com', '601', '조장', '']]);
    b.post({ action: 'vote.submit', idToken: 'tok-a1', track: 'A', teams: ['05'] });
    b.cache.delete('scores1');
    const s2 = b.post({ action: 'score.summary', key: op }).tracks.find((t) => t.key === 'A');
    const r05 = s2.rows.find((r) => r.no === '05');
    assert.deepEqual([r05.votes, r05.P, r05.S, r05.rank], [1, 15, 87.25, 1]);
  });

  test('운영진이 마감하면 더 고칠 수 없고, 다시 열 수 있다', () => {
    const b = sb();
    const k = judge(b, '한 교수님'), op = b.viewer('박운영', '운영진');
    assert.equal(b.post({ action: 'score.state', key: k, op: 'close' }).error, 'NOT_STAFF');
    assert.equal(b.post({ action: 'score.state', key: op, op: 'close' }).scoring, 'closed');
    assert.equal(save(b, k, '03', { idea: 10 }).error, 'SCORE_CLOSED');
    assert.equal(b.post({ action: 'view.list', key: k }).scoring, 'closed');
    assert.equal(b.post({ action: 'score.state', key: op, op: 'open' }).scoring, 'open');
    assert.equal(save(b, k, '03', { idea: 10 }).ok, true);
  });

  test('시트 메뉴 "심사 종합 만들기" 가 `종합` 탭을 쓴다', () => {
    const b = sb();
    const A = judge(b, '가 교수님');
    save(b, A, '03', { idea: 20, done: 20, ux: 20, arch: 20 });
    b.run('scoreReport');
    const rows = b.scoreBook().getSheetByName('종합').cells;
    assert.deepEqual(rows[0].slice(0, 5), ['트랙', '순위', '팀', '프로젝트', '가 교수님']);
    const r03 = rows.find((r) => r[2] === '03');
    assert.deepEqual([r03[0], r03[1], r03[4], r03[5]], ['구현과제', 1, 80, 80]);
    assert.match(b.logs.at(-1), /`종합` 탭을 새로 썼습니다/);
  });
});


describe('시각 컷 (본선 시간표)', () => {
  const T = { ...TOKENS, 'tok-d1': token('d1@x.com', '701') };
  function cb(extra = {}) {
    const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: T, ...extra });
    b.roster([
      ['03', '가나다', 'a1@x.com', '101', '조장', ''],
      ['12', '사아자', 'b1@x.com', '201', '조장', ''],
      ['15', '마바사', 'd1@x.com', '701', '조장', ''],
    ]);
    return b;
  }
  const st = (b, key) => b.post({ action: 'vote.me', idToken: 'tok-a1' }).tracks.find((t) => t.key === key);
  const vote = (b, idToken, track, teams) => b.post({ action: 'vote.submit', idToken, track, teams });
  const admin = (b, track, op) => b.post({ action: 'vote.admin', idToken: 'tok-op', track, op });
  const ms = (iso) => Date.parse(iso);

  test('화면 순서는 발표 순서대로 해커톤 → 구현과제 (팀 번호는 그대로)', () => {
    const b = cb();
    const me = b.post({ action: 'vote.me', idToken: 'tok-a1' });
    assert.deepEqual(me.tracks.map((t) => [t.key, t.name, t.teams[0].no, t.teams.at(-1).no]), [['H', '해커톤', '11', '20'], ['A', '구현과제', '01', '10']]);
    assert.deepEqual(me.me, { team: '03', track: '구현과제', trackKey: 'A', name: '가나다' });
  });

  test('투표는 시간표대로 저절로 열리고 닫힌다 — 해커톤 12:12–12:27, 구현과제 14:15–14:25', () => {
    const b = cb();
    b.at('2026-11-14T12:11:59+09:00');
    assert.deepEqual([st(b, 'H').state, st(b, 'A').state], ['ready', 'ready']);
    assert.deepEqual([st(b, 'H').from, st(b, 'H').until], [ms('2026-11-14T12:12:00+09:00'), ms('2026-11-14T12:27:00+09:00')]);
    assert.equal(vote(b, 'tok-a1', 'H', ['12']).error, 'VOTE_NOT_OPEN');
    b.at('2026-11-14T12:12:00+09:00');
    assert.equal(st(b, 'H').state, 'open');
    assert.equal(vote(b, 'tok-a1', 'H', ['12']).ok, true);
    assert.equal(vote(b, 'tok-a1', 'A', ['01']).error, 'VOTE_NOT_OPEN');     // 구현과제는 아직
    assert.equal(vote(b, 'tok-b1', 'H', ['12']).error, 'VOTE_SELF');          // 자기 팀에는 못 준다
    b.at('2026-11-14T12:27:00+09:00');
    assert.equal(st(b, 'H').state, 'closed');
    assert.equal(vote(b, 'tok-b1', 'H', ['15']).error, 'VOTE_CLOSED');
    b.at('2026-11-14T14:15:00+09:00');
    assert.deepEqual([st(b, 'H').state, st(b, 'A').state], ['closed', 'open']);
    assert.equal(vote(b, 'tok-b1', 'A', ['03']).ok, true);
    assert.equal(vote(b, 'tok-a1', 'A', ['03']).error, 'VOTE_SELF');
    b.at('2026-11-14T14:25:00+09:00');
    assert.equal(vote(b, 'tok-d1', 'A', ['03']).error, 'VOTE_CLOSED');
    const tl = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally;      // 낸 표는 그대로 센다
    assert.deepEqual(tl.map((t) => [t.key, t.votes, t.state]), [['H', 1, 'closed'], ['A', 1, 'closed']]);
  });

  test('잠금을 기다리는 사이에 마감 시각이 지나도, 마감 전에 들어온 표는 받는다', () => {
    const b = cb();
    const at = ms('2026-11-14T12:26:59+09:00');
    b.at('2026-11-14T12:27:05+09:00');
    assert.equal(b.ctx.voteState_('H', at), 'open');
    assert.equal(b.ctx.voteState_('H'), 'closed');
  });

  test('운영진: 5분 늦추기 · 지금 열기 · 5분 연장 · 마감 · 다시 열기(10분) · 시간표대로', () => {
    const b = cb();
    b.at('2026-11-14T12:05:00+09:00');
    assert.equal(admin(b, 'H', 'extend').error, 'VOTE_NOT_OPEN');            // 열리기 전에는 연장이 없다
    let r = admin(b, 'H', 'delay');                                           // 발표가 밀린다
    assert.deepEqual([r.ok, r.from, r.until], [true, ms('2026-11-14T12:17:00+09:00'), ms('2026-11-14T12:32:00+09:00')]);
    assert.equal(b.store.VOTE_H_FROM, '2026-11-14T12:17:00+09:00');           // 스크립트 속성에 적는다
    assert.equal(st(b, 'H').state, 'ready');
    r = admin(b, 'H', 'open');                                                // 일찍 끝났다 — 지금 연다
    assert.deepEqual([r.state, r.from, r.until], ['open', ms('2026-11-14T12:05:00+09:00'), ms('2026-11-14T12:32:00+09:00')]);
    assert.equal(admin(b, 'H', 'delay').error, 'VOTE_NOT_READY');
    assert.equal(admin(b, 'H', 'extend').until, ms('2026-11-14T12:37:00+09:00'));
    b.at('2026-11-14T12:20:00+09:00');
    r = admin(b, 'H', 'close');
    assert.deepEqual([r.state, r.until], ['closed', ms('2026-11-14T12:20:00+09:00')]);
    assert.equal(vote(b, 'tok-a1', 'H', ['12']).error, 'VOTE_CLOSED');
    assert.equal(admin(b, 'H', 'close').error, 'VOTE_NOT_OPEN');
    r = admin(b, 'H', 'open');                                                // 다시 열기 → 10분 뒤 저절로 닫힘
    assert.deepEqual([r.state, r.until], ['open', ms('2026-11-14T12:30:00+09:00')]);
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'H').custom, true);
    r = admin(b, 'H', 'auto');                                                // 시간표대로
    assert.deepEqual([r.from, r.until], [ms('2026-11-14T12:12:00+09:00'), ms('2026-11-14T12:27:00+09:00')]);
    assert.equal(b.store.VOTE_H_FROM, undefined);
    assert.equal(b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'H').custom, false);
    assert.ok(b.rows('기록').some((l) => l['동작'] === 'vote.delay' && l['메모'] === '12:17–12:32'));
    assert.equal(b.post({ action: 'vote.admin', idToken: 'tok-a1', track: 'H', op: 'open' }).error, 'NOT_ADMIN');
    assert.equal(admin(b, 'H', 'wipe').error, 'BAD_OP');
  });

  test('운영진: 같은 누름을 다시 보내도 5분 연장 · 5분 늦추기는 한 번만 된다 (nonce)', () => {
    const b = cb();
    b.at('2026-11-14T12:05:00+09:00');
    const send = (op, nonce) => b.post({ action: 'vote.admin', idToken: 'tok-op', track: 'H', op, nonce });
    assert.equal(send('delay', 'n-1').from, ms('2026-11-14T12:17:00+09:00'));
    const again = send('delay', 'n-1');                                       // 응답이 끊겨 화면이 다시 보냈다
    assert.deepEqual([again.ok, again.replay, again.from], [true, true, ms('2026-11-14T12:17:00+09:00')]);
    assert.equal(b.store.VOTE_H_FROM, '2026-11-14T12:17:00+09:00');
    assert.equal(send('delay', 'n-2').from, ms('2026-11-14T12:22:00+09:00'));   // 새로 누르면 또 늦춘다
    b.at('2026-11-14T12:23:00+09:00');
    assert.equal(send('extend', 'n-3').until, ms('2026-11-14T12:42:00+09:00'));
    assert.equal(send('extend', 'n-3').until, ms('2026-11-14T12:42:00+09:00'));
    assert.equal(b.rows('기록').filter((l) => l['동작'] === 'vote.extend').length, 1);
  });

  test('스크립트 속성에 손으로 적어도 된다 (서울 시각) · none 이면 그쪽 끝이 없다', () => {
    const b = cb({ props: { ADMINS: 'op@x.com', VOTE_H_FROM: '2026-11-14 11:00', VOTE_H_UNTIL: 'none' } });
    b.at('2026-11-14T10:59:00+09:00');
    assert.equal(st(b, 'H').state, 'ready');
    b.at('2026-11-14T11:00:00+09:00');
    assert.equal(st(b, 'H').state, 'open');
    b.at('2026-11-14T20:00:00+09:00');
    assert.deepEqual([st(b, 'H').state, st(b, 'H').until], ['open', 0]);    // 마감 시각이 없으면 운영진이 닫을 때까지
  });

  test('심사 점수는 14:25 에 저절로 마감 · 운영진 다시 열기(10분) · 시간표대로 · 지금 마감', () => {
    const b = cb();
    b.run('setup');
    const k = b.viewer('한 교수님', '심사위원'), op = b.viewer('박운영', '운영진');
    const save = (team) => b.post({ action: 'score.save', key: k, team, scores: { idea: 20 } });
    b.at('2026-11-14T14:24:59+09:00');
    assert.equal(save('03').ok, true);
    const v = b.post({ action: 'view.list', key: k });
    assert.deepEqual([v.scoring, v.scoreUntil], ['open', ms('2026-11-14T14:25:00+09:00')]);
    b.at('2026-11-14T14:25:00+09:00');
    assert.equal(save('03').error, 'SCORE_CLOSED');
    assert.equal(b.post({ action: 'view.list', key: k }).scoring, 'closed');
    assert.equal(b.post({ action: 'score.state', key: k, op: 'open' }).error, 'NOT_STAFF');
    let r = b.post({ action: 'score.state', key: op, op: 'open' });
    assert.deepEqual([r.scoring, r.scoreUntil, r.scoreCustom], ['open', ms('2026-11-14T14:35:00+09:00'), true]);
    assert.equal(save('05').ok, true);
    b.at('2026-11-14T14:35:00+09:00');
    assert.equal(save('05').error, 'SCORE_CLOSED');                           // 10분 뒤 저절로
    r = b.post({ action: 'score.state', key: op, op: 'auto' });
    assert.deepEqual([r.scoring, r.scoreUntil, r.scoreCustom], ['closed', ms('2026-11-14T14:25:00+09:00'), false]);
    b.at('2026-11-14T13:00:00+09:00');
    r = b.post({ action: 'score.state', key: op, op: 'close' });              // 일찍 마감
    assert.deepEqual([r.scoring, r.scoreUntil], ['closed', ms('2026-11-14T13:00:00+09:00')]);
    b.post({ action: 'score.state', key: op, op: 'auto' });
    assert.equal(save('03').ok, true);
    b.prop('SCORE_CLOSED', 'true');                                           // 예전 마감 버튼이 남긴 값도 마감으로 본다
    assert.equal(save('03').error, 'SCORE_CLOSED');
    assert.ok(b.rows('기록').some((l) => l['동작'] === 'score.open' && l['누가'] === '열람:박운영'));
  });

  test('비중을 바꾸면 참가자 점수 만점도 따라 바뀐다 (JUDGE_WEIGHT · POP_FULL_X)', () => {
    const b = cb({ props: { ADMINS: 'op@x.com', JUDGE_WEIGHT: '0.8', POP_FULL_X: '1' } });
    b.at('2026-11-14T12:15:00+09:00');
    assert.equal(vote(b, 'tok-a1', 'H', ['12']).ok, true);
    const h = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'H');
    assert.deepEqual([h.popMax, h.popFull, h.full], [20, 1, 0.1]);
    assert.equal(h.rows.find((r) => r.no === '12').p, 20);                    // 평균 0.1표의 1배 이상 → 만점 20
  });
});

describe('연습용 팀 파일', () => {
  test('심사위원 토큰으로는 연습용 팀(00) 파일을 받을 수 없다 (운영진은 된다)', () => {
    const b = backend();
    const { fin } = upload(b, { idToken: 'tok-op', as: '00' });
    const id = fin.state.deck.id;
    assert.equal(b.post({ action: 'file.get', key: b.viewer('심사'), id }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'file.get', key: b.viewer('운영', '운영진'), id }).ok, true);
  });
});

describe('공개 현황판 (로그인 없이 — 메인 메뉴 제출·투표 현황)', () => {
  const T = { ...TOKENS, 'tok-d1': token('d1@x.com', '701') };
  function pb(extra = {}) {
    const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: T, ...extra });
    b.roster([['03', '가나다', 'a1@x.com', '101', '조장', ''], ['12', '사아자', 'b1@x.com', '201', '조장', ''], ['15', '마바사', 'd1@x.com', '701', '조장', '']]);
    return b;
  }
  const pub = (b) => b.post({ action: 'status.public' });
  const ms = (iso) => Date.parse(iso);

  test('누구나 본다 — 팀 번호 · 낸 것의 유무 · 투표한 사람 수만 (프로젝트 이름 · 링크 · 이메일 · 득표 · 연습팀 없음)', () => {
    const b = pb();
    b.at('2026-11-14T09:00:00+09:00');
    b.post({ action: 'info.save', idToken: 'tok-a1', data: { title: '비밀 프로젝트', url: 'https://secret.example.app' } });
    upload(b, { idToken: 'tok-a1' });
    upload(b, { idToken: 'tok-op', as: '00' });
    b.at('2026-11-14T09:05:00+09:00');
    const r = pub(b);
    assert.equal(r.ok, true);
    assert.equal(r.submit.teams.length, 20);
    assert.deepEqual(r.submit.teams.slice(0, 2).map((t) => t.no), ['11', '12']);           // 발표 순서: 해커톤 먼저
    assert.deepEqual(r.submit.teams.find((t) => t.no === '03'), { no: '03', track: 'A', deck: true, product: true, done: true });
    assert.deepEqual(r.submit.sum, { teams: 20, complete: 1, deck: 1, product: 1 });
    const text = JSON.stringify(r);
    assert.ok(!/비밀 프로젝트|secret\.example|@x\.com|가나다|drive|"00"|token/.test(text), text.slice(0, 400));
    assert.deepEqual(r.vote.tracks.map((t) => [t.key, t.name, t.state, t.voters]), [['H', '해커톤', 'ready', 0], ['A', '구현과제', 'ready', 0]]);
    assert.equal(r.vote.eligible, 3);
    assert.equal(r.vote.tracks[0].rows, undefined);                                         // 팀별 득표는 없다
  });

  test('제출 현황은 5분, 투표한 사람 수는 1분마다 새로 센다 — 그 사이에는 같은 값, 열림 · 닫힘은 바로', () => {
    const b = pb();
    b.at('2026-11-14T09:00:10+09:00');
    let r = pub(b);
    assert.deepEqual([r.submit.sum.deck, r.submit.every, r.submit.next], [0, 300, ms('2026-11-14T09:05:00+09:00')]);
    upload(b, { idToken: 'tok-a1' });
    b.at('2026-11-14T09:04:59+09:00');
    assert.equal(pub(b).submit.sum.deck, 0);
    b.at('2026-11-14T09:05:00+09:00');
    r = pub(b);
    assert.deepEqual([r.submit.sum.deck, r.submit.at], [1, ms('2026-11-14T09:05:00+09:00')]);
    b.at('2026-11-14T12:12:05+09:00');
    r = pub(b);
    assert.deepEqual(r.vote.tracks.map((t) => [t.key, t.state, t.voters]), [['H', 'open', 0], ['A', 'ready', 0]]);
    assert.deepEqual([r.vote.every, r.vote.next], [60, ms('2026-11-14T12:13:00+09:00')]);
    assert.equal(b.post({ action: 'vote.submit', idToken: 'tok-a1', track: 'H', teams: ['12'] }).ok, true);
    b.at('2026-11-14T12:12:59+09:00');
    assert.equal(pub(b).vote.tracks[0].voters, 0);
    b.at('2026-11-14T12:13:00+09:00');
    assert.equal(pub(b).vote.tracks[0].voters, 1);
    b.at('2026-11-14T12:27:00+09:00');
    assert.equal(pub(b).vote.tracks[0].state, 'closed');
  });

  test('간격은 스크립트 속성으로 바꿀 수 있다 (BOARD_SUBMIT_SEC · BOARD_VOTE_SEC)', () => {
    const b = pb({ props: { ADMINS: 'op@x.com', BOARD_SUBMIT_SEC: '60', BOARD_VOTE_SEC: '30' } });
    b.at('2026-11-14T09:00:10+09:00');
    const r = pub(b);
    assert.deepEqual([r.submit.every, r.vote.every, r.submit.next, r.vote.next],
      [60, 30, ms('2026-11-14T09:01:00+09:00'), ms('2026-11-14T09:00:30+09:00')]);
  });
});

describe('발표 자료 보기용 PDF (PowerPoint · odp)', () => {
  const pdfRow = (b, id) => b.rows('파일').find((x) => Number(x['번호']) === id);
  const folderName = (b, f) => b.drive.folders.get(f.parents[0])?.name;

  test('pptx 를 올리면 보기용 PDF 를 만들고, 심사위원은 PDF 로 본다 (원본은 그대로 받기)', () => {
    const b = backend();
    const { fin } = upload(b, { name: '발표.pptx', bytes: bytesOf(5000, 3) });
    const id = fin.state.deck.id;
    assert.equal(fin.state.deck.pdf, undefined);
    const r = b.post({ action: 'deck.pdf', idToken: 'tok-a1', id });
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = pdfRow(b, id);
    assert.ok(row['PDF ID'] && Number(row['PDF 크기']) > 0);
    assert.ok([...b.drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.presentation').every((f) => f.trashed));   // 중간 사본은 휴지통
    const pdf = b.drive.files.get(row['PDF ID']);
    assert.match(pdf.name, /^team03_발표_v1_.*_보기용\.pdf$/);
    assert.equal(folderName(b, pdf), 'team03');                                // 원본 옆
    const key = b.viewer('심사');
    const t3 = b.post({ action: 'view.list', key }).tracks.find((t) => t.name === '구현과제').teams.find((t) => t.no === '03');
    assert.equal(t3.deck.pdf, Number(row['PDF 크기']));
    assert.equal(t3.deck.pdfUrl, undefined);                                   // 심사위원에게 Drive 주소는 없다
    const g = b.post({ action: 'file.get', key, id, variant: 'pdf' });
    assert.deepEqual([g.ok, g.mime, g.variant], [true, 'application/pdf', 'pdf']);
    assert.match(g.name, /_보기용\.pdf$/);
    assert.match(Buffer.from(g.data, 'base64').toString('utf8'), /^%PDF-1\.7/);
    assert.equal(b.post({ action: 'file.get', key, id }).size, 5000);          // 원본은 그대로
    const n = b.drive.exports;
    assert.equal(b.post({ action: 'deck.pdf', key, id }).ok, true);           // 이미 있으면 다시 만들지 않는다
    assert.equal(b.drive.exports, n);
  });

  test('PowerPoint 계열 · odp 는 모두 바꾸고, PDF · 영상 · Keynote 는 바꾸지 않는다', () => {
    for (const ext of ['ppt', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'odp']) {
      const b = backend();
      const { fin } = upload(b, { name: '발표.' + ext, bytes: bytesOf(700, 5) });
      assert.equal(b.post({ action: 'deck.pdf', idToken: 'tok-a1', id: fin.state.deck.id }).ok, true, ext);
    }
    for (const ext of ['pdf', 'mp4', 'key']) {
      const b = backend();
      const { fin } = upload(b, { name: '발표.' + ext, bytes: bytesOf(700, 5) });
      assert.equal(b.post({ action: 'deck.pdf', idToken: 'tok-a1', id: fin.state.deck.id }).error, 'NOT_CONVERTIBLE', ext);
    }
  });

  test('다른 팀 사람은 부를 수 없고, 틀린 토큰도 안 된다', () => {
    const b = backend();
    const { fin } = upload(b, { name: '발표.pptx' });
    assert.equal(b.post({ action: 'deck.pdf', idToken: 'tok-b1', id: fin.state.deck.id }).error, 'NOT_FOUND');
    assert.equal(b.post({ action: 'deck.pdf', key: 'x'.repeat(40), id: fin.state.deck.id }).error, 'KEY_INVALID');
    assert.equal(b.post({ action: 'file.get', key: b.viewer('심사'), id: fin.state.deck.id, variant: 'pdf' }).error, 'NO_PDF');
  });

  test('10MB 넘는 내보내기는 Apps Script 변환으로 · 바꾸지 못하면 PDF_FAILED (제출은 그대로)', () => {
    const b = backend();
    const { fin } = upload(b, { name: '큰발표.pptx', bytes: bytesOf(3000, 1) });
    b.drive.exportLimit = 100;
    assert.equal(b.post({ action: 'deck.pdf', idToken: 'tok-a1', id: fin.state.deck.id }).ok, true);
    assert.equal(b.drive.getAs, 1);
    const c = backend();
    const up = upload(c, { name: '깨진발표.pptx' });
    c.drive.convertFail = true;
    const r = c.post({ action: 'deck.pdf', idToken: 'tok-a1', id: up.fin.state.deck.id });
    assert.equal(r.error, 'PDF_FAILED');
    assert.equal(c.post({ action: 'me', idToken: 'tok-a1' }).state.deck.id, up.fin.state.deck.id);   // 제출은 그대로
    assert.equal(c.isLocked(), false);
  });

  test('다시 올리거나 내리면 보기용 PDF 도 옛날 자료로 옮긴다', () => {
    const b = backend();
    const first = upload(b, { name: 'v1.pptx', bytes: bytesOf(800, 1) });
    b.post({ action: 'deck.pdf', idToken: 'tok-a1', id: first.fin.state.deck.id });
    const pdf1 = b.drive.files.get(pdfRow(b, first.fin.state.deck.id)['PDF ID']);
    const second = upload(b, { name: 'v2.pptx', bytes: bytesOf(900, 2) });
    assert.equal(folderName(b, pdf1), '옛날 자료');
    b.post({ action: 'deck.pdf', idToken: 'tok-a1', id: second.fin.state.deck.id });
    const pdf2 = b.drive.files.get(pdfRow(b, second.fin.state.deck.id)['PDF ID']);
    assert.equal(b.post({ action: 'file.withdraw', idToken: 'tok-a1', kind: 'deck' }).ok, true);
    assert.equal(folderName(b, pdf2), '옛날 자료');
  });

  test('시트 메뉴 "발표 자료 PDF 만들기": 빠진 것만 한꺼번에', () => {
    const b = backend();
    upload(b, { name: 'a.pptx' });
    upload(b, { idToken: 'tok-b1', name: 'b.odp' });
    upload(b, { idToken: 'tok-op', as: '05', name: 'c.pdf' });
    assert.deepEqual(b.run('pdfMissing'), { todo: 2, done: 2, bad: 0, left: 0 });
    assert.deepEqual(b.run('pdfMissing'), { todo: 0, done: 0, bad: 0, left: 0 });
  });
});

describe('투표 줄이 시트에서 바뀌어도 (최악의 경우)', () => {
  test('시트가 시각을 날짜로, 숫자처럼 보이는 글자를 숫자로 바꿔도 다시 읽어 글자로 고쳐 쓰고, 표는 그대로 센다', () => {
    const T = { ...TOKENS, 'tok-d1': token('d1@x.com', '701') };
    const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: T });
    b.roster([['03', '가나다', 'a1@x.com', '101', '조장', ''], ['12', '사아자', 'b1@x.com', '201', '조장', ''], ['15', '마바사', 'd1@x.com', '701', '조장', '']]);
    b.at('2026-11-14T12:15:00+09:00');
    FakeSheet.misparse = true;
    try {
      assert.equal(b.post({ action: 'vote.submit', idToken: 'tok-a1', track: 'H', teams: ['12', '15'] }).ok, true);
      assert.equal(b.post({ action: 'vote.submit', idToken: 'tok-b1', track: 'H', teams: ['15'] }).ok, true);
    } finally { FakeSheet.misparse = false; }
    const rows = b.rows('투표');
    assert.ok(rows.every((r) => typeof r['시각'] === 'string' && typeof r['대상 팀'] === 'string'), JSON.stringify(rows[0]));
    const h = b.post({ action: 'vote.me', idToken: 'tok-op' }).tally.find((t) => t.key === 'H');
    assert.deepEqual([h.voters, h.votes, h.bad], [2, 3, 0]);
  });
});

describe('발표 순서 — 트랙마다 마지막 제출이 늦은 팀부터 (11-14 공지)', () => {
  const T = { ...TOKENS, 'tok-c1': token('c1@x.com', '601'), 'tok-c2': token('c2@x.com', '602'), 'tok-d1': token('d1@x.com', '701') };
  function ob() {
    const b = loadBackend({ props: { ADMINS: 'op@x.com' }, tokens: T });
    b.roster([['01', '일팀', 'c1@x.com', '601', '조장', ''], ['02', '이팀', 'c2@x.com', '602', '조장', ''], ['03', '가나다', 'a1@x.com', '101', '조장', ''],
              ['12', '사아자', 'b1@x.com', '201', '조장', ''], ['15', '마바사', 'd1@x.com', '701', '조장', '']]);
    return b;
  }
  const save = (b, tok, title) => assert.equal(b.post({ action: 'info.save', idToken: tok, data: { title } }).ok, true);
  const nos = (r, name) => r.tracks.find((t) => t.name === name).teams.map((t) => t.no);
  const ranks = (r, name) => r.tracks.find((t) => t.name === name).teams.map((t) => t.rank);

  test('공지 예시: 8시에 낸 01팀 · 10시에 낸 02팀이면 02팀이 먼저 — 안 낸 팀은 맨 뒤 (팀 번호 순)', () => {
    const b = ob();
    b.at('2026-11-14T08:00:00+09:00'); save(b, 'tok-c1', '일팀 서비스');
    b.at('2026-11-14T09:00:00+09:00'); save(b, 'tok-a1', '삼팀 서비스');
    b.at('2026-11-14T10:00:00+09:00'); save(b, 'tok-c2', '이팀 서비스');
    const r = b.post({ action: 'view.list', key: b.viewer('홍길동 교수님') });
    assert.deepEqual(nos(r, '구현과제'), ['02', '03', '01', '04', '05', '06', '07', '08', '09', '10']);
    assert.deepEqual(ranks(r, '구현과제'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(r.orderFinal, false);                                   // 유예(10:05)가 끝나야 확정
  });

  test('파일을 올려도 · 다시 올려도 마지막 제출 시각이 바뀐다 (해커톤 트랙도 따로 센다)', () => {
    const b = ob();
    b.at('2026-11-14T08:30:00+09:00'); save(b, 'tok-b1', '십이팀');
    b.at('2026-11-14T09:10:00+09:00'); save(b, 'tok-d1', '십오팀');
    b.at('2026-11-14T09:40:00+09:00'); upload(b, { idToken: 'tok-b1' });
    const r = b.post({ action: 'view.list', key: b.viewer('홍길동 교수님') });
    assert.deepEqual(nos(r, '해커톤').slice(0, 3), ['12', '15', '11']);
  });

  test('마감(+유예) 뒤에 운영진이 대신 올려도 마지막 제출 시각 · 순서는 그대로 (기록에는 남는다)', () => {
    const b = ob();
    b.at('2026-11-14T08:00:00+09:00'); save(b, 'tok-c1', '일팀');
    b.at('2026-11-14T09:00:00+09:00'); save(b, 'tok-c2', '이팀');
    b.at('2026-11-14T10:20:00+09:00');
    upload(b, { idToken: 'tok-op', as: '01' });                         // 늦은 팀 구제
    const row = b.rows('팀').find((x) => x['팀'] === '01');
    assert.equal(row['마지막 제출'], '2026-11-14 08:00:00');
    assert.ok(row['발표 자료']);
    const r = b.post({ action: 'view.list', key: b.viewer('홍길동 교수님') });
    assert.deepEqual(nos(r, '구현과제').slice(0, 2), ['02', '01']);
    assert.equal(r.orderFinal, true);
    assert.ok(b.rows('기록').some((x) => x['동작'] === 'upload.finish' && String(x['팀']) === '01'));
  });

  test("`팀` 탭 '순서' 칸에 숫자를 적은 팀은 그 숫자대로 앞에 선다 (운영진이 손으로)", () => {
    const b = ob();
    b.at('2026-11-14T08:00:00+09:00'); save(b, 'tok-c1', '일팀');
    b.at('2026-11-14T09:00:00+09:00'); save(b, 'tok-c2', '이팀');
    const sh = b.tab('팀'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const rowNo = sh.objects().findIndex((x) => x['팀'] === '01') + 2;
    sh.getRange(rowNo, head.indexOf('순서') + 1).setValue(1);
    b.ctx.refreshStates_();                                             // 시트를 손으로 고친 것은 캐시(5분)가 지나면 반영된다
    const r = b.post({ action: 'view.list', key: b.viewer('홍길동 교수님') });
    assert.deepEqual(nos(r, '구현과제').slice(0, 3), ['01', '02', '03']);
  });

  test('공개 현황판: 마감 전에는 순서가 없고, 10:00 이 지나면 순서 · 마지막 제출 시각, 유예가 끝나면 확정', () => {
    const b = ob();
    b.at('2026-11-14T08:00:00+09:00'); save(b, 'tok-c1', '일팀');
    b.at('2026-11-14T09:59:00+09:00'); save(b, 'tok-c2', '이팀');
    let r = b.post({ action: 'status.public' });
    assert.equal(r.submit.order, null);
    b.at('2026-11-14T10:01:00+09:00');
    r = b.post({ action: 'status.public' });
    assert.equal(r.submit.order.final, false);
    b.at('2026-11-14T10:05:01+09:00');                                  // 유예 끝 — 같은 5분 칸이어도 바로 새로 센다
    r = b.post({ action: 'status.public' });
    assert.equal(r.submit.order.final, true);
    const A = r.submit.order.tracks.find((t) => t.key === 'A');
    assert.deepEqual(A.teams.slice(0, 3).map((t) => [t.no, t.rank]), [['02', 1], ['01', 2], ['03', 3]]);
    assert.equal(A.teams[0].at, Date.parse('2026-11-14T09:59:00+09:00'));
    assert.equal(A.teams[2].at, 0);                                     // 안 낸 팀
    assert.deepEqual(r.submit.order.tracks.map((t) => t.key), ['H', 'A']);
    assert.ok(!/일팀|이팀|@x\.com/.test(JSON.stringify(r)));               // 이름 · 이메일은 여전히 없다
  });
});

describe('결과 발표 — 운영진이 심사 마감(결과 발표)을 누르면 메인 페이지에 · 시상 화면', () => {
  const ms = (iso) => Date.parse(iso);
  const four = (n) => ({ idea: n, done: n, ux: n, arch: n });
  function rb() {
    const b = backend();
    b.run('setup');
    b.at('2026-11-14T09:00:00+09:00');                                     // 제출 마감 전에 이름을 적었다
    assert.equal(b.post({ action: 'info.save', idToken: 'tok-b1', data: { title: '십이팀 서비스' } }).ok, true);
    b.at('2026-11-14T13:00:00+09:00');
    const prof = b.viewer('홍길동 교수님', '심사위원');
    // 구현과제: 02 100 · 04 88 · 01 80 · 03 60 · 05 40 · 06 은 덜 채움 / 해커톤: 11 96 · 12 92 · 13 = 14 84 (동점) · 15 72 · 16 68 · 17 64 · 18 48
    for (const [no, n] of [['01', 20], ['02', 25], ['03', 15], ['04', 22], ['05', 10], ['11', 24], ['12', 23], ['13', 21], ['14', 21], ['15', 18], ['16', 17], ['17', 16], ['18', 12]]) {
      assert.equal(b.post({ action: 'score.save', key: prof, team: no, scores: four(n) }).ok, true, no);
    }
    assert.equal(b.post({ action: 'score.save', key: prof, team: '06', scores: { idea: 25 } }).ok, true);
    return { b, op: b.viewer('운영 담당', '운영진'), prof };
  }
  const pub = (b) => b.post({ action: 'results.public' });
  const shape = (r, key) => r.tracks.find((t) => t.key === key).places.map((p) => [p.place, p.teams.map((t) => t.no)]);

  test('14:25 에 저절로 마감돼도 메인에는 안 뜬다 — 운영진이 결과 발표를 누르면 뜬다', () => {
    const { b, op } = rb();
    let r = pub(b);
    assert.deepEqual([r.ok, r.state, r.at, r.tracks], [true, 'judging', -1, undefined]);
    b.at('2026-11-14T14:40:00+09:00');                                   // 심사 · 투표 모두 마감 (시각으로)
    r = pub(b);
    assert.deepEqual([r.state, r.tracks], ['ready', undefined]);
    const s = b.post({ action: 'results.state', key: op, op: 'now' });
    assert.deepEqual([s.ok, s.results.state], [true, 'open']);
    r = pub(b);
    assert.equal(r.state, 'open');
    assert.deepEqual(r.tracks.map((t) => [t.key, t.name]), [['H', '해커톤'], ['A', '구현과제']]);
  });

  test("'심사 마감' 단추 = 결과 발표 — 구현과제 투표가 아직이면 투표가 마감되는 순간 뜬다", () => {
    const { b, op } = rb();
    b.at('2026-11-14T14:20:00+09:00');                                   // 구현과제 투표 14:15 – 14:25 진행 중
    assert.equal(b.post({ action: 'score.state', key: op, op: 'close' }).scoring, 'closed');
    assert.equal(b.store.RESULTS_AT, '2026-11-14T14:20:00+09:00');
    assert.equal(pub(b).state, 'judging');                                // 투표가 끝나야 P 가 정해진다
    b.at('2026-11-14T14:25:00+09:00');
    assert.equal(pub(b).state, 'open');
    assert.equal(b.post({ action: 'score.summary', key: op }).results.state, 'open');
  });

  test('최종 S 순서대로 상금표에 맞춰 — 해커톤 1등 1 · 2등 2 · 3등 3, 구현과제 1 – 4등 (동점은 같은 등수, 덜 채운 팀은 빠진다)', () => {
    const { b, op } = rb();
    b.at('2026-11-14T14:31:00+09:00');
    b.post({ action: 'results.state', key: op, op: 'now' });
    const r = pub(b);
    assert.deepEqual(shape(r, 'A'), [[1, ['02']], [2, ['04']], [3, ['01']], [4, ['03']]]);
    assert.deepEqual(shape(r, 'H'), [[1, ['11']], [2, ['12', '13', '14']], [3, ['15', '16']]]);
    assert.equal(r.tracks.find((t) => t.key === 'H').places[1].teams[0].title, '십이팀 서비스');
    const text = JSON.stringify(r);
    assert.ok(!/교수님|@x\.com|"S"|"J"|"P"|"s"|comment|가나다/.test(text), text.slice(0, 300));      // 메인에는 등수 · 팀 · 프로젝트 이름만
  });

  test('시상 화면 (운영진만): 등수마다 팀 · 프로젝트 이름 · 최종 S — 공개 전에도 (리허설)', () => {
    const { b, op, prof } = rb();
    assert.equal(b.post({ action: 'results.award', key: prof }).error, 'NOT_STAFF');
    assert.equal(b.post({ action: 'results.award', key: 'x'.repeat(40) }).error, 'KEY_INVALID');
    const r = b.post({ action: 'results.award', key: op });
    assert.deepEqual([r.ok, r.scoring, r.results.state], [true, 'open', 'judging']);
    const A = r.tracks.find((t) => t.key === 'A');
    assert.deepEqual(A.places.map((p) => p.teams.map((t) => [t.no, t.s])), [[['02', 85]], [['04', 74.8]], [['01', 68]], [['03', 51]]]);   // 0.85 × J (투표 0)
    assert.ok(!/@x\.com|교수님|comment/.test(JSON.stringify(r)));
  });

  test('운영진: 결과 내리기 · 시간표대로(=누를 때까지 안 뜸), 심사를 다시 열면 저절로 내려가고 다시 마감되면 다시 뜬다', () => {
    const { b, op, prof } = rb();
    assert.equal(b.post({ action: 'results.state', key: op, op: 'now' }).error, 'RESULTS_NOT_READY');   // 심사 중에는 공개 못 함
    assert.equal(b.post({ action: 'results.state', key: prof, op: 'now' }).error, 'NOT_STAFF');
    b.at('2026-11-14T14:26:00+09:00');
    assert.equal(b.post({ action: 'results.state', key: op, op: 'now' }).results.state, 'open');
    let s = b.post({ action: 'results.state', key: op, op: 'hide' });
    assert.deepEqual([s.results.state, s.results.at], ['ready', -1]);
    assert.equal(pub(b).tracks, undefined);
    s = b.post({ action: 'results.state', key: op, op: 'auto' });
    assert.deepEqual([s.results.state, s.results.custom], ['ready', false]);
    b.post({ action: 'results.state', key: op, op: 'now' });
    assert.equal(b.post({ action: 'score.state', key: op, op: 'open' }).ok, true);   // 점수를 고치려고 다시 열면
    assert.equal(pub(b).state, 'judging');
    b.at('2026-11-14T14:37:00+09:00');                                   // 10분 뒤 저절로 다시 마감
    assert.equal(pub(b).state, 'open');
    assert.ok(b.rows('기록').some((l) => l['동작'] === 'results.now'));
    assert.equal(b.post({ action: 'results.state', key: op, op: 'wipe' }).error, 'BAD_OP');
  });

  test('스크립트 속성 RESULTS_AT 에 시각을 적으면 그 시각에 저절로', () => {
    const { b } = rb();
    b.store.RESULTS_AT = '2026-11-14 14:30'; b.ctx.propsDrop_();
    b.at('2026-11-14T14:29:00+09:00');
    assert.equal(pub(b).state, 'ready');
    b.at('2026-11-14T14:30:00+09:00');
    assert.equal(pub(b).state, 'open');
  });

  test("RESULTS_AT 이 'none' 이면 마감되는 대로 바로", () => {
    const { b } = rb();
    b.store.RESULTS_AT = 'none'; b.ctx.propsDrop_();
    b.at('2026-11-14T14:25:00+09:00');
    assert.equal(pub(b).state, 'open');
  });
});
