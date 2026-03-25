'use client'
import { useRef, useMemo } from 'react'
import { Mesh } from 'three'
import { Html } from '@react-three/drei'
import { useGameStore } from '@/lib/store'
import { Card3D } from './Card3D'

// Seat positions around the table (up to 8 seats)
const SEAT_POSITIONS: [number, number, number][] = [
  [0, 0, 3.8],      // Bottom center (player 1 - "you")
  [-2.8, 0, 2.8],   // Bottom left
  [-3.8, 0, 0],     // Left
  [-2.8, 0, -2.8],  // Top left
  [0, 0, -3.8],     // Top center
  [2.8, 0, -2.8],   // Top right
  [3.8, 0, 0],      // Right
  [2.8, 0, 2.8],    // Bottom right
]

const AVATARS = ['😎','🤠','👻','🦊','🐸','🎭','🤖','👾','🦁','🐲','🦄','🎪','🃏','🎰','🌟','🔥']

export function PlayerSeats() {
  const players = useGameStore(s => s.players)
  const gameState = useGameStore(s => s.gameState)
  const myId = useGameStore(s => s.myId)

  // Put "me" at seat 0, others fill remaining seats
  const sortedPlayers = useMemo(() => {
    if (!players.length) return []
    const me = players.find(p => p.id === myId)
    const others = players.filter(p => p.id !== myId)
    return me ? [me, ...others] : players
  }, [players, myId])

  if (!gameState) return null

  return (
    <group>
      {sortedPlayers.map((player, idx) => {
        if (idx >= SEAT_POSITIONS.length) return null
        const pos = SEAT_POSITIONS[idx]
        const isMe = player.id === myId
        const isActive = gameState.turnOrder[gameState.currentTurn] === player.id
        const isFolded = gameState.foldedPlayers?.includes(player.id)
        const isWinner = gameState.winner === player.id
        const isShowdown = gameState.phase === 'result' || gameState.phase === 'showdown'
        const roundBet = gameState.roundBets?.[player.id] || 0
        const hand = isShowdown ? gameState.allHands?.[player.id] : (isMe ? gameState.myHand : null)
        const handResult = isShowdown ? gameState.handResults?.[player.id] : null

        // Card positions (slightly in front of seat, toward center)
        const dirX = -pos[0] * 0.15
        const dirZ = -pos[2] * 0.15
        const cardBaseX = pos[0] + dirX
        const cardBaseZ = pos[2] + dirZ

        return (
          <group key={player.id} position={pos}>
            {/* Seat cushion */}
            <mesh position={[0, -0.3, 0]} castShadow>
              <cylinderGeometry args={[0.4, 0.45, 0.15, 24]} />
              <meshStandardMaterial
                color={isActive ? '#d4a843' : isFolded ? '#333' : '#2a1a10'}
                roughness={0.7}
                metalness={0.2}
                emissive={isActive ? '#d4a843' : isWinner ? '#27ae60' : '#000'}
                emissiveIntensity={isActive ? 0.3 : isWinner ? 0.4 : 0}
              />
            </mesh>

            {/* Player info label (HTML overlay) */}
            <Html position={[0, 0.8, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
              <div className={`text-center whitespace-nowrap px-3 py-1.5 rounded-lg backdrop-blur-md
                ${isActive ? 'bg-yellow-500/30 border border-yellow-400/50 shadow-lg shadow-yellow-500/20' :
                  isWinner ? 'bg-green-500/30 border border-green-400/50 shadow-lg shadow-green-500/20' :
                  isFolded ? 'bg-gray-800/60 border border-gray-600/30' :
                  'bg-black/60 border border-white/10'}
              `}>
                <div className="text-lg leading-none">{AVATARS[player.avatar] || '😎'}</div>
                <div className={`text-xs font-bold ${isMe ? 'text-yellow-300' : 'text-white'}`}>
                  {player.name}{player.isAI ? ' [AI]' : ''}{isMe ? ' (You)' : ''}
                </div>
                <div className="text-[10px] text-yellow-400 font-mono">${player.chips.toLocaleString()}</div>
                {roundBet > 0 && (
                  <div className="text-[10px] text-green-400 font-mono">Bet: ${roundBet}</div>
                )}
                {isFolded && <div className="text-[9px] text-red-400 font-bold">FOLDED</div>}
                {isWinner && <div className="text-[10px] text-green-300 font-bold animate-pulse-slow">WINNER!</div>}
                {handResult && <div className="text-[9px] text-yellow-300">{handResult.name}</div>}
              </div>
            </Html>

            {/* Player cards */}
            {hand && hand.length > 0 && (
              <group position={[dirX, 0.3, dirZ]}>
                <Card3D
                  card={hand[0]}
                  faceUp={isMe || isShowdown}
                  position={[-0.22, 0, 0]}
                  scale={isMe ? 0.9 : 0.7}
                />
                <Card3D
                  card={hand[1]}
                  faceUp={isMe || isShowdown}
                  position={[0.22, 0, 0]}
                  delay={100}
                  scale={isMe ? 0.9 : 0.7}
                />
              </group>
            )}

            {/* Hidden cards for opponents (not showing hand) */}
            {!hand && !isFolded && !isShowdown && (
              <group position={[dirX, 0.3, dirZ]}>
                <Card3D faceUp={false} position={[-0.18, 0, 0]} scale={0.7} />
                <Card3D faceUp={false} position={[0.18, 0, 0]} delay={80} scale={0.7} />
              </group>
            )}

            {/* Bet chip indicator (between seat and center) */}
            {roundBet > 0 && (
              <group position={[dirX * 2.5, 0, dirZ * 2.5]}>
                <mesh position={[0, 0.32, 0]} castShadow>
                  <cylinderGeometry args={[0.12, 0.12, 0.04, 16]} />
                  <meshStandardMaterial
                    color={roundBet >= 100 ? '#1a1a2e' : roundBet >= 50 ? '#27ae60' : '#c0392b'}
                    roughness={0.4}
                    metalness={0.5}
                  />
                </mesh>
                {roundBet >= 40 && (
                  <mesh position={[0, 0.36, 0]} castShadow>
                    <cylinderGeometry args={[0.12, 0.12, 0.04, 16]} />
                    <meshStandardMaterial color="#d4a843" roughness={0.4} metalness={0.5} />
                  </mesh>
                )}
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}
