// Lifetime statistics. The UI keeps this object in localStorage; nothing here
// touches storage, so it can be tested directly. Every finished game counts,
// whether or not its match goes on. Against the computer the person is side 0;
// games between people count each person's games, wins and draws, by name.

const levelRow = () => ({ games: 0, wins: 0, draws: 0, streak: 0, bestStreak: 0, assisted: 0 });
const personRow = () => ({ name: '', games: 0, wins: 0, draws: 0 });

export function emptyStats() {
  return {
    ai: { easy: levelRow(), medium: levelRow(), hard: levelRow(), guru: levelRow() },
    people: {}, // by name, lower case: { name, games, wins, draws }
    records: { fastestWin: 0, longestGame: 0 }, // against the computer; 0 means none yet
  };
}

// Pours saved data into the current shape, so a missing or damaged entry
// falls back to zero instead of breaking the page.
function fill(shape, saved) {
  if (typeof shape === 'string') return typeof saved === 'string' ? saved.slice(0, 40) : shape;
  if (Array.isArray(shape)) return shape.map((item, i) => fill(item, saved?.[i]));
  if (typeof shape === 'object') {
    return Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, fill(item, saved?.[key])]));
  }
  return Number.isFinite(saved) ? saved : shape;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = name => name.toLowerCase().slice(0, 40);

export function loadStats(saved) {
  const stats = fill(emptyStats(), saved);
  if (isObject(saved?.people)) {
    for (const [key, person] of Object.entries(saved.people).slice(0, 200)) {
      if (isObject(person)) stats.people[key.slice(0, 40)] = fill(personRow(), person);
    }
  }
  return stats;
}

// One finished game. A draw leaves a streak as it was. A win that used
// take-backs counts as a win but is noted as assisted, and earns no streak or
// record: with take-backs, anyone can beat Guru in the end.
export function recordGame(stats, match) {
  const { winner, stones } = match.result;
  if (match.mode !== 'ai') {
    match.players.forEach(({ name, ai }, side) => {
      if (ai) return;
      const person = (stats.people[keyOf(name)] ??= { ...personRow(), name });
      person.name = name;
      person.games++;
      if (side === winner) person.wins++;
      if (winner === null) person.draws++;
    });
    return;
  }

  const row = stats.ai[match.difficulty];
  const { records } = stats;
  row.games++;
  records.longestGame = Math.max(records.longestGame, stones);
  if (winner === null) {
    row.draws++;
    return;
  }
  if (winner !== 0) {
    row.streak = 0;
    return;
  }
  row.wins++;
  if (match.takeBacks > 0) {
    row.assisted++;
    return;
  }
  row.streak++;
  row.bestStreak = Math.max(row.bestStreak, row.streak);
  const moves = Math.ceil(stones / 2); // the winner's own discs, whoever started
  if (!records.fastestWin || moves < records.fastestWin) records.fastestWin = moves;
}
