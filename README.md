# Connect Four

Connect Four for the browser. Play against the computer (easy, medium, hard or guru), pass one device between two people, or play on your own phones over Wi-Fi. Matches to 1, 3 or 5 games. Works with touch, mouse and keyboard, on phones and desktops.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step. Its one library, PeerJS, is kept in `js/vendor/` and loaded only for Wi-Fi games.

## Play

- **Computer** on the menu plays against the computer; **People** is for two people sharing one device, each of whom can type a name.
- **Wi-Fi** on the menu lets two people play on their own phones (see [Wi-Fi games](#wi-fi-games)). Each types their name. One taps **Host a game**, and a four-letter code appears. The other taps **Join a game** and types it, or opens the link that **Share link** sends. The host taps **Start** once both are in.
- **First move**, against the computer, says who starts: you, the computer, or **Take turns**, which passes the first move to the other side each game, from one match to the next as well. Moving first is a real advantage, so it also works as a handicap. People and Wi-Fi games always take turns.
- **Match to** sets how many games win the match. A draw scores nothing.
- Tap a column to drop a disc. With a mouse, a disc waits over the column you point at. The computer's last disc is marked with a dot, and a tap while a disc is falling plays straight away.
- **Hint** shows the strongest move it can find quickly, and says why. It can be switched off on the menu.
- **Undo**, against the computer, takes back your last move and its reply, as far as the start of the game. It works after you lose or draw too, from the same button or the result box, and the game comes back out of your statistics. It can be switched off on the menu. A win that used Undo counts as a win, but it adds nothing to a streak or a record, and the statistics list these wins separately.
- The winning line glows before anything else happens. Winning a match is then celebrated with fireworks, confetti and a brass fanfare (the same as Cribbage's and Backgammon's) before the results appear. Tap to skip it. In a longer match, a game won along the way gets a chime. **See the board** on the results puts them aside, so you can study how it ended.
- Sound effects can be muted with the speaker button, the Sound setting on the menu, or `M`.
- Keyboard: the left and right arrow keys choose a column and `Space` or `Enter` drops a disc, or press `1` to `7` to drop one directly. `Enter` also presses Next game, `U` or `Backspace` undoes, `H` asks for a hint and `M` mutes.
- **Statistics** keeps your record against each computer level, with your fastest win and longest game, and games between people (on one device or over Wi-Fi) by name.
- The **i** button on the menu shows which version is running.

Settings, the match in progress and your statistics are kept in the browser's `localStorage`, so they stay on that device and browser and disappear if its site data is cleared.

## Wi-Fi games

Each person plays on their own phone, and one phone, the host's, keeps the match. It checks every move and keeps the score. The other phone sends it each move, and it sends the match back after every one.

- A browser cannot run a server or find other devices on a network by itself. So, for a few seconds at the start, a free public service, the [PeerJS](https://peerjs.com) cloud server, passes the connection details between the phones. After that the phones are linked directly (WebRTC), and moves go straight across the Wi-Fi. This needs the internet at the start. Everyone has it anyway, because the game itself loads from the web.
- On a Wi-Fi network that keeps devices apart (guest and hotel networks often do), PeerJS's free relay carries the moves instead. If the PeerJS service is down, Wi-Fi games cannot start, but the other modes are not affected.
- The host's match length and hints settings apply to both. Sound is set on each phone. There is no Undo in a game between people.
- Screens stay on during a Wi-Fi game, because a phone that goes to sleep drops out.
- A phone that drops out (it slept, switched apps, reloaded, or lost the Wi-Fi) reconnects by itself and takes back its seat. While it is gone, its name is dimmed on the other phone. When it is that player's turn, the host's main button can let the computer play for them, after asking, so the match need not wait.
- If the host's page reloads, it reopens the same match under the same code, and the other phone comes back by itself.
- When it becomes your turn, your phone chimes, and buzzes if it can.
- Each phone records every game in its own **Statistics**, under "Between people". Only the host can start another match.
- A phone running an older copy of the game is asked to reload.
- PeerJS 1.5.5 (MIT licence, see `js/vendor/LICENSE-peerjs.txt`) is the unchanged `peerjs.min.js` from <https://github.com/peers/peerjs>.

## The computer

- **Easy** does not search. It looks one disc ahead and takes a win nine times in ten and blocks seven times in ten; otherwise it favours the places on the most possible lines.
- **Medium**, **Hard** and **Guru** share one search, which differs only in how far it looks and how much noise is added to its scores. Medium reads 4 discs ahead with noise. Hard reads 10 with a little. Guru has no noise and 1.5 seconds a move, which reaches about 20 discs ahead on a PC.
- In self-play from random openings, Medium beats Easy, and Hard beats Medium, about 94% of the time, and Guru beats Hard about 92%.
- Connect Four is a solved game: with perfect play the first player wins by starting in the middle. Guru opens in the middle, and answers a middle opening on top of it, from a small book, then searches. Whenever a search reaches the end of every line the result is proved, and from then on its play is perfect. That usually happens around the eighth to twelfth disc. Before that its choices are very strong but not proved, so it is unbeatable in practice rather than in theory. An expert who knows the openings could still find a way through while moving first.
- When Guru has only losing moves, it holds out for as long as it can, and among the moves that last about as long it picks the one leaving the fewest winning replies.
- The same position in the same game gets the same reply, so Undo cannot be used to fish for a mistake.

The computer thinks in a Web Worker, so the page stays smooth. If a worker cannot start, or stops answering, the page thinks for itself on a shorter budget.

## Run locally

Browsers will not load JavaScript modules from `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>. The tests run in the browser at <http://localhost:8000/tests.html>.

## Deploy to GitHub Pages

In the repository go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` and `/ (root)`. The game is served at <https://menaechmus.github.io/ConnectFour/>.

## Releasing

Before pushing a change, raise `VERSION` and `RELEASED` at the top of `js/ui.js`. The About box shows them, which makes it easy to tell when a browser is still running a cached copy of an earlier release. Wi-Fi also compares `VERSION`, so two phones on different releases cannot play each other.

## Layout

| File | What it holds |
|---|---|
| `index.html`, `css/style.css` | The page and its styles |
| `js/game.js` | The rules: the board, turns, wins, draws, take-backs and the match, as a plain match object and the actions that change it |
| `js/board.js` | Board geometry: where each cell sits, and the shapes of the plate and its holes |
| `js/engine.js` | The search: positions as bits, threats, the table of positions seen, and choosing a move |
| `js/ai.js` | The computer's four levels and its hints |
| `js/worker.js`, `js/thinker.js` | The computer's thinking off the page's thread, and the page's side of that |
| `js/stats.js` | Lifetime statistics |
| `js/sound.js` | Sound effects, generated with the Web Audio API (no audio files) |
| `js/fanfare.js` | The win fanfare: a generated brass ensemble with timpani, as in Cribbage |
| `js/celebrate.js` | Fireworks and confetti for a win, as in Cribbage |
| `js/net.js` | Connections between phones for a Wi-Fi game: a room under a four-letter code, and links that carry messages (through PeerJS, or between the tabs of one browser for testing), as in Cribbage |
| `js/wifi.js` | A Wi-Fi game between two phones: seats, what each phone is sent, and the messages between the host and the other |
| `js/vendor/` | PeerJS, and its licence |
| `js/ui.js` | Drawing, input, animation, Wi-Fi games and storage |
| `tests.html` | Tests for the rules, take-backs, the search, the computer, Wi-Fi games, statistics, the celebration and sound; `?only=engine` runs just one group |
