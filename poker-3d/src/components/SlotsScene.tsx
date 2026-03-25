'use client'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { SlotMachine } from './three/SlotMachine'
import { useSlotsStore } from '@/lib/slots-store'
import { useGameStore } from '@/lib/store'

function CasinoFloor() {
  return (
    <>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1a0f0a" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 5, -4]}>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#0a0510" roughness={1} />
      </mesh>

      {/* Neon accents on wall */}
      <mesh position={[-4, 6, -3.9]}>
        <boxGeometry args={[0.1, 2, 0.05]} />
        <meshStandardMaterial color="#8e44ad" emissive="#8e44ad" emissiveIntensity={1} />
      </mesh>
      <mesh position={[4, 6, -3.9]}>
        <boxGeometry args={[0.1, 2, 0.05]} />
        <meshStandardMaterial color="#c0392b" emissive="#c0392b" emissiveIntensity={1} />
      </mesh>
    </>
  )
}

function SlotsLighting() {
  return (
    <>
      <ambientLight intensity={0.2} color="#8090b0" />
      <spotLight position={[0, 8, 4]} angle={0.5} penumbra={0.5} intensity={30}
        color="#fff5e0" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[5, 4, 3]} intensity={6} color="#ff6644" distance={10} decay={2} />
      <pointLight position={[-5, 4, 3]} intensity={6} color="#4466ff" distance={10} decay={2} />
      <pointLight position={[0, 2, 6]} intensity={4} color="#d4a843" distance={8} decay={2} />
    </>
  )
}

export function SlotsScene() {
  const gameState = useSlotsStore(s => s.gameState)
  const myId = useGameStore(s => s.myId)

  const myResult = gameState?.results?.[myId || '']
  const isSpinning = gameState?.phase === 'spinning'
  const isWinner = myResult?.totalWin ? myResult.totalWin > 0 : false

  const reels = useMemo(() => {
    if (myResult?.reels) return myResult.reels
    return null
  }, [myResult])

  return (
    <div className="absolute inset-0">
      <Canvas shadows gl={{ antialias: true, alpha: false }}>
        <PerspectiveCamera makeDefault position={[0, 2, 7]} fov={50} />
        <OrbitControls
          target={[0, 1.5, 0]}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={4}
          maxDistance={12}
          enablePan={false}
        />

        <Suspense fallback={null}>
          <SlotsLighting />
          <Environment preset="night" background={false} />
          <fog attach="fog" args={['#050510', 10, 30]} />

          <CasinoFloor />
          <SlotMachine reels={reels} spinning={isSpinning} isWinner={isWinner} />

          <ContactShadows position={[0, -0.49, 0]} opacity={0.5} scale={12} blur={2} far={4} />
        </Suspense>
      </Canvas>
    </div>
  )
}
