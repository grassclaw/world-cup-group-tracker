const groups = [
  {
    id: "A", record: "4 teams · 4 played", leader: "Mexico", points: 6,
    matches: [
      { date: "Jun 11", status: "FT", a: ["MX", "Mexico", 2], b: ["ZA", "South Africa", 0], winner: "a" },
      { date: "Jun 18", status: "FT", a: ["CZ", "Czechia", 1], b: ["ZA", "South Africa", 1], winner: "draw" },
      { date: "Jun 24", kickoff: "2026-06-25T01:00:00Z", a: ["CZ", "Czechia", null], b: ["MX", "Mexico", null], next: true }
    ]
  },
  {
    id: "B", record: "4 teams · 4 played", leader: "Canada", points: 4,
    matches: [
      { date: "Jun 12", status: "FT", a: ["CA", "Canada", 1], b: ["BA", "Bosnia & Herz.", 1], winner: "draw" },
      { date: "Jun 18", status: "FT", a: ["CH", "Switzerland", 4], b: ["BA", "Bosnia & Herz.", 1], winner: "a" },
      { date: "Jun 24", kickoff: "2026-06-24T19:00:00Z", a: ["CH", "Switzerland", null], b: ["CA", "Canada", null], next: true }
    ]
  },
  {
    id: "C", record: "4 teams · 4 played", leader: "Brazil", points: 4,
    matches: [
      { date: "Jun 13", status: "FT", a: ["BR", "Brazil", 1], b: ["MA", "Morocco", 1], winner: "draw" },
      { date: "Jun 19", status: "FT", a: ["MA", "Morocco", 1], b: ["SC", "Scotland", 0], winner: "a" },
      { date: "Jun 24", kickoff: "2026-06-24T22:00:00Z", a: ["SC", "Scotland", null], b: ["BR", "Brazil", null], next: true }
    ]
  },
  {
    id: "D", record: "4 teams · 3 played", leader: "USA", points: 6,
    matches: [
      { date: "Jun 12", status: "FT", a: ["US", "USA", 4], b: ["PY", "Paraguay", 1], winner: "a" },
      { date: "Jun 19", status: "FT", a: ["US", "USA", 2], b: ["AU", "Australia", 0], winner: "a" },
      { date: "Jun 25", kickoff: "2026-06-26T02:00:00Z", a: ["TR", "Türkiye", null], b: ["US", "USA", null], next: true }
    ]
  }
];

const bracketGrid = document.querySelector("#bracketGrid");
let activeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatKickoff(iso) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: activeZone,
    timeZoneName: "short"
  }).format(new Date(iso));
}

function teamRow(team, outcome) {
  const [code, name, score] = team;
  return `<div class="team ${outcome ? "winner" : ""}">
    <span><i>${code}</i>${name}</span>
    ${score === null ? "" : `<b>${score}</b>`}
  </div>`;
}

function matchCard(match) {
  const isDraw = match.winner === "draw";
  return `<div class="match-card ${match.next ? "next" : ""}">
    ${teamRow(match.a, match.winner === "a")}
    <div class="versus"></div>
    ${teamRow(match.b, match.winner === "b")}
    <div class="match-note"><span>${match.date}</span><b>${isDraw ? "DRAW" : match.next ? "UP NEXT" : match.status}</b></div>
  </div>`;
}

function renderGroups(filter = "all") {
  const visible = filter === "all" ? groups : groups.filter(group => group.id === filter);
  bracketGrid.innerHTML = visible.map((group, groupIndex) => `
    <article class="group-row" style="animation-delay:${groupIndex * 55}ms">
      <div class="group-label">
        <small>Group</small><strong>${group.id}</strong><span>${group.record}</span>
      </div>
      <div class="rounds">
        ${group.matches.map((match, index) => `
          <div class="round">
            <div class="round-head"><span>${index === 0 ? "Opening" : index === 1 ? "Latest" : "Final round"}</span><span>${match.kickoff ? formatKickoff(match.kickoff) : match.status}</span></div>
            ${matchCard(match)}
          </div>`).join("")}
        <div class="advance">
          <small>Current leader</small>
          <b>${group.leader}</b>
          <span>${group.points} pts · Top 2 advance →</span>
        </div>
      </div>
    </article>
  `).join("");
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderGroups(button.dataset.group);
  });
});

const timezoneButton = document.querySelector("#timezoneButton");
const timezoneLabel = document.querySelector("#timezoneLabel");
const zones = [
  { label: "LOCAL TIME", value: Intl.DateTimeFormat().resolvedOptions().timeZone },
  { label: "ET", value: "America/New_York" },
  { label: "PT", value: "America/Los_Angeles" },
  { label: "UTC", value: "UTC" }
];
let zoneIndex = 0;
timezoneButton.addEventListener("click", () => {
  zoneIndex = (zoneIndex + 1) % zones.length;
  activeZone = zones[zoneIndex].value;
  timezoneLabel.textContent = zones[zoneIndex].label;
  document.querySelectorAll(".kickoff").forEach(time => {
    time.textContent = formatKickoff(time.dataset.utc);
  });
  renderGroups(document.querySelector(".filter.active").dataset.group);
});

renderGroups();
