// Daily growth: what each account gained each day, as a percentage of what it
// had the day before.
//
// The same chart the phone app draws (docs/specs/16-growth-chart.md), and the
// same rules, because two front-ends disagreeing about what a number means is
// worse than either of them being wrong on its own:
//
//   * the percentage is the collector's `series[].change.pct`, never one worked
//     out here;
//   * EVERY POINT IS ONE DAY'S GROWTH, with no exceptions. A step at the
//     platform's own reporting resolution, or one spanning a missed day, draws
//     blank and BREAKS the line rather than joining across it -- a line chart is
//     read as a rate, so a point that is not a one-day figure is read as one
//     anyway;
//   * the vertical axis stops at the tallest line, not at 100%, because real
//     daily growth is fractions of a percent and a full scale flattens it.

const GROWTH_WINDOW_DAYS = 14;
const GROWTH_LINES = 5;
// Below this many followers at the start of the window, one follower is a +50%
// day, which would win every ranking and flatten every real line. It bars an
// account from the AUTOMATIC five only -- one picked by hand draws at any size.
const GROWTH_FLOOR = 10;

// Spread by hue, not picked for looks: gold beside orange read as one line on a
// chart of crossings. Red is left out, because red means "down" everywhere else.
const GROWTH_PALETTE = [
  "#4AF2C8", // ours, teal
  "#6FB2FF",
  "#B388FF",
  "#D2A460",
  "#9CCC65",
  "#FF5FA2", // the hand-added sixth
];

const DAY_MS = 86400000;

function dayNumber(iso) {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function isoOfDay(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Which accounts the chart draws, in which colour. */
function growthLines(accounts, extraId) {
  let newest = null;
  accounts.forEach((a) =>
    (a.series || []).forEach((p) => {
      const d = dayNumber(p.date);
      if (newest === null || d > newest) newest = d;
    })
  );
  if (newest === null) {
    return { lines: [], reason: "Nothing collected yet — a growth line needs two days." };
  }
  const start = newest - (GROWTH_WINDOW_DAYS - 1);

  const candidates = accounts.map((account) => candidateOf(account, start, newest));
  const drawable = candidates.filter((c) => c.points.length);

  // Ours is pinned rather than earned: a dashboard that can drop us from its
  // own chart is answering a different question.
  const ours = drawable.filter((c) => c.account.is_own);
  const rivals = drawable
    .filter((c) => !c.account.is_own && c.startFollowers >= GROWTH_FLOOR && c.growth !== null)
    .sort((a, b) => b.growth - a.growth);

  const picked = ours.concat(rivals.slice(0, Math.max(0, GROWTH_LINES - ours.length)));
  let rival = 0;
  const lines = picked.map((c) =>
    lineOf(c, c.account.is_own ? GROWTH_PALETTE[0] : GROWTH_PALETTE[1 + (rival++ % 4)], false)
  );

  if (extraId && !picked.some((c) => c.account.account_id === extraId)) {
    const extra = drawable.find((c) => c.account.account_id === extraId);
    if (extra) lines.push(lineOf(extra, GROWTH_PALETTE[5], true));
  }

  return {
    lines,
    start,
    newest,
    drawableIds: new Set(drawable.map((c) => c.account.account_id)),
    reason: lines.length
      ? null
      : `Not enough history yet — a line needs two readings inside the last ${GROWTH_WINDOW_DAYS} days.`,
  };
}

function candidateOf(account, start, end) {
  const inWindow = new Map();
  (account.series || []).forEach((p) => {
    const d = dayNumber(p.date);
    if (d >= start && d <= end) inWindow.set(d, p);
  });

  const days = [...inWindow.keys()].sort((a, b) => a - b);
  const first = days.length ? inWindow.get(days[0]) : null;
  const last = days.length ? inWindow.get(days[days.length - 1]) : null;
  const growth =
    first && last && first.followers
      ? ((last.followers - first.followers) / first.followers) * 100
      : null;

  const points = [];
  const blanks = { rounded: 0, notCollected: 0, untracked: 0 };
  for (let i = 0; i < GROWTH_WINDOW_DAYS; i++) {
    const day = start + i;
    const reading = inWindow.get(day);
    if (!reading) {
      // Before the account was first read is not a gap in the record.
      if (!days.length || day < days[0]) blanks.untracked++;
      else blanks.notCollected++;
      continue;
    }
    const change = reading.change;
    if (!change) blanks.untracked++;
    else if (change.days !== 1 || change.pct == null) blanks.notCollected++;
    else if (change.within_rounding && change.delta !== 0) blanks.rounded++;
    else points.push({ i, pct: change.pct, date: reading.date, delta: change.delta });
  }

  return {
    account,
    points,
    blanks,
    growth,
    startFollowers: first ? first.followers : 0,
  };
}

function lineOf(candidate, color, isExtra) {
  const segments = [];
  candidate.points.forEach((p) => {
    const run = segments[segments.length - 1];
    if (run && run[run.length - 1].i === p.i - 1) run.push(p);
    else segments.push([p]);
  });
  return {
    id: candidate.account.account_id,
    label: candidate.account.display_name,
    isOwn: !!candidate.account.is_own,
    isExtra,
    color,
    segments,
    growth: candidate.growth,
    blanks: candidate.blanks,
    daysDrawn: candidate.points.length,
    belowFloor: candidate.startFollowers < GROWTH_FLOOR,
  };
}

/** Zero to the tallest line, never 0-100%. */
function growthAxisRange(lines) {
  const values = lines.flatMap((l) => l.segments.flatMap((s) => s.map((p) => p.pct)));
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (max - min < 0.2) max = min + 0.2;
  return { min, max: max + (max - min) * 0.08 };
}

/** One precision for the whole axis: 4.0% / 1.8% / -0.40% / -2.6% is three
 *  ways of writing the same kind of number. */
function tickLabel(value, span) {
  const digits = span >= 10 ? 0 : span >= 2 ? 1 : 2;
  let text = value.toFixed(digits);
  if (Number(text) === 0) text = (0).toFixed(digits); // never "-0%"
  return `${text}%`;
}

/** Drawn at the container's real pixel width, not scaled to fit it.
 *
 * A fixed viewBox stretched across the page distorts by whatever the ratio
 * happens to be -- at phone width that squashed every axis label to about
 * two-fifths of its proper width. Passing the measured width makes one user
 * unit one pixel, so the text is drawn the size it is meant to be.
 */
function growthChartSvg(model, highlightId, width) {
  const { lines, start } = model;
  const W = Math.max(280, Math.round(width || 720));
  const H = 260;
  const gutter = 46;
  const bottom = 26;
  const top = 10;
  const { min, max } = growthAxisRange(lines);

  const x = (i) => gutter + (i / (GROWTH_WINDOW_DAYS - 1)) * (W - gutter - 8);
  const y = (pct) => H - bottom - ((pct - min) / (max - min)) * (H - bottom - top);

  const parts = [];
  for (let i = 0; i <= 3; i++) {
    const value = max - ((max - min) / 3) * i;
    parts.push(
      `<line class="grid" x1="${gutter}" y1="${y(value).toFixed(1)}" x2="${W - 8}" y2="${y(value).toFixed(1)}" />`,
      `<text class="tick" x="${gutter - 6}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end">${tickLabel(value, max - min)}</text>`
    );
  }
  if (min < 0) {
    parts.push(`<line class="zero" x1="${gutter}" y1="${y(0).toFixed(1)}" x2="${W - 8}" y2="${y(0).toFixed(1)}" />`);
  }

  // A tick per day: the axis is daily even where only some days are labelled.
  for (let i = 0; i < GROWTH_WINDOW_DAYS; i++) {
    parts.push(
      `<line class="grid" x1="${x(i).toFixed(1)}" y1="${H - bottom}" x2="${x(i).toFixed(1)}" y2="${H - bottom + (i % 3 === 0 ? 5 : 3)}" />`
    );
  }
  [0, Math.floor((GROWTH_WINDOW_DAYS - 1) / 2), GROWTH_WINDOW_DAYS - 1].forEach((i) => {
    const anchor = i === 0 ? "start" : i === GROWTH_WINDOW_DAYS - 1 ? "end" : "middle";
    parts.push(
      `<text class="tick" x="${x(i).toFixed(1)}" y="${H - bottom + 17}" text-anchor="${anchor}">${shortDate(isoOfDay(start + i))}</text>`
    );
  });

  // Highlighted last, so it sits on top of what it is being told apart from.
  const ordered = lines
    .filter((l) => l.id !== highlightId)
    .concat(lines.filter((l) => l.id === highlightId));
  ordered.forEach((line) => {
    const on = line.id === highlightId;
    const dimmed = highlightId && !on;
    const width = on ? 3.4 : dimmed ? 1.2 : line.isOwn ? 2.8 : 1.8;
    const opacity = dimmed ? 0.22 : 1;
    line.segments.forEach((segment) => {
      if (segment.length === 1) {
        parts.push(
          `<circle cx="${x(segment[0].i).toFixed(1)}" cy="${y(segment[0].pct).toFixed(1)}" r="${on ? 3.4 : 2.4}" fill="${line.color}" opacity="${opacity}" />`
        );
        return;
      }
      const d = segment
        .map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.pct).toFixed(1)}`)
        .join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke="${line.color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`
      );
    });
  });

  return `<svg class="growthSvg" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Daily follower growth over the last ${GROWTH_WINDOW_DAYS} days">${parts.join("")}</svg>`;
}

function shortDate(iso) {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

function growthPct(value) {
  const abs = Math.abs(value);
  const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${abs.toFixed(digits)}%`;
}

/** What the chart is NOT showing, and why. A blank day is a movement we
 *  measured and cannot honestly place on a day, so it gets said out loud. */
function growthNotes(lines) {
  const notes = [];
  const named = (ls) => {
    const names = ls.map((l) => l.label);
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };

  const rounded = lines.filter((l) => l.blanks.rounded > 0);
  if (rounded.length) {
    const days = rounded.reduce((n, l) => n + l.blanks.rounded, 0);
    notes.push(
      `${days} ${days === 1 ? "day is" : "days are"} blank on ${named(rounded)}: the movement sits at the limit of what this platform reports, so it has no honest daily size.`
    );
  }
  const gaps = lines.filter((l) => l.blanks.notCollected > 0);
  if (gaps.length) {
    const days = gaps.reduce((n, l) => n + l.blanks.notCollected, 0);
    notes.push(
      `${days} ${days === 1 ? "day was" : "days were"} not collected on ${named(gaps)}, so no daily figure exists for ${days === 1 ? "it" : "them"}.`
    );
  }
  const tiny = lines.filter((l) => l.belowFloor);
  if (tiny.length) {
    notes.push(
      `${named(tiny)} started the window under ${GROWTH_FLOOR} followers, where one follower is a swing of tens of percent — which is why the axis reaches as high as it does.`
    );
  }
  return notes;
}
