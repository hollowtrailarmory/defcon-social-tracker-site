const PLATFORM_ORDER = ["tiktok", "instagram", "youtube", "facebook"];
const PLATFORM_LABEL = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
};

let report = null;
let activePlatform = PLATFORM_ORDER[0];

async function main() {
  try {
    report = await fetchJson("data/report.json");
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<p class="error">Couldn't load data/report.json (${escapeHtml(String(err))}). ` +
      `If you're viewing this locally, open it through a server, not as a bare file.</p>`;
    return;
  }

  activePlatform = PLATFORM_ORDER.find((p) => report.platforms[p]) || PLATFORM_ORDER[0];

  renderAsOf();
  renderOwnTotal();
  renderTabs();
  renderPlatform();
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function renderAsOf() {
  const generated = new Date(report.generated_at);
  document.getElementById("asOf").textContent =
    `Last run ${generated.toLocaleString()} · week ${report.current.week}`;
}

// -- own total -------------------------------------------------------------

function renderOwnTotal() {
  const own = report.own_total;
  const el = document.getElementById("ownTotal");

  const missing = own.missing.length
    ? `<span class="caption"> (missing: ${own.missing.map((p) => PLATFORM_LABEL[p] || p).join(", ")})</span>`
    : "";

  el.innerHTML = `
    <div>
      <div class="bigNumber">${formatFollowers(own.followers, own.precision)}</div>
      <div class="bigLabel">total followers across ${own.platforms.map((p) => PLATFORM_LABEL[p] || p).join(", ")}${missing}</div>
    </div>
    <div class="deltas">
      ${deltaChip(own.deltas.day, "today")}
      ${deltaChip(own.deltas.sunday, "since Sunday")}
      ${deltaChip(own.deltas.last_week, "since last week")}
    </div>
  `;
}

/** A Delta object: {delta, pct, days, from_value, within_rounding}, or null
 *  when there is no baseline yet. */
function deltaChip(delta, label) {
  if (!delta) {
    return `<span class="deltaChip flat"><span class="caption">no baseline for ${label} yet</span></span>`;
  }
  const dir = delta.delta > 0 ? "up" : delta.delta < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  const sign = delta.delta > 0 ? "+" : "";
  const tilde = delta.within_rounding ? "~" : "";
  const pct = delta.within_rounding || delta.pct == null ? "" : ` (${sign}${delta.pct}%)`;
  const spanLabel = delta.days > 1 ? `${label}, ${delta.days}d` : label;
  return `
    <span class="deltaChip ${dir}">
      <span class="arrow">${arrow}</span>
      <span>${tilde}${sign}${formatNumber(delta.delta)}${pct}</span>
      <span class="caption">${spanLabel}</span>
    </span>
  `;
}

// -- tabs --------------------------------------------------------------

function renderTabs() {
  const el = document.getElementById("tabs");
  el.innerHTML = PLATFORM_ORDER.filter((p) => report.platforms[p])
    .map(
      (p) =>
        `<button data-platform="${p}" class="${p === activePlatform ? "active" : ""}">${PLATFORM_LABEL[p]}</button>`
    )
    .join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePlatform = btn.dataset.platform;
      renderTabs();
      renderPlatform();
    });
  });
}

// -- platform detail -----------------------------------------------------

function renderPlatform() {
  const platform = report.platforms[activePlatform];
  const own = platform.accounts.find((a) => a.is_own);
  const el = document.getElementById("platformDetail");

  const rows = [...platform.accounts].sort((a, b) => b.followers - a.followers);
  const likesCol = rows.some((r) => r.likes != null);

  const rankLine = own
    ? `DEFCON ranks #${own.rank} of ${platform.with_data} · ${(own.share_of_voice * 100).toFixed(2)}% share of voice`
    : `${platform.with_data} accounts tracked`;

  el.innerHTML = `
    <div class="platformHead">
      <h2>${PLATFORM_LABEL[activePlatform]}</h2>
      <span class="rankLine">${rankLine}</span>
      ${own ? deltaChip(own.deltas.day, "today") : ""}
      ${own ? deltaChip(own.deltas.sunday, "since Sunday") : ""}
    </div>
    <table class="leaderboard">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Account</th>
          <th class="num">Followers</th>
          ${likesCol ? '<th class="num">Likes</th>' : ""}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => leaderboardRow(r, likesCol)).join("")}
        ${platform.missing.map((m) => missingRow(m, likesCol)).join("")}
      </tbody>
    </table>
  `;
}

function leaderboardRow(account, likesCol) {
  const precision = (account.series && account.series.length ? account.series[account.series.length - 1].precision : null) || 1;
  return `
    <tr class="${account.is_own ? "own" : ""}">
      <td class="num">${account.rank}</td>
      <td>${escapeHtml(account.display_name)}${account.is_own ? " (DEFCON)" : ""}</td>
      <td class="num">${formatFollowers(account.followers, precision)}</td>
      ${likesCol ? `<td class="num">${account.likes != null ? formatNumber(account.likes) : "—"}</td>` : ""}
    </tr>
  `;
}

function missingRow(missing, likesCol) {
  return `
    <tr class="notOk">
      <td class="num">—</td>
      <td>${escapeHtml(missing.display_name)}</td>
      <td class="num" title="${escapeHtml(missing.reason || "")}">unreadable</td>
      ${likesCol ? '<td class="num">—</td>' : ""}
    </tr>
  `;
}

// -- formatting ------------------------------------------------------------

function formatNumber(n) {
  return n.toLocaleString();
}

/** precision 1 is exact; anything higher is a rounding step (100, 1000, ...)
 *  the collector could not see past, so it earns a leading tilde. */
function formatFollowers(value, precision) {
  const tilde = precision && precision > 1 ? '<span class="precisionTilde">~</span>' : "";
  return `${tilde}${formatNumber(value)}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

main();
