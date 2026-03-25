'use client'
import { useState, useCallback, useMemo } from 'react'
import { useGameStore } from '@/lib/store'

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
}

interface GameHUDProps {
  onAction: (action: string, amount?: number) => void
}

export function GameHUD({ onAction }: GameHUDProps) {
  const gameState = useGameStore(s => s.gameState)
  const myId = useGameStore(s => s.myId)
  const myChips = useGameStore(s => s.myChips)
  const players = useGameStore(s => s.players)
  const [raiseAmount, setRaiseAmount] = useState(40)

  const isMyTurn = useMemo(() => {
    if (!gameState || !myId) return false
    return gameState.turnOrder[gameState.currentTurn] === myId
  }, [gameState, myId])

  const isFolded = useMemo(() => {
    return gameState?.foldedPlayers?.includes(myId || '') || false
  }, [gameState, myId])

  const isResult = gameState?.phase === 'result' || gameState?.phase === 'showdown'

  const myRoundBet = gameState?.roundBets?.[myId || ''] || 0
  const toCall = (gameState?.currentBet || 0) - myRoundBet
  const bigBlind = gameState?.bigBlind || 20
  const minRaise = (gameState?.currentBet || 0) + bigBlind
  const maxRaise = myChips + myRoundBet

  const handleAction = useCallback((action: string) => {
    if (action === 'raise') {
      onAction('raise', raiseAmount)
    } else {
      onAction(action)
    }
  }, [onAction, raiseAmount])

  if (!gameState) return null

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      {/* Top bar - Phase info */}
      <div className="flex justify-between items-start">
        <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                        border border-white/10 shadow-xl">
          <div className="text-[10px] text-white/40 uppercase tracking-widest">Phase</div>
          <div className="text-lg font-bold text-white capitalize">{gameState.phase}</div>
        </div>

        {/* Your hand display */}
        {gameState.myHand && gameState.myHand.length > 0 && (
          <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                          border border-yellow-500/30 shadow-xl shadow-yellow-500/5">
            <div className="text-[10px] text-yellow-400/60 uppercase tracking-widest mb-1">Your Hand</div>
            <div className="flex gap-2">
              {gameState.myHand.map((card, i) => (
                <div key={i} className={`bg-white rounded-md px-2 py-1 text-center min-w-[36px]
                  ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'text-red-600' : 'text-gray-900'}
                  font-bold text-sm shadow-md`}>
                  {card.rank}{SUIT_SYMBOLS[card.suit]}
                </div>
              ))}
            </div>
            {isResult && gameState.handResults?.[myId || ''] && (
              <div className="text-[10px] text-yellow-400 mt-1 text-center">
                {gameState.handResults[myId || ''].name}
              </div>
            )}
          </div>
        )}

        <div className="pointer-events-auto bg-black/70 backdrop-blur-md rounded-xl px-4 py-2
                        border border-white/10 shadow-xl">
          <div className="text-[10px] text-white/40 uppercase tracking-widest">Your Chips</div>
          <div className="text-lg font-bold text-yellow-400 font-mono">${myChips.toLocaleString()}</div>
        </div>
      </div>

      {/* Result banner */}
      {isResult && (
        <div className="flex justify-center animate-fade-in">
          <div className={`pointer-events-auto px-8 py-4 rounded-2xl border-2 shadow-2xl backdrop-blur-md
            ${gameState.winner === myId
              ? 'bg-green-900/70 border-green-400/50 shadow-green-500/20'
              : 'bg-red-900/50 border-red-500/30 shadow-red-500/10'}`}>
            <div className={`text-2xl font-black text-center
              ${gameState.winner === myId ? 'text-green-300' : 'text-red-300'}`}>
              {gameState.winner === myId
                ? `YOU WIN $${gameState.pot}!`
                : `${players.find(p => p.id === gameState.winner)?.name || 'Opponent'} wins`}
            </div>
            {gameState.winner && gameState.handResults?.[gameState.winner] && (
              <div className="text-sm text-center text-yellow-300 mt-1">
                {gameState.handResults[gameState.winner].name}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="flex flex-col items-center gap-3">
        {isFolded && !isResult && (
          <div className="pointer-events-auto bg-gray-800/70 backdrop-blur-md px-6 py-3 rounded-xl
                          border border-gray-600/30 text-gray-400 font-bold">
            You Folded - Watching...
          </div>
        )}

        {!isResult && !isFolded && !isMyTurn && (
          <div className="pointer-events-auto bg-black/60 backdrop-blur-md px-6 py-3 rounded-xl
                          border border-white/10 text-white/60">
            Waiting for {players.find(p => p.id === gameState.turnOrder?.[gameState.currentTurn])?.name || '...'}
            {players.find(p => p.id === gameState.turnOrder?.[gameState.currentTurn])?.isAI ? ' [AI]' : ''}
          </div>
        )}

        {isMyTurn && !isResult && (
          <div className="pointer-events-auto animate-fade-in flex flex-col items-center gap-2 w-full max-w-lg">
            {/* YOUR TURN indicator */}
            <div className="text-yellow-400 font-black text-lg animate-pulse-slow tracking-wider">
              YOUR TURN
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap justify-center">
              <button className="btn-action btn-fold" onClick={() => handleAction('fold')}>
                FOLD
              </button>

              {toCall > 0 ? (
                <button className="btn-action btn-call" onClick={() => handleAction('call')}>
                  CALL ${toCall}
                </button>
              ) : (
                <button className="btn-action btn-check" onClick={() => handleAction('check')}>
                  CHECK
                </button>
              )}

              {maxRaise > minRaise && (
                <button className="btn-action btn-raise" onClick={() => handleAction('raise')}>
                  RAISE ${raiseAmount}
                </button>
              )}

              <button className="btn-action btn-allin" onClick={() => handleAction('allin')}>
                ALL IN
              </button>
            </div>

            {/* Raise slider */}
            {maxRaise > minRaise && (
              <div className="flex items-center gap-3 w-full max-w-sm bg-black/60 backdrop-blur-md
                              rounded-xl px-4 py-2 border border-white/10">
                <span className="text-xs text-white/40 font-mono">${minRaise}</span>
                <input
                  type="range"
                  min={minRaise}
                  max={maxRaise}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-yellow-400 font-mono font-bold">${raiseAmount}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
