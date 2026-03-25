'use client'
import dynamic from 'next/dynamic'
import { useGameStore } from '@/lib/store'
import { useSocket } from '@/hooks/useSocket'
import { Lobby } from '@/components/Lobby'
import { GameHUD } from '@/components/GameHUD'

// Dynamic import for Three.js scene (avoid SSR)
const PokerScene = dynamic(() => import('@/components/PokerScene').then(m => ({ default: m.PokerScene })), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a]">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse-slow">♠ ♥ ♦ ♣</div>
        <div className="text-white/40 text-sm">Loading 3D Poker...</div>
      </div>
    </div>
  ),
})

export default function Home() {
  const screen = useGameStore(s => s.screen)
  const gameState = useGameStore(s => s.gameState)
  const { createRoom, joinRoom, startPoker, pokerAction, confirmReady } = useSocket()

  if (screen === 'lobby' || !gameState) {
    return (
      <main className="w-full h-screen relative">
        <Lobby
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onStartPoker={startPoker}
          onConfirmReady={confirmReady}
        />
      </main>
    )
  }

  return (
    <main className="w-full h-screen relative overflow-hidden">
      <PokerScene />
      <GameHUD onAction={pokerAction} />
    </main>
  )
}
