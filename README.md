# TV Casino

A multiplayer mobile casino game you play on your phone and cast to your TV in real-time.

## Games
- **Roulette** - Bet on numbers, colors, odds/evens, and dozens
- **Slots** - Pull the lever on a weighted 3-reel slot machine
- **Blackjack** - Classic 21 against the dealer, multiplayer
- **Poker** - Texas Hold'em with blinds and full betting rounds
- **Horse Racing** - Pick a horse and watch them race

## How to Play

### Setup
```bash
npm install
npm start
```

### Connect
1. **Create a room** on your phone at `http://<your-ip>:3000`
2. **Open TV view** on your TV/Chromecast at `http://<your-ip>:3000/tv?room=XXXX`
3. **Share the room code** with friends so they can join from their phones

### Chromecast
Open the TV URL (`/tv?room=CODE`) in a Chrome tab, then cast that tab to your Chromecast. The TV shows the shared game view while each player controls from their phone.

## Architecture
- **Server**: Node.js + Express + Socket.IO for real-time multiplayer
- **Mobile UI**: Touch-optimized responsive web app
- **TV Display**: Full-screen presentation view with animations
- Players get 1,000 chips to start, up to 8 players per room
