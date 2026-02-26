/**
 * content-work.js
 * DLsite 作品公開ページから評価スコア・レビュー数・お気に入り・発売状態を取得
 *
 * 対象URL:
 *   https://www.dlsite.com/*/work/=/product_id/RJxxxxxx.html
 *   https://www.dlsite.com/*/work/announce/=/product_id/RJxxxxxx.html  (発売前)
 */

(function () {
  // 作品IDをURLから抽出
  const workId = extractWorkId(location.href);
  if (!workId) return;

  // ページ読み込み完了後にキャプチャ
  if (document.readyState === "complete") {
    captureAndSend();
  } else {
    window.addEventListener("load", captureAndSend);
  }

  function extractWorkId(url) {
    const match = url.match(/product_id[=/](RJ\d+|VJ\d+|BJ\d+)/i);
    return match ? match[1].toUpperCase() : null;
  }

  function captureAndSend() {
    const data = scrapeWorkPage();
    if (!data) return;

    // background.js 経由でFirebaseに保存
    chrome.runtime.sendMessage({
      type: "WORK_DATA_CAPTURED",
      workId,
      data
    });

    // ポップアップへも通知（開いていれば）
    chrome.runtime.sendMessage({
      type: "CAPTURE_COMPLETE",
      workId,
      data
    });
  }

  function scrapeWorkPage() {
    try {
      const data = {};

      // ---- 発売前後の判定 ----
      // 発売前ページ: URL に /announce/ を含む、または「予約受付中」等のラベルがある
      const isPreRelease = detectPreRelease();
      data.is_released = !isPreRelease;

      // ---- 評価スコア ----
      // 例: <span class="star_rating_pt">4.50</span>  または  data-ratting="4.50"
      const ratingEl =
        document.querySelector(".star_rating_pt") ||
        document.querySelector("[itemprop='ratingValue']") ||
        document.querySelector(".work_rating .point");
      if (ratingEl) {
        const val = parseFloat(ratingEl.textContent.trim());
        if (!isNaN(val)) data.rating = val;
      }

      // ---- レビュー数 ----
      // 例: <span class="work_review_num">（123件）</span>
      const reviewEl =
        document.querySelector(".work_review_num") ||
        document.querySelector("[itemprop='reviewCount']") ||
        document.querySelector(".work_rating .count");
      if (reviewEl) {
        const match = reviewEl.textContent.replace(/,/g, "").match(/\d+/);
        if (match) data.reviews = parseInt(match[0], 10);
      }

      // ---- お気に入り数（発売前のみ表示される場合が多い） ----
      // 例: <dd id="wishlist_count">1,234</dd>  or  class="wishlist_btn_count"
      const favEl =
        document.querySelector("#wishlist_count") ||
        document.querySelector(".wishlist_btn_count") ||
        document.querySelector("[data-wishlist-count]") ||
        findByText("お気に入り");

      if (favEl) {
        const text = favEl.getAttribute("data-wishlist-count") || favEl.textContent;
        const match = text.replace(/,/g, "").match(/\d+/);
        if (match) data.fav = parseInt(match[0], 10);
      }

      // ---- 販売数（公開されている場合） ----
      // DLsiteは発売後に販売数を表示することがある
      const salesEl =
        document.querySelector(".work_sales_count") ||
        findByLabelText("販売数");
      if (salesEl) {
        const match = salesEl.textContent.replace(/,/g, "").match(/\d+/);
        if (match) data.sales = parseInt(match[0], 10);
      }

      // ---- 発売日 ----
      const dateEl =
        document.querySelector("[itemprop='datePublished']") ||
        findByLabelText("販売日") ||
        findByLabelText("発売日");
      if (dateEl) {
        const dateText = dateEl.getAttribute("content") || dateEl.textContent.trim();
        // "2024年01月15日" → "2024-01-15"
        const dateMatch = dateText.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
        if (dateMatch) {
          data.release_date = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2,"0")}-${String(dateMatch[3]).padStart(2,"0")}`;
        }
      }

      // 何もデータが取れなかった場合は null
      const hasData = data.rating !== undefined || data.reviews !== undefined || data.fav !== undefined;
      return hasData ? data : null;

    } catch (e) {
      console.error("[DLsite Dashboard] キャプチャエラー:", e);
      return null;
    }
  }

  function detectPreRelease() {
    // URLに /announce/ が含まれる
    if (location.href.includes("/announce/")) return true;

    // ページ内に発売前を示すラベルがある
    const preReleaseSelectors = [
      ".work_announce",
      ".work_status_badge",
      "[data-work-status='pre']"
    ];
    for (const sel of preReleaseSelectors) {
      if (document.querySelector(sel)) return true;
    }

    // 「予約受付中」「近日発売」テキスト
    const bodyText = document.body.innerText;
    if (/予約受付中|近日発売|発売予定/.test(bodyText.substring(0, 5000))) return true;

    return false;
  }

  // ラベルテキストで対応するdd/spanを探す
  function findByLabelText(label) {
    // table形式: <th>ラベル</th><td>値</td>
    const ths = document.querySelectorAll("th, dt");
    for (const th of ths) {
      if (th.textContent.trim().includes(label)) {
        return th.nextElementSibling || th.parentElement?.nextElementSibling;
      }
    }
    return null;
  }

  // テキスト含む要素の次の要素を探す（汎用）
  function findByText(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === text) {
        return node.parentElement?.nextElementSibling || node.parentElement;
      }
    }
    return null;
  }
})();
