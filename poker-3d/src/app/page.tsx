'use client'
import dynamic from 'next/dynamic'
import { useGameStore } from '@/lib/store'
import { useSlotsStore } from '@/lib/slots-store'
import { useSocket } from '@/hooks/useSocket'
import { Lobby } from '@/components/Lobby'
import { GameHUD } from '@/components/GameHUD'
import { SlotsHUD } from '@/components/SlotsHUD'

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a]">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse-slow">{text === 'Loading 3D Slots...' ? '🎰' : '♠ ♥ ♦ ♣'}</div>
        <div className="text-white/40 text-sm">{text}</div>
      </div>
    </div>
  )
}

const PokerScene = dynamic(() => import('@/components/PokerScene').then(m => ({ default: m.PokerScene })), {
  ssr: false,
  loading: () => <LoadingScreen text="Loading 3D Poker..." />,
})

const SlotsScene = dynamic(() => import('@/components/SlotsScene').then(m => ({ default: m.SlotsScene })), {
  ssr: false,
  loading: () => <LoadingScreen text="Loading 3D Slots..." />,
})

export default function Home() {
  const screen = useGameStore(s => s.screen)
  const currentGame = useGameStore(s => s.currentGame)
  const { createRoom, joinRoom, startGame, pokerAction, slotsBet, slotsFreeSpin, confirmReady } = useSocket()

  const isInGame = screen === 'game' && currentGame

  if (!isInGame) {
    return (
      <main className="w-full h-screen relative">
        <Lobby
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onStartGame={startGame}
          onConfirmReady={confirmReady}
        />
      </main>
    )
  }

  if (currentGame === 'slots') {
    return (
      <main className="w-full h-screen relative overflow-hidden">
        <SlotsScene />
        <SlotsHUD onBet={slotsBet} onFreeSpin={slotsFreeSpin} />
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
