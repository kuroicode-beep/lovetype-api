/**
 * Single-page admin UI for LoveType-Tarot (Railway).
 * API calls use header X-Admin-Key; configure ADMIN_API_KEY on the server.
 */
function renderAdminPage() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>LoveType-Tarot Admin</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;background:#0f0a18;color:#e8e0f0}
  h1{font-size:1.25rem;color:#c9a227}
  h2{font-size:1rem;margin-top:28px;color:#b8a8d8;border-bottom:1px solid #3d3558;padding-bottom:6px}
  label{display:block;margin-top:10px;font-size:.85rem;color:#9a8fb8}
  input,textarea,select{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #4a4068;background:#1a1428;color:#eee}
  button{margin-top:12px;margin-right:8px;padding:10px 14px;border-radius:8px;border:none;background:#6b4cc9;color:#fff;cursor:pointer}
  button.secondary{background:#3d3558}
  pre,#out,#out2,#out3,#out4,#out5{white-space:pre-wrap;background:#1a1428;padding:12px;border-radius:8px;font-size:12px;max-height:280px;overflow:auto;border:1px solid #3d3558}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row > div{flex:1;min-width:140px}
  p.note{font-size:12px;color:#7a7098}
</style>
</head>
<body>
<h1>LoveType-Tarot 어드민</h1>
<p class="note">모든 API는 헤더 <code>X-Admin-Key</code>가 필요합니다. 서버에 <code>ADMIN_API_KEY</code>와 FCM 설정을 두세요.</p>

<label>Admin API Key <input type="password" id="key" autocomplete="off"/></label>

<h2>1) 통계</h2>
<button type="button" id="btnStats">불러오기</button>
<pre id="outStats">(통계)</pre>

<h2>2) 결제 · 지갑 / 충전 로그</h2>
<button type="button" id="btnWallets">지갑 TOP 50</button>
<button type="button" class="secondary" id="btnCharges">충전 로그 100</button>
<pre id="outPay">(결제)</pre>

<h2>3) 푸시 발송</h2>
<label>대상
<select id="target"><option value="all">전체</option><option value="subscribed">구독자만</option></select>
</label>
<label>특정 user_id (비우면 위 선택 사용) <input id="uid" placeholder="optional"/></label>
<label>제목 <input id="title" value="LoveType-Tarot"/></label>
<label>내용 <textarea id="body" rows="3">오늘의 무료 타로가 기다리고 있어요</textarea></label>
<button type="button" id="sendPush">발송</button>
<pre id="outPush">(푸시 결과)</pre>

<h2>4) 쿨타임 · 카드덱 (DB)</h2>
<p class="note">쿨타임은 초 단위(60~864000). 덱 플래그는 앱에서 원격 반영하려면 별도 API 연동이 필요합니다(현재는 관리·기록용).</p>
<div class="row">
  <div><label>daily 쿨타임(초) <input type="number" id="cdDaily" min="60"/></label></div>
  <div><label>romance 쿨타임(초) <input type="number" id="cdRom" min="60"/></label></div>
</div>
<label><input type="checkbox" id="deckBasic"/> basic 덱 활성</label>
<label><input type="checkbox" id="deckLv"/> low_vision 덱 활성</label>
<label><input type="checkbox" id="deckWb"/> webtoon 덱 활성</label>
<button type="button" id="btnLoadSet">설정 불러오기</button>
<button type="button" id="btnSaveSet">설정 저장</button>
<pre id="outSet">(설정)</pre>

<script>
(function(){
  function hdr() {
    var k = document.getElementById('key').value;
    return { 'X-Admin-Key': k, 'Content-Type': 'application/json' };
  }
  async function j(path, opt) {
    var o = opt || {};
    var h = Object.assign({}, hdr(), o.headers || {});
    var r = await fetch(path, Object.assign({}, o, { headers: h }));
    var t = await r.text();
    var jv = null;
    try { jv = JSON.parse(t); } catch (e) {}
    return { ok: r.ok, status: r.status, text: t, json: jv };
  }
  document.getElementById('btnStats').onclick = async function() {
    var r = await j('/api/v1/admin/stats');
    document.getElementById('outStats').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
  };
  document.getElementById('btnWallets').onclick = async function() {
    var r = await j('/api/v1/admin/wallets?limit=50');
    document.getElementById('outPay').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
  };
  document.getElementById('btnCharges').onclick = async function() {
    var r = await j('/api/v1/admin/charges?limit=100');
    document.getElementById('outPay').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
  };
  document.getElementById('sendPush').onclick = async function() {
    var target = document.getElementById('target').value;
    var uid = document.getElementById('uid').value.trim();
    if (uid) target = uid;
    var r = await j('/api/v1/push/send', {
      method: 'POST',
      body: JSON.stringify({
        app_id: 'lovetype-tarot',
        title: document.getElementById('title').value,
        body: document.getElementById('body').value,
        target: target
      })
    });
    document.getElementById('outPush').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
  };
  document.getElementById('btnLoadSet').onclick = async function() {
    var r = await j('/api/v1/admin/settings');
    document.getElementById('outSet').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
    if (r.json && r.json.settings) {
      var s = r.json.settings;
      document.getElementById('cdDaily').value = s.cooldown_daily_sec;
      document.getElementById('cdRom').value = s.cooldown_romance_sec;
      document.getElementById('deckBasic').checked = !!s.deck_basic_enabled;
      document.getElementById('deckLv').checked = !!s.deck_low_vision_enabled;
      document.getElementById('deckWb').checked = !!s.deck_webtoon_enabled;
    }
  };
  document.getElementById('btnSaveSet').onclick = async function() {
    var body = {
      cooldown_daily_sec: Number(document.getElementById('cdDaily').value),
      cooldown_romance_sec: Number(document.getElementById('cdRom').value),
      deck_basic_enabled: document.getElementById('deckBasic').checked,
      deck_low_vision_enabled: document.getElementById('deckLv').checked,
      deck_webtoon_enabled: document.getElementById('deckWb').checked
    };
    var r = await j('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
    document.getElementById('outSet').textContent = r.status + '\\n' + (r.json ? JSON.stringify(r.json, null, 2) : r.text);
  };
})();
</script>
</body>
</html>`;
}

module.exports = renderAdminPage;
