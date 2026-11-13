/**
 * ENDPoinT 결과물 제출 — 운영진 메뉴
 * ---------------------------------------------------------------
 * 제출 시트를 열면 위쪽에 "ENDPoinT 제출" 메뉴가 생긴다. 웹 앱(Submit.gs)과 같은 프로젝트에 붙여 넣는다.
 * 여기 있는 함수는 시트를 연 운영진만 실행할 수 있고, 사이트에서는 부를 수 없다.
 *
 *   ① 처음 설정          탭 · 팀 폴더를 만들고 권한을 승인한다 (한 번)
 *   ② 명단 만들기        신청 시트(웹신청 · 팀편성_현황)에서 "구글 계정 → 팀" 표를 만든다
 *   ③ 열람 링크 만들기   심사위원 · 운영진이 현황판에 들어올 링크를 만든다
 *   설정 점검 / 현황 새로 읽기 / 끊긴 업로드 정리 / 선택한 줄을 제출로 인정
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ENDPoinT 제출')
    .addItem('① 처음 설정 (탭 · 폴더 · 권한)', 'setup')
    .addItem('② 명단 만들기 (신청 시트에서)', 'rosterBuild')
    .addItem('③ 열람 토큰 만들기 (심사위원 · 운영진)', 'viewerNew')
    .addSeparator()
    .addItem('설정 점검', 'doctor')
    .addItem('현황 새로 읽기 (캐시 비우기)', 'cacheClear')
    .addItem('끊긴 업로드 정리', 'sweepUploads')
    .addItem('발표 자료 PDF 만들기 (빠진 것)', 'pdfMissing')
    .addItem('선택한 줄을 제출로 인정 (늦게 도착한 파일)', 'acceptSelected')
    .addSeparator()
    .addItem('인기투표 결과 보기', 'voteReport')
    .addItem('심사 종합 만들기 (심사 시트의 `종합` 탭)', 'scoreReport')
    .addToUi();
}

/** 처음 한 번: 탭과 팀 폴더를 만들고, Drive 권한이 살아 있는지 확인한다. 다시 실행해도 안전하다. */
function setup() {
  fresh_();
  // 한 번에 하나만 돈다. 권한 승인 직후에 저절로 이어서 돈 실행과 다시 누른 실행이 겹치면
  // 둘 다 "없네" 하고 같은 이름의 폴더를 하나씩 만들 수 있다 (2026-11-13 에 실제로 겪었다).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return say_('다른 실행이 지금 처음 설정을 하고 있습니다. 1–2분 뒤에 다시 눌러 주세요.');
  var root, made = 0, cleaned = [], busy = [], scoreName = '';
  try {
    Object.keys(TABS).forEach(function (k) { if (!TABS[k].book) table_(k); });   // 심사 시트의 탭은 아래에서

    // 새 스프레드시트에 딸려 오는 빈 기본 탭은 지운다
    var ss = ss_();
    ss.getSheets().forEach(function (sh) {
      if (/^(시트\s*1|Sheet\s*1)$/i.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
        try { ss.deleteSheet(sh); } catch (e) {}
      }
    });

    // 팀 폴더를 미리 만들어 둔다 — 첫 업로드가 폴더를 만드느라 느려지지 않게.
    // 같은 이름의 폴더가 여럿이면 스크립트가 쓰던 것(없으면 가장 먼저 만든 것)만 남기고, 빈 것은 휴지통으로 보낸다.
    root = rootFolder_();
    var store = PropertiesService.getScriptProperties(), p = store.getProperties() || {}, set = {};
    teamList_(true).forEach(function (tm) {
      var t = pickFolder_(root, 'team' + tm.no, p['F_' + tm.no], cleaned, busy);
      if (t.made) made++;
      var o = pickFolder_(t.folder, OLD_NAME, p['O_' + tm.no], cleaned, busy);
      set['F_' + tm.no] = t.folder.getId();
      set['O_' + tm.no] = o.folder.getId();
    });
    store.setProperties(set, false);
    propsDrop_();
    // 심사 시트: 제출 폴더 옆 '심사위원' 폴더의 'ENDPoinT 2026 심사' (없으면 만든다) + `점수` 탭
    try { scoreSheetFind_(true); MEMO.scoreSs = null; table_('score', true); scoreName = scoreSs_().getName(); } catch (e8) { scoreName = '못 만듦 — ' + e8.message; }
  } finally {
    lock.releaseLock();
  }

  voteSalt_();                                 // 투표 검증에 쓰는 비밀 솔트 (한 번만 만든다)
  var who = driveCheck_();
  say_('준비됐습니다.\n\n' +
    '· 탭: ' + Object.keys(TABS).map(function (k) { return TABS[k].name; }).join(', ') + '\n' +
    '· 제출 폴더: ' + root.getName() + ' (팀 폴더 ' + made + '개를 새로 만들었습니다)\n' +
    (cleaned.length ? '· 같은 이름으로 겹쳐 생긴 빈 폴더 ' + cleaned.length + '개를 휴지통으로 보냈습니다: ' + cleaned.join(', ') + '\n' : '') +
    (busy.length ? '! 같은 이름의 폴더가 더 있지만 안에 무언가 있어 그대로 두었습니다 (확인해 주세요): ' + busy.join(', ') + '\n' : '') +
    '· 심사 시트: ' + conf_('SCORE_FOLDER_NAME') + ' / ' + scoreName + '\n' +
    '· Drive 계정: ' + who + '\n\n' +
    '다음: ② 명단 만들기 → 배포(웹 앱) → ③ 열람 토큰 만들기');
}

/**
 * parent 안의 name 폴더를 하나로 정한다: 스크립트가 쓰던 것(id) → 없으면 가장 먼저 만든 것 → 그것도 없으면 새로.
 * 같은 이름의 나머지 폴더는 비어 있으면 휴지통으로 보내고(cleaned), 무언가 들어 있으면 건드리지 않는다(busy).
 */
function pickFolder_(parent, name, id, cleaned, busy) {
  var list = [], it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) list.push(f); }
  var keep = null;
  list.forEach(function (f) { if (id && f.getId() === id) keep = f; });
  if (!keep && list.length) {
    list.sort(function (a, b) { return a.getDateCreated().getTime() - b.getDateCreated().getTime(); });
    keep = list[0];
  }
  var made = false;
  if (!keep) { keep = parent.createFolder(name); made = true; }
  list.forEach(function (f) {
    if (f.getId() === keep.getId()) return;
    var where = (name === OLD_NAME ? parent.getName() + '/' : '') + name;
    if (folderEmpty_(f)) { f.setTrashed(true); cleaned.push(where); }
    else busy.push(where);
  });
  return { folder: keep, made: made };
}

/** 비었는가: 파일이 없고, 안의 폴더도 모두 비었다 (빈 '옛날 자료' 만 든 팀 폴더도 빈 것으로 본다) */
function folderEmpty_(f) {
  if (f.getFiles().hasNext()) return false;
  var it = f.getFolders();
  while (it.hasNext()) { var c = it.next(); if (!c.isTrashed() && !folderEmpty_(c)) return false; }
  return true;
}

/** 같은 이름으로 겹친 팀 폴더 · 옛날 자료 폴더 (설정 점검이 알린다) */
function folderDups_() {
  var out = [], root = rootFolder_(), p = props_();
  var count = function (parent, name) {
    var n = 0, it = parent.getFoldersByName(name);
    while (it.hasNext()) { if (!it.next().isTrashed()) n++; }
    return n;
  };
  teamList_(true).forEach(function (tm) {
    if (count(root, 'team' + tm.no) > 1) out.push('team' + tm.no);
    if (p['F_' + tm.no]) {
      try { if (count(DriveApp.getFolderById(p['F_' + tm.no]), OLD_NAME) > 1) out.push('team' + tm.no + '/' + OLD_NAME); } catch (e) {}
    }
  });
  return out;
}

/** Drive REST 가 이 스크립트 토큰으로 되는지 확인한다. 되면 계정 주소를 돌려준다. */
function driveCheck_() {
  var res = driveFetch_('get', '/drive/v3/about?fields=user(emailAddress)');
  if (res.getResponseCode() !== 200) throw driveFail_(res, 'about');
  return JSON.parse(res.getContentText()).user.emailAddress;
}

/* ================================================================
   ② 명단 — "구글 계정 → 팀"
   ----------------------------------------------------------------
   신청 시트의 `웹신청`(성함 · 이메일 · 계정 식별자)과 `팀편성_현황`(Team 01 | 조장 | 팀원들)을 이름으로 잇는다.
   - 이름이 신청서에 없거나 같은 이름이 여러 팀에 있으면 계정을 비워 두고 '확인 필요' 로 남긴다. 그 줄에 이메일을 적으면 된다.
   - 제출 폴더에 '팀원 추가 계정' 시트(팀 · 이름 · 이메일)가 있으면 그 주소도 같은 사람의 계정으로 넣는다 (출처 '추가').
     신청할 때와 다른 구글 계정으로 들어오는 사람을 위한 것이다. 팀 칸을 비워 두면 이름으로 팀을 찾는다.
   - 출처가 '신청서' · '추가' 가 아닌 줄(손으로 넣은 줄 · '확인 필요')은 다시 만들어도 건드리지 않는다.
   - 팀에 없는 신청자는 맨 아래에 '미배정' 으로 적어 둔다 (참고용. 명단에는 들어가지 않는다).
   ================================================================ */

function rosterBuild() {
  fresh_();
  var ui = ui_();
  var exclude = str_(props_().ROSTER_EXCLUDE);
  if (ui) {
    var r = ui.prompt('명단 만들기',
      '신청 시트에서 팀원 명단을 만듭니다. 출처가 "신청서"인 줄은 새로 만들어지고, 손으로 넣은 줄은 그대로 둡니다.\n\n' +
      '불참자가 있으면 이름을 쉼표로 적어 주세요 (없으면 비워 두세요).', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    if (str_(r.getResponseText()) || !exclude) exclude = str_(r.getResponseText());
    PropertiesService.getScriptProperties().setProperty('ROSTER_EXCLUDE', exclude);
    propsDrop_();
  }
  var res = rosterBuild_(exclude);
  say_(res.message);
}

function rosterBuild_(exclude) {
  var src = SpreadsheetApp.openById(conf_('APPLY_SHEET_ID'));
  var ap = src.getSheetByName(conf_('APPLY_TAB')), tmTab = src.getSheetByName(conf_('TEAMS_TAB'));
  if (!ap || !tmTab) return { ok: false, message: '신청 시트에서 탭을 찾지 못했습니다: ' + conf_('APPLY_TAB') + ' / ' + conf_('TEAMS_TAB') };

  // 1) 신청자: 이름 → 계정들
  var av = ap.getDataRange().getValues();
  var ah = (av[0] || []).map(function (h) { return String(h).trim(); });
  var cName = ah.indexOf('성함'), cMail = ah.indexOf('이메일'), cSub = ah.indexOf('계정 식별자');
  if (cName < 0 || cMail < 0) return { ok: false, message: '신청 탭에 "성함" · "이메일" 열이 없습니다.' };
  var people = {}, blank = {};          // blank: 신청서에 이름은 있는데 이메일 · 계정 식별자가 둘 다 빈 사람 (운영진이 손으로 넣은 줄 등)
  av.slice(1).forEach(function (row) {
    var name = str_(row[cName]), mail = str_(row[cMail]).toLowerCase(), sub = cSub >= 0 ? str_(row[cSub]) : '';
    if (!name) return;
    var k = nameKey_(name);
    if (!mail && !sub) { blank[k] = 1; return; }
    (people[k] = people[k] || []).push({ name: name, mail: mail, sub: sub, used: false });
  });

  // 2) 팀 편성: 'Team 01' 칸 바로 옆이 조장, 그 옆이 팀원들(쉼표)
  var teams = [], where = {};
  tmTab.getDataRange().getValues().forEach(function (row) {
    for (var i = 0; i < row.length - 2; i++) {
      var m = /^team\s*0*(\d{1,3})$/i.exec(str_(row[i]));
      if (!m) continue;
      var no = teamNo_(m[1]);
      var names = str_(row[i + 2]).split(/[,，\n]+/).map(str_).filter(function (x) { return x; });
      teams.push({ no: no, leader: nameKey_(row[i + 1]), names: names });
      names.forEach(function (n) { var k = nameKey_(n); (where[k] = where[k] || []).push(no); });
      break;
    }
  });
  if (!teams.length) return { ok: false, message: '팀편성 탭에서 "Team 01" 같은 줄을 찾지 못했습니다.' };

  // 3) 지금 탭에서 지킬 것: 손으로 넣은 줄 전체, 그리고 신청서 줄에 적어 둔 상태(불참 등)
  var t = table_('member', true), c = t.col;
  var kept = [], keptKey = {}, status = {};
  t.rows.forEach(function (row) {
    var srcName = str_(row[c['출처']]), no = teamNo_(row[c['팀']]), k = no + '|' + nameKey_(row[c['이름']]);
    if (srcName !== '신청서' && srcName !== '추가') {
      if (!row.join('').trim()) return;
      kept.push(row); keptKey[k] = 1;
    } else {
      var st = str_(row[c['상태']]);
      if (st && st !== '미배정') status[k] = st;
    }
  });

  var ex = String(exclude || '').split(/[,，\n]+/).map(nameKey_).filter(function (x) { return x; });
  var made = [], note = { none: [], blank: [], dup: [], multi: [], out: [], clash: [], extraNone: [], extraDup: [] };

  // 따로 알려 준 주소: 팀|이름 → [주소…].  팀 칸이 비어 있으면 팀편성에서 이름으로 팀을 찾는다
  // (그 이름이 정확히 한 팀에만 있을 때만. 없거나 여러 팀에 있으면 넣지 않고 알린다).
  var known = {};
  teams.forEach(function (tm) { known[tm.no] = 1; });
  var extraBy = {};
  var extras = extraAccounts_().filter(function (x) {
    var k = nameKey_(x.name);
    if (!x.no) {
      var at = where[k] || [];
      if (at.length !== 1) { (at.length ? note.extraDup : note.extraNone).push(x.name); return false; }
      x.no = at[0];
    } else if (!known[x.no]) { note.extraNone.push(x.no + '팀 ' + x.name); return false; }
    (extraBy[x.no + '|' + k] = extraBy[x.no + '|' + k] || []).push(x);
    return true;
  });
  var mk = function (no, name, mail, sub, role, st, memo, from) {
    var row = t.headers.map(function () { return ''; });
    var set = function (h, v) { if (c[h] !== undefined) row[c[h]] = cell_(v); };
    set('팀', no); set('이름', name); set('이메일', mail); set('계정 식별자', sub);
    set('역할', role); set('상태', st); set('비고', memo); set('출처', from);
    return row;
  };
  teams.forEach(function (tm) {
    tm.names.forEach(function (name) {
      var k = nameKey_(name), key = tm.no + '|' + k;
      if (keptKey[key]) return;                                  // 손으로 넣은 줄이 우선
      var role = k === tm.leader ? '조장' : '';
      var st = status[key] || (ex.indexOf(k) !== -1 ? '불참' : '');
      if (st === '불참') note.out.push(tm.no + '팀 ' + name);
      var cands = people[k] || [];
      if ((where[k] || []).length > 1) {
        made.push(mk(tm.no, name, '', '', role, st, '같은 이름이 여러 팀에 있습니다 — 이 줄에 이메일을 직접 적어 주세요', '확인 필요'));
        note.dup.push(tm.no + '팀 ' + name);
        return;
      }
      if (!cands.length) {
        if (extraBy[key]) return;                                // 신청서에는 없지만 따로 알려 준 주소가 있다 — 아래에서 넣는다
        made.push(mk(tm.no, name, '', '', role, st, blank[k]
          ? '신청서에 이름은 있지만 이메일 · 계정 식별자가 비어 있습니다 — 이 줄에 이메일을 직접 적어 주세요'
          : '신청서에서 이름을 찾지 못했습니다 — 이 줄에 이메일을 직접 적어 주세요', '확인 필요'));
        (blank[k] ? note.blank : note.none).push(tm.no + '팀 ' + name);
        return;
      }
      cands.forEach(function (p) {
        p.used = true;
        made.push(mk(tm.no, p.name, p.mail, p.sub, role, st, cands.length > 1 ? '신청서가 ' + cands.length + '건입니다 — 같은 사람인지 확인' : '', '신청서'));
      });
      if (cands.length > 1) note.multi.push(tm.no + '팀 ' + name);
    });
  });
  // 따로 알려 준 주소를 덧붙인다. 이미 있는 주소는 건너뛰고, 다른 팀에 이미 있는 주소면 넣지 않고 알린다.
  var extraN = 0, mailTeam = {};
  kept.concat(made).forEach(function (row) {
    var m = mailKey_(row[c['이메일']]), no = teamNo_(row[c['팀']]);
    if (m && no && !mailTeam[m]) mailTeam[m] = no;
  });
  var leaderOf = {};
  teams.forEach(function (tm) { leaderOf[tm.no] = tm.leader; });
  extras.forEach(function (x) {
    var k = nameKey_(x.name);
    var mk0 = mailKey_(x.mail);
    if (mailTeam[mk0]) {
      if (mailTeam[mk0] !== x.no) note.clash.push(x.no + '팀 ' + x.name);
      return;
    }
    mailTeam[mk0] = x.no;
    made.push(mk(x.no, x.name, x.mail, '', k === leaderOf[x.no] ? '조장' : '',
      status[x.no + '|' + k] || (ex.indexOf(k) !== -1 ? '불참' : ''), x.memo || '참가자가 따로 알려 준 주소', '추가'));
    extraN++;
  });

  var loose = 0;
  Object.keys(people).forEach(function (k) {
    people[k].forEach(function (p) {
      if (p.used) return;
      loose++;
      made.push(mk('', p.name, p.mail, p.sub, '', '미배정', '팀편성에 없는 신청자입니다 (참고용). 팀 번호를 적고 상태를 지우면 명단에 들어갑니다', '신청서'));
    });
  });

  // 4) 한꺼번에 쓴다: 손으로 넣은 줄 + 새로 만든 줄, 팀 번호순 (미배정은 맨 아래)
  var rows = kept.concat(made);
  rows.forEach(function (row) { while (row.length < t.headers.length) row.push(''); });
  var rank = function (row) { var no = teamNo_(row[c['팀']]); return no ? Number(no) : 9999; };
  rows.sort(function (x, y) { return rank(x) - rank(y) || (str_(y[c['역할']]) === '조장') - (str_(x[c['역할']]) === '조장'); });

  withLock_(function () {
    var sh = t.sheet, width = t.headers.length;
    if (t.n > 1) sh.getRange(2, 1, t.n - 1, width).clearContent();
    if (rows.length) {
      var range = sh.getRange(2, 1, rows.length, width);
      range.setNumberFormat('@');
      range.setValues(rows.map(function (row) { return row.map(cell_); }));
    }
    SpreadsheetApp.flush();
  });
  cacheDrop_('roster1');
  fresh_();

  var accounts = made.filter(function (row) { return teamNo_(row[c['팀']]) && (row[c['이메일']] || row[c['계정 식별자']]); }).length;
  var msg = '명단을 만들었습니다.\n\n' +
    '· 팀 ' + teams.length + '개, 계정 ' + accounts + '개 연결' + (extraN ? ' (따로 알려 준 주소 ' + extraN + '개 포함)' : '') +
      (kept.length ? ', 손으로 넣은 줄 ' + kept.length + '개 유지' : '') + '\n' +
    (note.out.length ? '· 불참: ' + note.out.join(', ') + '\n' : '') +
    (note.blank.length ? '\n✘ 신청서에 이메일 · 계정 식별자가 비어 있는 사람 (' + note.blank.length + '명) — `팀원` 탭의 그 줄에 이메일을 적어 주세요\n   ' + note.blank.join(', ') + '\n' : '') +
    (note.none.length ? '\n✘ 신청서에서 이름을 못 찾은 사람 (' + note.none.length + '명) — `팀원` 탭의 그 줄에 이메일을 적어 주세요\n   ' + note.none.join(', ') + '\n' : '') +
    (note.dup.length ? '\n✘ 같은 이름이 여러 팀에 있는 사람 — 줄마다 이메일을 적어 주세요\n   ' + note.dup.join(', ') + '\n' : '') +
    (note.clash.length ? '\n! 따로 알려 준 주소가 이미 다른 팀에 있어 넣지 않았습니다\n   ' + note.clash.join(', ') + '\n' : '') +
    (note.extraNone.length ? '\n! `' + conf_('ROSTER_EXTRA_NAME') + '` 시트에서 팀을 찾지 못해 넣지 않은 줄 (' + note.extraNone.length + '개) — 그 시트의 `팀` 칸에 번호를 적거나 이름을 팀편성과 같게 고쳐 주세요\n   ' + note.extraNone.join(', ') + '\n' : '') +
    (note.extraDup.length ? '\n! `' + conf_('ROSTER_EXTRA_NAME') + '` 시트의 이름이 여러 팀에 있어 넣지 않은 줄 — `팀` 칸에 번호를 적어 주세요\n   ' + note.extraDup.join(', ') + '\n' : '') +
    (note.multi.length ? '\n! 신청서가 두 건 이상인 사람 (둘 다 넣었습니다. 다른 사람이면 한 줄을 지우세요)\n   ' + note.multi.join(', ') + '\n' : '') +
    (loose ? '\n· 팀편성에 없는 신청자 ' + loose + '명은 맨 아래 "미배정"으로 적어 두었습니다. 위에서 못 찾은 사람과 이름 표기만 다른 경우가 많습니다.\n' : '');
  return {
    ok: true, message: msg, teams: teams.length, accounts: accounts, extra: extraN, loose: loose,
    none: note.none, blank: note.blank, dup: note.dup, multi: note.multi, clash: note.clash, extraNone: note.extraNone, extraDup: note.extraDup
  };
}

/**
 * 제출 폴더 안의 '팀원 추가 계정' 을 읽는다 (없으면 빈 목록). 스프레드시트여도 되고, 같은 이름의 CSV 파일
 * ('팀원 추가 계정.csv')을 폴더에 끌어다 놓아도 된다.
 * 열: 이름 · 이메일 (· 팀 · 비고). 참가자가 신청서와 다른 주소를 따로 알려 준 경우를 모아 두는 곳이다.
 * 팀 칸이 없거나 비어 있으면 no 가 '' 로 온다 — 그런 줄은 명단을 만들 때 이름으로 팀을 찾는다.
 */
function extraAccounts_() {
  var out = [];
  try {
    var root = rootFolder_(), name = conf_('ROSTER_EXTRA_NAME'), file = null;
    [name, name + '.csv'].forEach(function (n) {
      if (file) return;
      var it = root.getFilesByName(n);
      if (it.hasNext()) file = it.next();
    });
    if (!file) return out;
    var v = file.getMimeType() === 'application/vnd.google-apps.spreadsheet'
      ? SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getValues()
      : Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, ''));
    var h = (v[0] || []).map(function (x) { return String(x).trim(); });
    var cNo = h.indexOf('팀'), cName = h.indexOf('이름'), cMail = h.indexOf('이메일'), cMemo = h.indexOf('비고');
    if (cName < 0 || cMail < 0) return out;
    v.slice(1).forEach(function (row) {
      var no = cNo >= 0 ? teamNo_(row[cNo]) : '', mail = str_(row[cMail]).toLowerCase(), name = str_(row[cName]);
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return;
      out.push({ no: no, name: name, mail: mail, memo: cMemo >= 0 ? str_(row[cMemo]) : '' });
    });
  } catch (e) {}
  return out;
}

/* ================================================================
   ③ 열람 링크 — 심사위원 · 운영진
   ----------------------------------------------------------------
   `열람` 탭에 이름(과 역할)을 먼저 적어 두고 이 메뉴를 누르면, 토큰이 없는 줄마다 링크를 만든다.
   시트에는 토큰의 해시만 남는다. 링크는 이 창에서 한 번만 보이므로 바로 복사해 전달한다.
   링크를 막으려면 그 줄의 '사용' 칸을 지운다 (1분 안에 반영).
   ================================================================ */

function viewerNew() {
  fresh_();
  var ui = ui_();
  // 토큰은 시트 메뉴의 창에서만 보여 준다. 편집기에서 실행하면 실행 기록(스크립트 편집자 모두가 볼 수 있다)에 남으므로 만들지 않는다
  if (!ui) return say_('시트의 메뉴 "제출 관리 → ③ 열람 토큰 만들기" 에서 실행해 주세요. 토큰은 그 창에서만 보여 줍니다.');
  var salt = voteSalt_();                       // 토큰 · 검증값에 섞는 비밀값 (잠그기 전에)
  var t = table_('view', true), c = t.col, todo = [];
  t.rows.forEach(function (row, i) {
    if (str_(row[c['이름']]) && !str_(row[c['토큰 해시']])) todo.push(i);
  });
  if (!todo.length) {
    var r = ui.prompt('열람 토큰 만들기',
      '받을 사람의 이름을 쉼표로 적어 주세요. 사람마다 그 이름을 넣어 만든 토큰이 하나씩 나옵니다.\n' +
      '예) 홍길동 교수님, 김철수 교수님\n\n' +
      '운영진용(종합 · Drive 링크까지 보임)이면 이름 뒤에 "=운영진" 을 붙입니다. 예) 김운영=운영진',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var people = viewerPeople_(r.getResponseText());
    if (!people.length) return;
    withLock_(function () {
      t = table_('view', true);
      todo = people.map(function (p) { return put_(t, 0, { '이름': p.name, '역할': p.role }) - 2; });
    });
  }

  var until = kst_(isoMs_(conf_('VIEW_UNTIL')) || (deadlineMs_() + 24 * 3600000));
  var links = [];
  withLock_(function () {
    t = table_('view', true); c = t.col;
    todo.forEach(function (i) {
      var row = t.rows[i];
      if (!row || !str_(row[c['이름']]) || str_(row[c['토큰 해시']])) return;
      var name = str_(row[c['이름']]), key = newKey_(name, salt), hash = sha256hex_(key);
      var role = str_(row[c['역할']]) || '심사위원';
      put_(t, i + 2, {
        '역할': role, '토큰 해시': hash, '만든 시각': kst_(nowMs_()),
        '만료': str_(row[c['만료']]) || until, '사용': 'O', '검증': viewSig_(salt, name, hash)
      });
      links.push({ name: str_(row[c['이름']]), role: role, key: key, url: String(CONFIG.SITE_URL).replace(/\/+$/, '') + '/judge/#k=' + key });
    });
    SpreadsheetApp.flush();
  });
  cacheDrop_('views1');
  if (!links.length) return say_('새로 만들 토큰이 없습니다.');

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
  var text = links.map(function (l) { return l.name + ' (' + l.role + ')\n토큰: ' + l.key + '\n링크: ' + l.url; }).join('\n\n');
  // 사람마다 따로 복사할 수 있게 한 칸씩
  var boxes = links.map(function (l, i) {
    return '<div style="border:1px solid #ddd;padding:10px 12px;margin:0 0 10px">' +
      '<b>' + esc(l.name) + '</b> <span style="color:#666">(' + esc(l.role) + ')</span>' +
      '<div style="margin-top:6px">토큰 <input id="k' + i + '" readonly value="' + esc(l.key) + '" style="width:72%;font:12px ui-monospace,Menlo,monospace"> ' +
        '<button onclick="var e=document.getElementById(\'k' + i + '\');e.select();document.execCommand(\'copy\');this.textContent=\'복사함\'">복사</button></div>' +
      '<div style="margin-top:4px">링크 <input id="u' + i + '" readonly value="' + esc(l.url) + '" style="width:72%;font:12px ui-monospace,Menlo,monospace"> ' +
        '<button onclick="var e=document.getElementById(\'u' + i + '\');e.select();document.execCommand(\'copy\');this.textContent=\'복사함\'">복사</button></div></div>';
  }).join('');
  var all = '<textarea id="all" readonly style="width:100%;height:' + (links.length > 3 ? 160 : 90) + 'px;font:11.5px/1.5 ui-monospace,Menlo,monospace">' + esc(text) + '</textarea>' +
    '<p style="margin:4px 0 12px"><button onclick="var e=document.getElementById(\'all\');e.select();document.execCommand(\'copy\');this.textContent=\'모두 복사함\'">모두 복사</button> ' +
    '<span style="color:#666">이름 · 토큰 · 링크가 사람마다 세 줄씩</span></p>';
  var html = '<div style="font:13px/1.6 system-ui,sans-serif">' +
    '<p style="margin:0 0 10px"><b>지금 복사해 두세요.</b> 창을 닫으면 다시 볼 수 없습니다 (시트에는 해시만 남습니다). ' +
    '받는 분은 링크를 열거나, 현황판(/judge/)의 열람 코드 칸에 토큰을 붙여 넣으면 됩니다. ' +
    '토큰은 이름을 넣어 만들었기 때문에 `열람` 탭에서 이름을 바꾸면 더 쓸 수 없습니다 (그때는 새로 만드세요).</p>' + all + boxes +
    '<p style="margin:6px 0 0;color:#666">만료: ' + esc(until) + ' (서울) · 토큰을 받은 사람은 로그인 없이 전체 팀 자료를 봅니다. 꼭 본인에게만 전달하세요. ' +
    '잃어버렸으면 그 줄의 "사용"을 지우고 다시 만드세요.</p></div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(720).setHeight(Math.min(640, 150 + links.length * 110)), '열람 토큰 ' + links.length + '개');
  return links;
}

/** 프롬프트에 적은 것 → [{name, role}] */
function viewerPeople_(text) {
  var s = str_(text);
  return s.split(/[,，\n]+/).map(function (x) {
    var p = x.split('=');
    return { name: str_(p[0]), role: str_(p[1]) === '운영진' ? '운영진' : '심사위원' };
  }).filter(function (p) { return p.name; }).slice(0, 100);
}

/**
 * token_ 으로 시작하는 46글자: SHA-256(비밀 솔트 | 이름 | 무작위 값 | 시각) 을 base64url 로.
 * 이름이 들어가지만 솔트와 무작위 값 때문에 이름을 안다고 토큰을 만들어 낼 수는 없다. 시트에는 토큰의 해시만 남는다.
 */
function newKey_(name, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    [salt || '', 'token', nameKey_(name || ''), Utilities.getUuid(), Utilities.getUuid(), Date.now()].join('|'));
  return 'token_' + Utilities.base64EncodeWebSafe(raw).replace(/[=]+$/, '').slice(0, 40);
}

/* ================================================================
   점검 · 정리
   ================================================================ */

function doctor() {
  fresh_();
  var lines = [], bad = 0;
  var ok = function (b, text) { if (!b) bad++; lines.push((b ? '✔ ' : '✘ ') + text); };
  ok(!!CONFIG.CLIENT_ID, '로그인 클라이언트 ID');
  try { ok(true, '제출 폴더: ' + rootFolder_().getName()); } catch (e) { ok(false, '제출 폴더 — ' + e.message); }
  try {
    var dups = folderDups_();
    ok(!dups.length, dups.length ? '같은 이름의 폴더가 겹쳐 있습니다: ' + dups.join(', ') + ' — ① 처음 설정을 다시 누르면 빈 것은 정리합니다' : '팀 폴더: 겹친 것 없음');
  } catch (e7) {}
  try { ok(true, 'Drive API: ' + driveCheck_()); } catch (e2) { ok(false, String(e2.message)); }
  try {
    var q = driveQuota_();
    if (!q.limit) lines.push('✔ Drive 저장 공간: 제한 없음');
    else {
      var gb = q.free / (1024 * MB);
      lines.push((gb >= 10 ? '✔ ' : '! ') + 'Drive 남은 저장 공간: ' + gb.toFixed(1) + 'GB' +
        (gb >= 10 ? '' : '\n   파일이 몰리면 모자랄 수 있습니다 (프로그램 파일은 팀당 1GB 까지, 다시 올린 것도 지우지 않고 둡니다). 공간을 비우거나 늘려 주세요.'));
    }
  } catch (e5) {}
  try {
    var pr = directProbe_();
    lines.push(pr.ok ? '✔ 브라우저 → Drive 직접 올리기: 됩니다'
      : '! 브라우저 → Drive 직접 올리기: 안 됩니다 (응답 ' + pr.code + ', 허용 출처 "' + pr.allow + '")\n' +
        '   제출은 되지만 파일이 이 스크립트를 거쳐 올라가서 느립니다. 큰 파일은 일찍 올리라고 안내해 주세요.');
  } catch (e4) { lines.push('! 직접 올리기 점검을 하지 못했습니다 — ' + String(e4.message).slice(0, 120)); }
  var r = roster_();
  var accounts = Object.keys(r.sub).length + Object.keys(r.mail).length;
  ok(accounts > 0, '명단: 팀 ' + Object.keys(r.teams).length + '개 · 줄 ' +
    Object.keys(r.teams).reduce(function (n, k) { return n + r.teams[k]; }, 0) + '개' + (accounts ? '' : ' — ② 명단 만들기를 실행하세요'));
  ok(admins_().length > 0, '운영진 계정(스크립트 속성 ADMINS): ' + admins_().length + '명' + (admins_().length ? '' : ' — 없으면 대신 올리기를 쓸 수 없습니다'));
  var vs = viewers_(), judgeN = Object.keys(vs).filter(function (h) { return vs[h].role === '심사위원'; }).length;
  ok(true, '열람 토큰: ' + Object.keys(vs).length + '개 사용 중 (심사위원 ' + judgeN + '명)');
  try { ok(true, '심사 시트: ' + scoreSs_().getName() + ' · 심사 ' + (scoreState_() === 'closed' ? '마감됨' : '받는 중') + (scoreUntil_() ? ' (마감 ' + kst_(scoreUntil_()).slice(5, 16) + ')' : '')); }
  catch (e9) { ok(false, '심사 시트 — ' + String(e9.message || e9)); }
  var d = deadlineMs_();
  ok(d > 0, '마감: ' + (d ? kst_(d) + ' (서울), 유예 ' + graceMin_() + '분' : '없음') + ' · 지금 단계: ' + phase_());
  lines.push('· 팀당 저장 한도: ' + (teamCap_() ? (teamCap_() / (1024 * MB)) + 'GB (스크립트 속성 TEAM_MAX_GB)' : '없음'));
  try {
    voteSalt_();                               // 없으면 지금 만든다 (투표 검증에 쓰는 비밀값)
    lines.push('· 인기투표: ' + voteTally_().map(function (x) {
      return x.name + ' ' + ({ ready: '열기 전', open: '받는 중', closed: '마감' }[x.state]) + ' ' + winText_(x) + ' (' + x.voters + '명 · ' + x.votes + '표' + (x.bad ? ' · 검증 실패 ' + x.bad : '') + ')';
    }).join(' / ') + ' · 1인 ' + voteMax_() + '표' + (voteSelf_() ? ' · 자기 팀 가능' : ''));
  } catch (e6) {}
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e3) {}
  ok(!!url, '웹 앱 주소: ' + (url || '아직 배포하지 않았습니다 (배포 → 새 배포 → 웹 앱)'));
  say_((bad ? '고칠 곳이 ' + bad + '군데 있습니다.\n\n' : '모두 정상입니다.\n\n') + lines.join('\n'));
}

/** 제출물이 쌓이는 Drive(이 스크립트를 배포한 계정)의 저장 공간. limit 이 0 이면 제한이 없는 계정이다. */
function driveQuota_() {
  var res = driveFetch_('get', '/drive/v3/about?fields=storageQuota(limit,usage)');
  if (res.getResponseCode() !== 200) throw driveFail_(res, 'about');
  var q = JSON.parse(res.getContentText()).storageQuota || {};
  var limit = Number(q.limit) || 0, usage = Number(q.usage) || 0;
  return { limit: limit, usage: usage, free: limit ? Math.max(0, limit - usage) : 0 };
}

/**
 * 브라우저가 Drive 로 직접 올릴 수 있는지 실제로 해 본다.
 * 사이트 출처로 이어 올리기 주소를 만들고, 그 출처의 브라우저인 척 두 바이트를 보낸 뒤,
 * Drive 가 그 출처를 허용한다고 답하는지(Access-Control-Allow-Origin) 본다. 만든 파일은 바로 휴지통으로 보낸다.
 */
function directProbe_() {
  var origin = String(CONFIG.SITE_URL).replace(/\/+$/, '');
  var id = driveNewId_(), bytes = [111, 107];
  var s = driveSession_({ id: id, name: '점검용_지워도_됩니다.txt', parents: [rootFolder_().getId()], mimeType: 'text/plain' },
    'text/plain', bytes.length, origin);
  var res = UrlFetchApp.fetch(s.url, {
    method: 'put', contentType: 'text/plain', payload: bytes,
    headers: { 'Content-Range': 'bytes 0-' + (bytes.length - 1) + '/' + bytes.length, Origin: origin },
    muteHttpExceptions: true, followRedirects: false
  });
  var code = res.getResponseCode(), allow = header_(res, 'Access-Control-Allow-Origin');
  driveTrash_(id);
  return { ok: s.direct && (code === 200 || code === 201) && (allow === origin || allow === '*'), code: code, allow: allow };
}

/** 시트를 손으로 고친 뒤 바로 반영하고 싶을 때. (그냥 두어도 명단은 90초, 열람은 60초, 현황은 5분 안에 반영된다) */
function cacheClear() {
  fresh_();
  var keys = ['roster1', 'views1', 'props1', 'votes1', 'scores1'].concat(teamList_(true).map(function (tm) { return 'st1:' + tm.no; }));
  try { CacheService.getScriptCache().removeAll(keys); } catch (e) {}
  say_('캐시를 비웠습니다. 다음 요청부터 시트를 새로 읽습니다.');
}

/**
 * 6시간 넘게 '업로드 중' 인 줄을 '끊김' 으로 바꾼다. Drive 의 파일은 지우지 않는다 —
 * 마감 직후에 다 올라온 파일일 수 있어서다. 그런 파일은 '선택한 줄을 제출로 인정' 으로 살릴 수 있다.
 */
function sweepUploads() {
  fresh_();
  var n = 0, alive = [];
  withLock_(function () {
    var t = table_('file', true), c = t.col, before = nowMs_() - 6 * 3600000;
    t.rows.forEach(function (row, i) {
      if (str_(row[c['상태']]) !== '업로드 중' || time_(row[c['올린 시각']]) > before) return;
      var meta = null;
      try { meta = driveMeta_(str_(row[c['Drive ID']])); } catch (e) {}
      put_(t, i + 2, { '상태': '끊김' });
      n++;
      if (meta && !meta.trashed) alive.push('#' + row[c['번호']] + ' ' + row[c['팀']] + '팀 ' + row[c['원래 이름']]);
    });
  });
  say_('끊긴 업로드 ' + n + '건을 "끊김"으로 표시했습니다.' +
    (alive.length ? '\n\nDrive 에 다 올라와 있는 파일 (필요하면 그 줄을 고르고 "선택한 줄을 제출로 인정"):\n' + alive.join('\n') : ''));
}

/**
 * `파일` 탭에서 고른 줄('업로드 중' 또는 '끊김')을 그 팀의 제출로 인정한다.
 * 마감 유예가 지난 뒤에 다 올라온 파일을 운영진 판단으로 받아 줄 때 쓴다.
 */
function acceptSelected() {
  fresh_();
  var ui = ui_();
  if (!ui) return;
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== TABS.file.name) return say_('`파일` 탭에서 인정할 줄을 고른 뒤 다시 실행해 주세요.');
  var rowNo = sh.getActiveRange().getRow();
  var t = table_('file', true), c = t.col, row = t.rows[rowNo - 2];
  if (!row) return say_('줄을 고른 뒤 다시 실행해 주세요.');
  var id = Number(row[c['번호']]), team = teamNo_(row[c['팀']]);
  var ans = ui.alert('제출로 인정', team + '팀 · ' + row[c['종류']] + ' · ' + row[c['원래 이름']] + '\n\n이 파일을 이 팀의 현재 제출물로 바꿉니다. 계속할까요?', ui.ButtonSet.OK_CANCEL);
  if (ans !== ui.Button.OK) return;
  var mail = '';
  try { mail = Session.getActiveUser().getEmail(); } catch (e) {}
  var res = finishUpload_({ email: mail || '운영진', sub: 'menu', admin: true, proxy: true, team: team, name: '운영진' }, id);
  say_(res.ok ? '인정했습니다. 현황판에는 바로 반영됩니다.' : '인정하지 못했습니다: ' + res.error +
    (res.error === 'NOT_UPLOADED' ? ' (Drive 에 파일이 끝까지 올라오지 않았습니다)' : ''));
}

/** 메뉴에서 실행할 때는 메모와 속성 캐시를 비우고 시작한다 — 방금 고친 속성이 바로 보이게 */
function fresh_() { MEMO = {}; cacheDrop_('props1'); }

/**
 * 지금 제출된 발표 자료 가운데 PowerPoint · odp 인데 보기용 PDF 가 없는 것을 한꺼번에 만든다.
 * 한 번에 5분까지만 하고, 남으면 다시 누르라고 알린다 (Apps Script 한 번 실행은 6분까지).
 */
function pdfMissing() {
  fresh_();
  var t = table_('file', true), c = t.col, todo = [], t0 = Date.now();
  t.rows.forEach(function (row) {
    if (kindOf_(row[c['종류']]) !== 'deck' || str_(row[c['상태']]) !== '현재') return;
    if (!convertible_(str_(row[c['이름']])) || (c['PDF ID'] !== undefined && str_(row[c['PDF ID']]))) return;
    todo.push(Number(row[c['번호']]));
  });
  var done = 0, bad = [];
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - t0 > 300000) break;
    var r = deckPdf_(todo[i]);
    if (r && r.ok) done++; else bad.push('#' + todo[i] + ' ' + ((r && r.error) || ''));
  }
  var left = todo.length - done - bad.length;
  say_('보기용 PDF: 빠진 ' + todo.length + '개 중 ' + done + '개를 만들었습니다.' + (bad.length ? '\n못 만든 것: ' + bad.join(', ') : '') +
       (left > 0 ? '\n남은 ' + left + '개는 이 메뉴를 한 번 더 눌러 주세요.' : ''));
  return { todo: todo.length, done: done, bad: bad.length, left: left };
}

/** 심사 시트에 `종합` 탭을 새로 쓴다 (트랙별 순위 · 심사위원별 합계 · 평균 J · 참가자 점수 P · 최종 S) */
function scoreReport() {
  fresh_();
  var res = scoreTable_(), crit = criteria_(), ss = scoreSs_();
  var sh = ss.getSheetByName('종합') || ss.insertSheet('종합');
  sh.clearContents();
  var head = ['트랙', '순위', '팀', '프로젝트'].concat(res.judges.map(function (j) { return j.name; }),
    ['심사위원 평균 (J)', '인기투표 표', '참가자 점수 (P)', '최종 (S = ' + (Number(conf_('JUDGE_WEIGHT')) || 0.85) + '×J + P)'],
    crit.map(function (k) { return k.name + ' 평균'; }));
  var rows = [head];
  res.tracks.forEach(function (tr) {
    tr.rows.forEach(function (r) {
      rows.push([tr.name, r.rank || '', r.no, r.title].concat(
        res.judges.map(function (j) { var x = r.judges[j.id]; return x ? (x.complete ? x.total : '(' + x.total + ' 작성 중)') : ''; }),
        [r.J === null ? '' : r.J, r.votes, r.P, r.S === null ? '' : r.S],
        crit.map(function (k) { return r.avg[k.key] === null ? '' : r.avg[k.key]; })));
    });
  });
  var range = sh.getRange(1, 1, rows.length, head.length);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (row) { return row.map(function (x) { return typeof x === 'number' ? x : cell_(x); }); }));
  try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); } catch (e) {}
  SpreadsheetApp.flush();
  say_('`종합` 탭을 새로 썼습니다 (' + ss.getName() + ').\n심사위원 ' + res.judges.length + '명 · 트랙 ' + res.tracks.length + '개. 4문항을 다 채운 점수만 평균에 넣습니다.');
}

/** 인기투표 결과를 창으로 (트랙별 득표 · 참가자 점수 P). 시트를 연 운영진만 볼 수 있다. */
function voteReport() {
  fresh_();
  var res = voteTally_();
  var text = res.map(function (x) {
    var head = '[' + x.name + '] ' + ({ ready: '열기 전', open: '받는 중', closed: '마감' }[x.state]) + ' ' + winText_(x) +
      ' · 투표한 사람 ' + x.voters + ' / ' + x.eligible + '명 · 전체 ' + x.votes + '표 · 팀당 평균 ' + x.mean + '표 (만점 기준 ' + x.full + '표)' +
      (x.bad ? '\n  ! 검증이 맞지 않아 세지 않은 표 ' + x.bad + '장 — `투표` 탭이 손으로 고쳐졌을 수 있습니다' : '');
    var rows = x.rows.slice().sort(function (p, q) { return q.votes - p.votes || (p.no < q.no ? -1 : 1); }).map(function (r) {
      return '  ' + r.no + '팀  ' + ('   ' + r.votes).slice(-3) + '표  P ' + r.p.toFixed(2) + (r.title ? '  ' + r.title : '');
    });
    return head + '\n' + rows.join('\n');
  }).join('\n\n');
  say_('인기투표 결과\n\nP = ' + popMax_() + ' × √min(1, 득표 / (' + popFull_() + ' × 트랙 평균))\n\n' + text);
}

/** 투표 시간 '11-14 12:12 – 12:27' (운영진이 옮겼으면 '· 바꿈') */
function winText_(x) {
  var f = x.from ? kst_(x.from).slice(5, 16) : '…', u = x.until ? kst_(x.until).slice(11, 16) : '…';
  return f + ' – ' + u + (x.custom ? ' · 바꿈' : '');
}

function ui_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }
function say_(text) {
  var ui = ui_();
  if (ui) { try { ui.alert(String(text)); return; } catch (e) {} }
  Logger.log(String(text));
}
