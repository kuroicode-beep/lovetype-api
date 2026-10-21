// src/services/storeVerification.js
const { createHash } = require('node:crypto');
const { GoogleAuth } = require('google-auth-library');
const CREDITS = Object.freeze({ tarot_1: 1, tarot_6: 6, tarot_10p: 10, tarot_13: 13, tarot_40: 40, tarot_sub: 0 });

// Return a public error without including store tokens or credential contents.
function failure(status, code) { return Object.assign(new Error(code), { status, code }); }
// Match the obfuscated account identifier supplied by the mobile billing flow.
function accountHash(userId) { return createHash('sha256').update(userId).digest('hex'); }

// Verify purchases with Google Play; unsupported or unconfigured stores fail closed.
async function verifyPlayReceipt(body, userId, options = {}) {
  const env = options.env || process.env;
  if (!Object.hasOwn(CREDITS, body.product_id)) throw failure(400, 'unknown_product');
  if (body.platform !== 'android') throw failure(503, 'store_not_configured');
  if (typeof body.receipt !== 'string' || !body.receipt || body.receipt.length > 16384) throw failure(400, 'receipt_required');
  if (!env.PLAY_SERVICE_ACCOUNT_JSON || !env.PLAY_PACKAGE_NAME) throw failure(503, 'play_verification_not_configured');
  let client = options.client;
  if (!client) {
    try {
      client = await new GoogleAuth({ credentials: JSON.parse(env.PLAY_SERVICE_ACCOUNT_JSON), scopes: ['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
    } catch { throw failure(503, 'play_verification_not_configured'); }
  }
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.PLAY_PACKAGE_NAME)}/purchases`;
  const token = encodeURIComponent(body.receipt);
  const product = encodeURIComponent(body.product_id);
  const subscription = body.product_id === 'tarot_sub';
  const url = subscription ? `${base}/subscriptionsv2/tokens/${token}` : `${base}/products/${product}/tokens/${token}`;
  let purchase;
  try { purchase = (await client.request({ url, timeout: 20000 })).data; }
  catch { throw failure(502, 'store_verification_failed'); }
  const owner = subscription ? purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId : purchase.obfuscatedExternalAccountId;
  if (owner !== accountHash(userId)) throw failure(403, 'purchase_owner_mismatch');
  let expiresAt = null;
  if (subscription) {
    const item = purchase.lineItems?.find(item => item.productId === body.product_id);
    expiresAt = item && new Date(item.expiryTime);
    if (!['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'].includes(purchase.subscriptionState) || !expiresAt || !(expiresAt.getTime() > Date.now())) throw failure(400, 'subscription_inactive');
  } else if (purchase.purchaseState !== 0 || (purchase.quantity != null && purchase.quantity !== 1)) {
    throw failure(400, 'purchase_not_completed');
  }
  return {
    key: createHash('sha256').update(`android:${body.receipt}`).digest('hex'),
    productId: body.product_id, credits: CREDITS[body.product_id], expiresAt,
    // Fulfilment is committed before acknowledging or consuming the store purchase.
    async finish() {
      if (subscription && purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') return;
      if (!subscription && purchase.consumptionState === 1) return;
      const action = subscription ? 'acknowledge' : 'consume';
      const type = subscription ? 'subscriptions' : 'products';
      try { await client.request({ url: `${base}/${type}/${product}/tokens/${token}:${action}`, method: 'POST', data: {}, timeout: 20000 }); }
      catch { throw failure(502, 'store_completion_pending'); }
    },
  };
}
module.exports = { verifyPlayReceipt, accountHash, failure, CREDITS };
