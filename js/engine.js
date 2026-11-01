// The computer's search, with no page in sight: it runs in a Web Worker
// (worker.js) and in the tests. Alpha-beta over a position held as bits, with a
// table of positions already seen, deepening one move at a time until time or
// the game runs out. When a search reaches the end of every line, its answer
// is proved rather than judged, so perfect play needs no separate mode.
//
// A position is two pairs of 32-bit words, as there are 49 bits and JavaScript
// shifts only 32 at a time. p is the discs of the side to move and m is all the
// discs. Each column has seven bits, the bottom cell lowest and the top bit
// always clear: lo holds columns 0 to 3 and hi columns 4 to 6.
//
//   hi                      lo
//   .  .  .        .  .  .  .     top bit, always empty
//   20 13 06       27 20 13 06    row 5
//   19 12 05       26 19 12 05
//   18 11 04       25 18 11 04
//   17 10 03       24 17 10 03
//   16 09 02       23 16 09 02
//   15 08 01       22 15 08 01
//   14 07 00       21 14 07 00    row 0
//
// Scores are for the side to move and count the discs on the board when the
// game ends: a win on disc 25 is 1000 - 25, and the same loss is its negative,
// so the same position scores the same however it was reached and a quicker
// win scores higher. A draw is 0. Judged positions stay within JUDGED, so
// anything beyond PROVED is certain.

export const CELLS = 42;
const COLUMNS = 7;
const WIN = 1000;
const INFINITE = 1024;
const JUDGED = 800;
export const PROVED = 900;

const BOTTOM_LO = 0x00204081;
const BOTTOM_HI = 0x00004081;
const BOARD_LO = BOTTOM_LO * 63;
const BOARD_HI = BOTTOM_HI * 63;
const ODD_LO = BOTTOM_LO * 0b010101; // rows 1, 3 and 5, counting the bottom as 1
const ODD_HI = BOTTOM_HI * 0b010101;
const EVEN_LO = BOTTOM_LO * 0b101010;
const EVEN_HI = BOTTOM_HI * 0b101010;
const CENTRE_LO = 63 << 21;
const NEAR_LO = 63 << 14; // the columns either side of the centre
const NEAR_HI = 63;

const COLUMN_LO = new Int32Array([63, 63 << 7, 63 << 14, 63 << 21, 0, 0, 0]);
const COLUMN_HI = new Int32Array([0, 0, 0, 0, 63, 63 << 7, 63 << 14]);
const CENTRE_OUT = new Int32Array([3, 2, 4, 1, 5, 0, 6]);
const PREFER = new Int32Array([0, 1, 2, 3, 2, 1, 0]);

const count = word => {
  let n = word - ((word >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return Math.imul((n + (n >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
};

// ---- Lines ----------------------------------------------------------------

let outLo = 0;
let outHi = 0;

// Every empty cell where a disc would finish a line for the side holding
// (pLo, pHi), whether or not it can be reached yet; the answer is left in
// outLo and outHi, as a function can only return one word. A shift across the
// board moves bits between the words; the top bit of each column keeps a line
// from wrapping round, and bits shifted off the board are masked at the end.
function threats(pLo, pHi, mLo, mHi) {
  let lo = (pLo << 1) & (pLo << 2) & (pLo << 3);
  let hi = (pHi << 1) & (pHi << 2) & (pHi << 3);

  // Across: from three cells in each of the four ways a gap can sit.
  let aLo = pLo << 7;
  let aHi = (pHi << 7) | (pLo >>> 21);
  let bLo = pLo << 14;
  let bHi = (pHi << 14) | (pLo >>> 14);
  let cLo = (pLo >>> 7) | (pHi << 21);
  let cHi = pHi >>> 7;
  let dLo = (pLo >>> 14) | (pHi << 14);
  let dHi = pHi >>> 14;
  let qLo = aLo & bLo;
  let qHi = aHi & bHi;
  lo |= qLo & ((pLo << 21) | cLo);
  hi |= qHi & ((pHi << 21) | (pLo >>> 7) | cHi);
  qLo = cLo & dLo;
  qHi = cHi & dHi;
  lo |= qLo & (aLo | (pLo >>> 21) | (pHi << 7));
  hi |= qHi & (aHi | (pHi >>> 21));

  // Falling to the right.
  aLo = pLo << 6;
  aHi = (pHi << 6) | (pLo >>> 22);
  bLo = pLo << 12;
  bHi = (pHi << 12) | (pLo >>> 16);
  cLo = (pLo >>> 6) | (pHi << 22);
  cHi = pHi >>> 6;
  dLo = (pLo >>> 12) | (pHi << 16);
  dHi = pHi >>> 12;
  qLo = aLo & bLo;
  qHi = aHi & bHi;
  lo |= qLo & ((pLo << 18) | cLo);
  hi |= qHi & ((pHi << 18) | (pLo >>> 10) | cHi);
  qLo = cLo & dLo;
  qHi = cHi & dHi;
  lo |= qLo & (aLo | (pLo >>> 18) | (pHi << 10));
  hi |= qHi & (aHi | (pHi >>> 18));

  // Rising to the right.
  aLo = pLo << 8;
  aHi = (pHi << 8) | (pLo >>> 20);
  bLo = pLo << 16;
  bHi = (pHi << 16) | (pLo >>> 12);
  cLo = (pLo >>> 8) | (pHi << 20);
  cHi = pHi >>> 8;
  dLo = (pLo >>> 16) | (pHi << 12);
  dHi = pHi >>> 16;
  qLo = aLo & bLo;
  qHi = aHi & bHi;
  lo |= qLo & ((pLo << 24) | cLo);
  hi |= qHi & ((pHi << 24) | (pLo >>> 4) | cHi);
  qLo = cLo & dLo;
  qHi = cHi & dHi;
  lo |= qLo & (aLo | (pLo >>> 24) | (pHi << 4));
  hi |= qHi & (aHi | (pHi >>> 24));

  outLo = lo & (BOARD_LO ^ mLo);
  outHi = hi & (BOARD_HI ^ mHi);
}

// For the tests: threats() as [lo, hi], and what the words of a position are.
export function threatsOf(pLo, pHi, mLo, mHi) {
  threats(pLo, pHi, mLo, mHi);
  return [outLo, outHi];
}

export function positionOf(moves) {
  let pLo = 0;
  let pHi = 0;
  let mLo = 0;
  let mHi = 0;
  for (const column of moves) {
    const cellLo = (mLo + BOTTOM_LO) & COLUMN_LO[column];
    const cellHi = (mHi + BOTTOM_HI) & COLUMN_HI[column];
    // The next side's discs are the ones that are not the mover's.
    const nextLo = pLo ^ mLo;
    const nextHi = pHi ^ mHi;
    mLo |= cellLo;
    mHi |= cellHi;
    pLo = nextLo;
    pHi = nextHi;
  }
  return { pLo, pHi, mLo, mHi, stones: moves.length };
}

// ---- The table ------------------------------------------------------------

// Three words a slot: the position's key in two, and the rest packed into one.
// The key is the sum of p and m in each word, which no two positions share, so
// a hit is always the right position. A slot's packed word is never 0, as the
// bound is 1 to 3; otherwise the empty board, whose key is 0, would seem to be
// in every empty slot.
//
//   bits 0-10 value + INFINITE, 11-12 bound, 13-18 depth, 19-21 move, 22-29 age
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
const NO_MOVE = 7;
const BITS = 22; // about 50 MB
const KEEP_FROM_DEPTH = 2;

let table = null;
let tableBits = 0; // the size it has
let tableAsked = 0; // and the size it was asked for, which can be more
let tableSeed = 0;
let age = 0;

// Allocated on first use, so that a game against Easy never pays for it. A
// phone short of memory gets a smaller table rather than an error, and keeps
// it: asking again would only empty it.
function makeTable(bits) {
  if (table && tableAsked === bits) return;
  table = null;
  tableAsked = bits;
  for (let tried = bits; ; tried--) {
    try {
      table = new Int32Array(3 << tried);
      tableBits = tried;
      return;
    } catch (error) {
      if (tried <= 12) throw error;
    }
  }
}

const bucketOf = (keyLo, keyHi) => {
  const h = Math.imul(keyLo, 0x9e3779b1) ^ Math.imul(keyHi, 0x85ebca77);
  return ((h ^ (h >>> 15)) >>> (32 - tableBits)) & ~1;
};

// Replaces the same position, or else an empty slot, or whichever of the two
// is older, or shallower.
function remember(keyLo, keyHi, value, bound, depth, move) {
  const first = bucketOf(keyLo, keyHi) * 3;
  const second = first + 3;
  let slot = first;
  if (table[second] === keyLo && table[second + 1] === keyHi) slot = second;
  else if (!(table[first] === keyLo && table[first + 1] === keyHi) && table[first + 2] !== 0) {
    const a = table[first + 2];
    const b = table[second + 2];
    const aOld = ((a >>> 22) & 255) !== age;
    const bOld = ((b >>> 22) & 255) !== age;
    if (b === 0) slot = second;
    else if (aOld !== bOld) slot = aOld ? first : second;
    else slot = ((a >>> 13) & 63) <= ((b >>> 13) & 63) ? first : second;
  }
  table[slot] = keyLo;
  table[slot + 1] = keyHi;
  table[slot + 2] = (value + INFINITE) | (bound << 11) | (depth << 13) | (move << 19) | (age << 22);
}

// ---- The search -----------------------------------------------------------

const STOP = new Error('out of time');
const CHECK_EVERY = 1024;
const REPORT_MS = 250;

let nodes = 0;
let nodeLimit = Infinity;
let timeLimit = Infinity;
let checkAt = CHECK_EVERY;
let cut = false; // this search stopped at a judged position, so it proves nothing
let jitter = 0;
let deepest = 0; // how many discs ahead the last whole round of the search looked
let startedAt = 0;
let report = null; // who hears how the search is going
let reportAt = 0;

// A running search can't be told anything, so it looks at the clock itself.
// It can tell, though, and that also shows the page it is still alive.
function checkBudget() {
  checkAt = nodes + CHECK_EVERY;
  const now = performance.now();
  if (nodes >= nodeLimit || now >= timeLimit) throw STOP;
  if (report && now >= reportAt) {
    reportAt = now + REPORT_MS;
    report({ nodes, depth: deepest, ms: Math.round(now - startedAt) });
  }
}

// How good the position looks, for a search out of depth. A line that needs
// one more disc is worth most on a row its owner will be left to fill when the
// columns run out: the first player reaches the odd rows and the second the
// even rows. The jitter is a small sum drawn from the position, so that equal
// moves are told apart differently from game to game, yet the same position
// always scores the same and the table stays honest.
function judge(pLo, pHi, oLo, oHi, myLo, myHi, thLo, thHi, stones, keyLo, keyHi) {
  const odd = count(myLo & ODD_LO) + count(myHi & ODD_HI);
  const even = count(myLo & EVEN_LO) + count(myHi & EVEN_HI);
  const theirOdd = count(thLo & ODD_LO) + count(thHi & ODD_HI);
  const theirEven = count(thLo & EVEN_LO) + count(thHi & EVEN_HI);
  let score = stones & 1
    ? 30 * even + 8 * odd - 30 * theirOdd - 8 * theirEven // the second player to move
    : 30 * odd + 8 * even - 30 * theirEven - 8 * theirOdd;
  score += 4 * (count(pLo & CENTRE_LO) - count(oLo & CENTRE_LO));
  score += 2 * (count(pLo & NEAR_LO) + count(pHi & NEAR_HI) - count(oLo & NEAR_LO) - count(oHi & NEAR_HI));
  const mixed = Math.imul(keyLo ^ jitter, 0x9e3779b1) ^ Math.imul(keyHi, 0x85ebca77);
  score += ((mixed ^ (mixed >>> 15)) >>> 28) % 7 - 3;
  return score > JUDGED ? JUDGED : score < -JUDGED ? -JUDGED : score;
}

const orderLo = new Int32Array(CELLS * COLUMNS + COLUMNS);
const orderHi = new Int32Array(CELLS * COLUMNS + COLUMNS);
const orderColumn = new Int32Array(CELLS * COLUMNS + COLUMNS);
const orderRank = new Int32Array(CELLS * COLUMNS + COLUMNS);

function search(pLo, pHi, mLo, mHi, stones, alpha, beta, depth, ply) {
  if (++nodes >= checkAt) checkBudget();
  if (stones === CELLS) return 0;

  const openLo = (mLo + BOTTOM_LO) & BOARD_LO;
  const openHi = (mHi + BOTTOM_HI) & BOARD_HI;
  threats(pLo, pHi, mLo, mHi);
  const myLo = outLo;
  const myHi = outHi;
  if ((myLo & openLo) | (myHi & openHi)) return WIN - (stones + 1);

  const oLo = pLo ^ mLo;
  const oHi = pHi ^ mHi;
  threats(oLo, oHi, mLo, mHi);
  const thLo = outLo;
  const thHi = outHi;

  // Their win next move must be blocked, and two can't be. Nor may a disc go
  // straight under a cell that wins for them.
  let safeLo = openLo;
  let safeHi = openHi;
  const mustLo = thLo & openLo;
  const mustHi = thHi & openHi;
  if (mustLo | mustHi) {
    if ((mustLo & (mustLo - 1)) | (mustHi & (mustHi - 1)) | (mustLo && mustHi)) return -(WIN - (stones + 2));
    safeLo = mustLo;
    safeHi = mustHi;
  }
  safeLo &= ~(thLo >>> 1);
  safeHi &= ~(thHi >>> 1);
  if (!(safeLo | safeHi)) return -(WIN - (stones + 2));

  // A forced reply doesn't use up depth, so a line of threats is read to its end.
  const only = !((safeLo & (safeLo - 1)) | (safeHi & (safeHi - 1)) | (safeLo && safeHi));
  const keyLo = pLo + mLo;
  const keyHi = pHi + mHi;
  if (depth <= 0 && !only) {
    cut = true;
    return judge(pLo, pHi, oLo, oHi, myLo, myHi, thLo, thHi, stones, keyLo, keyHi);
  }

  // Neither side can win sooner than this now.
  const most = WIN - (stones + 3);
  const least = -(WIN - (stones + 4));
  if (beta > most) {
    beta = most;
    if (alpha >= beta) return beta;
  }
  if (alpha < least) {
    alpha = least;
    if (alpha >= beta) return alpha;
  }

  const first = bucketOf(keyLo, keyHi) * 3;
  let slot = -1;
  if (table[first] === keyLo && table[first + 1] === keyHi && table[first + 2] !== 0) slot = first;
  else if (table[first + 3] === keyLo && table[first + 4] === keyHi && table[first + 5] !== 0) slot = first + 3;
  let hinted = NO_MOVE;
  if (slot >= 0) {
    const data = table[slot + 2];
    const value = (data & 2047) - INFINITE;
    const bound = (data >>> 11) & 3;
    const stored = (data >>> 13) & 63;
    hinted = (data >>> 19) & 7;
    // A proved win or loss holds at any depth, but only as a bound: a deeper
    // look can only find a quicker win or a slower loss. Whatever is not
    // certain counts as a judgement.
    const deep = stored >= depth || stored >= CELLS - stones;
    const atLeast = bound !== UPPER && (deep || value >= PROVED);
    const atMost = bound !== LOWER && (deep || value <= -PROVED);
    if (atLeast || atMost) {
      if (stored < CELLS - stones && !(value >= PROVED && bound !== UPPER) && !(value <= -PROVED && bound !== LOWER)) cut = true;
      if (atLeast && atMost) return value;
      if (atLeast) {
        if (value >= beta) return value;
        if (value > alpha) alpha = value;
      } else {
        if (value <= alpha) return value;
        if (value < beta) beta = value;
      }
    }
  }

  // The move the table remembers first, then those that make the most new
  // threats, and the centre before the edges. Counting threats costs too much
  // near the leaves.
  const base = ply * COLUMNS;
  let moves = 0;
  for (let i = 0; i < COLUMNS; i++) {
    const column = CENTRE_OUT[i];
    const cellLo = safeLo & COLUMN_LO[column];
    const cellHi = safeHi & COLUMN_HI[column];
    if (!(cellLo | cellHi)) continue;
    let rank = PREFER[column];
    if (column === hinted) rank = 1 << 20;
    else if (depth >= 3) {
      threats(pLo | cellLo, pHi | cellHi, mLo | cellLo, mHi | cellHi);
      rank += 16 * (count(outLo) + count(outHi));
    }
    let at = base + moves++;
    while (at > base && orderRank[at - 1] < rank) {
      orderRank[at] = orderRank[at - 1];
      orderLo[at] = orderLo[at - 1];
      orderHi[at] = orderHi[at - 1];
      orderColumn[at] = orderColumn[at - 1];
      at--;
    }
    orderRank[at] = rank;
    orderLo[at] = cellLo;
    orderHi[at] = cellHi;
    orderColumn[at] = column;
  }

  const start = alpha;
  const next = only ? depth : depth - 1;
  let best = -INFINITE;
  let bestMove = NO_MOVE;
  for (let i = 0; i < moves; i++) {
    const at = base + i;
    const nextLo = mLo | orderLo[at];
    const nextHi = mHi | orderHi[at];
    let value;
    if (i === 0) value = -search(oLo, oHi, nextLo, nextHi, stones + 1, -beta, -alpha, next, ply + 1);
    else {
      value = -search(oLo, oHi, nextLo, nextHi, stones + 1, -alpha - 1, -alpha, next, ply + 1);
      if (value > alpha && value < beta) value = -search(oLo, oHi, nextLo, nextHi, stones + 1, -beta, -alpha, next, ply + 1);
    }
    if (value > best) {
      best = value;
      bestMove = orderColumn[at];
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }

  if (depth >= KEEP_FROM_DEPTH) {
    remember(keyLo, keyHi, best, best <= start ? UPPER : best >= beta ? LOWER : EXACT, depth > 63 ? 63 : depth, bestMove);
  }
  return best;
}

// ---- Choosing a move --------------------------------------------------------

// A small generator, so that a seed gives the same game every time.
export function rngOf(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

const columnBits = (lo, hi, column) => (column < 4 ? (lo >>> (7 * column)) & 127 : (hi >>> (7 * (column - 4))) & 127);

function isMirrored({ pLo, pHi, mLo, mHi }) {
  for (let column = 0; column < 3; column++) {
    if (columnBits(mLo, mHi, column) !== columnBits(mLo, mHi, 6 - column)) return false;
    if (columnBits(pLo, pHi, column) !== columnBits(pLo, pHi, 6 - column)) return false;
  }
  return true;
}

const cellIn = (column, openLo, openHi) => [openLo & COLUMN_LO[column], openHi & COLUMN_HI[column]];

// What's at stake at the root, before any search: the columns that can be
// played, and how many of them don't lose at once.
function survey({ pLo, pHi, mLo, mHi, stones }) {
  const openLo = (mLo + BOTTOM_LO) & BOARD_LO;
  const openHi = (mHi + BOTTOM_HI) & BOARD_HI;
  const legal = Array.from(CENTRE_OUT).filter(column => (openLo & COLUMN_LO[column]) | (openHi & COLUMN_HI[column]));
  threats(pLo, pHi, mLo, mHi);
  const wins = legal.filter(column => (outLo & openLo & COLUMN_LO[column]) | (outHi & openHi & COLUMN_HI[column]));
  threats(pLo ^ mLo, pHi ^ mHi, mLo, mHi);
  const thLo = outLo;
  const thHi = outHi;
  const blocks = legal.filter(column => (thLo & openLo & COLUMN_LO[column]) | (thHi & openHi & COLUMN_HI[column]));
  const safe = blocks.length > 1 ? [] : (blocks.length ? blocks : legal).filter(column => !((thLo >>> 1) & openLo & COLUMN_LO[column]) && !((thHi >>> 1) & openHi & COLUMN_HI[column]));
  return { legal, wins, blocks, safe, stones };
}

// How many of the replies to `column` still win for the other side: the
// fewer, the more chances they have to go wrong.
function winningReplies({ pLo, pHi, mLo, mHi, stones }, column) {
  const [cellLo, cellHi] = cellIn(column, (mLo + BOTTOM_LO) & BOARD_LO, (mHi + BOTTOM_HI) & BOARD_HI);
  const afterLo = mLo | cellLo;
  const afterHi = mHi | cellHi;
  threats(pLo ^ mLo, pHi ^ mHi, afterLo, afterHi);
  const theirLo = outLo;
  const theirHi = outHi;
  const openLo = (afterLo + BOTTOM_LO) & BOARD_LO;
  const openHi = (afterHi + BOTTOM_HI) & BOARD_HI;
  let replies = 0;
  for (let reply = 0; reply < COLUMNS; reply++) {
    const [lo, hi] = cellIn(reply, openLo, openHi);
    if (!(lo | hi)) continue;
    // search() takes a game still going, so a reply that finishes it counts here.
    if ((lo & theirLo) | (hi & theirHi) || search(pLo | cellLo, pHi | cellHi, afterLo | lo, afterHi | hi, stones + 2, -1, 0, CELLS, 1) < 0) replies++;
  }
  return replies;
}

// Thinks about the position after `moves`, the columns played so far.
//
// `depth`, `nodes` and `ms` limit it, and the tests use `nodes` so that the
// answer does not depend on the machine. `noise` is added to every move's
// score, which also makes it score all of them fully. `seed` draws the
// randomness. `book` plays the known best opening without thinking. `defend`
// makes a side that has lost pick its most awkward defence, and `all` asks for
// every move's exact score. `fresh` empties the table first, so that two runs
// are the same. `progress` hears { nodes, depth, ms } a few times a second.
//
// The answer is { column, score, depth, solved, nodes, values, ms, memory }:
// `values` holds each column's score, or null where it was not looked at,
// `solved` says that the score is proved, `ms` is the time it took, and
// `memory` is the table's size in MB.
export function think(moves, { depth = CELLS, nodes: budget = Infinity, ms = Infinity, noise = 0, seed = 1, book = false, defend = false, all = false, fresh = false, bits = BITS, progress = null } = {}) {
  const root = positionOf(moves);
  const { pLo, pHi, mLo, mHi, stones } = root;
  const random = rngOf(Math.imul(seed, 31) + stones);
  const { legal, wins, blocks, safe } = survey(root);
  const values = new Array(COLUMNS).fill(null);
  const says = (column, score, more = {}) => ({ column, score, depth: 0, solved: true, nodes: 0, values, ms: 0, memory: 0, ...more });

  if (!all) {
    if (wins.length) return says(wins[0], WIN - (stones + 1), { reason: 'win' });
    if (!safe.length) return says(blocks[0] ?? legal[0], -(WIN - (stones + 2)), { reason: 'lost' });
    if (safe.length === 1) return says(safe[0], 0, { solved: false, reason: blocks.length ? 'block' : 'only' });
    if (book && stones === 0) return says(3, 0, { solved: false, reason: 'book' });
    if (book && stones === 1 && moves[0] === 3) return says(3, 0, { solved: false, reason: 'book' });
  }

  makeTable(bits);
  if (fresh || seed !== tableSeed) {
    table.fill(0);
    tableSeed = seed;
    age = 0;
  }
  age = (age + 1) & 255;
  jitter = Math.imul(seed, 0x2545f491);
  nodes = 0;
  deepest = 0;
  nodeLimit = budget;
  startedAt = performance.now();
  timeLimit = startedAt + ms;
  report = progress;
  reportAt = startedAt + REPORT_MS;
  checkAt = CHECK_EVERY;

  // Scoring every move means a full window for each, which is what `noise`
  // and `all` are for. Mirror-image moves score the same, so one of each pair
  // is enough, with the mirror drawn at the end.
  const everyMove = noise > 0 || all;
  const mirrored = !everyMove && isMirrored(root);
  let order = all ? [...legal] : [...safe];
  if (mirrored) order = order.filter(column => column <= 3);

  const openLo = (mLo + BOTTOM_LO) & BOARD_LO;
  const openHi = (mHi + BOTTOM_HI) & BOARD_HI;
  const oLo = pLo ^ mLo;
  const oHi = pHi ^ mHi;
  const score = (column, alpha, beta, left) => {
    const [cellLo, cellHi] = cellIn(column, openLo, openHi);
    // A move that finishes a line ends the search here; search() only looks
    // for wins one disc ahead of the side to move.
    if (wins.includes(column)) return WIN - (stones + 1);
    return -search(oLo, oHi, mLo | cellLo, mHi | cellHi, stones + 1, -beta, -alpha, left, 1);
  };

  let bestColumn = order[0];
  let bestScore = -INFINITE;
  let solved = false;
  const limit = Math.min(depth, CELLS - stones);
  try {
    for (let d = 1; d <= limit; d++) {
      cut = false;
      let alpha = -INFINITE;
      let top = -INFINITE;
      let topColumn = order[0];
      for (let i = 0; i < order.length; i++) {
        const column = order[i];
        let value;
        if (i === 0 || everyMove) value = score(column, -INFINITE, INFINITE, d - 1);
        else {
          value = score(column, alpha, alpha + 1, d - 1);
          if (value > alpha) value = score(column, alpha, INFINITE, d - 1);
        }
        values[column] = value;
        if (value > top) {
          top = value;
          topColumn = column;
          // Good enough to stand if time runs out in the rest of this round.
          bestColumn = column;
          bestScore = value;
        }
        if (value > alpha) alpha = value;
        if (!everyMove && value >= PROVED) break;
      }
      deepest = d;
      order = [topColumn, ...order.filter(column => column !== topColumn).sort((a, b) => (values[b] ?? -INFINITE) - (values[a] ?? -INFINITE))];
      solved = !cut || (!all && Math.abs(top) >= PROVED);
      if (solved) break;
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }

  // Every move loses: hold out, and leave them the fewest ways to go on winning.
  // A quick loss with one winning reply can beat a slow one with five, so
  // moves near the slowest are compared by that. Runs on what time is left.
  if (defend && solved && bestScore < 0 && order.length > 1) {
    try {
      const scored = order.map(column => ({ column, value: score(column, -INFINITE, INFINITE, CELLS) }));
      const slowest = Math.max(...scored.map(move => move.value));
      const near = scored.filter(move => move.value >= slowest - 2).map(move => ({ ...move, replies: winningReplies(root, move.column) }));
      const fewest = Math.min(...near.map(move => move.replies));
      const tied = near.filter(move => move.replies === fewest);
      const longest = Math.max(...tied.map(move => move.value));
      const picks = tied.filter(move => move.value === longest);
      bestColumn = picks[Math.floor(random() * picks.length)].column;
      bestScore = longest;
      for (const { column, value } of scored) values[column] = value;
    } catch (error) {
      if (error !== STOP) throw error;
    }
  }

  if (noise > 0) {
    let top = -Infinity;
    for (const column of order) {
      if (values[column] === null) continue;
      const value = values[column] + noise * gauss(random);
      if (value > top) {
        top = value;
        bestColumn = column;
        bestScore = values[column];
      }
    }
  }

  const mirror = mirrored && bestColumn !== 3 && random() < 0.5;
  return {
    column: mirror ? 6 - bestColumn : bestColumn,
    score: bestScore === -INFINITE ? 0 : bestScore,
    depth: deepest,
    solved,
    nodes,
    values,
    ms: Math.round(performance.now() - startedAt),
    memory: Math.round((12 << tableBits) / 1e6),
    reason: 'search',
  };
}
