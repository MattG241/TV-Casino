'use client'
import { useRef } from 'react'
import { Mesh } from 'three'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'

export function PokerTable() {
  const feltRef = useRef<Mesh>(null)

  return (
    <group position={[0, 0, 0]}>
      {/* Table base / pedestal */}
      <mesh position={[0, -0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.2, 1.5, 0.5, 32]} />
        <meshStandardMaterial color="#2a1810" roughness={0.7} metalness={0.3} />
      </mesh>

      {/* Table rim - dark wood */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[4.6, 4.6, 0.25, 64]} />
        <meshStandardMaterial color="#3a2215" roughness={0.5} metalness={0.2} />
      </mesh>

      {/* Wood rail / bumper */}
      <mesh position={[0, 0.30, 0]} castShadow>
        <torusGeometry args={[4.35, 0.18, 16, 64]} />
        <meshStandardMaterial color="#4a2a18" roughness={0.4} metalness={0.3} />
      </mesh>

      {/* Padded rail (leather) */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <torusGeometry args={[4.35, 0.14, 12, 64]} />
        <meshStandardMaterial color="#1a1a28" roughness={0.8} metalness={0.05} />
      </mesh>

      {/* Felt surface */}
      <mesh ref={feltRef} position={[0, 0.28, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[4.2, 64]} />
        <meshStandardMaterial
          color="#0d6e2e"
          roughness={0.95}
          metalness={0}
          envMapIntensity={0.1}
        />
      </mesh>

      {/* Felt decorative lines - inner oval */}
      <mesh position={[0, 0.285, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.0, 3.05, 64]} />
        <meshStandardMaterial color="#0a5a25" roughness={0.9} transparent opacity={0.6} />
      </mesh>

      {/* Center line decorations */}
      <mesh position={[0, 0.285, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 1.25, 64]} />
        <meshStandardMaterial color="#0a5a25" roughness={0.9} transparent opacity={0.4} />
      </mesh>

      {/* Dealer button area marker */}
      <mesh position={[0, 0.286, 2.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.15, 32]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} transparent opacity={0.15} />
      </mesh>

      {/* Gold trim rings */}
      <mesh position={[0, 0.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.15, 4.2, 64]} />
        <meshStandardMaterial color="#d4a843" roughness={0.3} metalness={0.8} />
      </mesh>
    </group>
  )
}
