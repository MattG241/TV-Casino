# Race Day

Horse racing betting game — bet on your phone, watch on TV.

## How to Play

1. Open the TV view on your big screen (`/tv` route)
2. Players scan the QR code or enter the room code on their phones
3. When everyone's in, hit "START RACING"
4. Place bets on horses — win, place, or trifecta
5. Watch the race unfold on the TV with 3D graphics and live commentary

## Features

- Real-time multiplayer via Socket.IO
- 3D horse racing with Three.js on TV display
- AI jockey decision-making with different riding styles
- Dynamic odds that shift based on betting pool
- Multiple bet types: Win, Place, Trifecta
- Detailed form guide with career stats
- Track conditions and barrier draws
- Text-to-speech race commentary
- Chromecast / Fire TV compatible

## Setup

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`  
TV display at `http://localhost:3000/tv`
