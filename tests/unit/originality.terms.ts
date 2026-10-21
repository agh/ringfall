/**
 * Names and signature terms of the console shooter franchise Ringfall is
 * inspired by. ADR-0003 forbids them anywhere a reader of the product would
 * see them: code, UI strings, comments, docs, test names, scripts, the
 * journey. Research notes under `docs/research/` are exempt because they
 * cite sources by URL and title.
 *
 * Patterns are case-sensitive proper nouns on purpose: the optical term
 * for a bloom ring and the English words for a small minion or a leader
 * stay usable in lower case. Extend the list here; the test reads it.
 */
export const FRANCHISE_TERMS: readonly RegExp[] = [
  // The franchise, the ring-world term that names it, and the first game
  /\bHalo\b/,
  /\bHALO\b/,
  /halo-feel-and-mlp/,
  /\bCombat Evolved\b/,
  /\bInstallation 04\b/,
  // Studios and the engine
  /\bBungie\b/,
  /\b343 Industries\b/,
  /\bBlam!?\b/,
  // Characters, factions, and species
  /\bMaster Chief\b/,
  /\bSpartans?\b/,
  /\bMjolnir\b/i,
  /\bCortana\b/,
  /\bArbiter\b/,
  /\bthe Covenant\b/,
  /\bForerunners?\b/,
  /\bthe Flood\b/,
  /\bGrunts?\b/,
  /\bElites?\b/,
  /\bJackals?\b/,
  /\bBrutes?\b/,
  /\bSangheili\b/,
  /\bUnggoy\b/,
  /\bUNSC\b/,
  /\bODST\b/,
  /\bPillar of Autumn\b/,
  // Vehicles and weapons
  /\bWarthog\b/,
  /\bBanshee\b/,
  /\bNeedler\b/,
  /\bEnergy Sword\b/,
  /\bPlasma (?:Pistol|Rifle|Grenade)\b/,
  // Shield terminology unique to the franchise
  /\bOvershield\b/i,
  // Fan wiki
  /\bHalopedia\b/,
];
