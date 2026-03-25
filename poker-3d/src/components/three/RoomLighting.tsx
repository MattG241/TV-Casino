'use client'
import { useRef } from 'react'
import { SpotLight } from 'three'

export function RoomLighting() {
  const spotRef = useRef<SpotLight>(null)

  return (
    <>
      {/* Ambient fill - very dim casino atmosphere */}
      <ambientLight intensity={0.15} color="#8090b0" />

      {/* Main overhead spotlight (like a casino table lamp) */}
      <spotLight
        ref={spotRef}
        position={[0, 10, 0]}
        angle={0.5}
        penumbra={0.6}
        intensity={40}
        color="#fff5e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.001}
      />

      {/* Secondary warm fill from side */}
      <pointLight position={[6, 5, 4]} intensity={8} color="#ff9944" distance={15} decay={2} />
      <pointLight position={[-6, 5, -4]} intensity={6} color="#ff9944" distance={15} decay={2} />

      {/* Cool rim light from behind */}
      <pointLight position={[0, 3, -8]} intensity={4} color="#4488ff" distance={12} decay={2} />

      {/* Hanging lamp above table */}
      <group position={[0, 7, 0]}>
        {/* Lamp shade */}
        <mesh>
          <coneGeometry args={[1.2, 0.6, 32, 1, true]} />
          <meshStandardMaterial color="#2a1a10" roughness={0.8} metalness={0.3} side={2} />
        </mesh>
        {/* Inner reflective surface */}
        <mesh>
          <coneGeometry args={[1.15, 0.55, 32, 1, true]} />
          <meshStandardMaterial color="#d4a843" roughness={0.3} metalness={0.7} side={1} />
        </mesh>
        {/* Cord */}
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 3, 8]} />
          <meshStandardMaterial color="#333" roughness={0.9} />
        </mesh>
        {/* Bulb glow */}
        <pointLight position={[0, -0.2, 0]} intensity={5} color="#fff5e0" distance={3} decay={2} />
      </group>

      {/* Subtle warm underglow from table felt */}
      <pointLight position={[0, 0.5, 0]} intensity={1} color="#0d6e2e" distance={3} decay={2} />
    </>
  )
}
