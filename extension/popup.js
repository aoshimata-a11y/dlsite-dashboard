/**
 * popup.js - Chrome拡張ポップアップのロジック
 */

// ---- 初期化 ----

document.addEventListener("DOMContentLoaded", async () => {
  await initAuth();
  initTabs();
  initCsvImport();
  initRegister();
});

// ---- 認証 ----

async function initAuth() {
  const user = await bg("GET_AUTH_STATE");
  if (user?.uid) {
    showMain(user);
  } else {
    showLogin();
  }

  document.getElementById("loginBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("loginBtn");
    btn.disabled = true;
    btn.textContent = "ログイン中...";
    const res = await bg("SIGN_IN");
    btn.disabled = false;
    btn.textContent = "Googleでログイン";
    if (res?.ok) {
      showMain(res);
    } else {
      const msg = document.getElementById("loginErrorMsg");
      if (msg) msg.textContent = "❌ " + (res?.error || "ログインに失敗しました");
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await bg("SIGN_OUT");
    showLogin();
  });
}

function showLogin() {
  document.getElementById("loginPanel").style.display = "block";
  document.getElementById("mainPanel").style.display = "none";
  document.getElementById("authDot").className = "auth-dot offline";
  document.getElementById("authLabel").textContent = "未ログイン";
  document.getElementById("logoutBtn").style.display = "none";
  const msg = document.getElementById("loginErrorMsg");
  if (msg) msg.textContent = "";
}

function showMain(user) {
  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("mainPanel").style.display = "block";
  document.getElementById("authDot").className = "auth-dot";
  document.getElementById("authLabel").textContent = user?.displayName || user?.email || "ログイン済み";
  document.getElementById("logoutBtn").style.display = "inline-flex";
  loadWorkList();
}

// ---- タブ ----

function initTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll("[id^='tab-']").forEach(el => el.style.display = "none");
      document.getElementById(`tab-${name}`).style.display = "block";
    });
  });
}

// ---- 作品リスト ----

let works = {};

async function loadWorkList() {
  const list = document.getElementById("workList");
  try {
    works = await bg("GET_WORKS");
    if (!works || Object.keys(works).length === 0) {
      list.innerHTML = `<div class="status-msg">作品が登録されていません<br><small style="font-size:10px;">「作品登録」タブから追加してください</small></div>`;
      return;
    }
    renderWorkList();
  } catch (e) {
    list.innerHTML = `<div class="status-msg error">❌ 読み込み失敗</div>`;
  }
}

function renderWorkList() {
  const list = document.getElementById("workList");
  list.innerHTML = Object.values(works).map(w => {
    const isReleased = w.is_released !== false;
    const badge = isReleased
      ? `<span class="work-status-badge badge-released">発売済</span>`
      : `<span class="work-status-badge badge-pre">発売前</span>`;
    return `
      <div class="work-item">
        <div class="work-item-info">
          <div class="work-title">${escHtml(w.title)}</div>
          <div class="work-id">${w.id}</div>
        </div>
        ${badge}
      </div>
    `;
  }).join("");

  // キャプチャボタン設定
  document.getElementById("captureAllBtn").addEventListener("click", captureAll);
  document.getElementById("capturePageBtn").addEventListener("click", captureCurrentPage);
}

// ---- キャプチャ ----

async function captureAll() {
  const workIds = Object.keys(works);
  if (workIds.length === 0) return;

  const btn = document.getElementById("captureAllBtn");
  btn.disabled = true;
  const bar = document.getElementById("progressBar");
  const fill = document.getElementById("progressFill");
  bar.style.display = "block";
  fill.style.width = "0%";
  setStatus("captureStatus", `全作品更新中... (0/${workIds.length})`);

  let done = 0;
  // background.jsで一括処理
  const res = await bg("OPEN_WORK_TABS", { workIds });
  done = workIds.length;
  fill.style.width = "100%";

  if (res?.ok) {
    setStatus("captureStatus", `✅ ${res.captured}作品 更新完了`, "ok");
  } else {
    setStatus("captureStatus", `❌ エラー: ${res?.error || ""}`, "error");
  }

  setTimeout(() => {
    bar.style.display = "none";
    btn.disabled = false;
  }, 2000);
}

async function captureCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const url = tab.url || "";
  const match = url.match(/product_id[=/](RJ\d+|VJ\d+|BJ\d+)/i);
  if (!match) {
    setStatus("captureStatus", "⚠️ DLsite作品ページを開いてください", "error");
    return;
  }

  setStatus("captureStatus", "現在のページをキャプチャ中...");
  // content-work.js に対してページキャプチャを要求
  chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_NOW" }, (response) => {
    if (response?.ok) {
      setStatus("captureStatus", "✅ キャプチャして保存しました", "ok");
    } else {
      setStatus("captureStatus", "ページを再読み込みしてから試してください", "error");
    }
  });
}

// ---- CSVインポート ----

let csvData = { headers: [], rows: [] };

function initCsvImport() {
  const dropArea = document.getElementById("csvDropArea");
  const fileInput = document.getElementById("csvFileInput");

  dropArea.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleCsvFile(e.target.files[0]));

  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("drag-over");
  });
  dropArea.addEventListener("dragleave", () => dropArea.classList.remove("drag-over"));
  dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("drag-over");
    handleCsvFile(e.dataTransfer.files[0]);
  });

  document.getElementById("csvImportBtn").addEventListener("click", executeCsvImport);
}

function handleCsvFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parseCsv(text);
  };
  // BOM対応
  reader.readAsText(file, "UTF-8");
}

function parseCsv(text) {
  // BOM除去
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    setStatus("csvStatus", "⚠️ データが見つかりません", "error");
    return;
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(l => parseCsvLine(l));
  csvData = { headers, rows };

  // プレビュー表示
  const preview = rows.slice(0, 5).map(r =>
    `<tr>${r.map(c => `<td style="padding:2px 6px;border:1px solid #2a2a3a;">${escHtml(c)}</td>`).join("")}</tr>`
  ).join("");
  document.getElementById("csvPreviewTable").innerHTML =
    `<table style="border-collapse:collapse;width:100%;">
      <thead><tr>${headers.map(h => `<th style="padding:2px 6px;border:1px solid #2a2a3a;color:#8888aa;">${escHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${preview}</tbody>
    </table>`;

  // 列セレクタに選択肢を設定
  const optionsHtml = ['<option value="">（なし）</option>',
    ...headers.map((h, i) => `<option value="${i}">${h}</option>`)
  ].join("");

  ["colWorkId", "colSales", "colAmount", "colWholesale", "colDate"].forEach(id => {
    document.getElementById(id).innerHTML = optionsHtml;
  });

  // DLsiteの一般的なCSVヘッダーを自動マッピング
  autoMapColumns(headers);

  document.getElementById("csvPreview").style.display = "block";
  setStatus("csvStatus", `${rows.length}行を読み込みました`);
}

function autoMapColumns(headers) {
  const mappings = {
    colWorkId:    /作品ID|product.?id|work.?id/i,
    colSales:     /販売数|売上数|sold|quantity/i,
    colAmount:    /販売額|売上額|revenue|amount/i,
    colWholesale: /卸|wholesale|net/i,
    colDate:      /日付|date|期間/i
  };
  for (const [id, regex] of Object.entries(mappings)) {
    const idx = headers.findIndex(h => regex.test(h));
    if (idx !== -1) {
      document.getElementById(id).value = String(idx);
    }
  }
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function executeCsvImport() {
  const colWorkId    = parseInt(document.getElementById("colWorkId").value);
  const colSales     = document.getElementById("colSales").value;
  const colAmount    = document.getElementById("colAmount").value;
  const colWholesale = document.getElementById("colWholesale").value;
  const colDate      = document.getElementById("colDate").value;

  if (isNaN(colWorkId)) {
    setStatus("csvStatus", "⚠️ 作品ID列を選択してください", "error");
    return;
  }

  // 日付ごとにグループ化してスナップショットを作成
  const byDate = {};
  for (const row of csvData.rows) {
    const workId = row[colWorkId]?.trim().toUpperCase();
    if (!workId || !/^[RVB]J\d+$/i.test(workId)) continue;

    const ts = colDate !== ""
      ? parseJpDate(row[parseInt(colDate)]) || new Date().toISOString()
      : new Date().toISOString();

    if (!byDate[ts]) byDate[ts] = {};

    const record = {};
    if (colSales !== "" && row[parseInt(colSales)] !== undefined)
      record.sales = parseNum(row[parseInt(colSales)]);
    if (colAmount !== "" && row[parseInt(colAmount)] !== undefined)
      record.sales_amount = parseNum(row[parseInt(colAmount)]);
    if (colWholesale !== "" && row[parseInt(colWholesale)] !== undefined)
      record.wholesale = parseNum(row[parseInt(colWholesale)]);

    byDate[ts][workId] = record;
  }

  const dates = Object.keys(byDate);
  if (dates.length === 0) {
    setStatus("csvStatus", "⚠️ 有効なデータが見つかりません", "error");
    return;
  }

  setStatus("csvStatus", `インポート中... (${dates.length}スナップショット)`);
  document.getElementById("csvImportBtn").disabled = true;

  try {
    for (const ts of dates) {
      await bg("SAVE_BULK_SNAPSHOT", { records: byDate[ts], ts });
    }
    setStatus("csvStatus", `✅ ${dates.length}件のスナップショットをインポートしました`, "ok");
  } catch (e) {
    setStatus("csvStatus", `❌ エラー: ${e.message}`, "error");
  }
  document.getElementById("csvImportBtn").disabled = false;
}

function parseJpDate(str) {
  if (!str) return null;
  // "2024年01月15日" or "2024/01/15" or "2024-01-15"
  const m = str.replace(/,/g, "").match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}T00:00:00`).toISOString();
}

function parseNum(str) {
  const val = parseInt(String(str).replace(/[¥,\s円]/g, ""), 10);
  return isNaN(val) ? 0 : val;
}

// ---- 作品登録 ----

function initRegister() {
  document.getElementById("regBtn").addEventListener("click", registerWork);
}

async function registerWork() {
  const id = document.getElementById("regWorkId").value.trim().toUpperCase();
  const title = document.getElementById("regTitle").value.trim();
  const releaseDate = document.getElementById("regReleaseDate").value;
  const isReleased = document.getElementById("regIsReleased").value === "true";

  if (!id || !title) {
    setStatus("regStatus", "⚠️ IDとタイトルを入力してください", "error");
    return;
  }
  if (!/^[RVB]J\d+$/i.test(id)) {
    setStatus("regStatus", "⚠️ 作品IDはRJxxxxxxx形式で入力してください", "error");
    return;
  }

  setStatus("regStatus", "登録中...");
  const res = await bg("SAVE_WORK_META", {
    workId: id,
    fields: { id, title, release_date: releaseDate || null, is_released: isReleased }
  });

  if (res?.ok) {
    setStatus("regStatus", `✅ 「${title}」を登録しました`, "ok");
    document.getElementById("regWorkId").value = "";
    document.getElementById("regTitle").value = "";
    works = await bg("GET_WORKS");
    renderWorkList();
  } else {
    setStatus("regStatus", `❌ エラー: ${res?.error || ""}`, "error");
  }
}

// ---- ユーティリティ ----

function bg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function setStatus(id, msg, cls = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = "status-msg" + (cls ? ` ${cls}` : "");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
