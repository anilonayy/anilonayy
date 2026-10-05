// Renders the profile header and activity card as light/dark SVGs into assets/.
// Runs daily in GitHub Actions; needs GITHUB_TOKEN. No dependencies (Node 20+).
import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.PROFILE_LOGIN ?? "anilonayy";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const QUERY = `query($login: String!) {
  user(login: $login) {
    createdAt
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        pushedAt
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
});
const { data, errors } = await res.json();
if (errors) throw new Error(JSON.stringify(errors));
const user = data.user;

const calendar = user.contributionsCollection.contributionCalendar;
const days = calendar.weeks.flatMap((w) => w.contributionDays);
const stars = user.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0);

// Language share by bytes across public, non-fork repos pushed in the last two years —
// old coursework shouldn't define the profile. Markup languages are noise here.
const IGNORED = new Set(["HTML", "CSS", "SCSS", "Blade", "Dockerfile", "Makefile", "Shell", "Procfile"]);
const since = Date.now() - 2 * 365 * 864e5;
const bytes = new Map();
for (const repo of user.repositories.nodes.filter((r) => Date.parse(r.pushedAt) >= since))
  for (const { size, node } of repo.languages.edges)
    if (!IGNORED.has(node.name)) bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
const total = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
const top = ranked.slice(0, 5).map(([name, size]) => ({ name, share: size / total })).filter((l) => l.share >= 0.02);
const rest = 1 - top.reduce((a, l) => a + l.share, 0);
if (rest > 0.005) top.push({ name: "Other", share: rest });

// Longest streak and current streak (today may still be empty; that doesn't break it).
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue;
  else break;
}

const THEMES = {
  light: { fg: "#0a0a0a", muted: "#6b6b6b", line: "#e4e4e4", cells: ["#ececec", "#c4c4c4", "#8f8f8f", "#525252", "#0a0a0a"],
    langs: ["#0a0a0a", "#3a3a3a", "#666666", "#8f8f8f", "#b5b5b5", "#d6d6d6"] },
  dark: { fg: "#f5f5f5", muted: "#8b8b8b", line: "#262626", cells: ["#1c1c1c", "#3d3d3d", "#6e6e6e", "#a8a8a8", "#f5f5f5"],
    langs: ["#f5f5f5", "#c8c8c8", "#9a9a9a", "#707070", "#4d4d4d", "#333333"] },
};
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
const W = 840;
const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Quantile-based levels so one busy day doesn't flatten the rest of the year.
const counts = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 1;
const cuts = [q(0.25), q(0.5), q(0.75)];
const level = (c) => (c === 0 ? 0 : c <= cuts[0] ? 1 : c <= cuts[1] ? 2 : c <= cuts[2] ? 3 : 4);

function header(t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="150" viewBox="0 0 ${W} 150" role="img" aria-label="Cengizhan Anıl Onay — Software engineer, Istanbul">
  <text x="0" y="62" fill="${t.fg}" font-family="${SANS}" font-size="44" font-weight="600" letter-spacing="-1.2">Cengizhan Anıl Onay</text>
  <text x="0" y="98" fill="${t.muted}" font-family="${SANS}" font-size="18">Software engineer. Backend systems in Go, products in TypeScript, AI where it earns its place.</text>
  <line x1="0" y1="126" x2="${W}" y2="126" stroke="${t.line}"/>
  <text x="0" y="146" fill="${t.muted}" font-family="${MONO}" font-size="12" letter-spacing="0.6">ISTANBUL · GO · TYPESCRIPT · NEXT.JS · POSTGRES · AI AGENTS</text>
</svg>`;
}

function activity(t) {
  // Cells stretch so the year spans the full card width.
  const gap = 3, step = (W + gap) / calendar.weeks.length, cell = +(step - gap).toFixed(2), gridX = 0, gridY = 96;
  let cells = "", months = "";
  let lastMonth = -1;
  calendar.weeks.forEach((week, wi) => {
    week.contributionDays.forEach((d) => {
      const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
      cells += `<rect x="${(gridX + wi * step).toFixed(2)}" y="${(gridY + dow * step).toFixed(2)}" width="${cell}" height="${cell}" rx="2" fill="${t.cells[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
    });
    const m = new Date(week.contributionDays[0].date + "T00:00:00Z").getUTCMonth();
    if (m !== lastMonth && wi < calendar.weeks.length - 2) {
      if (lastMonth !== -1 || week.contributionDays[0].date.endsWith("-01") || wi === 0)
        months += `<text x="${gridX + wi * step}" y="${gridY - 8}" fill="${t.muted}" font-family="${MONO}" font-size="10">${new Date(Date.UTC(2000, m, 1)).toLocaleString("en-US", { month: "short" }).toUpperCase()}</text>`;
      lastMonth = m;
    }
  });

  const stats = [
    [fmt(calendar.totalContributions), "contributions, last 12 months"],
    [`${current}d`, `current streak · longest ${longest}d`],
    [fmt(user.repositories.totalCount), `public repositories · ${fmt(stars)} stars`],
  ];
  const colW = W / 3;
  const statSvg = stats.map(([big, small], i) => `
  <text x="${i * colW}" y="34" fill="${t.fg}" font-family="${SANS}" font-size="28" font-weight="600" letter-spacing="-0.6">${big}</text>
  <text x="${i * colW}" y="54" fill="${t.muted}" font-family="${SANS}" font-size="13">${small}</text>`).join("");

  const barY = gridY + 7 * step + 34, barH = 8;
  let x = 0, segs = "", legend = "";
  top.forEach((l, i) => {
    const w = Math.max(2, l.share * W);
    const shade = t.langs[i];
    segs += `<rect x="${x}" y="${barY}" width="${Math.max(0, w - 2)}" height="${barH}" fill="${shade}"/>`;
    x += w;
  });
  let lx = 0;
  top.forEach((l, i) => {
    const label = `${esc(l.name)} ${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`;
    legend += `<rect x="${lx}" y="${barY + 24}" width="8" height="8" rx="1" fill="${t.langs[i]}"/><text x="${lx + 14}" y="${barY + 32}" fill="${t.muted}" font-family="${MONO}" font-size="11">${label}</text>`;
    lx += 14 + label.length * 7 + 22;
  });

  const H = barY + 50;
  const updated = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub activity: ${calendar.totalContributions} contributions in the last year">
  ${statSvg}
  <line x1="0" y1="70" x2="${W}" y2="70" stroke="${t.line}"/>
  ${months}
  ${cells}
  <text x="${W}" y="${gridY + 7 * step + 12}" text-anchor="end" fill="${t.muted}" font-family="${MONO}" font-size="10">UPDATED ${updated}</text>
  <text x="0" y="${barY - 10}" fill="${t.muted}" font-family="${MONO}" font-size="10" letter-spacing="0.6">LANGUAGES · PUBLIC REPOSITORIES, LAST 2 YEARS</text>
  ${segs}
  ${legend}
</svg>`;
}

await mkdir("assets", { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  await writeFile(`assets/header-${name}.svg`, header(t));
  await writeFile(`assets/activity-${name}.svg`, activity(t));
}
console.log(`rendered: ${calendar.totalContributions} contributions, ${user.repositories.totalCount} repos, langs ${top.map((l) => l.name).join(", ")}`);
