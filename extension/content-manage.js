/**
 * content-manage.js
 * DLsite 管理画面ページから販売データを自動キャプチャ
 *
 * 管理画面のURL/構造はサイトにより異なるため、
 * 実際の管理画面を確認後にセレクターを調整してください。
 * 現在はページに「キャプチャ」ボタンを注入する形で対応します。
 */

(function () {
  if (!isManagePage()) return;

  // ページ読み込み後にキャプチャボタンを注入
  if (document.readyState === "complete") {
    injectCaptureButton();
  } else {
    window.addEventListener("load", injectCaptureButton);
  }

  function isManagePage() {
    const url = location.href;
    return (
      url.includes("dlsite.com/home/mypage") ||
      url.includes("manage.dlsite.com") ||
      url.includes("/work/create/") ||
      // 管理画面によく含まれるキーワード
      document.title.includes("管理") ||
      document.title.includes("マイページ")
    );
  }

  function injectCaptureButton() {
    // 既に注入済みなら無視
    if (document.getElementById("dlsite-dashboard-capture-btn")) return;

    const btn = document.createElement("div");
    btn.id = "dlsite-dashboard-capture-btn";
    btn.innerHTML = `
      <button id="dlsite-db-capture" style="
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        background: #e8407a;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 10px 18px;
        font-size: 13px;
        font-family: sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(232,64,122,0.4);
        transition: background 0.2s;
      ">
        📊 ダッシュボードに保存
      </button>
      <div id="dlsite-db-status" style="
        position: fixed;
        bottom: 70px;
        right: 24px;
        z-index: 99999;
        background: #1a1a24;
        color: #00d4aa;
        border: 1px solid #2a2a3a;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-family: sans-serif;
        display: none;
      "></div>
    `;
    document.body.appendChild(btn);

    document.getElementById("dlsite-db-capture").addEventListener("click", onCapture);
  }

  async function onCapture() {
    const statusEl = document.getElementById("dlsite-db-status");
    statusEl.style.display = "block";
    statusEl.textContent = "データを読み取り中...";

    try {
      const rows = scrapeManagePage();
      if (rows.length === 0) {
        statusEl.textContent = "⚠️ データが見つかりませんでした";
        setTimeout(() => { statusEl.style.display = "none"; }, 3000);
        return;
      }

      // records: { RJxxxxxx: { sales, sales_amount, wholesale }, ... }
      const records = {};
      for (const row of rows) {
        records[row.workId] = {
          sales: row.sales ?? undefined,
          sales_amount: row.sales_amount ?? undefined,
          wholesale: row.wholesale ?? undefined
        };
        // 未定義を除去
        Object.keys(records[row.workId]).forEach(k => {
          if (records[row.workId][k] === undefined) delete records[row.workId][k];
        });
      }

      statusEl.textContent = `保存中... (${rows.length}作品)`;
      const res = await chrome.runtime.sendMessage({
        type: "SAVE_BULK_SNAPSHOT",
        records,
        ts: new Date().toISOString()
      });

      if (res?.ok) {
        statusEl.textContent = `✅ ${rows.length}作品を保存しました`;
      } else {
        statusEl.textContent = `❌ エラー: ${res?.error || "不明"}`;
      }
    } catch (e) {
      statusEl.textContent = `❌ エラー: ${e.message}`;
    }

    setTimeout(() => { statusEl.style.display = "none"; }, 4000);
  }

  function scrapeManagePage() {
    const results = [];

    // ---- パターン1: テーブル形式の管理画面 ----
    // 各行に作品ID・販売数・販売額・卸価格が並ぶ場合
    const rows = document.querySelectorAll("table tr, .work_list_item, .product-row");
    for (const row of rows) {
      const workId = extractWorkId(row.textContent || row.innerText);
      if (!workId) continue;

      const cells = row.querySelectorAll("td, .cell, .col");
      if (cells.length < 2) continue;

      const item = { workId };

      // セルテキストから数値を抽出（順序はサイトにより異なる）
      for (const cell of cells) {
        const text = cell.textContent.trim();
        const label = cell.getAttribute("data-label") || cell.className || "";

        if (/販売数|sold|quantity/i.test(label)) {
          item.sales = parseNum(text);
        } else if (/販売額|売上|revenue|amount/i.test(label)) {
          item.sales_amount = parseNum(text);
        } else if (/卸|wholesale|net/i.test(label)) {
          item.wholesale = parseNum(text);
        }
      }

      if (Object.keys(item).length > 1) results.push(item);
    }

    // ---- パターン2: 定義リスト形式 ----
    if (results.length === 0) {
      const workId = extractWorkId(location.href + " " + document.title);
      if (workId) {
        const item = { workId };
        const allText = document.body.innerText;

        const salesMatch = allText.match(/販売数[^\d]*([0-9,]+)/);
        if (salesMatch) item.sales = parseNum(salesMatch[1]);

        const amountMatch = allText.match(/販売額[^\d]*([0-9,]+)/);
        if (amountMatch) item.sales_amount = parseNum(amountMatch[1]);

        const wholesaleMatch = allText.match(/卸(?:価格)?[^\d]*([0-9,]+)/);
        if (wholesaleMatch) item.wholesale = parseNum(wholesaleMatch[1]);

        if (Object.keys(item).length > 1) results.push(item);
      }
    }

    return results;
  }

  function extractWorkId(text) {
    const match = text.match(/\b(RJ\d{6,8}|VJ\d{6,8}|BJ\d{6,8})\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  function parseNum(str) {
    const cleaned = String(str).replace(/[¥,\s円]/g, "").trim();
    const val = parseInt(cleaned, 10);
    return isNaN(val) ? undefined : val;
  }
})();
