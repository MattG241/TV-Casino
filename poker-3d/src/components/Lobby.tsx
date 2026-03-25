'use client'
import { useState } from 'react'
import { useGameStore } from '@/lib/store'

interface LobbyProps {
  onCreateRoom: (name: string) => void
  onJoinRoom: (code: string, name: string) => void
  onStartPoker: () => void
  onConfirmReady: () => void
}

export function Lobby({ onCreateRoom, onJoinRoom, onStartPoker, onConfirmReady }: LobbyProps) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu')
  const roomCode = useGameStore(s => s.roomCode)
  const players = useGameStore(s => s.players)
  const myId = useGameStore(s => s.myId)
  const connected = useGameStore(s => s.connected)
  const isHost = players.find(p => p.id === myId)?.isHost

  // Waiting room
  if (roomCode) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#0a0a1a] to-[#0d1a0d]">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 w-[400px] shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-sm text-white/40 uppercase tracking-widest mb-2">Room Code</div>
            <div className="text-5xl font-black text-yellow-400 tracking-[0.3em] font-mono">{roomCode}</div>
          </div>

          <div className="mb-6">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-3">Players ({players.length})</div>
            <div className="space-y-2">
              {players.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-lg">😎</span>
                  <span className="font-bold text-white flex-1">{p.name}</span>
                  <span className="text-xs text-yellow-400 font-mono">${p.chips}</span>
                  {p.isHost && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">HOST</span>}
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="space-y-2">
              <button
                onClick={onStartPoker}
                className="w-full py-3 rounded-xl font-black text-lg uppercase tracking-wider
                           bg-gradient-to-r from-green-600 to-green-500 text-white
                           hover:from-green-500 hover:to-green-400 transition-all
                           shadow-lg shadow-green-500/20"
              >
                Start Poker
              </button>
              <div className="text-center text-[10px] text-white/30">
                {players.length === 1 ? 'AI opponent will join automatically' : `${players.length} players ready`}
              </div>
            </div>
          )}

          {!isHost && (
            <div className="text-center text-white/40 text-sm animate-pulse-slow">
              Waiting for host to start...
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#0a0a1a] to-[#0d1a0d]">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute top-20 left-20 text-[200px] text-green-500 rotate-12">♠</div>
        <div className="absolute bottom-20 right-20 text-[200px] text-red-500 -rotate-12">♥</div>
        <div className="absolute top-40 right-40 text-[150px] text-yellow-500 rotate-45">♦</div>
        <div className="absolute bottom-40 left-40 text-[150px] text-blue-500 -rotate-45">♣</div>
      </div>

      <div className="relative z-10 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 w-[400px] shadow-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black bg-gradient-to-r from-yellow-400 via-yellow-300 to-yellow-500
                         bg-clip-text text-transparent mb-2">
            TV CASINO
          </h1>
          <div className="text-sm text-white/40 tracking-widest uppercase">3D Texas Hold&apos;em</div>
          <div className="flex justify-center gap-2 mt-3 text-2xl">
            <span>♠</span><span className="text-red-500">♥</span>
            <span className="text-yellow-500">♦</span><span>♣</span>
          </div>
        </div>

        {!connected && (
          <div className="text-center text-red-400 text-sm mb-4 animate-pulse-slow">
            Connecting to server...
          </div>
        )}

        {mode === 'menu' && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('create')}
              disabled={!connected}
              className="w-full py-4 rounded-xl font-black text-lg uppercase tracking-wider
                         bg-gradient-to-r from-yellow-600 to-yellow-500 text-black
                         hover:from-yellow-500 hover:to-yellow-400 transition-all
                         shadow-lg shadow-yellow-500/20 disabled:opacity-30"
            >
              Create Room
            </button>
            <button
              onClick={() => setMode('join')}
              disabled={!connected}
              className="w-full py-4 rounded-xl font-black text-lg uppercase tracking-wider
                         bg-gradient-to-r from-white/10 to-white/5 text-white border border-white/20
                         hover:bg-white/15 transition-all disabled:opacity-30"
            >
              Join Room
            </button>
          </div>
        )}

        {(mode === 'create' || mode === 'join') && (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Your Name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={12}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white
                         placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50
                         focus:ring-1 focus:ring-yellow-500/30 font-bold"
            />

            {mode === 'join' && (
              <input
                type="text"
                placeholder="Room Code"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white
                           text-center text-2xl tracking-[0.5em] font-mono font-bold
                           placeholder:text-white/30 placeholder:text-base placeholder:tracking-normal
                           focus:outline-none focus:border-yellow-500/50"
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setMode('menu')}
                className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60
                           hover:bg-white/10 transition-all font-bold"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!name.trim()) return
                  if (mode === 'create') onCreateRoom(name.trim())
                  else if (code.length >= 4) onJoinRoom(code, name.trim())
                }}
                disabled={!name.trim() || (mode === 'join' && code.length < 4)}
                className="flex-1 py-3 rounded-xl font-black text-lg uppercase
                           bg-gradient-to-r from-green-600 to-green-500 text-white
                           hover:from-green-500 hover:to-green-400 transition-all
                           shadow-lg shadow-green-500/20 disabled:opacity-30"
              >
                {mode === 'create' ? 'Create' : 'Join'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
