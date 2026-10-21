/** Regenerating energy shield layered over non-regenerating health. */
export interface Vitality {
  readonly shield: number;
  readonly maxShield: number;
  readonly health: number;
  readonly maxHealth: number;
  /** Simulation time of the last hit taken; recharge waits `rechargeDelay` after it. */
  readonly lastDamageAt: number;
}

export const SHIELD_RECHARGE_DELAY = 4;
export const SHIELD_RECHARGE_RATE = 35;

export const createVitality = (maxShield = 100, maxHealth = 100): Vitality => ({
  shield: maxShield,
  maxShield,
  health: maxHealth,
  maxHealth,
  lastDamageAt: Number.NEGATIVE_INFINITY,
});

export interface DamageOutcome {
  readonly vitality: Vitality;
  /** The shield dropped to zero on this hit. */
  readonly shieldBroken: boolean;
  readonly died: boolean;
}

export const applyDamage = (v: Vitality, amount: number, now: number): DamageOutcome => {
  if (amount <= 0 || v.health <= 0) return { vitality: v, shieldBroken: false, died: false };
  const absorbed = Math.min(v.shield, amount);
  const shield = v.shield - absorbed;
  const health = Math.max(0, v.health - (amount - absorbed));
  return {
    vitality: { ...v, shield, health, lastDamageAt: now },
    shieldBroken: v.shield > 0 && shield === 0,
    died: health === 0,
  };
};

export const tickVitality = (v: Vitality, dt: number, now: number): Vitality => {
  if (v.health <= 0 || v.shield >= v.maxShield) return v;
  if (now - v.lastDamageAt < SHIELD_RECHARGE_DELAY) return v;
  return { ...v, shield: Math.min(v.maxShield, v.shield + SHIELD_RECHARGE_RATE * dt) };
};

export const isDead = (v: Vitality): boolean => v.health <= 0;
