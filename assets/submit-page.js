/* ==============================================================
   결과물 제출 화면 (/submit/)
   --------------------------------------------------------------
   로그인 → 서버가 계정으로 팀을 찾아 준다 → 그 팀의 제출 상태를 보여 주고 고친다.
   - 이름 · 설명 · 주소는 '저장' 을 눌러야 반영된다 (보낸 항목만 바뀐다).
   - 파일은 고르는 즉시 올라가고, 끝나면 바로 제출물이 된다. 다시 올리면 먼젓번 것은 옛날 자료로 간다.
   - 권한 판정은 전부 서버가 한다. 여기서 버튼을 감추는 것은 편의일 뿐이다.
   ============================================================== */
(function () {
  'use strict';
  var EP = window.EP, S = EP.session, esc = EP.esc, $ = EP.$;
  var gate = $('gate'), app = $('app');
  var KIND_NAME = { deck: '발표 자료', program: '프로그램 파일' };

  var st = {
    pdf: {},               // 발표 자료 번호 → 보기용 PDF 만들기 'busy' · 'ok' · 'fail'
    me: null,              // 서버의 me 응답
    state: null,           // 내 팀의 제출 상태
    as: '',                // 운영진 대리: 고른 팀 번호
    limits: null,
    deadline: Date.parse(EP.cfg.DEADLINE) || 0,
    grace: 5,
    up: { deck: null, program: null },     // 올리는 중인 것
    err: { deck: '', program: '' },
    busy: false, built: false, loadedAt: 0, phase: '',
    shown: {}              // 입력 칸에 마지막으로 채워 준 서버 값 — 사람이 고친 칸인지는 이것과 비교한다
  };

  /* ------------------------------ 시각 ------------------------------ */
  function phase() {
    if (!st.deadline) return 'open';
    var left = st.deadline - EP.now();
    if (left > 0) return 'open';
    return left > -st.grace * 60000 ? 'grace' : 'closed';
  }
  function proxy() { return !!(st.me && st.me.team && st.me.team.proxy); }
  function canEdit() { return proxy() || phase() === 'open'; }
  function uploading() { return !!(st.up.deck || st.up.program); }

  function tick() {
    var left = st.deadline - EP.now(), el = $('h-left');
    el.textContent = st.deadline ? EP.fmtLeft(left) : '—';
    el.classList.toggle('red', left > 0 && left < 30 * 60000);
    $('h-deadline').textContent = EP.fmtDay(st.deadline) || '—';
    var p = phase();
    if (p !== st.phase) {
      var was = st.phase;
      st.phase = p;
      if (was && st.built && st.state) {
        paint();
        if (p !== 'open') EP.toast(p === 'grace' ? '마감됐습니다. 올리던 파일만 마무리됩니다.' : '제출이 마감됐습니다.');
      }
    }
  }

  /* ------------------------------ 안내 패널 ------------------------------ */
  function showGate(html) { gate.innerHTML = html; gate.hidden = false; app.hidden = true; }
  function gateLogin(expired) {
    showGate(expired
      ? '<div class="t"><span class="lab red">Signed out</span><b>로그인 시간이 지났습니다. 다시 로그인해 주세요</b>' +
        '<span>' + (uploading() ? '<strong>올리던 파일은 버려지지 않았습니다.</strong> 같은 계정으로 다시 로그인하면 이어서 마무리합니다. 이 창을 닫지 마세요.'
                               : '적어 두고 저장하지 않은 내용은 그대로 남아 있습니다. 같은 계정으로 다시 로그인하면 이어서 쓸 수 있습니다.') + '</span></div>' +
        '<div class="act" id="gate-btn"></div>'
      : '<div class="t"><span class="lab blue">Sign in</span><b>참가 신청에 쓴 구글 계정으로 로그인해 주세요</b>' +
        '</div>' +
        '<div class="act" id="gate-btn"></div>');
    S.mountButton($('gate-btn'));
  }
  function gateNotMember(email) {
    showGate('<div class="t"><span class="lab red">Not on the list</span><b>이 계정은 팀 명단에 없습니다</b>' +
      '<p>지금 로그인한 계정은 <code>' + esc(email) + '</code> 입니다. 참가 신청에 쓴 구글 계정이 따로 있으면 그 계정으로 다시 로그인해 주세요. ' +
      '그래도 안 되면 운영진에게 위 주소를 알려 주세요. 명단에 추가하면 바로 들어올 수 있습니다.</p></div>' +
      '<div class="act rowy"><button class="btn btn-o" type="button" id="gate-out"><span>다른 계정으로 로그인</span></button>' +
      '<button class="mini quiet" type="button" id="gate-again">다시 확인</button></div>');
    $('gate-out').addEventListener('click', function () { S.signOut(); });
    $('gate-again').addEventListener('click', function () { load(); });
  }
  function gateError(text) {
    showGate('<div class="t"><span class="lab red">Error</span><b>불러오지 못했습니다</b><span>' + esc(text) + '</span></div>' +
      '<div class="act"><button class="btn btn-o" type="button" id="gate-retry"><span>다시 시도</span></button></div>');
    $('gate-retry').addEventListener('click', function () { load(); });
  }

  /* ------------------------------ 불러오기 ------------------------------ */
  var loadSeq = 0;
  function load(silent) {
    var u = S.get();
    if (!u) return Promise.resolve();
    var seq = ++loadSeq;
    if (!silent) showGate(EP.loading('팀 정보를 불러오는 중'));
    return EP.api('me', { as: st.as || undefined }, { tries: 3 }).then(function (d) {
      if (seq !== loadSeq) return;
      if (d && d.deadline) { st.deadline = d.deadline; if (d.graceMin !== undefined) st.grace = d.graceMin; }
      if (d && d.ok) { apply(d); return; }
      if (d && d.error === 'AUTH_FAILED') return;          // 로그인 화면으로 돌아가 있다 (EP.api 가 처리)
      if (d && d.error === 'BAD_TEAM') { st.as = ''; load(silent); return; }
      if (silent) return;
      if (d && d.error === 'NOT_MEMBER') { $('h-team').textContent = '명단에 없는 계정'; gateNotMember(d.email || u.email); return; }
      gateError(EP.say(d));
    })['catch'](function (e) {
      if (seq !== loadSeq || silent) return;       // 조용한 새로 고침은 실패해도 화면을 건드리지 않는다
      gateError(EP.say(e));
    });
  }
  function apply(d) {
    st.me = d;
    st.limits = d.limits || st.limits;
    st.loadedAt = Date.now();
    st.state = d.team ? d.state : null;
    if (st.state) ensurePdf(st.state.deck);
    gate.hidden = true; app.hidden = false;
    if (!st.built) build();
    fill(false);
    paint();
    tick();
  }

  /* ------------------------------ 뼈대 ------------------------------ */
  function step(key, no, name, req, body, tag) {
    return '<div class="step" id="st-' + key + '"><div class="step-hd"><span class="step-no">' + no + '</span>' +
      '<span class="step-name">' + name + (req ? '<span class="req">*</span>' : '<span class="opt">선택</span>') +
        (tag ? '<span class="opt">' + tag + '</span>' : '') + '</span>' +
      '<span class="step-val" id="v-' + key + '"></span><span class="step-mark"></span></div>' +
      '<div class="step-bd">' + body + '</div></div>';
  }
  function build() {
    app.innerHTML =
      '<div class="sb">' +
        '<div class="sb-pick" id="pick" hidden><span class="lab ko">운영진</span>' +
          '<select class="tin" id="pick-team" aria-label="대신 제출할 팀"></select></div>' +
        '<div class="sb-state" id="state" hidden></div>' +
        '<div id="steps" hidden>' +
          step('info', '01', '프로젝트', true,
            '<div class="qgrid">' +
              '<label class="q full"><span class="lab">프로젝트 이름<span class="req">*</span><span class="cnt" id="c-title"></span></span>' +
                '<input class="tin" id="f-title" type="text" maxlength="60" autocomplete="off" placeholder="심사위원이 보게 될 이름"></label>' +
              '<label class="q full"><span class="lab">한 줄 설명<span class="cnt" id="c-desc"></span></span>' +
                '<textarea class="tar" id="f-desc" maxlength="300" rows="2" placeholder="무엇을 하는 서비스인지 한두 문장으로"></textarea></label>' +
            '</div>') +
          step('product', '02', '결과물', true,
            '<div><label class="q"><span class="lab">배포 주소</span>' +
              '<input class="tin" id="f-url" type="text" inputmode="url" maxlength="500" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://"></label>' +
              '<p class="err" id="e-url" hidden></p></div>' +
            '<div class="q"><span class="lab">프로그램 파일</span><div id="slot-program" data-slot="program" style="margin-top:6px"></div></div>') +
          step('deck', '03', '발표 자료', true,
            '<div id="slot-deck" data-slot="deck"></div>', 'PDF 권장 · PPT 는 보기용 PDF 로 바꿔 둡니다 · Keynote 는 PDF 로 내보내 주세요') +
          step('video', '04', '데모 영상', false,
            '<div><label class="q"><span class="lab">영상 주소</span>' +
              '<input class="tin" id="f-video" type="text" inputmode="url" maxlength="500" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://youtu.be/…"></label>' +
              '<p class="err" id="e-video" hidden></p></div>') +
        '</div>' +
        '<div class="sb-send" id="send" hidden><div class="t" id="send-t"></div>' +
          '<button class="btn" type="button" id="save" disabled><span>저장</span></button></div>' +
        '<div class="msg" id="msg" hidden role="status"></div>' +
      '</div>' +
      '<div id="hist-wrap" hidden><div class="sechd">옛날 자료 <small id="hist-n"></small></div><div class="hist" id="hist"></div></div>';

    app.addEventListener('click', onClick);
    app.addEventListener('change', onChange);
    app.addEventListener('input', onInput);
    app.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'file') { e.preventDefault(); save(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) { app.addEventListener(ev, onDragOver); });
    ['dragleave', 'drop'].forEach(function (ev) { app.addEventListener(ev, onDragEnd); });
    $('save').addEventListener('click', save);
    $('pick-team').addEventListener('change', function () {
      if (uploading()) { this.value = st.as; return; }
      st.as = this.value;
      st.err = { deck: '', program: '' };
      note('', '');
      load(true).then(function () { fill(true); paint(); });
    });
    st.built = true;
  }

  /* ------------------------------ 글자 입력 ------------------------------ */
  var FIELDS = ['title', 'desc', 'url', 'video'];
  function values() {
    var o = {};
    FIELDS.forEach(function (k) { o[k] = $('f-' + k).value.replace(/\r\n?/g, '\n').trim(); });
    return o;
  }
  function dirtyKeys() {
    if (!st.state) return [];
    var v = values();
    return FIELDS.filter(function (k) { return v[k] !== (st.state[k] || ''); });
  }
  /**
   * 서버 값을 입력 칸에 채운다. force 가 아니면 고치던 칸은 건드리지 않는다.
   * '고치던 칸' 은 마지막으로 채워 준 값(st.shown)과 다른 칸이다 — 새로 받은 서버 값과 비교하면
   * 처음 열 때 빈 칸이 저장된 값과 달라 모두 고치던 것으로 보이고, 저장한 글자가 채워지지 않는다.
   */
  function fill(force) {
    if (!st.built || !st.state) return;
    FIELDS.forEach(function (k) {
      var el = $('f-' + k), now = el.value.replace(/\r\n?/g, '\n').trim();
      var edited = now !== (st.shown[k] || '');
      if (force || (!edited && document.activeElement !== el)) { el.value = st.state[k] || ''; st.shown[k] = st.state[k] || ''; }
    });
    counts();
  }
  function counts() {
    $('c-title').textContent = $('f-title').value.length + '/60';
    $('c-desc').textContent = $('f-desc').value.length + '/300';
  }
  function looksUrl(s) {
    if (!s) return true;
    return !/\s/.test(s) && /^(https?:\/\/)?(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.\-]*[a-z0-9])?)(:\d{1,5})?([\/?#].*)?$/i.test(s);
  }
  function fieldErr(k, text) {
    var el = $('e-' + k);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    $('f-' + k).setAttribute('aria-invalid', text ? 'true' : 'false');
  }
  function note(kind, text) {
    var el = $('msg');
    if (!el) return;
    el.className = 'msg ' + kind;
    el.textContent = text;
    el.hidden = !text;
  }

  function save() {
    var keys = dirtyKeys();
    if (!keys.length || st.busy || !canEdit()) return;
    var v = values(), data = {}, bad = false;
    keys.forEach(function (k) { data[k] = v[k]; });
    ['url', 'video'].forEach(function (k) {
      var ok = looksUrl(v[k]);
      fieldErr(k, ok ? '' : '주소 형식이 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주세요.');
      if (!ok) bad = true;
    });
    if (bad) return note('err', '주소를 확인해 주세요.');
    st.busy = true;
    note('', '');
    paintSend();
    EP.api('info.save', { data: data, as: st.as || undefined }, { nonce: EP.nonce(), tries: 3 }).then(function (d) {
      st.busy = false;
      if (d && d.ok) {
        st.state = d.state;
        fill(true);
        paint();
        note('ok', '저장했습니다 · ' + EP.fmtTime(EP.now()));
        return;
      }
      if (d && d.error === 'INVALID') {
        (d.fields || []).forEach(function (k) { fieldErr(k, '이 주소는 받을 수 없습니다. http · https 주소만 넣어 주세요.'); });
        note('err', EP.say(d));
      } else if (d && d.error === 'AUTH_FAILED') {
        return;                                            // 로그인 화면으로 돌아가 있다. 적은 내용은 남아 있다
      } else note('err', EP.say(d));
      paintSend();
    }, function (e) { st.busy = false; note('err', EP.say(e)); paintSend(); });
  }

  /* ------------------------------ 그리기 ------------------------------ */
  function ck(text, on) { return '<span class="ck' + (on ? ' on' : '') + '"><i></i>' + text + '</span>'; }

  function paint() {
    if (!st.built) return;
    var d = st.me, s = st.state, team = d && d.team, has = !!(team && s);
    $('h-team').textContent = team ? team.no + '팀 · ' + team.track + (team.proxy ? ' (대리)' : '')
      : (d && d.admin ? '팀을 골라 주세요' : '—');
    paintPick();
    ['state', 'steps'].forEach(function (id) { $(id).hidden = !has; });
    if (!has) { $('send').hidden = true; $('hist-wrap').hidden = true; return; }

    // 상태 띠
    var okInfo = !!s.title, okProd = !!(s.url || s.program), okDeck = !!s.deck, edit = canEdit();
    var left = [];
    if (!okInfo) left.push('프로젝트 이름');
    if (!okProd) left.push('결과물');
    if (!okDeck) left.push('발표 자료');
    var el = $('state');
    el.className = 'sb-state' + (s.complete ? ' done' : '') + (edit ? '' : ' closed');
    el.innerHTML = '<div class="who"><b>' + esc(team.no) + '팀</b><span>' + esc(team.track) + ' 트랙' +
      (team.proxy ? ' · 운영진이 대신 제출하는 중' : (team.name ? ' · ' + esc(team.name) : '')) + '</span></div>' +
      '<div class="cks">' + ck('프로젝트 이름', okInfo) + ck('결과물', okProd) + ck('발표 자료', okDeck) + '</div>' +
      '<span class="verdict">' + (edit
        ? (s.complete ? '제출 완료' : left.join(' · ') + ' 남음')
        : (s.complete ? '제출 완료 · 마감됨' : '마감됨 · ' + (left.length ? left.join(' · ') + ' 없음' : ''))) + '</span>';

    // 단계 표시
    var mark = function (key, done, text) { $('st-' + key).classList.toggle('done', !!done); $('v-' + key).textContent = text; };
    mark('info', okInfo, okInfo ? '' : '이름을 적어 주세요');
    mark('product', okProd, s.url && s.program ? '배포 주소 · 프로그램 파일' : s.url ? '배포 주소' : s.program ? '프로그램 파일' : '주소나 파일 중 하나');
    mark('deck', okDeck, okDeck ? EP.fmtTime(s.deck.at) + ' 제출' : '아직 없음');
    mark('video', !!s.video, '');

    FIELDS.forEach(function (k) { $('f-' + k).disabled = !edit; });
    paintSlot('program');
    paintSlot('deck');
    paintHist();
    paintSend();
  }

  function paintPick() {
    var d = st.me, box = $('pick');
    box.hidden = !(d && d.admin);
    if (!d || !d.admin) return;
    var sel = $('pick-team'), sig = (d.teams || []).length + ':' + (d.team && !d.team.proxy ? d.team.no : '');
    if (sel.getAttribute('data-sig') !== sig) {
      sel.innerHTML = '<option value="">' + (d.team && !d.team.proxy ? '내 팀 (' + esc(d.team.no) + '팀)' : '팀 고르기') + '</option>' +
        (d.teams || []).map(function (t) { return '<option value="' + esc(t.no) + '">' + esc(t.no) + '팀 · ' + esc(t.track) + '</option>'; }).join('');
      sel.setAttribute('data-sig', sig);
    }
    sel.value = st.as;
    sel.disabled = uploading();
  }

  function paintSlot(kind) {
    var el = $('slot-' + kind), K = st.limits[kind], f = st.state[kind], up = st.up[kind], edit = canEdit(), html;
    if (up) {
      html = '<div class="file"><div class="t"><div class="nm">' + esc(up.name) + '</div><div class="meta" id="pm-' + kind + '"></div></div>' +
        '<div class="acts"><button class="mini quiet" type="button" data-act="cancel" data-kind="' + kind + '">취소</button></div>' +
        '<div class="prog"><span class="t"><span class="f" id="pf-' + kind + '"></span></span><span class="n" id="pn-' + kind + '">0%</span></div></div>';
    } else if (f) {
      html = '<div class="file now"><div class="t"><div class="nm">' + esc(f.name) + '</div>' +
        '<div class="meta">' + EP.fmtSize(f.size) + ' · ' + EP.fmtTime(f.at) + ' 제출' + (f.by ? ' · ' + esc(f.by) : '') + pdfNote(f) +
        (f.md5 ? ' · <span title="파일 지문(md5). 내 컴퓨터의 파일과 같은지 확인할 때 씁니다">md5 <code>' + esc(f.md5.slice(0, 10)) + '…</code></span>' : '') +
        '</div></div><div class="acts">' +
        '<button class="mini quiet" type="button" data-act="get" data-id="' + f.id + '">받아서 확인</button>' +
        (edit ? '<button class="mini" type="button" data-act="pick" data-kind="' + kind + '">다시 올리기</button>' +
                '<button class="mini quiet" type="button" data-act="withdraw" data-kind="' + kind + '">내리기</button>' : '') +
        '</div></div>';
    } else if (edit) {
      html = '<div class="drop"><div class="t"><b>파일을 여기에 끌어다 놓거나 골라 주세요</b>' +
        '<span>' + K.exts.join(' · ') + ' · 최대 ' + EP.fmtSize(K.max) + '</span></div>' +
        '<button class="btn btn-o btn-sm" type="button" data-act="pick" data-kind="' + kind + '"><span>파일 고르기</span></button></div>';
    } else {
      html = '<p class="hint">낸 파일이 없습니다.</p>';
    }
    if (st.err[kind]) html += '<p class="err" style="margin-top:10px" role="alert">' + esc(st.err[kind]) + '</p>';
    el.innerHTML = html + '<input type="file" id="in-' + kind + '" data-kind="' + kind + '" hidden accept="' +
      K.exts.map(function (x) { return '.' + x; }).join(',') + '">';
    if (up) paintProgress(kind);
  }
  function paintProgress(kind) {
    var up = st.up[kind], pf = $('pf-' + kind);
    if (!up || !pf) return;
    var pct = up.total ? Math.min(100, Math.floor(up.sent / up.total * 100)) : 0;
    pf.style.width = pct + '%';
    $('pn-' + kind).textContent = pct + '%';
    var text = EP.fmtSize(up.sent) + ' / ' + EP.fmtSize(up.total);
    if (up.sent >= up.total) text += ' · 마무리하는 중';
    else {
      if (up.rate > 0) {
        var sec = Math.ceil((up.total - up.sent) / up.rate);
        text += ' · 약 ' + (sec >= 90 ? Math.ceil(sec / 60) + '분' : sec + '초') + ' 남음';
      }
      if (up.mode === 'relay') text += ' · 우회 경로로 올리는 중 (조금 느립니다)';
    }
    if (up.waiting) text = EP.fmtSize(up.sent) + ' / ' + EP.fmtSize(up.total) + ' · 다시 로그인하면 이어서 마무리합니다';
    $('pm-' + kind).textContent = text;
  }

  function paintHist() {
    var list = st.state.history || [];
    $('hist-wrap').hidden = !list.length;
    if (!list.length) return;
    $('hist-n').textContent = list.length + '개';
    $('hist').innerHTML = list.map(function (f) {
      return '<div class="r"><div><div class="nm">' + esc(f.name) + '</div><div class="meta">' + EP.fmtSize(f.size) + ' · ' +
        EP.fmtTime(f.at) + (f.by ? ' · ' + esc(f.by) : '') + '</div></div>' +
        '<button class="mini quiet" type="button" data-act="get" data-id="' + f.id + '">받기</button></div>';
    }).join('');
  }

  function paintSend() {
    if (!st.built || !st.state) return;
    var keys = dirtyKeys(), edit = canEdit(), s = st.state, box = $('send');
    box.hidden = !edit;
    box.classList.toggle('dirty', keys.length > 0);
    $('save').disabled = !keys.length || st.busy;
    $('save').innerHTML = '<span>' + (st.busy ? EP.spin('sm ink') + '저장하는 중' : '저장') + '</span>';
    $('send-t').innerHTML = keys.length
      ? '<b>저장하지 않은 내용이 있습니다.</b>'
      : (s.at ? '마지막 제출 ' + EP.fmtTime(s.at) + (s.by ? ' · ' + esc(s.by) : '') : '');
  }

  /* ------------------------------ 파일 ------------------------------ */
  function startUpload(kind, file) {
    if (!file || st.up[kind]) return;
    st.err[kind] = '';
    var bad = !canEdit() ? EP.say({ code: 'CLOSED' }) : EP.checkFile(file, st.limits[kind]);
    if (bad) { st.err[kind] = bad; paintSlot(kind); return; }
    var up = { name: file.name, sent: 0, total: file.size, mode: 'direct', rate: 0, last: 0, lastT: Date.now(), ctl: null };
    st.up[kind] = up;
    up.ctl = EP.upload(file, kind, {
      as: st.as || undefined,
      onWait: function (on) { up.waiting = on; paintProgress(kind); },
      onProgress: function (sent, total, mode) {
        var t = Date.now(), dt = (t - up.lastT) / 1000;
        if (dt >= 0.5) {
          var r = Math.max(0, sent - up.last) / dt;
          up.rate = up.rate ? up.rate * 0.7 + r * 0.3 : r;
          up.last = sent; up.lastT = t;
        }
        up.sent = sent; up.mode = mode;
        paintProgress(kind);
      }
    });
    paint();
    up.ctl.promise.then(function (state) {
      if (st.up[kind] !== up) return;                    // 그 사이에 다른 계정으로 바뀌었다
      st.up[kind] = null;
      st.state = state;
      fill(false);
      paint();
      if (kind === 'deck') ensurePdf(state.deck);
      EP.toast(KIND_NAME[kind] + (kind === 'deck' ? '를' : '을') + ' 올렸습니다');
    }, function (e) {
      if (st.up[kind] !== up) return;
      st.up[kind] = null;
      if (!e || e.code !== 'CANCELLED') st.err[kind] = EP.say(e);
      paint();
    });
  }

  /* ------------------------------ 보기용 PDF ------------------------------
     PowerPoint · odp 발표 자료를 올리면 서버(Drive)가 PDF 로 바꿔 둔다 — 심사위원 화면에서 바로 열리게.
     몇 초 – 1분 걸린다. 올린 직후, 그리고 이 화면을 열 때(아직 없으면) 한 번씩 부른다. 실패해도 제출은 그대로다. */
  var CONV = /\.(pptx|ppt|pptm|ppsx|pps|potx|pot|odp)$/i;
  function pdfNote(f) {
    if (!f || f.kind !== 'deck' || !CONV.test(f.name)) return '';
    var s = st.pdf[f.id];
    if (f.pdf || s === 'ok') return ' · <span class="ok">보기용 PDF 준비됨</span>';
    if (s === 'busy') return ' · 보기용 PDF 만드는 중…';
    if (s === 'fail') return ' · <span class="bad">PDF 로 바꾸지 못했습니다 (원본은 제출됨)</span>';
    return '';
  }
  function ensurePdf(f) {
    if (!f || f.pdf || !CONV.test(f.name) || st.pdf[f.id]) return;
    st.pdf[f.id] = 'busy';
    if (st.built) paintSlot('deck');
    EP.api('deck.pdf', { id: f.id, as: st.as || undefined }, { timeout: 330000, tries: 1 }).then(function (r) {
      if (r && r.ok) {
        st.pdf[f.id] = 'ok';
        if (st.state && st.state.deck && st.state.deck.id === f.id) st.state.deck.pdf = r.pdf;
      } else if (r && (r.error === 'PDF_BUSY' || r.error === 'BUSY')) {
        st.pdf[f.id] = '';                                   // 다른 사람(같은 팀)이 이미 바꾸는 중 — 조금 뒤 다시
        setTimeout(function () { if (st.state && st.state.deck && st.state.deck.id === f.id) ensurePdf(st.state.deck); }, 20000);
      } else st.pdf[f.id] = 'fail';
      if (st.built) paintSlot('deck');
    }, function () { st.pdf[f.id] = 'fail'; if (st.built) paintSlot('deck'); });
  }

  function fetchFile(btn, id) {
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true;
    EP.download(id, { as: st.as || undefined, onProgress: function (got, total) {
      btn.textContent = '받는 중 ' + Math.floor(got / total * 100) + '%';
    } }).then(function (r) {
      EP.saveBlob(r.blob, r.name);
      btn.textContent = label; btn.disabled = false;
    }, function (e) {
      btn.textContent = label; btn.disabled = false;
      EP.toast(EP.say(e));
    });
  }

  function withdraw(kind) {
    if (st.busy || !st.state[kind]) return;
    if (!window.confirm('지금 올려 둔 ' + KIND_NAME[kind] + (kind === 'deck' ? '를' : '을') + ' 내릴까요?\n파일은 지워지지 않고 옛날 자료로 옮겨집니다.')) return;
    st.busy = true;
    EP.api('file.withdraw', { kind: kind, as: st.as || undefined }, { nonce: EP.nonce(), tries: 3 }).then(function (d) {
      st.busy = false;
      if (d && d.ok) { st.state = d.state; paint(); EP.toast('내렸습니다'); }
      else if (d && d.error === 'AUTH_FAILED') return;
      else { st.err[kind] = EP.say(d); paint(); }
    }, function (e) { st.busy = false; st.err[kind] = EP.say(e); paint(); });
  }

  /* ------------------------------ 이벤트 ------------------------------ */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !app.contains(b)) return;
    var act = b.getAttribute('data-act'), kind = b.getAttribute('data-kind');
    if (act === 'pick') { var inp = $('in-' + kind); if (inp) inp.click(); }
    else if (act === 'cancel') { if (st.up[kind] && st.up[kind].ctl) st.up[kind].ctl.cancel(); }
    else if (act === 'withdraw') withdraw(kind);
    else if (act === 'get') fetchFile(b, Number(b.getAttribute('data-id')));
  }
  function onChange(e) {
    var t = e.target;
    if (t && t.type === 'file' && t.files && t.files[0]) startUpload(t.getAttribute('data-kind'), t.files[0]);
  }
  function onInput(e) {
    var id = e.target && e.target.id;
    if (!id || id.indexOf('f-') !== 0) return;
    if (id === 'f-url' || id === 'f-video') fieldErr(id.slice(2), '');
    counts();
    paintSend();
  }
  function slotOf(e) { return e.target.closest ? e.target.closest('[data-slot]') : null; }
  function onDragOver(e) {
    var slot = slotOf(e);
    if (!slot || !canEdit()) return;
    e.preventDefault();
    var d = slot.querySelector('.drop');
    if (d) d.classList.add('over');
  }
  function onDragEnd(e) {
    var slot = slotOf(e);
    if (!slot) return;
    var d = slot.querySelector('.drop');
    if (d) d.classList.remove('over');
    if (e.type !== 'drop') return;
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) startUpload(slot.getAttribute('data-slot'), f);
  }
  // 파일을 놓는 자리 밖에 떨어뜨리면 브라우저가 그 파일을 열어 버린다 — 막는다
  ['dragover', 'drop'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (!slotOf(e)) e.preventDefault(); });
  });
  window.addEventListener('beforeunload', function (e) {
    if (uploading() || (st.built && st.state && dirtyKeys().length)) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------ 시작 ------------------------------ */
  if (EP.pending) {
    // 사이트는 올라갔는데 제출 서버가 아직 연결되지 않았다
    $('h-team').textContent = '—';
    tick();
    setInterval(tick, 1000);
    showGate('<div class="t"><span class="lab blue">Opening soon</span><b>제출 페이지를 준비하고 있습니다</b>' +
      '<span>곧 열립니다. 열리면 공지로 알려 드리겠습니다. 그 전에 급히 낼 것이 있으면 운영진에게 알려 주세요.</span></div>');
    return;
  }
  $('demo-note').hidden = !EP.demo;
  EP.initInApp();
  EP.mountAuth($('top-auth'));
  tick();
  setInterval(tick, 1000);
  EP.warm().then(function (d) {
    if (d && d.deadline) { st.deadline = d.deadline; if (d.graceMin !== undefined) st.grace = d.graceMin; tick(); }
  });

  var lastSub = '';
  S.onChange(function (u, why) {
    // 스스로 로그아웃했거나 다른 계정으로 바뀌었을 때만 올리던 것을 그만둔다.
    // 로그인 시간이 지난 것뿐이면 그대로 두고, 같은 계정으로 다시 로그인하면 이어서 마무리한다.
    if (why === 'logout' || (u && lastSub && u.sub !== lastSub)) {
      ['deck', 'program'].forEach(function (k) { var up = st.up[k]; st.up[k] = null; if (up && up.ctl) up.ctl.cancel(); });
      st.as = '';
      if (st.built) FIELDS.forEach(function (k) { $('f-' + k).value = ''; });
      st.shown = {};
    }
    st.me = null; st.state = null; st.err = { deck: '', program: '' };
    if (!u) { $('h-team').textContent = '로그인을 해주세요'; gateLogin(why === 'expired'); return; }
    lastSub = u.sub;
    load();
  });

  // 같은 팀의 다른 사람이 낸 것이 보이도록, 한가할 때 가끔 새로 읽는다 (사람마다 조금씩 어긋난 간격으로)
  var idleEvery = 60000 + Math.floor(Math.random() * 30000);
  function refreshIfIdle() {
    if (document.hidden || !st.me || !st.state || uploading() || st.busy || dirtyKeys().length) return;
    if (Date.now() - st.loadedAt < idleEvery) return;
    load(true);
  }
  setInterval(refreshIfIdle, 20000);
  document.addEventListener('visibilitychange', refreshIfIdle);
})();
