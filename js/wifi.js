// A Wi-Fi game between two phones, without the page: who sits where, what
// each phone is sent, and the messages between the host and the other. The
// host keeps the real match (game.js), and the page runs every move through
// it; this file only checks who sent what, and passes it on. The links come
// from net.js, or from its linkPair() in the tests. The same as Backgammon's,
// apart from the moves.
//
// Messages are objects { t, ... }:
//   guest to host   hello { name, token, version }, drop { column },
//                   next { game }, bye
//   host to guest   lobby { seat, players }, state { seat, game, away },
//                   refused { message }, denied { why, version },
//                   closed { why }

export const MAX_PLAYERS = 2;
export const NAME_LENGTH = 12;

// A name as typed: single spaces, trimmed, no longer than the menu allows.
export const cleanName = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH);

// "Alex" a second time becomes "Alex 2", so that every score, message and
// statistic names one person.
function uniqueName(name, taken) {
  const used = new Set(taken.map(other => other.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, NAME_LENGTH - String(n).length - 1)} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// A guest's move rebuilt from only what it should hold, or null. The rules
// (game.js) then decide whether it is allowed. `next` carries the game the
// phone was looking at, so that both phones pressing Next game at once start
// only one.
export function cleanMove(message) {
  const { t, column, game } = message ?? {};
  if (t === 'drop') return Number.isInteger(column) && column >= 0 && column <= 6 ? { t, column } : null;
  if (t === 'next') return Number.isInteger(game) && game >= 1 ? { t, game } : null;
  return null;
}

// What `seat` is sent of the match: all of it, as nothing is hidden, except
// the host's notes on the seats.
export function seatView(match) {
  const view = JSON.parse(JSON.stringify(match));
  delete view.net;
  return view;
}

// Whether a state from the host is one this phone has already. It is sent
// again when the other phone joins, comes back or drops out.
export const sameState = (match, next) => Boolean(match) && JSON.stringify(match) === JSON.stringify(next);

// Why the host turned this phone away, in words.
export function deniedText({ why, version }, ours) {
  if (why === 'version') return `This phone has version ${ours} of the game and the host's has ${version}. Reload the page on the older one, then join again.`;
  if (why === 'full') return 'That game already has two players.';
  if (why === 'started') return 'That game has already started.';
  return 'Type your name first.';
}

// ---- The host -------------------------------------------------------------

// The host is seat 0, and the other phone seat 1. `seats` are a saved
// game's, as `saved()` gave them, when the game is reopened: the other person
// then counts as away until their phone comes back.
//
// onmove(seat, move) hears each guest's move (cleaned, see cleanMove); the
// page runs it, then calls share() or refuse(). onchange({ seat, joined })
// hears of anyone joining, coming back or dropping out.
export function createHost({ name, version, seats = null, onmove, onchange = () => {} }) {
  let started = Boolean(seats);
  let ended = false;
  let list = (seats ?? [{ name, token: null }]).map(seat => ({ name: cleanName(seat.name) || 'Host', token: seat.token ?? null, link: null }));

  const here = i => i === 0 || Boolean(list[i].link);
  // A person's seat, which a returning phone may take back.
  const theirs = (seat, i) => i > 0;
  const seatOf = link => list.findIndex(seat => seat.link === link);

  function sendLobby() {
    const players = host.players();
    list.forEach((seat, i) => seat.link?.send({ t: 'lobby', seat: i, players }));
  }

  // The guest hangs up once it has read why; this is in case it does not.
  function deny(link, why) {
    link.send({ t: 'denied', why, version });
    setTimeout(() => link.close(), 3000);
  }

  // A returning player is known by the token its tab keeps, or else, once
  // the game has started, by its name on a seat whose phone has gone.
  function hello(link, message) {
    const name = cleanName(message.name);
    const token = typeof message.token === 'string' ? message.token.slice(0, 40) : '';
    if (message.version !== version) return deny(link, 'version');
    if (!name || !token) return deny(link, 'name');
    let seat = list.findIndex((other, i) => theirs(other, i) && other.token === token);
    if (seat < 0 && started) seat = list.findIndex((other, i) => theirs(other, i) && !other.link && other.name.toLowerCase() === name.toLowerCase());
    if (seat < 0) {
      if (started) return deny(link, 'started');
      if (list.length >= MAX_PLAYERS) return deny(link, 'full');
      list.push({ name: uniqueName(name, list.map(other => other.name)), token, link: null });
      seat = list.length - 1;
    }
    const old = list[seat].link;
    Object.assign(list[seat], { link, token });
    if (old && old !== link) {
      old.onclose = null;
      old.close();
    }
    link.onmessage = next => heard(link, next);
    if (!started) sendLobby();
    onchange({ seat, joined: true });
  }

  function heard(link, message) {
    const seat = seatOf(link);
    if (seat < 0 || ended) return;
    if (message.t === 'bye') {
      link.close();
      return;
    }
    const move = started ? cleanMove(message) : null;
    if (move) onmove(seat, move);
  }

  // In the lobby a player who drops out loses the seat; in a game it is kept
  // for them.
  function dropped(link) {
    const seat = seatOf(link);
    if (seat < 0) return;
    list[seat].link = null;
    if (!started) {
      list.splice(seat, 1);
      sendLobby();
    }
    onchange({ seat, joined: false });
  }

  const host = {
    get started() {
      return started;
    },
    // A link from net.js. The guest says hello first. Once the game has
    // ended, nobody new is let in.
    attach(link) {
      if (ended) {
        link.close();
        return;
      }
      link.onmessage = message => {
        if (message.t === 'hello' && !ended) hello(link, message);
      };
      link.onclose = () => dropped(link);
    },
    players: () => list.map((seat, i) => ({ name: seat.name, here: here(i) })),
    away: () => list.map((seat, i) => !here(i)),
    // Back to the lobby, for another match: whoever has gone loses their
    // seat, and someone new may join again.
    reopen() {
      list = list.filter((seat, i) => here(i));
      started = false;
      sendLobby();
    },
    // Starts the match with the two in the lobby, as newMatch() takes them.
    begin() {
      list = list.filter((seat, i) => here(i));
      started = true;
      return list.map(({ name }) => ({ name }));
    },
    // For the saved match, so that it can be reopened: names and tokens.
    saved: () => list.map(({ name, token }) => ({ name, token })),
    // The match, and who is there, to each guest.
    share(match) {
      const away = host.away();
      list.forEach((seat, i) => seat.link?.send({ t: 'state', seat: i, game: seatView(match), away }));
    },
    refuse(seat, message) {
      list[seat]?.link?.send({ t: 'refused', message });
    },
    // Ends the Wi-Fi game for everyone.
    close(why = 'ended') {
      ended = true;
      for (const seat of list) {
        const { link } = seat;
        if (!link) continue;
        seat.link = null;
        link.onclose = null;
        link.send({ t: 'closed', why });
        setTimeout(() => link.close(), 500);
      }
    },
  };
  return host;
}

// ---- A guest ----------------------------------------------------------------

// connect() gives a link to the host: net.js joinRoom, or a test's. join()
// resolves when the host first answers (with the lobby or the match), or
// rejects with an error whose message can be shown. After that a lost link
// is dialled again every `retryMs`, until it is back or the host says no.
//
// onmessage(message) hears lobby, state, refused, denied and closed, and
// onlink(up) hears the link go and come back.
export function createGuest({ name, token, version, connect, onmessage = () => {}, onlink = () => {}, retryMs = 3000 }) {
  let link = null;
  let up = false;
  let stopped = false;
  let retry = 0;
  let waiting = null; // join()'s promise, until the host first answers

  const answered = (error = null) => {
    if (!waiting) return;
    const { resolve, reject } = waiting;
    waiting = null;
    if (error) {
      guest.stop();
      reject(error);
    } else resolve();
  };

  const again = () => {
    clearTimeout(retry);
    if (!stopped) retry = setTimeout(dial, retryMs);
  };

  function hear(message) {
    if (message.t === 'lobby' || message.t === 'state') {
      if (!up) {
        up = true;
        onlink(true);
      }
      answered();
    } else if (message.t === 'denied' || message.t === 'closed') {
      const first = Boolean(waiting);
      answered(new Error(message.t === 'denied' ? deniedText(message, version) : 'The host ended the game.'));
      guest.stop();
      if (first) return;
    }
    onmessage(message);
  }

  async function dial() {
    clearTimeout(retry);
    if (stopped) return;
    let next;
    try {
      next = await connect();
    } catch (error) {
      if (waiting) answered(error);
      else again();
      return;
    }
    if (stopped) {
      next.close();
      return;
    }
    link = next;
    link.onmessage = hear;
    link.onclose = () => {
      if (link !== next) return;
      link = null;
      if (up) {
        up = false;
        onlink(false);
      }
      if (waiting) answered(new Error('Lost touch with the host. Try again.'));
      else again();
    };
    link.send({ t: 'hello', name, token, version });
  }

  const guest = {
    get connected() {
      return up;
    },
    join() {
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        dial();
      });
    },
    // False when there is no link to send it on.
    send(message) {
      if (!up || !link) return false;
      link.send(message);
      return true;
    },
    // No more dialling, and the link hung up.
    stop() {
      stopped = true;
      clearTimeout(retry);
      const old = link;
      link = null;
      up = false;
      if (old) {
        old.onclose = null;
        old.close();
      }
    },
    leave() {
      link?.send({ t: 'bye' });
      guest.stop();
    },
  };
  return guest;
}
