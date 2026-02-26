// Service Worker - Firebase への書き込みとメッセージ仲介

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase, ref, set, get, push, onValue
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import {
  getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// ---- Auth ----

async function getSignedInUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError?.message || "認証失敗");
        return;
      }
      try {
        const credential = GoogleAuthProvider.credential(null, token);
        const result = await signInWithCredential(auth, credential);
        resolve(result.user);
      } catch (e) {
        reject(e.message);
      }
    });
  });
}

// ---- Firebase helpers ----

async function ensureAuth() {
  let user = await getSignedInUser();
  if (!user) {
    user = await signInWithGoogle();
  }
  return user;
}

async function loadWorks() {
  await ensureAuth();
  const snap = await get(ref(db, "dashboard/works"));
  return snap.val() || {};
}

async function saveSnapshot(records, ts) {
  await ensureAuth();
  const snap = {
    ts: ts || new Date().toISOString(),
    records
  };
  await push(ref(db, "dashboard/snapshots"), snap);
}

async function saveWorkMeta(workId, fields) {
  await ensureAuth();
  const current = await get(ref(db, `dashboard/works/${workId}`));
  const existing = current.val() || {};
  await set(ref(db, `dashboard/works/${workId}`), { ...existing, ...fields });
}

// ---- メッセージハンドラ ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
  return true; // 非同期応答を許可
});

async function handleMessage(msg) {
  switch (msg.type) {
    case "GET_WORKS":
      return loadWorks();

    case "SAVE_WORK_SNAPSHOT": {
      // content script からの単作品データ保存
      const { workId, data } = msg;
      const records = { [workId]: data };
      await saveSnapshot(records, new Date().toISOString());
      return { ok: true };
    }

    case "SAVE_BULK_SNAPSHOT": {
      // ポップアップからの一括保存（複数作品のrecords）
      const { records, ts } = msg;
      await saveSnapshot(records, ts);
      return { ok: true };
    }

    case "SAVE_WORK_META": {
      const { workId, fields } = msg;
      await saveWorkMeta(workId, fields);
      return { ok: true };
    }

    case "SIGN_IN":
      await signInWithGoogle();
      return { ok: true };

    case "GET_AUTH_STATE": {
      const user = await getSignedInUser();
      return { uid: user?.uid, email: user?.email, displayName: user?.displayName };
    }

    case "OPEN_WORK_TABS": {
      // 作品公開ページを順番に開いてデータ取得
      const { workIds } = msg;
      const results = {};
      for (const id of workIds) {
        const url = `https://www.dlsite.com/home/work/=/product_id/${id}.html`;
        const tab = await chrome.tabs.create({ url, active: false });
        // content-work.js からのデータ受信を待つ
        const data = await waitForCapture(tab.id, id, 15000);
        if (data) results[id] = data;
        await chrome.tabs.remove(tab.id);
        await sleep(1000); // レート制限対策
      }
      if (Object.keys(results).length > 0) {
        await saveSnapshot(results, new Date().toISOString());
      }
      return { ok: true, captured: Object.keys(results).length };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// タブからキャプチャ結果を待機
function waitForCapture(tabId, workId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      resolve(null);
    }, timeoutMs);

    function handler(msg, sender) {
      if (
        msg.type === "WORK_DATA_CAPTURED" &&
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
  return new Promise((r) => setTimeout(r, ms));
}
