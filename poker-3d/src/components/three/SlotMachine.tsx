'use client'
import { useRef, useMemo, useState, useEffect } from 'react'
import { Mesh, CanvasTexture, Group } from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'

const SYMBOL_MAP: Record<string, string> = {
  cherry: '🍒', lemon: '🍋', orange: '🍊', plum: '🍇',
  bell: '🔔', bar: '📊', seven: '7️⃣', diamond: '💎', wild: '⭐'
}

function createSymbolTexture(symbol: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0d0d15'
  ctx.fillRect(0, 0, 128, 128)
  ctx.font = '64px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(SYMBOL_MAP[symbol] || '?', 64, 64)
  const tex = new CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

interface SlotReelProps {
  symbols: string[]
  spinning: boolean
  position: [number, number, number]
  delay: number
}

function SlotReel({ symbols, spinning, position, delay }: SlotReelProps) {
  const groupRef = useRef<Group>(null)
  const [spinOffset, setSpinOffset] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [displaySymbols, setDisplaySymbols] = useState(symbols)
  const spinSpeed = useRef(0)

  useEffect(() => {
    if (spinning) {
      const timer = setTimeout(() => {
        setIsSpinning(true)
        spinSpeed.current = 15
      }, delay)
      return () => clearTimeout(timer)
    } else {
      // Stop spinning with deceleration
      if (isSpinning) {
        const stopTimer = setTimeout(() => {
          setIsSpinning(false)
          spinSpeed.current = 0
          setSpinOffset(0)
          setDisplaySymbols(symbols)
        }, delay + 500)
        return () => clearTimeout(stopTimer)
      }
    }
  }, [spinning, symbols, delay, isSpinning])

  useFrame((_, delta) => {
    if (isSpinning && groupRef.current) {
      const newOffset = (spinOffset + spinSpeed.current * delta) % 1
      setSpinOffset(newOffset)
      // Gradually slow down
      if (!spinning && spinSpeed.current > 0) {
        spinSpeed.current = Math.max(0, spinSpeed.current - delta * 20)
      }
    }
  })

  const textures = useMemo(() => {
    return displaySymbols.map(s => createSymbolTexture(s))
  }, [displaySymbols])

  return (
    <group position={position} ref={groupRef}>
      {/* Reel frame */}
      <mesh>
        <boxGeometry args={[0.9, 2.8, 0.15]} />
        <meshStandardMaterial color="#0a0a14" roughness={0.8} metalness={0.2} />
      </mesh>

      {/* Symbol cells */}
      {displaySymbols.map((sym, i) => {
        const y = (1 - i) * 0.85 + (isSpinning ? Math.sin(Date.now() * 0.01 + i) * 0.1 : 0)
        const isMiddle = i === 1
        return (
          <group key={i} position={[0, y, 0.08]}>
            {/* Cell background */}
            <mesh>
              <planeGeometry args={[0.8, 0.75]} />
              <meshStandardMaterial
                color={isMiddle ? '#1a1a0a' : '#0d0d12'}
                emissive={isMiddle ? '#d4a843' : '#000000'}
                emissiveIntensity={isMiddle ? 0.08 : 0}
                roughness={0.9}
              />
            </mesh>
            {/* Symbol */}
            <Html center position={[0, 0, 0.01]} distanceFactor={4} style={{ pointerEvents: 'none' }}>
              <div className={`text-4xl ${isSpinning ? 'blur-sm' : ''} transition-all duration-200`}>
                {isSpinning ? SYMBOL_MAP[['cherry','lemon','diamond','seven','wild'][Math.floor(Math.random()*5)]] : (SYMBOL_MAP[sym] || '?')}
              </div>
            </Html>
          </group>
        )
      })}

      {/* Middle line indicator (gold) */}
      <mesh position={[0, 0, 0.085]}>
        <planeGeometry args={[0.85, 0.02]} />
        <meshStandardMaterial color="#d4a843" emissive="#d4a843" emissiveIntensity={0.5} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.78, 0.085]}>
        <planeGeometry args={[0.85, 0.02]} />
        <meshStandardMaterial color="#d4a843" emissive="#d4a843" emissiveIntensity={0.3} transparent opacity={0.3} />
      </mesh>
      <mesh position={[0, -0.78, 0.085]}>
        <planeGeometry args={[0.85, 0.02]} />
        <meshStandardMaterial color="#d4a843" emissive="#d4a843" emissiveIntensity={0.3} transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

interface SlotMachineProps {
  reels: string[][] | null
  spinning: boolean
  isWinner: boolean
}

export function SlotMachine({ reels, spinning, isWinner }: SlotMachineProps) {
  const defaultReels = [['cherry', 'cherry', 'lemon'], ['lemon', 'diamond', 'orange'], ['orange', 'seven', 'plum']]
  const displayReels = reels || defaultReels

  return (
    <group position={[0, 1.5, 0]}>
      {/* Machine cabinet */}
      <mesh position={[0, 0, -0.15]} castShadow>
        <boxGeometry args={[4.2, 3.8, 0.4]} />
        <meshStandardMaterial
          color="#1a1028"
          roughness={0.6}
          metalness={0.4}
        />
      </mesh>

      {/* Cabinet trim (gold) */}
      <mesh position={[0, 0, -0.14]}>
        <boxGeometry args={[4.3, 3.9, 0.01]} />
        <meshStandardMaterial color="#d4a843" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Top banner */}
      <mesh position={[0, 2.15, 0]}>
        <boxGeometry args={[4, 0.5, 0.2]} />
        <meshStandardMaterial
          color="#8e44ad"
          emissive={isWinner ? '#27ae60' : '#8e44ad'}
          emissiveIntensity={isWinner ? 0.5 : 0.2}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      <Html position={[0, 2.15, 0.15]} center distanceFactor={6} style={{ pointerEvents: 'none' }}>
        <div className="text-xl font-black text-yellow-300 whitespace-nowrap tracking-wider">
          LUCKY SLOTS
        </div>
      </Html>

      {/* Reels */}
      {displayReels.map((reel, i) => (
        <SlotReel
          key={i}
          symbols={reel}
          spinning={spinning}
          position={[(i - 1) * 1.1, 0, 0]}
          delay={i * 200}
        />
      ))}

      {/* Lever */}
      <group position={[2.5, 0.5, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.06, 0.06, 2, 12]} />
          <meshStandardMaterial color="#888" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[0, 1.1, 0]} castShadow>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#c0392b" roughness={0.4} metalness={0.3}
            emissive="#c0392b" emissiveIntensity={0.2} />
        </mesh>
      </group>

      {/* Coin tray */}
      <mesh position={[0, -2.1, 0.1]} castShadow>
        <boxGeometry args={[3.5, 0.3, 0.3]} />
        <meshStandardMaterial color="#2a1a10" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Side decorations */}
      <pointLight position={[-2.2, 1.5, 0.3]} intensity={isWinner ? 3 : 0.5} color={isWinner ? '#27ae60' : '#d4a843'} distance={2} />
      <pointLight position={[2.2, 1.5, 0.3]} intensity={isWinner ? 3 : 0.5} color={isWinner ? '#27ae60' : '#d4a843'} distance={2} />
    </group>
  )
}
