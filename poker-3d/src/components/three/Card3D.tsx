'use client'
import { useRef, useMemo, useState, useEffect } from 'react'
import { Mesh, CanvasTexture, DoubleSide } from 'three'
import { useFrame } from '@react-three/fiber'
import { Card } from '@/lib/store'

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
}

const SUIT_COLORS: Record<string, string> = {
  hearts: '#c0392b',
  diamonds: '#c0392b',
  clubs: '#1a1a2e',
  spades: '#1a1a2e',
}

function createCardTexture(card: Card): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 384
  const ctx = canvas.getContext('2d')!

  // White background with rounded corners
  ctx.fillStyle = '#fafafa'
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 376, 12)
  ctx.fill()

  // Border
  ctx.strokeStyle = '#ddd'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 376, 12)
  ctx.stroke()

  const color = SUIT_COLORS[card.suit] || '#000'
  const symbol = SUIT_SYMBOLS[card.suit] || ''

  // Top-left rank
  ctx.fillStyle = color
  ctx.font = 'bold 38px Georgia, serif'
  ctx.textAlign = 'left'
  ctx.fillText(card.rank, 18, 50)

  // Top-left suit
  ctx.font = '32px serif'
  ctx.fillText(symbol, 20, 82)

  // Center suit (large)
  ctx.font = '100px serif'
  ctx.textAlign = 'center'
  ctx.fillText(symbol, 128, 220)

  // Rank repeated in center
  ctx.font = 'bold 48px Georgia, serif'
  ctx.fillText(card.rank, 128, 280)

  // Bottom-right (rotated)
  ctx.save()
  ctx.translate(238, 346)
  ctx.rotate(Math.PI)
  ctx.font = 'bold 38px Georgia, serif'
  ctx.textAlign = 'left'
  ctx.fillText(card.rank, 0, 38)
  ctx.font = '32px serif'
  ctx.fillText(symbol, 2, 70)
  ctx.restore()

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createCardBackTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 384
  const ctx = canvas.getContext('2d')!

  // Dark blue background
  ctx.fillStyle = '#1a237e'
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 376, 12)
  ctx.fill()

  // Diamond pattern
  ctx.strokeStyle = '#283593'
  ctx.lineWidth = 1
  for (let x = 0; x < 256; x += 20) {
    for (let y = 0; y < 384; y += 20) {
      ctx.beginPath()
      ctx.moveTo(x + 10, y)
      ctx.lineTo(x + 20, y + 10)
      ctx.lineTo(x + 10, y + 20)
      ctx.lineTo(x, y + 10)
      ctx.closePath()
      ctx.stroke()
    }
  }

  // Inner border
  ctx.strokeStyle = '#d4a843'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(16, 16, 224, 352, 8)
  ctx.stroke()

  // Center logo
  ctx.fillStyle = '#d4a843'
  ctx.font = 'bold 36px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('\u2660', 128, 180)
  ctx.fillText('\u2665', 128, 220)

  // Outer gold border
  ctx.strokeStyle = '#d4a843'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(6, 6, 244, 372, 11)
  ctx.stroke()

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

let _backTexture: CanvasTexture | null = null
function getBackTexture(): CanvasTexture {
  if (!_backTexture) _backTexture = createCardBackTexture()
  return _backTexture
}

interface Card3DProps {
  card?: Card | null
  faceUp?: boolean
  position: [number, number, number]
  rotation?: [number, number, number]
  delay?: number
  scale?: number
}

export function Card3D({ card, faceUp = true, position, rotation = [0, 0, 0], delay = 0, scale = 1 }: Card3DProps) {
  const meshRef = useRef<Mesh>(null)
  const [visible, setVisible] = useState(delay === 0)
  const [currentY, setCurrentY] = useState(position[1] + 2)
  const [currentRotX, setCurrentRotX] = useState(-Math.PI / 2)

  const frontTexture = useMemo(() => {
    if (card && faceUp) return createCardTexture(card)
    return null
  }, [card, faceUp])

  const backTexture = useMemo(() => getBackTexture(), [])

  useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(() => setVisible(true), delay)
      return () => clearTimeout(timer)
    }
    setVisible(true)
  }, [delay])

  useFrame((_, delta) => {
    if (!meshRef.current || !visible) return

    // Animate drop-in
    const targetY = position[1]
    const diff = targetY - currentY
    const newY = currentY + diff * Math.min(1, delta * 8)
    setCurrentY(newY)
    meshRef.current.position.y = newY

    // Animate rotation (flip)
    const targetRotX = faceUp ? 0 : Math.PI
    const rotDiff = targetRotX - currentRotX
    const newRot = currentRotX + rotDiff * Math.min(1, delta * 6)
    setCurrentRotX(newRot)
  })

  if (!visible) return null

  const cardWidth = 0.45 * scale
  const cardHeight = 0.65 * scale
  const cardDepth = 0.01

  return (
    <group position={[position[0], currentY, position[2]]} rotation={[rotation[0], rotation[1], rotation[2]]}>
      {/* Card body */}
      <mesh ref={meshRef} castShadow>
        <boxGeometry args={[cardWidth, cardDepth, cardHeight]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0} />
      </mesh>

      {/* Front face */}
      <mesh position={[0, cardDepth / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
        <planeGeometry args={[cardWidth - 0.01, cardHeight - 0.01]} />
        {frontTexture ? (
          <meshStandardMaterial map={frontTexture} roughness={0.4} metalness={0} side={DoubleSide} />
        ) : (
          <meshStandardMaterial map={backTexture} roughness={0.4} metalness={0} side={DoubleSide} />
        )}
      </mesh>

      {/* Back face */}
      <mesh position={[0, -cardDepth / 2 - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cardWidth - 0.01, cardHeight - 0.01]} />
        <meshStandardMaterial map={backTexture} roughness={0.4} metalness={0} side={DoubleSide} />
      </mesh>
    </group>
  )
}
