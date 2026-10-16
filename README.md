# Family Fuel · Halloween Night

A self-contained offline game board for a school Halloween event. It is designed for one teacher with one classroom screen: the teacher can run the host console, or students can keep playing in Self-Run Mode without a dedicated host.
<img width="500" alt="image" src="https://github.com/user-attachments/assets/e4bbe7f9-5237-4ac3-aee2-b7f482c2178a" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/a0ba82f1-ca2f-436d-b5c2-ba0effb583a8" />

## Run it

Double-click `app.html`. No Node, server, account, or internet connection is required. Chrome, Edge, and Firefox are supported.

## Show flow

1. **Team setup** — choose a name and Halloween avatar for each team before the show starts.
2. **Game Board** — the board shows the question, scores, reveal cards, strikes, host artwork, school crest, and the 3D stage background.
3. **Host Console** — edit questions, answer text, scores, team names, round status, countdown, and save files.
4. **Self-Run Mode** — students can reveal answers, mark wrong answers, start the buzz-in timer, and start the next round from the board.
5. **Preset questions** — load ready-to-play school-safe packs for Halloween Party, Campus Night, School Spirit, Snack Table, or Movie Night.
6. **Classroom Rewards** — paste one student per line, set the reward name, mark awards one by one or all at once, then use Quick Start Next Round. Scores and the class list are kept between rounds.

## Shortcuts

- `R` reveal the next answer
- `X` mark a wrong answer
- `N` start the next round
- `Space` switch between the board and host console

## Files

- `app.html` — page structure and two views
- `styles.css` — 3D stage layout, high-DPI responsive sizing, lighting, bulbs, cards, setup screen, and multi-frame effects
- `app.js` — game state, presets, Self-Run Mode, countdown, scoring, classroom rewards, localStorage, and JSON import/export
- `assets/` — locally stored AI-generated stage, host, marquee, reveal, strike, streak, win/lose, and school crest artwork

## Data

Questions, answers, scores, team setup, and the classroom reward queue stay in this browser's local storage. Export a JSON save before changing devices. Importing a save replaces the current local game state.
