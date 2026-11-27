(() => {
  const SESSION_KEY = "fb2026.sess";
  const BUDGET_KEY = "fubon-bills-2026-budget";

  const $ = (id) => document.getElementById(id);
  const lockScreen = $("lock-screen");
  const appEl = $("app");
  const main = $("main");
  const pwInput = $("pw");
  const errEl = $("lock-error");
  const statusEl = $("lock-status");
  const rememberEl = $("remember");

  let data = null;
  let tab = "wrap";
  let story = 0;
  let badgeId = null;
  let cuts = 2;
  let budgetMonth = null;
  let filters = { month: "全部", card: "全部", cat: "全部", typ: "全部", q: "" };

  function b64ToBuf(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iterations) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptPayload(password, payload) {
    const key = await deriveKey(password, b64ToBuf(payload.salt), payload.iter);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(payload.iv) },
      key,
      b64ToBuf(payload.ct)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function ntd(n) {
    const v = Math.round(Number(n) || 0);
    return `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("zh-TW")} 元`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseMoney(s) {
    const n = Number(String(s || "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function loadBudget() {
    try {
      const raw = localStorage.getItem(BUDGET_KEY);
      if (!raw) return { incomes: {}, extras: [] };
      const o = JSON.parse(raw);
      return {
        incomes: o.incomes && typeof o.incomes === "object" ? o.incomes : {},
        extras: Array.isArray(o.extras) ? o.extras : [],
      };
    } catch {
      return { incomes: {}, extras: [] };
    }
  }

  function saveBudget(store) {
    try { localStorage.setItem(BUDGET_KEY, JSON.stringify(store)); } catch {}
  }

  function rateLabel(rate) {
    if (rate === null) return "填上收入後，會出現儲蓄評價";
    if (rate < 0) return "這個月入不敷出，先看支出結構再調";
    if (rate < 10) return "起步練習生，還有加速空間";
    if (rate < 20) return "穩健存錢中，節奏不錯";
    if (rate < 35) return "儲蓄達人，這個月有在累積";
    return "儲蓄傳說，結餘很亮眼";
  }

  function budgetRows(store) {
    let cum = 0;
    return data.bills.map((b) => {
      const income = parseMoney(store.incomes[b.month] || "");
      const extraInc = store.extras.filter((e) => e.month === b.month && e.kind === "income").reduce((s, e) => s + e.amount, 0);
      const extraExp = store.extras.filter((e) => e.month === b.month && e.kind === "expense").reduce((s, e) => s + e.amount, 0);
      const totalIn = income + extraInc;
      const totalOut = b.fixed + b.variable + extraExp;
      const balance = totalIn + b.rewards - totalOut;
      cum += balance;
      const rate = totalIn > 0 ? Math.round((balance / totalIn) * 1000) / 10 : null;
      return { bill: b, income, extraInc, extraExp, totalIn, totalOut, balance, cum, rate };
    });
  }

  function showError(msg) {
    errEl.hidden = !msg;
    errEl.textContent = msg || "";
  }

  function setStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
  }

  async function tryUnlock(password, persist) {
    showError("");
    setStatus("解密中…");
    $("unlock-btn").disabled = true;
    try {
      const res = await fetch("payload.json", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const payload = await res.json();
      const obj = await decryptPayload(password, payload);
      if (!obj || !Array.isArray(obj.transactions)) throw new Error("shape");
      data = obj;
      if (persist) sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
      else sessionStorage.removeItem(SESSION_KEY);
      enterApp();
    } catch {
      showError("密碼錯誤，請再試一次");
      setStatus("");
      pwInput.value = "";
      pwInput.focus();
    } finally {
      $("unlock-btn").disabled = false;
    }
  }

  function lockNow() {
    data = null;
    sessionStorage.removeItem(SESSION_KEY);
    appEl.hidden = true;
    lockScreen.hidden = false;
    showError("");
    setStatus("");
    pwInput.value = "";
    pwInput.focus();
  }

  function enterApp() {
    lockScreen.hidden = true;
    appEl.hidden = false;
    $("app-title").textContent = data.meta.title;
    if (!budgetMonth && data.bills.length) budgetMonth = data.bills[data.bills.length - 1].month;
    if (!badgeId && data.badges.length) badgeId = data.badges[0].id;
    render();
  }

  function switchTab(next) {
    tab = next;
    document.querySelectorAll(".tab").forEach((el) => {
      el.classList.toggle("is-on", el.dataset.tab === tab);
    });
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    if (tab === "wrap") main.innerHTML = renderWrap();
    else if (tab === "budget") main.innerHTML = renderBudget();
    else if (tab === "analyze") main.innerHTML = renderAnalyze();
    else main.innerHTML = renderLedger();
    bind();
  }

  function renderWrap() {
    const card = data.stories[story];
    const badge = data.badges.find((b) => b.id === badgeId) || data.badges[0];
    const dots = data.stories.map((_, i) => `<button type="button" class="dot${i === story ? " is-on" : ""}" data-story="${i}" aria-label="第 ${i + 1} 則"></button>`).join("");
    const stats = card.stats.map((s) => `<div class="stat"><span>${escapeHtml(s.label)}</span><b>${escapeHtml(s.value)}</b></div>`).join("");
    const lines = card.lines.map((t) => `<p>${escapeHtml(t)}</p>`).join("");
    const badges = data.badges.map((b) => `
      <button type="button" class="badge${b.id === badge.id ? " is-on" : ""}" data-badge="${escapeHtml(b.id)}">
        <strong>${escapeHtml(b.name)}</strong>
        <span>${escapeHtml(b.hook)}</span>
      </button>`).join("");
    const facts = badge.facts.map((f) => `<p>${escapeHtml(f)}</p>`).join("");
    return `
      <section class="card">
        <p class="kicker">${story + 1} / ${data.stories.length}　${escapeHtml(card.kicker)}</p>
        <h2>${escapeHtml(card.title)}</h2>
        ${lines}
        <div class="stats">${stats}</div>
        <div class="dots">${dots}</div>
        <div class="row-actions">
          <button type="button" class="btn" id="story-prev">上一則</button>
          <button type="button" class="btn primary" id="story-next">下一則</button>
        </div>
      </section>
      <section class="section card">
        <h2>刷卡成就</h2>
        <p>這些徽章都已用帳單解鎖。點一下，看對應的真實數據。</p>
        <div class="badge-grid">${badges}</div>
        <div class="stats" style="margin-top:16px">
          <div class="stat"><span>徽章</span><b>${escapeHtml(badge.name)}</b></div>
          <div class="stat"><span>解鎖條件</span><b>${escapeHtml(badge.hook)}</b></div>
        </div>
        ${facts}
      </section>
    `;
  }

  function renderBudget() {
    const store = loadBudget();
    const rows = budgetRows(store);
    const cur = rows.find((r) => r.bill.month === budgetMonth) || rows[rows.length - 1];
    const extras = store.extras.filter((e) => e.month === budgetMonth);
    const fixedTx = data.transactions.filter((t) => t.m === budgetMonth && t.fix && t.typ !== "繳款" && t.typ !== "回饋折抵");
    const monthOpts = data.bills.map((b) => `<option value="${b.month}"${b.month === budgetMonth ? " selected" : ""}>${escapeHtml(b.label)}</option>`).join("");
    const extraRows = extras.length ? extras.map((e) => `<tr>
      <td>${e.kind === "income" ? "收入" : "支出"}</td>
      <td>${escapeHtml(e.name)}</td>
      <td class="num">${ntd(e.amount)}</td>
      <td class="num"><button type="button" class="btn ghost" data-del-extra="${escapeHtml(e.id)}">刪除</button></td>
    </tr>`).join("") : "";
    const fixedRows = fixedTx.map((t) => `<tr><td>${escapeHtml(t.d || "—")}</td><td>${escapeHtml(t.desc)}</td><td>${escapeHtml(t.inst || "—")}</td><td class="num">${ntd(t.amt)}</td></tr>`).join("");
    const allRows = rows.map((r) => `<tr>
      <td>${escapeHtml(r.bill.label)}</td>
      <td class="num">${ntd(r.totalIn)}</td>
      <td class="num">${ntd(r.bill.fixed)}</td>
      <td class="num">${ntd(r.bill.variable)}</td>
      <td class="num">${ntd(r.bill.rewards)}</td>
      <td class="num">${ntd(r.extraInc - r.extraExp)}</td>
      <td class="num">${ntd(r.balance)}</td>
      <td class="num">${r.rate === null ? "—" : r.rate + "%"}</td>
      <td class="num">${ntd(r.cum)}</td>
    </tr>`).join("");
    const width = cur.rate === null ? 0 : Math.max(0, Math.min(100, cur.rate));
    const save = cuts * data.meta.billCount * data.meta.foodAvg;
    const tea = Math.round(save / data.meta.teaPrice);
    return `
      <section class="card">
        <h2>每月收支表</h2>
        <p>收入與其他現金項目存在這個瀏覽器，重新開啟仍會保留。未填收入時以 0 計算。刷卡數字取自各期新增消費。</p>
        <p class="formula">結餘 ＝ 收入 ＋ 其他收入 ＋ 回饋折抵 － 固定支出 － 變動支出 － 其他支出</p>
        <label class="field">月份
          <select id="budget-month">${monthOpts}</select>
        </label>
        <p class="hint">${escapeHtml(rateLabel(cur.rate))}</p>
        <div class="meter${cur.rate !== null && cur.rate < 0 ? " neg" : ""}"><i style="width:${width}%"></i></div>
        <div class="table-wrap"><table>
          <thead><tr><th>項目</th><th>金額</th></tr></thead>
          <tbody>
            <tr><td>每月收入（可填）</td><td class="num"><input id="income-in" type="number" value="${escapeHtml(store.incomes[budgetMonth] || "")}" placeholder="例如 80000" /></td></tr>
            <tr><td>固定支出（訂閱、電信、保費、固定分期）</td><td class="num">${ntd(cur.bill.fixed)}</td></tr>
            <tr><td>變動支出（餐飲、交通、網購、醫療、業務與雜支等）</td><td class="num">${ntd(cur.bill.variable)}</td></tr>
            <tr><td>刷卡回饋／折抵</td><td class="num">${ntd(cur.bill.rewards)}</td></tr>
            <tr><td>其他現金／轉帳收入</td><td class="num">${ntd(cur.extraInc)}</td></tr>
            <tr><td>其他現金／轉帳支出</td><td class="num">${ntd(cur.extraExp)}</td></tr>
            <tr><td>本期結餘</td><td class="num">${ntd(cur.balance)}</td></tr>
            <tr><td>儲蓄率</td><td class="num">${cur.rate === null ? "—" : cur.rate + "%"}</td></tr>
            <tr><td>累計淨現金流（5 月至本月）</td><td class="num">${ntd(cur.cum)}</td></tr>
          </tbody>
        </table></div>
        <div class="stats">
          <div class="stat"><span>結帳日</span><b>${escapeHtml(cur.bill.statementDate)}</b></div>
          <div class="stat"><span>繳款截止日</span><b>${escapeHtml(cur.bill.dueDate || cur.bill.dueNote || "—")}</b></div>
          <div class="stat"><span>本期應繳</span><b>${ntd(cur.bill.amountDue)}</b></div>
          <div class="stat"><span>本期新增</span><b>${ntd(cur.bill.newCharges)}</b></div>
        </div>
        <h3>其他現金／轉帳項目</h3>
        <div class="form-row">
          <label class="field">類型
            <select id="ex-kind">
              <option value="income">現金／轉帳收入</option>
              <option value="expense">現金／轉帳支出</option>
            </select>
          </label>
          <label class="field">項目名稱<input id="ex-name" type="text" placeholder="例如 房租" /></label>
          <label class="field">金額<input id="ex-amt" type="number" placeholder="0" /></label>
          <button type="button" class="btn primary" id="ex-add">新增項目</button>
          <button type="button" class="btn ghost" id="ex-clear">清除全部試算</button>
        </div>
        ${extras.length ? `<div class="table-wrap"><table><thead><tr><th>類型</th><th>項目</th><th>金額</th><th></th></tr></thead><tbody>${extraRows}</tbody></table></div>` : ""}
        ${fixedTx.length ? `<h3>這一期固定支出</h3><div class="table-wrap"><table><thead><tr><th>消費日</th><th>項目</th><th>期數</th><th>金額</th></tr></thead><tbody>${fixedRows}</tbody></table></div>` : ""}
        <h3>5 至 11 月總表</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>月份</th><th>收入</th><th>固定</th><th>變動</th><th>回饋</th><th>其他淨額</th><th>結餘</th><th>儲蓄率</th><th>累計</th></tr></thead>
          <tbody>${allRows}</tbody>
        </table></div>
      </section>
      <section class="card">
        <h2>趣味儲蓄挑戰</h2>
        <p>以這 ${data.meta.billCount} 期餐飲平均每筆 ${data.meta.foodAvg} 元來試算。滑桿數字是假設，不會改帳單。</p>
        <p>如果這 ${data.meta.billCount} 期每期少吃 ${cuts} 次外食，大約能多留 ${ntd(save)}，約等於 ${tea} 杯 ${data.meta.teaPrice} 元手搖。</p>
        <label class="field">每期少外食次數：${cuts} 次
          <input id="cut-range" type="range" min="0" max="8" step="1" value="${cuts}" />
        </label>
        <div class="stats">
          <div class="stat"><span>7 期合計可多留</span><b>${ntd(save)}</b></div>
          <div class="stat"><span>加上既有回饋</span><b>${ntd(save + data.annual.rewards)}</b></div>
          <div class="stat"><span>約等於手搖</span><b>${tea} 杯</b></div>
        </div>
      </section>
    `;
  }

  function lineChart(bills) {
    const w = 800, h = 280, p = { l: 48, r: 12, t: 16, b: 36 };
    const ys = bills.flatMap((b) => [b.newCharges, b.amountDue]);
    const min = Math.min(0, ...ys);
    const max = Math.max(...ys);
    const x = (i) => p.l + (i * (w - p.l - p.r)) / Math.max(1, bills.length - 1);
    const y = (v) => p.t + (1 - (v - min) / (max - min || 1)) * (h - p.t - p.b);
    const path = (key) => bills.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(" ");
    const ticks = bills.map((b, i) => `<text x="${x(i)}" y="${h - 10}" text-anchor="middle" font-size="12" fill="#6b6458">${escapeHtml(b.label)}</text>`).join("");
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="每月新增與應繳">
      <line x1="${p.l}" y1="${y(0)}" x2="${w - p.r}" y2="${y(0)}" stroke="#e4dcd0" />
      <path d="${path("newCharges")}" fill="none" stroke="#c45c26" stroke-width="2.5" />
      <path d="${path("amountDue")}" fill="none" stroke="#2b6b5a" stroke-width="2.5" stroke-dasharray="6 4" />
      ${ticks}
    </svg>
    <div class="legend"><span><i class="swatch" style="background:#c45c26"></i>本期新增</span><span><i class="swatch" style="background:#2b6b5a"></i>本期應繳</span></div>`;
  }

  function stackChart(bills) {
    const max = Math.max(...bills.map((b) => b.fixed + b.variable));
    return `<div class="legend"><span><i class="swatch" style="background:#2b6b5a"></i>固定支出</span><span><i class="swatch" style="background:#c45c26"></i>變動支出</span></div>
      ${bills.map((b) => {
        const f = (100 * b.fixed) / (max || 1);
        const v = (100 * b.variable) / (max || 1);
        return `<div class="bar-row"><span>${escapeHtml(b.label)}</span><div class="stack"><i style="width:${f}%"></i><i style="width:${v}%"></i></div><span class="num">${ntd(b.newCharges)}</span></div>`;
      }).join("")}`;
  }

  function catBars(totals) {
    const items = Object.entries(totals).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const max = Math.max(...items.map((x) => Math.abs(x[1])));
    const sum = items.reduce((s, x) => s + Math.max(0, x[1]), 0) || 1;
    return `<div class="bars">${items.map(([k, v]) => `
      <div class="bar-row">
        <span>${escapeHtml(k)}</span>
        <div class="bar-track"><i style="width:${(100 * Math.abs(v) / max).toFixed(1)}%"></i></div>
        <span class="num">${ntd(v)}　${(Math.round((v / sum) * 1000) / 10)}%</span>
      </div>`).join("")}</div>`;
  }

  function renderAnalyze() {
    const a = data.annual;
    const billRows = data.bills.map((b) => `<tr>
      <td>${escapeHtml(b.label)}</td>
      <td>${escapeHtml(b.statementDate)}</td>
      <td>${escapeHtml(b.dueDate || b.dueNote || "—")}</td>
      <td class="num">${ntd(b.previousDue)}</td>
      <td class="num">${ntd(b.paymentsCredits)}</td>
      <td class="num">${ntd(b.newCharges)}</td>
      <td class="num">${ntd(b.rewards)}</td>
      <td class="num${b.amountDue < 0 ? " ok" : ""}">${ntd(b.amountDue)}</td>
      <td class="num">${ntd(b.minDue)}</td>
    </tr>`).join("");
    const fixed = data.fixedItems.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.detail)}</td><td>${escapeHtml(x.span)}</td><td class="num">${ntd(x.total)}</td></tr>`).join("");
    const freq = data.frequentMerchants.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.months)}</td><td class="num">${x.count}</td><td class="num">${ntd(x.total)}</td></tr>`).join("");
    const top = data.top15.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${escapeHtml(t.month)}</td><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.cat)}</td><td>${escapeHtml(t.desc)}</td><td class="num">${ntd(t.amt)}</td></tr>`).join("");
    return `
      <section class="card">
        <h2>每月帳單總覽與消費趨勢</h2>
        <p>${escapeHtml(data.meta.coverage)}</p>
        <div class="stats">
          <div class="stat"><span>7 期新增消費</span><b>${ntd(a.totalNewCharges)}</b><span>月均 ${ntd(a.avgNew)}</span></div>
          <div class="stat"><span>刷卡回饋折抵</span><b>${ntd(a.rewards)}</b></div>
          <div class="stat"><span>固定支出</span><b>${ntd(a.fixed)}</b></div>
          <div class="stat"><span>${escapeHtml(a.minNewLabel)}新增（最低）</span><b>${ntd(a.minNew)}</b><span>${escapeHtml(a.maxNewLabel)}最高 ${ntd(a.maxNew)}</span></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>月份</th><th>結帳日</th><th>截止日</th><th>前期</th><th>繳（退）</th><th>新增</th><th>回饋</th><th>應繳</th><th>最低應繳</th></tr></thead>
          <tbody>${billRows}</tbody>
        </table></div>
        ${lineChart(data.bills)}
        ${stackChart(data.bills)}
      </section>
      <section class="card">
        <h2>消費分類佔比</h2>
        ${catBars(a.categoryTotals)}
      </section>
      <section class="card">
        <h2>固定扣款與常見商家</h2>
        <div class="table-wrap"><table><thead><tr><th>項目</th><th>說明</th><th>期間</th><th>合計</th></tr></thead><tbody>${fixed}</tbody></table></div>
        <div class="table-wrap"><table><thead><tr><th>常見商家</th><th>期間</th><th>筆數</th><th>合計</th></tr></thead><tbody>${freq}</tbody></table></div>
      </section>
      <section class="card">
        <h2>大額單筆消費排行</h2>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>月份</th><th>消費日</th><th>分類</th><th>說明</th><th>金額</th></tr></thead><tbody>${top}</tbody></table></div>
      </section>
    `;
  }

  function filteredTxs() {
    const needle = filters.q.trim();
    return data.transactions.filter((t) => {
      if (filters.month !== "全部" && t.m !== filters.month) return false;
      if (filters.card !== "全部" && t.card !== filters.card) return false;
      if (filters.cat !== "全部" && t.cat !== filters.cat) return false;
      if (filters.typ === "固定支出" && !(t.fix && t.typ !== "繳款" && t.typ !== "回饋折抵")) return false;
      if (filters.typ === "變動支出" && !(!t.fix && t.typ !== "繳款" && t.typ !== "回饋折抵")) return false;
      if (filters.typ === "回饋折抵" && t.typ !== "回饋折抵") return false;
      if (filters.typ === "繳款" && t.typ !== "繳款") return false;
      if (needle && !t.desc.includes(needle) && !t.cat.includes(needle) && !t.card.includes(needle)) return false;
      return true;
    });
  }

  function monthLabel(m) {
    const b = data.bills.find((x) => x.month === m);
    return b ? b.label : m;
  }

  function typLabel(t) {
    if (t.typ === "回饋折抵" || t.typ === "繳款") return t.typ;
    return t.fix ? "固定" : "變動";
  }

  function renderLedger() {
    const rows = filteredTxs();
    const monthOpts = ["全部", ...data.bills.map((b) => b.month)].map((m) => {
      const label = m === "全部" ? "全部" : monthLabel(m);
      return `<option value="${m}"${filters.month === m ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
    const cardOpts = ["全部", ...data.cards].map((c) => `<option${filters.card === c ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
    const catOpts = ["全部", ...data.categories].map((c) => `<option${filters.cat === c ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
    const typOpts = ["全部", "固定支出", "變動支出", "回饋折抵", "繳款"].map((c) => `<option${filters.typ === c ? " selected" : ""}>${c}</option>`).join("");
    const body = rows.map((t) => `<tr>
      <td>${escapeHtml(monthLabel(t.m))}</td>
      <td>${escapeHtml(t.d || "—")}</td>
      <td>${escapeHtml(t.p || "—")}</td>
      <td>${escapeHtml(t.card || "—")}</td>
      <td>${escapeHtml(t.inst ? `${t.desc}（${t.inst}）` : t.desc)}</td>
      <td>${escapeHtml(t.cat)}</td>
      <td>${escapeHtml(typLabel(t))}</td>
      <td class="num">${ntd(t.amt)}</td>
    </tr>`).join("");
    const sum = rows.reduce((s, t) => s + t.amt, 0);
    return `
      <section class="card">
        <h2>完整消費明細</h2>
        <p>共 ${data.meta.txCount} 筆（已扣除各期前期應繳結轉列）。可依月份、卡別、分類、固定或變動，以及關鍵字篩選，並匯出 CSV。</p>
        <div class="filters">
          <label class="field">月份<select id="f-month">${monthOpts}</select></label>
          <label class="field">卡別<select id="f-card">${cardOpts}</select></label>
          <label class="field">分類<select id="f-cat">${catOpts}</select></label>
          <label class="field">類型<select id="f-typ">${typOpts}</select></label>
          <label class="field">關鍵字<input id="f-q" type="text" value="${escapeHtml(filters.q)}" placeholder="商家、分類或卡別" /></label>
          <button type="button" class="btn ghost" id="f-reset">重設篩選</button>
          <button type="button" class="btn primary" id="f-csv">匯出 CSV</button>
        </div>
        <p>目前顯示 ${rows.length} 筆，合計 ${ntd(sum)}。</p>
        <div class="table-wrap"><table>
          <thead><tr><th>帳單月</th><th>消費日</th><th>入帳日</th><th>卡別</th><th>說明</th><th>分類</th><th>類型</th><th>金額</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </section>
    `;
  }

  function exportCsv() {
    const rows = filteredTxs();
    const head = ["帳單月", "消費日", "入帳日", "卡別", "說明", "分類", "類型", "期數", "金額"];
    const lines = [head.join(",")].concat(rows.map((t) => [
      monthLabel(t.m), t.d, t.p, t.card, `"${String(t.desc).replace(/"/g, '""')}"`, t.cat, typLabel(t), t.inst, t.amt
    ].join(",")));
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bind() {
    document.querySelectorAll("[data-story]").forEach((el) => {
      el.onclick = () => { story = Number(el.dataset.story); render(); };
    });
    const prev = $("story-prev");
    const next = $("story-next");
    if (prev) prev.onclick = () => { story = (story + data.stories.length - 1) % data.stories.length; render(); };
    if (next) next.onclick = () => { story = (story + 1) % data.stories.length; render(); };
    document.querySelectorAll("[data-badge]").forEach((el) => {
      el.onclick = () => { badgeId = el.dataset.badge; render(); };
    });
    const bm = $("budget-month");
    if (bm) bm.onchange = () => { budgetMonth = bm.value; render(); };
    const income = $("income-in");
    if (income) income.onchange = income.onblur = () => {
      const store = loadBudget();
      store.incomes[budgetMonth] = income.value;
      saveBudget(store);
      render();
    };
    const add = $("ex-add");
    if (add) add.onclick = () => {
      const name = ($("ex-name").value || "").trim();
      const amt = parseMoney($("ex-amt").value);
      if (!name || !amt) return;
      const store = loadBudget();
      store.extras.push({ id: String(Date.now()), month: budgetMonth, kind: $("ex-kind").value, name, amount: Math.abs(amt) });
      saveBudget(store);
      render();
    };
    const clear = $("ex-clear");
    if (clear) clear.onclick = () => { saveBudget({ incomes: {}, extras: [] }); render(); };
    document.querySelectorAll("[data-del-extra]").forEach((el) => {
      el.onclick = () => {
        const store = loadBudget();
        store.extras = store.extras.filter((e) => e.id !== el.dataset.delExtra);
        saveBudget(store);
        render();
      };
    });
    const range = $("cut-range");
    if (range) range.oninput = () => { cuts = Number(range.value); render(); };
    const fmap = [["f-month", "month"], ["f-card", "card"], ["f-cat", "cat"], ["f-typ", "typ"]];
    fmap.forEach(([id, key]) => {
      const el = $(id);
      if (el) el.onchange = () => { filters[key] = el.value; render(); };
    });
    const fq = $("f-q");
    if (fq) fq.oninput = () => { filters.q = fq.value; };
    if (fq) fq.onchange = () => { filters.q = fq.value; render(); };
    const reset = $("f-reset");
    if (reset) reset.onclick = () => { filters = { month: "全部", card: "全部", cat: "全部", typ: "全部", q: "" }; render(); };
    const csv = $("f-csv");
    if (csv) csv.onclick = exportCsv;
  }

  function bindChrome() {
    $("unlock-btn").onclick = () => tryUnlock(pwInput.value, rememberEl.checked);
    pwInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlock(pwInput.value, rememberEl.checked);
    });
    $("lock-btn").onclick = lockNow;
    document.querySelectorAll(".tab").forEach((el) => {
      el.onclick = () => switchTab(el.dataset.tab);
    });
  }

  bindChrome();
  try {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      const obj = JSON.parse(cached);
      if (obj && Array.isArray(obj.transactions)) {
        data = obj;
        enterApp();
      }
    }
  } catch {}
})();
