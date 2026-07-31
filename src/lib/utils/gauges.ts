import { DofusDBItem } from '@/lib/supabase/types';

export interface GaugeInfo {
  gaugeName: string;
  rechargeAmount: number;
  capAmount: number;
}

// Matches French descriptions like:
// "Ce carburant permet de recharger la jauge de Baffeur d'un enclos de 5000 sans dépasser 90 000."
// The "sans dépasser" clause is absent on the top (Élixir) tier, whose fixed amount is already the cap:
// "Ce carburant permet de recharger la jauge de Baffeur d'un enclos de 5000."
// Gauge names starting with a vowel are elided — "la jauge d'Abreuvoir d'un enclos de 3000" — so
// both "de " and "d'" have to be accepted before the name.
const GAUGE_DESCRIPTION_RE =
  /recharger la jauge d(?:e |['’])([^\d]+?) d['’]un enclos de ([\d\s  ]+?)(?:\s*sans dépasser ([\d\s  ]+))?\s*\./i;

const parseNumber = (raw: string) => parseInt(raw.replace(/[\s  ]/g, ''), 10);

const parseEnclosGaugeInfo = (descriptionFr: string | undefined): GaugeInfo | null => {
  if (!descriptionFr) return null;
  const match = descriptionFr.match(GAUGE_DESCRIPTION_RE);
  if (!match) return null;

  const rechargeAmount = parseNumber(match[2]);
  return {
    gaugeName: match[1].trim(),
    rechargeAmount,
    capAmount: match[3] ? parseNumber(match[3]) : rechargeAmount,
  };
};

// effectId 110 ("Rend X Points de Vie") and 139 ("Rend X points d'énergie") are the generic
// heal/energy effects shared by every edible item (Pain, Friandise, Poisson comestible...). In the
// élevage minigame, feeding one of these to a paddock's animal refills its PV/Énergie gauge by the
// same amount — e.g. "Briochette" restores 70 PV, "Borodinski" restores 390 Énergie.
const SIMPLE_EFFECT_GAUGES: { effectId: number; gaugeName: string }[] = [
  { effectId: 110, gaugeName: 'PV' },
  { effectId: 139, gaugeName: 'Énergie' },
];

const parseSimpleEffectInfo = (effects: DofusDBItem['effects']): GaugeInfo | null => {
  for (const { effectId, gaugeName } of SIMPLE_EFFECT_GAUGES) {
    const effect = effects?.find((e) => e.effectId === effectId);
    if (!effect) continue;

    const amount = effect.to > effect.from ? Math.round((effect.from + effect.to) / 2) : effect.from;
    if (!amount) continue;

    return { gaugeName, rechargeAmount: amount, capAmount: amount };
  }
  return null;
};

export const parseGaugeInfo = (item: Pick<DofusDBItem, 'description' | 'effects'>): GaugeInfo | null =>
  parseEnclosGaugeInfo(item.description?.fr) ?? parseSimpleEffectInfo(item.effects);

export const computeValuePerKama = (rechargeAmount: number, price: number) =>
  price > 0 ? rechargeAmount / price : 0;
