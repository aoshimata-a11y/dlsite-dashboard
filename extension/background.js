/**
 * background.js - Manifest V3 Service Worker
 *
 * 【なぜ Firebase SDK を使わないか】
 * Manifest V3 の Service Worker は外部CDN（www.gstatic.com）からの
 * ES module インポートが CSP により禁止されている。
 * また localStorage が存在しないため Firebase Auth の永続化も不可。
 * → Firebase REST API + chrome.identity で完全に代替する。
 */

const DB_URL  = 'https://dlsite-dashboard-default-rtdb.firebaseio.com';
const API_KEY = 'AIzaSyCkGabMQeQ2uB5RCLo3ndywW-SVuEGFuag';
const AUTH_STORAGE_KEY = 'dlsite_auth_v1';

// ============================================================
// chrome.storage ヘルパー
// ============================================================

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ============================================================
// 認証：Google OAuth → Firebase ID トークン交換
// ============================================================

/**
 * chrome.identity.getAuthToken でGoogleアクセストークンを取得し、
 * Firebase Identity Toolkit REST API で Firebase ID トークンに交換する。
 * 取得した ID トークン・リフレッシュトークンを chrome.storage.local に保存。
 */
async function signInWithGoogle() {
  // 1. Chrome の Google アカウントからアクセストークンを取得
  const accessToken = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Google認証に失敗しました'));
      } else {
        resolve(token);
      }
    });
  });

  // 2. アクセストークンを Firebase ID トークンに交換
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestUri: 'http://localhost',
        postBody: `access_token=${accessToken}&providerId=google.com`,
        returnSecureToken: true,
        returnIdpCredential: true
      })
    }
  );

  const data = await res.json();
  if (data.error) {
    throw new Error(`Firebase認証エラー: ${data.error.message}`);
  }

  // 3. トークンを保存
  const authData = {
    idToken:      data.idToken,
    refreshToken: data.refreshToken,
    expiry:       Date.now() + parseInt(data.expiresIn, 10) * 1000,
    uid:          data.localId,
    email:        data.email,
    displayName:  data.displayName || data.email
  };
  await storageSet({ [AUTH_STORAGE_KEY]: authData });
  return { uid: authData.uid, email: authData.email, displayName: authData.displayName };
}

async function signOutUser() {
  // chrome.identity のキャッシュも削除
  await new Promise(resolve => {
    chrome.identity.clearAllCachedAuthTokens(resolve);
  });
  await storageRemove([AUTH_STORAGE_KEY]);
}

/** 保存済みの認証情報を返す（未ログインなら null） */
async function getAuthState() {
  const stored = (await storageGet([AUTH_STORAGE_KEY]))[AUTH_STORAGE_KEY];
  if (!stored) return null;
  return { uid: stored.uid, email: stored.email, displayName: stored.displayName };
}

/**
 * 有効な Firebase ID トークンを返す。
 * 期限切れの場合はリフレッシュトークンで再取得する。
 */
async function getValidIdToken() {
  const stored = (await storageGet([AUTH_STORAGE_KEY]))[AUTH_STORAGE_KEY];
  if (!stored) return null;

  // 有効期限の60秒前まで使い回す
  if (stored.expiry > Date.now() + 60_000) {
    return stored.idToken;
  }

  // リフレッシュトークンで更新
  try {
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: stored.refreshToken
        })
      }
    );
    const data = await res.json();
    if (!data.id_token) throw new Error('リフレッシュ失敗');

    const updated = {
      ...stored,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiry: Date.now() + parseInt(data.expires_in, 10) * 1000
    };
    await storageSet({ [AUTH_STORAGE_KEY]: updated });
    return updated.idToken;
  } catch (e) {
    // リフレッシュ失敗 → 再ログインが必要
    await storageRemove([AUTH_STORAGE_KEY]);
    return null;
  }
}

// ============================================================
// Firebase Realtime Database REST API
// ============================================================

async function dbGet(path) {
  const token = await getValidIdToken();
  if (!token) throw new Error('ログインしてください');
  const res = await fetch(`${DB_URL}/${path}.json?auth=${token}`);
  if (!res.ok) throw new Error(`DB取得エラー: ${res.status}`);
  return res.json();
}

async function dbSet(path, data) {
  const token = await getValidIdToken();
  if (!token) throw new Error('ログインしてください');
  const res = await fetch(`${DB_URL}/${path}.json?auth=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`DB書き込みエラー: ${res.status}`);
  return res.json();
}

async function dbPush(path, data) {
  const token = await getValidIdToken();
  if (!token) throw new Error('ログインしてください');
  const res = await fetch(`${DB_URL}/${path}.json?auth=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`DBプッシュエラー: ${res.status}`);
  return res.json();
}

// ============================================================
// データ操作
// ============================================================

async function loadWorks() {
  return (await dbGet('dashboard/works')) || {};
}

async function saveSnapshot(records, ts) {
  await dbPush('dashboard/snapshots', {
    ts: ts || new Date().toISOString(),
    records
  });
}

async function saveWorkMeta(workId, fields) {
  const existing = (await dbGet(`dashboard/works/${workId}`)) || {};
  await dbSet(`dashboard/works/${workId}`, { ...existing, ...fields });
}

// ============================================================
// メッセージハンドラ
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(e => sendResponse({ error: String(e.message || e) }));
  return true; // 非同期応答を許可
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    case 'SIGN_IN': {
      const user = await signInWithGoogle();
      return { ok: true, ...user };
    }

    case 'SIGN_OUT': {
      await signOutUser();
      return { ok: true };
    }

    case 'GET_AUTH_STATE': {
      const state = await getAuthState();
      return state || { uid: null };
    }

    case 'GET_WORKS':
      return loadWorks();

    case 'SAVE_BULK_SNAPSHOT': {
      const { records, ts } = msg;
      await saveSnapshot(records, ts);
      return { ok: true };
    }

    case 'SAVE_WORK_SNAPSHOT': {
      const { workId, data } = msg;
      await saveSnapshot({ [workId]: data }, new Date().toISOString());
      return { ok: true };
    }

    case 'SAVE_WORK_META': {
      const { workId, fields } = msg;
      await saveWorkMeta(workId, fields);
      return { ok: true };
    }

    case 'OPEN_WORK_TABS': {
      const { workIds } = msg;
      const results = {};
      for (const id of workIds) {
        const url = `https://www.dlsite.com/home/work/=/product_id/${id}.html`;
        const tab = await chrome.tabs.create({ url, active: false });
        const data = await waitForCapture(tab.id, id, 15_000);
        if (data) results[id] = data;
        await chrome.tabs.remove(tab.id);
        await sleep(1000);
      }
      if (Object.keys(results).length > 0) {
        await saveSnapshot(results, new Date().toISOString());
      }
      return { ok: true, captured: Object.keys(results).length };
    }

    // content-work.js からのキャプチャ通知（background が仲介するだけ）
    case 'WORK_DATA_CAPTURED':
      return { ok: true };

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// ============================================================
// タブキャプチャ待機
// ============================================================

function waitForCapture(tabId, workId, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      resolve(null);
    }, timeoutMs);

    function handler(msg, sender) {
      if (
        msg.type === 'WORK_DATA_CAPTURED' &&
        msg.workId === workId &&
        sender.tab?.id === tabId
      ) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(msg.data);
      }
    }
    chrome.runtime.onMessage.addListener(handler);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
