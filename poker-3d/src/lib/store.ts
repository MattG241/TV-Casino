import { create } from 'zustand'

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'
  rank: string
}

export interface Player {
  id: string
  name: string
  chips: number
  isHost: boolean
  avatar: number
  isAI: boolean
}

export interface PokerState {
  phase: string
  community: Card[]
  pot: number
  currentBet: number
  currentTurn: number
  turnOrder: string[]
  activePlayers: string[]
  foldedPlayers: string[]
  roundBets: Record<string, number>
  winner: string | null
  allHands: Record<string, Card[]> | null
  handResults: Record<string, { rank: number; name: string }> | null
  dealerIdx: number
  bigBlind: number
  myHand: Card[] | null
}

interface GameStore {
  // Connection
  connected: boolean
  myId: string | null
  myName: string
  roomCode: string | null
  screen: 'lobby' | 'game'
  currentGame: string | null

  // Players
  players: Player[]

  // Game
  gameState: PokerState | null
  myChips: number

  // Actions
  setConnected: (v: boolean) => void
  setMyId: (id: string) => void
  setMyName: (name: string) => void
  setRoomCode: (code: string) => void
  setScreen: (s: 'lobby' | 'game') => void
  setCurrentGame: (g: string | null) => void
  setPlayers: (p: Player[]) => void
  setGameState: (s: PokerState | null) => void
  setMyChips: (c: number) => void
}

export const useGameStore = create<GameStore>((set) => ({
  connected: false,
  myId: null,
  myName: '',
  roomCode: null,
  screen: 'lobby',
  currentGame: null,
  players: [],
  gameState: null,
  myChips: 1000,

  setConnected: (v) => set({ connected: v }),
  setMyId: (id) => set({ myId: id }),
  setMyName: (name) => set({ myName: name }),
  setRoomCode: (code) => set({ roomCode: code }),
  setScreen: (s) => set({ screen: s }),
  setCurrentGame: (g) => set({ currentGame: g }),
  setPlayers: (p) => set({ players: p }),
  setGameState: (s) => set({ gameState: s }),
  setMyChips: (c) => set({ myChips: c }),
}))
