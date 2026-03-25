import { create } from 'zustand'
import { Player } from './store'

export interface SlotPayline {
  lineIdx: number
  symbols: string[]
  multiplier: number
  win: number
}

export interface SlotResult {
  reels: string[][]
  paylines: SlotPayline[]
  totalWin: number
  totalMultiplier: number
  betAmount: number
  jackpotWin: boolean
  jackpotAmount: number
  freeSpinsWon: number
  isFreeSpin?: boolean
}

export interface SlotsState {
  phase: 'betting' | 'spinning' | 'results'
  bets: Record<string, number>
  results: Record<string, SlotResult>
  roundNumber: number
  jackpot: number
  timer: number | null
  history: any[]
  leaderboard: Record<string, number>
  bonusRound: boolean
  freeSpins: Record<string, number>
}

interface SlotsStore {
  gameState: SlotsState | null
  setGameState: (s: SlotsState | null) => void
}

export const useSlotsStore = create<SlotsStore>((set) => ({
  gameState: null,
  setGameState: (s) => set({ gameState: s }),
}))
