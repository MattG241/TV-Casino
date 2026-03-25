'use client'
import { Card } from '@/lib/store'
import { Card3D } from './Card3D'

interface CommunityCardsProps {
  cards: Card[]
  phase: string
}

export function CommunityCards({ cards, phase }: CommunityCardsProps) {
  if (!cards || cards.length === 0) return null

  return (
    <group position={[0, 0.3, 0]}>
      {cards.map((card, i) => {
        // Spread cards across the center of the table
        const x = (i - 2) * 0.55
        const delay = phase === 'flop' && i < 3 ? i * 150 :
                     phase === 'turn' && i === 3 ? 0 :
                     phase === 'river' && i === 4 ? 0 : 0
        return (
          <Card3D
            key={`community-${i}-${card.rank}-${card.suit}`}
            card={card}
            faceUp={true}
            position={[x, 0.02, 0]}
            delay={delay}
            scale={1.1}
          />
        )
      })}
    </group>
  )
}
