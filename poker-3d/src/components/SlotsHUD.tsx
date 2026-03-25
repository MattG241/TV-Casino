'use client'
import { useState, useCallback, useMemo } from 'react'
import { useSlotsStore } from '@/lib/slots-store'
import { useGameStore } from '@/lib/store'

const SYMBOL_MAP: Record<string, string> = {
  cherry: '🍒', lemon: '🍋', orange: '🍊', plum: '🍇',
  bell: '🔔', bar: '📊', seven: '7️⃣', diamond: '💎', wild: '⭐'
}

interface SlotsHUDProps {
  onBet: (amount: number) => void
  onFreeSpin: () => void
}

export function SlotsHUD({ onBet, onFreeSpin }: SlotsHUDProps) {
  const gameState = useSlotsStore(s => s.gameState)
  const myId = useGameStore(s => s.myId)
  const myChips = useGameStore(s => s.myChips)
  const players = useGameStore(s => s.players)
  const [betAmount, setBetAmount] = useState(10)

  if (!gameState) return null

  const phase = gameState.phase
  const myResult = gameState.results?.[myId || '']
  const myBet = gameState.bets?.[myId || '']
  const freeSpins = gameState.freeSpins?.[myId || ''] || 0
  const betCount = Object.keys(gameState.bets).length
  const totalPlayers = players.length

  // Other players results
  const otherResults = Object.entries(gameState.results)
    .filter(([pid]) => pid !== myId)
    .map(([pid, r]) => ({ player: players.find(p => p.id === pid), result: r }))

  // Leaderboard
  const lb = Object.entries(gameState.leaderboard)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, net]) => ({ player: players.find(p => p.id === pid), net }))

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      {/* Top bar */}
      <div className="flex justify-between items-start gap-3">
        {/* Jackpot */}
        <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                        border border-yellow-500/30 shadow-xl shadow-yellow-500/5">
          <div className="text-[9px] text-yellow-400/60 uppercase tracking-widest">Jackpot</div>
          <div className="text-xl font-black text-yellow-400 font-mono">
            ${gameState.jackpot.toLocaleString()}
          </div>
          <div className="text-[8px] text-white/30">3x 💎 middle line</div>
        </div>

        {/* Round info */}
        <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                        border border-white/10 shadow-xl text-center">
          <div className="text-[9px] text-white/40 uppercase tracking-widest">Round</div>
          <div className="text-lg font-bold text-white">{gameState.roundNumber}</div>
          {gameState.timer && phase === 'betting' && (
            <div className={`text-sm font-mono ${gameState.timer <= 5 ? 'text-red-400' : 'text-white/60'}`}>
              {gameState.timer}s
            </div>
          )}
        </div>

        {/* Chips */}
        <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                        border border-white/10 shadow-xl">
          <div className="text-[9px] text-white/40 uppercase tracking-widest">Chips</div>
          <div className="text-lg font-bold text-yellow-400 font-mono">${myChips.toLocaleString()}</div>
        </div>
      </div>

      {/* Middle area: results */}
      {phase === 'results' && myResult && (
        <div className="flex justify-center animate-fade-in">
          <div className={`pointer-events-auto px-6 py-4 rounded-2xl border-2 shadow-2xl backdrop-blur-md max-w-md w-full
            ${myResult.totalWin > 0
              ? 'bg-green-900/70 border-green-400/50 shadow-green-500/20'
              : 'bg-gray-900/60 border-white/10'}`}>

            {myResult.jackpotWin && (
              <div className="text-3xl font-black text-center text-yellow-300 animate-pulse-slow mb-2">
                🎰 JACKPOT +${myResult.jackpotAmount}! 🎰
              </div>
            )}

            {myResult.totalWin > 0 ? (
              <div className="text-center">
                <div className="text-2xl font-black text-green-300">
                  WIN +${myResult.totalWin}!
                </div>
                <div className="text-sm text-green-400/80 mt-1">
                  {myResult.paylines.length} payline{myResult.paylines.length > 1 ? 's' : ''} hit
                </div>
                <div className="mt-2 space-y-1">
                  {myResult.paylines.map((pl, i) => (
                    <div key={i} className="text-xs text-green-400/60">
                      Line {pl.lineIdx + 1}: {pl.symbols.map(s => SYMBOL_MAP[s]).join(' ')} → {pl.multiplier}x (${pl.win})
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-lg font-bold text-center text-white/50">No win this round</div>
            )}

            {myResult.freeSpinsWon > 0 && (
              <div className="text-center text-yellow-300 font-bold mt-2">
                🎁 Won {myResult.freeSpinsWon} Free Spins!
              </div>
            )}

            {/* Other players results */}
            {otherResults.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
                {otherResults.map(({ player: p, result: r }, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-white/60">{p?.name || 'Player'}</span>
                    <span className={r.totalWin > 0 ? 'text-green-400' : 'text-white/30'}>
                      {r.totalWin > 0 ? `+$${r.totalWin}` : 'No win'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'spinning' && (
        <div className="flex justify-center">
          <div className="text-2xl font-black text-yellow-400 animate-pulse-slow">
            🎰 SPINNING... 🎰
          </div>
        </div>
      )}

      {/* Bottom: betting controls */}
      <div className="flex flex-col items-center gap-2">
        {/* Leaderboard strip */}
        {lb.length > 0 && (
          <div className="pointer-events-auto flex gap-4 bg-black/50 backdrop-blur-md rounded-xl px-4 py-2 border border-white/5">
            {lb.map(({ player: p, net }, i) => (
              <div key={i} className="text-center">
                <div className="text-xs">{['🥇','🥈','🥉'][i] || `${i+1}.`}</div>
                <div className="text-[10px] font-bold text-white/80">{p?.name || '?'}</div>
                <div className={`text-[10px] font-mono ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {net >= 0 ? '+' : ''}{net}
                </div>
              </div>
            ))}
          </div>
        )}

        {phase === 'betting' && (
          <div className="pointer-events-auto animate-fade-in flex flex-col items-center gap-2 w-full max-w-lg">
            {freeSpins > 0 && (
              <button
                onClick={onFreeSpin}
                className="w-full py-3 rounded-xl font-black text-lg bg-gradient-to-r from-purple-600 to-purple-500
                           text-white shadow-lg shadow-purple-500/20"
              >
                🎁 USE FREE SPIN ({freeSpins} left)
              </button>
            )}

            <div className="flex gap-2">
              {[5, 10, 25, 50, 100].map(v => (
                <button
                  key={v}
                  onClick={() => setBetAmount(v)}
                  className={`w-12 h-12 rounded-full font-bold text-sm transition-all
                    ${betAmount === v
                      ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30 scale-110'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
                >
                  ${v}
                </button>
              ))}
            </div>

            <button
              onClick={() => onBet(betAmount)}
              disabled={!!myBet}
              className={`w-full py-4 rounded-xl font-black text-lg uppercase tracking-wider shadow-lg
                ${myBet
                  ? 'bg-gray-700 text-gray-400'
                  : 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-black hover:from-yellow-500 hover:to-yellow-400 shadow-yellow-500/20'}`}
            >
              {myBet ? `BET PLACED ($${myBet}) — WAITING...` : `BET $${betAmount} & SPIN!`}
            </button>

            <div className="text-xs text-white/40">
              {betCount}/{totalPlayers} ready
              {gameState.timer ? ` • ${gameState.timer}s` : ''}
              {' • 5 paylines • wilds ⭐'}
            </div>
          </div>
        )}

        {phase === 'results' && (
          <div className="text-sm text-white/40 animate-pulse-slow">Next round starting soon...</div>
        )}
      </div>
    </div>
  )
}
