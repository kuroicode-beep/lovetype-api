const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const corsMiddleware = require('./middlewares/cors');
const resultRouter = require('./routes/result');
const compatibilityRouter = require('./routes/compatibility');
const eventRouter = require('./routes/event');
const statsRouter = require('./routes/stats');
const v1Router = require('./routes/v1');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(corsMiddleware);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'lovetype-api' }));

app.use('/api/mbti-test', resultRouter);
app.use('/api/mbti-test', compatibilityRouter);
app.use('/api/event', eventRouter);
app.use('/api/stats', statsRouter);
app.use('/api/v1', v1Router);

app.get('/admin', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><title>LoveType-Tarot Admin</title>
<style>body{font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px}
label{display:block;margin-top:12px}input,textarea,select{width:100%;box-sizing:border-box}
button{margin-top:16px;padding:10px 16px}</style></head><body>
<h1>LoveType-Tarot 푸시 (MVP)</h1>
<p><code>X-Admin-Key</code>와 FCM 서비스 계정이 서버에 설정되어 있어야 합니다.</p>
<label>Admin API Key <input type="password" id="key" autocomplete="off"/></label>
<label>대상
<select id="target"><option value="all">전체</option><option value="subscribed">구독자만</option></select>
</label>
<label>특정 user_id (대상이 전체/구독이 아닐 때) <input id="uid" placeholder="비우면 전체/구독 사용"/></label>
<label>제목 <input id="title" value="LoveType-Tarot"/></label>
<label>내용 <textarea id="body" rows="4">오늘의 무료 타로가 기다리고 있어요 🔮</textarea></label>
<button type="button" id="send">발송</button>
<pre id="out"></pre>
<script>
document.getElementById('send').onclick = async () => {
  const key = document.getElementById('key').value;
  let target = document.getElementById('target').value;
  const uid = document.getElementById('uid').value.trim();
  if (uid) target = uid;
  const r = await fetch('/api/v1/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key
    },
    body: JSON.stringify({
      app_id: 'lovetype-tarot',
      title: document.getElementById('title').value,
      body: document.getElementById('body').value,
      target
    })
  });
  const t = await r.text();
  document.getElementById('out').textContent = r.status + '\\n' + t;
};
</script></body></html>`);
});

app.listen(PORT, () => {
  console.log(`LoveType API running on port ${PORT}`);
});
