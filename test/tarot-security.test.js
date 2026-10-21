// test/tarot-security.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { newDb, DataType } = require('pg-mem');
const { createSecureTarotRouter } = require('../src/routes/secureTarot');
const { verifyPlayReceipt, accountHash, failure } = require('../src/services/storeVerification');

// Run real route and SQL logic against an isolated in-memory PostgreSQL model.
async function fixture(t, overrides = {}) {
  const db = newDb();
  db.registerExtension('uuid-ossp', schema => schema.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, implementation: randomUUID, impure: true }));
  db.public.none(fs.readFileSync('sql/tarot_v1.sql','utf8'));
  db.public.none(fs.readFileSync('sql/tarot_security.sql','utf8'));
  const { Pool } = db.adapters.createPg(); const raw = new Pool();
  // pg-mem does not implement advisory locks or timezone expressions; production uses PostgreSQL.
  const query = async (sql, args = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes("(NOW() AT TIME ZONE 'Asia/Seoul')::date")) {
      sql = sql.replace("(NOW() AT TIME ZONE 'Asia/Seoul')::date", '$10::date');
      args = [...args, new Date().toISOString().slice(0,10)];
    }
    return raw.query(sql,args);
  };
  const pool = { query, connect: async () => {
    let snapshot;
    return { async query(sql,args) {
      if (sql === 'BEGIN') { snapshot = db.backup(); return { rows: [] }; }
      if (sql === 'ROLLBACK') { snapshot.restore(); return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      return query(sql,args);
    }, release() {} };
  } };
  await pool.query(`INSERT INTO lovetype_tarot_wallet(app_id,user_id,balance) VALUES('lovetype-tarot','alice',20)`);
  let generations = 0; let finishes = 0;
  const app = express(); app.use(express.json());
  app.use(createSecureTarotRouter({ pool, getSettings: async () => ({ cooldown_daily_sec:3600,cooldown_romance_sec:3600 }),
    verifyToken: async token => { if (token !== 'alice') throw failure(401,'invalid_token'); return token; },
    generateStory: async () => { generations++; return '검증 이야기'; },
    verifyReceipt: async b => { if (!b.receipt) throw failure(400,'receipt_required'); return { key:b.receipt,productId:'tarot_10p',credits:10,finish:async()=>{finishes++;} }; }, ...overrides }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{ server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { pool, generations:()=>generations,finishes:()=>finishes, async request(path,body,token='alice') {
    const response = await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify({app_id:'lovetype-tarot',user_id:'alice',...body})}:{})});
    return { status:response.status, body:await response.json() };
  } };
}
test('인증 없는 지갑 조회와 타 사용자 식별자를 차단한다', async t => {
  const f=await fixture(t);
  assert.equal((await f.request('/payment/balance?app_id=lovetype-tarot&user_id=alice',null,null)).status,401);
  assert.equal((await f.request('/payment/balance?app_id=lovetype-tarot&user_id=bob')).status,403);
});
test('영수증 없는 충전은 잔액을 바꾸지 않는다',async t=>{
  const f=await fixture(t); assert.equal((await f.request('/payment/charge',{product_id:'tarot_10p'})).status,400);
  assert.equal((await f.request('/payment/balance?app_id=lovetype-tarot')).body.balance,20);
});
test('같은 검증 영수증은 한번만 지급하고 재시도는 스토어 완료를 복구한다',async t=>{
  const f=await fixture(t); const b={receipt:'a'.repeat(64),product_id:'tarot_10p',amount:99999};
  assert.equal((await f.request('/payment/charge',b)).body.balance,30);
  const repeated=await f.request('/payment/charge',b);assert.equal(repeated.body.balance,30);assert.equal(repeated.body.duplicate,true);assert.equal(f.finishes(),2);
});
test('앱 topic 인자가 실제 쿨타임을 조회한다',async t=>{
  const f=await fixture(t);await f.pool.query(`INSERT INTO lovetype_tarot_cooldown VALUES('lovetype-tarot','alice','daily',NOW())`);
  const r=await f.request('/tarot/cooltime?app_id=lovetype-tarot&topic=daily&category_key=today');
  assert.equal(r.body.available,false);assert.ok(r.body.remaining_seconds>3500);
  assert.equal((await f.request('/tarot/cooltime?app_id=lovetype-tarot&topic=bad')).status,400);
});
test('리딩 생성·과금·저장이 결합되고 동일 요청 재시도에 중복 과금하지 않는다',async t=>{
  const f=await fixture(t);const b={request_id:randomUUID(),topic:'romance',prompt:'이야기'};
  const first=await f.request('/tarot',b);assert.equal(first.status,200);
  const retry=await f.request('/tarot',b);assert.equal(retry.body.reading_id,first.body.reading_id);assert.equal(f.generations(),1);
  assert.equal((await f.request('/payment/balance?app_id=lovetype-tarot')).body.balance,10);
  assert.equal((await f.request('/tarot',{...b,request_id:randomUUID()})).status,429);
});
test('AI 실패 시 포인트와 쿨타임을 보존한다',async t=>{
  const f=await fixture(t,{generateStory:async()=>{throw Error('offline');}});
  assert.equal((await f.request('/tarot',{request_id:randomUUID(),topic:'romance',prompt:'이야기'})).status,500);
  assert.equal((await f.request('/payment/balance?app_id=lovetype-tarot')).body.balance,20);
  assert.equal((await f.request('/tarot/cooltime?app_id=lovetype-tarot&topic=romance')).body.available,true);
});
test('과거 클라이언트의 별도 포인트 차감을 차단한다',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/payment/use',{amount:10})).status,410);
});
test('히스토리 재전송은 중복을 만들거나 쿨타임을 갱신하지 않는다',async t=>{
  const f=await fixture(t);const b={client_reading_id:'offline-1',story:'과거 이야기',theme:'오늘의 이야기'};
  const first=await f.request('/tarot/history',b);const second=await f.request('/tarot/history',b);
  assert.equal(first.status,200);assert.equal(second.body.id,first.body.id);
  assert.equal((await f.request('/tarot/cooltime?app_id=lovetype-tarot&topic=daily')).body.available,true);
});
test('스토어 미설정·알 수 없는 상품은 검증을 우회하지 않는다',async()=>{
  await assert.rejects(verifyPlayReceipt({product_id:'unknown',platform:'android',receipt:'x'},'alice',{env:{}}),{code:'unknown_product'});
  await assert.rejects(verifyPlayReceipt({product_id:'tarot_10p',platform:'android',receipt:'x'},'alice',{env:{}}),{code:'play_verification_not_configured'});
});
test('Google 응답의 계정·결제 상태·수량을 검증한다',async()=>{
  const env={PLAY_SERVICE_ACCOUNT_JSON:'{}',PLAY_PACKAGE_NAME:'com.svil.lovetype_tarot'};
  const b={product_id:'tarot_10p',platform:'android',receipt:'token'};
  const client={request:async()=>({data:{purchaseState:0,consumptionState:0,quantity:1,obfuscatedExternalAccountId:accountHash('alice')}})};
  const result=await verifyPlayReceipt(b,'alice',{env,client});assert.equal(result.credits,10);
  await assert.rejects(verifyPlayReceipt(b,'bob',{env,client}),{code:'purchase_owner_mismatch'});
  await assert.rejects(verifyPlayReceipt(b,'alice',{env,client:{request:async()=>({data:{purchaseState:2,obfuscatedExternalAccountId:accountHash('alice')}})}}),{code:'purchase_not_completed'});
  await assert.rejects(verifyPlayReceipt(b,'alice',{env,client:{request:async()=>({data:{purchaseState:0,quantity:2,obfuscatedExternalAccountId:accountHash('alice')}})}}),{code:'purchase_not_completed'});
});
test('구독은 스토어 만료시각과 상품을 확인하고 미래 만료만 인정한다',async()=>{
  const env={PLAY_SERVICE_ACCOUNT_JSON:'{}',PLAY_PACKAGE_NAME:'com.svil.lovetype_tarot'};
  const b={product_id:'tarot_sub',platform:'android',receipt:'subscription-token'};
  const data={subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',externalAccountIdentifiers:{obfuscatedExternalAccountId:accountHash('alice')},lineItems:[{productId:'tarot_sub',expiryTime:'2099-01-01T00:00:00Z'}]};
  const verified=await verifyPlayReceipt(b,'alice',{env,client:{request:async()=>({data})}});
  assert.equal(verified.expiresAt.toISOString(),'2099-01-01T00:00:00.000Z');
  await assert.rejects(verifyPlayReceipt(b,'alice',{env,client:{request:async()=>({data:{...data,subscriptionState:'SUBSCRIPTION_STATE_EXPIRED'}})}}),{code:'subscription_inactive'});
});
test('스토어 완료 실패 뒤에도 이미 지급한 거래는 중복 지급하지 않는다',async t=>{
  let offline=true;
  const f=await fixture(t,{verifyReceipt:async b=>({key:b.receipt,productId:'tarot_10p',credits:10,finish:async()=>{if(offline)throw failure(502,'store_completion_pending');}})});
  const body={receipt:'b'.repeat(64),product_id:'tarot_10p'};
  assert.equal((await f.request('/payment/charge',body)).status,502);
  offline=false;
  const recovered=await f.request('/payment/charge',body);
  assert.equal(recovered.body.balance,30);assert.equal(recovered.body.duplicate,true);
});
