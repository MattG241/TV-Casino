'use client'
import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useGameStore } from '@/lib/store'

const SERVER_URL = typeof window !== 'undefined'
  ? window.location.origin.replace(':3001', ':3000')
  : 'http://localhost:3000'

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  const store = useGameStore()

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => {
      store.setConnected(true)
      console.log('[Socket] Connected:', socket.id)
    })

    socket.on('disconnect', () => {
      store.setConnected(false)
    })

    socket.on('room:created', (data: { code: string; playerId: string }) => {
      store.setRoomCode(data.code)
      store.setMyId(data.playerId)
    })

    socket.on('room:joined', (data: { code: string; playerId: string }) => {
      store.setRoomCode(data.code)
      store.setMyId(data.playerId)
      store.setScreen('game')
    })

    socket.on('players:update', (playerList: any[]) => {
      store.setPlayers(playerList)
      const me = playerList.find(p => p.id === useGameStore.getState().myId)
      if (me) store.setMyChips(me.chips)
    })

    socket.on('game:started', (data: { game: string }) => {
      if (data.game === 'poker') {
        store.setScreen('game')
      }
    })

    socket.on('game:state', (data: { game: string; state: any }) => {
      if (data.game === 'poker') {
        store.setGameState(data.state)
      }
    })

    socket.on('game:error', (data: { message: string }) => {
      console.warn('[Game Error]', data.message)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createRoom = useCallback((name: string) => {
    store.setMyName(name)
    socketRef.current?.emit('room:create', { playerName: name, avatar: 0 })
  }, [store])

  const joinRoom = useCallback((code: string, name: string) => {
    store.setMyName(name)
    socketRef.current?.emit('room:join', { code, playerName: name, avatar: 0 })
  }, [store])

  const startPoker = useCallback(() => {
    socketRef.current?.emit('game:select', { game: 'poker' })
  }, [])

  const pokerAction = useCallback((action: string, amount?: number) => {
    socketRef.current?.emit('poker:action', { action, amount })
  }, [])

  const confirmReady = useCallback(() => {
    socketRef.current?.emit('lobby:everyone-in')
  }, [])

  return { createRoom, joinRoom, startPoker, pokerAction, confirmReady, socket: socketRef }
}
