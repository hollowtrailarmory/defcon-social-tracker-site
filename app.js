const PLATFORM_ORDER = ["tiktok", "instagram", "youtube", "facebook"];
const PLATFORM_LABEL = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
};

let report = null;
let activePlatform = PLATFORM_ORDER[0];

// Chart state, per platform, so switching tabs and coming back keeps what you
// were looking at.
const chartExtra = {};
const chartHighlight = {};

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
  renderPlatformSummary();
  renderTabs();
  renderPlatform();
}

/** Every platform at once, before you have to pick one.
 *
 * The tabs below show one platform at a time, which reads as "this is what
 * there is" when the rest are a click away and the report is showing a
 * half-collected day. This strip says what we hold on all four, and how old
 * each one is -- the halves of a run land half an hour apart on different
 * machines, so a platform being a few hours behind is normal, not a fault.
 */
function renderPlatformSummary() {
  const el = document.getElementById("platformSummary");
  const platforms = PLATFORM_ORDER.filter((p) => report.platforms[p]);

  el.innerHTML = platforms
    .map((p) => {
      const block = report.platforms[p];
      const own = block.accounts.find((a) => a.is_own);
      const rank = own
        ? `#${own.rank} of ${block.with_data}`
        : `${block.with_data} tracked`;
      return `
        <button class="summaryCard ${p === activePlatform ? "active" : ""}" data-platform="${p}">
          <span class="summaryName">${PLATFORM_LABEL[p]}</span>
          <span class="summaryNumber">${own ? formatNumber(own.followers) : "—"}</span>
          <span class="caption">${own ? "our followers" : "we are not on this"} · ${rank}</span>
          <span class="caption freshness">${collectedLabel(block)}</span>
        </button>
      `;
    })
    .join("");

  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePlatform = btn.dataset.platform;
      renderPlatformSummary();
      renderTabs();
      renderPlatform();
    });
  });
}

/** How old this platform's numbers are. Never guessed: a report written before
 *  the stamp existed says so rather than implying it is fresh. */
function collectedLabel(block) {
  const at = block.last_collected_at ? Date.parse(block.last_collected_at) : NaN;
  if (Number.isNaN(at)) return "collection time unknown";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `read ${mins}m ago`;
  if (mins < 60 * 24) return `read ${Math.round(mins / 60)}h ago`;
  return `read ${Math.round(mins / (60 * 24))}d ago`;
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

  const model = growthLines(platform.accounts, chartExtra[activePlatform]);
  // A highlight pointing at no line would dim every line for no visible reason.
  const highlight = model.lines.some((l) => l.id === chartHighlight[activePlatform])
    ? chartHighlight[activePlatform]
    : null;

  const rankLine = own
    ? `DEFCON ranks #${own.rank} of ${platform.with_data} · ${(own.share_of_voice * 100).toFixed(2)}% share of voice`
    : `${platform.with_data} accounts tracked`;

  el.innerHTML = `
    <div class="platformHead">
      <h2>${PLATFORM_LABEL[activePlatform]}</h2>
      <span class="rankLine">${rankLine}</span>
      ${own ? deltaChip(own.deltas.day, "today") : ""}
      ${own ? deltaChip(own.deltas.sunday, "since Sunday") : ""}
      <span class="caption freshness">${collectedLabel(platform)}</span>
    </div>
    ${growthChartBlock(model, highlight)}
    <table class="leaderboard">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Account</th>
          <th class="num">Followers</th>
          ${likesCol ? '<th class="num">Likes</th>' : ""}
          <th class="chartCol"><span class="srOnly">On the chart</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => leaderboardRow(r, likesCol, model, highlight)).join("")}
        ${platform.missing.map((m) => missingRow(m, likesCol)).join("")}
      </tbody>
    </table>
  `;

  wireChart(el, model, highlight);
}

/** Add if it is not on the chart, highlight it if it is, release if it already
 *  was. The colour on the row is the point: six lines crossing on one chart
 *  cannot be told apart by shape. */
function wireChart(el, model, highlight) {
  // Drawn only once the holder has a width to be measured, so one SVG unit is
  // one pixel and the axis labels are not stretched to fit the page.
  const holder = el.querySelector(".chartHolder");
  if (holder) {
    holder.innerHTML = growthChartSvg(model, highlight, holder.clientWidth);
  }

  el.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = btn.dataset.chart;
      if (!model.lines.some((l) => l.id === id)) {
        chartExtra[activePlatform] = id;
        chartHighlight[activePlatform] = id;
      } else {
        chartHighlight[activePlatform] =
          chartHighlight[activePlatform] === id ? null : id;
      }
      renderPlatform();
    });
  });
  el.querySelectorAll("[data-drop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (chartHighlight[activePlatform] === btn.dataset.drop) {
        chartHighlight[activePlatform] = null;
      }
      chartExtra[activePlatform] = null;
      renderPlatform();
    });
  });
}

function growthChartBlock(model, highlight) {
  if (!model.lines.length) {
    return `<p class="chartEmpty">${escapeHtml(model.reason || "Nothing to chart yet.")}</p>`;
  }

  const shown = model.lines.find((l) => l.id === highlight);
  const legend = model.lines
    .map(
      (line) => `
      <span class="legendItem ${highlight && line.id !== highlight ? "dim" : ""}">
        <button class="legendSwatch" data-chart="${escapeHtml(line.id)}"
                style="background:${line.color}"
                title="${highlight === line.id ? "Stop highlighting" : "Highlight"} ${escapeHtml(line.label)}"></button>
        <span>${escapeHtml(line.label)}</span>
        ${line.isExtra ? `<button class="dropLine" data-drop="${escapeHtml(line.id)}" title="Remove from the chart">×</button>` : ""}
      </span>`
    )
    .join("");

  const notes = growthNotes(model.lines)
    .map((n) => `<p class="chartNote">${escapeHtml(n)}</p>`)
    .join("");

  return `
    <section class="chartCard">
      <div class="chartHead">
        <h3>Daily growth</h3>
        <span class="caption">last ${GROWTH_WINDOW_DAYS} days · ${shortDate(isoOfDay(model.start))} – ${shortDate(isoOfDay(model.newest))}</span>
      </div>
      <p class="caption chartWhat">
        Followers gained each day, as a percentage of the day before. Ours plus
        the four that grew fastest across the window. Click a colour to pick a
        line out, or the ▸ beside any account to add it.
      </p>
      ${shown ? `<p class="chartReadout" style="color:${shown.color}">
          <strong>${escapeHtml(shown.label)}</strong>
          <span class="caption">${shown.growth == null ? "no growth figure" : growthPct(shown.growth)} over the window ·
          ${shown.daysDrawn} of ${GROWTH_WINDOW_DAYS} days drawn</span>
        </p>` : ""}
      <p class="caption axisLabel">% gained per day</p>
      <div class="chartHolder"></div>
      <div class="legend">${legend}</div>
      ${notes}
    </section>
  `;
}

function leaderboardRow(account, likesCol, model, highlight) {
  const precision = (account.series && account.series.length ? account.series[account.series.length - 1].precision : null) || 1;
  const line = model.lines.find((l) => l.id === account.account_id);
  const drawable = model.drawableIds && model.drawableIds.has(account.account_id);
  const button = !drawable
    ? `<span class="chartOff" title="Not enough readings in the last ${GROWTH_WINDOW_DAYS} days to chart">▸</span>`
    : `<button class="chartToggle ${highlight === account.account_id ? "on" : ""}"
         data-chart="${escapeHtml(account.account_id)}"
         style="color:${line ? line.color : "inherit"}"
         title="${!line ? "Add to the chart" : highlight === account.account_id ? "Stop highlighting" : "Highlight on the chart"}">▸</button>`;

  return `
    <tr class="${account.is_own ? "own" : ""}">
      <td class="num">${account.rank}</td>
      <td>${escapeHtml(account.display_name)}${account.is_own ? " (DEFCON)" : ""}</td>
      <td class="num">${formatFollowers(account.followers, precision)}</td>
      ${likesCol ? `<td class="num">${account.likes != null ? formatNumber(account.likes) : "—"}</td>` : ""}
      <td class="chartCol">${button}</td>
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
      <td class="chartCol"></td>
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

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (!report) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPlatform, 150);
});

main();
