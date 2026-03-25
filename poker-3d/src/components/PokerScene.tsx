'use client'
import { Canvas } from '@react-three/fiber'
import { Environment, ContactShadows, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Suspense } from 'react'
import { PokerTable } from './three/PokerTable'
import { CommunityCards } from './three/CommunityCards'
import { PlayerSeats } from './three/PlayerSeats'
import { ChipStacks } from './three/ChipStacks'
import { RoomLighting } from './three/RoomLighting'
import { useGameStore } from '@/lib/store'

export function PokerScene() {
  const gameState = useGameStore(s => s.gameState)

  return (
    <div className="absolute inset-0">
      <Canvas shadows gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}>
        <PerspectiveCamera makeDefault position={[0, 8, 7]} fov={45} />
        <OrbitControls
          target={[0, 0.5, 0]}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.5}
          minDistance={6}
          maxDistance={16}
          enablePan={false}
        />

        <Suspense fallback={null}>
          <RoomLighting />

          {/* Casino Room Environment */}
          <Environment preset="night" background={false} />
          <fog attach="fog" args={['#050510', 12, 35]} />

          {/* Room floor */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#1a0f0a" roughness={0.9} metalness={0.1} />
          </mesh>

          {/* Room walls - dark background */}
          <mesh position={[0, 8, -15]}>
            <planeGeometry args={[40, 20]} />
            <meshStandardMaterial color="#0a0510" roughness={1} />
          </mesh>

          {/* Poker Table */}
          <PokerTable />

          {/* Community Cards */}
          {gameState && <CommunityCards cards={gameState.community} phase={gameState.phase} />}

          {/* Player Seats */}
          <PlayerSeats />

          {/* Chip stacks in pot */}
          {gameState && <ChipStacks pot={gameState.pot} />}

          {/* Contact shadows under table */}
          <ContactShadows
            position={[0, -0.49, 0]}
            opacity={0.6}
            scale={15}
            blur={2}
            far={4}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
