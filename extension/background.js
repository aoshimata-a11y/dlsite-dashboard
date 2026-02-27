/**
 * background.js - Manifest V3 Service Worker
 *
 * Firebase Realtime Database に REST API で直接アクセスする。
 * 認証は不要（Firebase Security Rules を公開設定にしている）。
 */

const DB_URL = 'https://dlsite-dashboard-default-rtdb.firebaseio.com';

// ============================================================
// Firebase Realtime Database REST API
// ============================================================

async function firebaseFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error(`ネットワークエラー: ${e.message}`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

async function dbGet(path) {
  return firebaseFetch(`${DB_URL}/${path}.json`);
}

async function dbSet(path, data) {
  return firebaseFetch(`${DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function dbPush(path, data) {
  return firebaseFetch(`${DB_URL}/${path}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
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
