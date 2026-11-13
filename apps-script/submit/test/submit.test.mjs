import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, token, bytesOf, md5 } from './harness.mjs';

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
    assert.deepEqual(r.tracks.map((t) => [t.name, t.teams.length]), [['구현과제', 10], ['해커톤', 10]]);
    assert.deepEqual(r.summary, { teams: 20, complete: 1, deck: 1, product: 1, title: 2 });
    const t3 = r.tracks[0].teams.find((t) => t.no === '03');
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
    const t3 = r.tracks[0].teams.find((t) => t.no === '03');
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
    const teams = b.post({ action: 'view.list', key }).tracks[0].teams.map((t) => t.no);
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
    assert.ok(b.post({ action: 'view.list', key }).tracks[1].teams.find((t) => t.no === '12').deck);
  });
});

describe('운영진 메뉴', () => {
  test('처음 설정: 탭과 팀 폴더를 만든다', () => {
    const b = loadBackend({ tokens: TOKENS });
    b.ss.insertSheet('시트1');
    b.run('setup');
    assert.deepEqual([...b.ss.sheets.keys()].sort(), ['기록', '열람', '팀', '팀원', '파일']);
    assert.equal(b.drive.childFolders(b.rootId, 'team01').length, 1);
    assert.equal(b.drive.childFolders(b.store.F_20, '옛날 자료').length, 1);
    assert.match(b.logs.at(-1), /준비됐습니다/);
    b.run('setup');                                          // 다시 실행해도 폴더가 늘지 않는다
    assert.equal(b.drive.folders.size, 1 + 21 * 2);
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
    b.run('viewerNew');
    const text = b.logs.at(-1);
    const keys = [...text.matchAll(/\/judge\/#k=([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    assert.equal(keys.length, 2);
    assert.ok(keys.every((k) => k.length === 40));
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
    b.run('doctor');
    assert.match(b.logs.at(-1), /모두 정상입니다/);
    const empty = loadBackend({});
    empty.drive.apiOff = true;
    empty.run('doctor');
    assert.match(empty.logs.at(-1), /고칠 곳이 3군데/);
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
