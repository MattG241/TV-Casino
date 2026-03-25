'use client'
import { useMemo } from 'react'
import { Html } from '@react-three/drei'

const CHIP_COLORS = ['#c0392b', '#27ae60', '#1a1a2e', '#d4a843', '#8e44ad']

interface ChipStacksProps {
  pot: number
}

export function ChipStacks({ pot }: ChipStacksProps) {
  const chipCount = useMemo(() => {
    if (pot <= 0) return 0
    return Math.min(12, Math.ceil(pot / 50))
  }, [pot])

  if (pot <= 0) return null

  return (
    <group position={[0, 0.28, -0.8]}>
      {/* Pot chips stacked */}
      {Array.from({ length: chipCount }).map((_, i) => (
        <mesh key={i} position={[(i % 4) * 0.15 - 0.22, 0.02 + Math.floor(i / 4) * 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.035, 16]} />
          <meshStandardMaterial
            color={CHIP_COLORS[i % CHIP_COLORS.length]}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
      ))}

      {/* Edge markings on chips */}
      {Array.from({ length: Math.min(4, chipCount) }).map((_, i) => (
        <mesh key={`ring-${i}`} position={[(i % 4) * 0.15 - 0.22, 0.04, 0]}>
          <torusGeometry args={[0.1, 0.005, 8, 24]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.8} transparent opacity={0.5} />
        </mesh>
      ))}

      {/* Pot amount label */}
      <Html position={[0, 0.4, 0]} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="bg-black/80 border border-yellow-500/50 px-3 py-1 rounded-full
                        text-yellow-400 font-mono font-bold text-sm whitespace-nowrap
                        shadow-lg shadow-yellow-500/10">
          POT ${pot.toLocaleString()}
        </div>
      </Html>
    </group>
  )
}
