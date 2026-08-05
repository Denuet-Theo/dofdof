'use client';

import { useState } from 'react';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ColorPriceInputs from '@/components/breeding/ColorPriceInputs';
import BreedingPlanPanel from '@/components/breeding/BreedingPlanPanel';
import { formatHours } from '@/lib/utils/date';
import { HDV_TAX_RATE } from '@/lib/dofus/breeding/costs';
import type { BreedingRow } from '@/lib/hooks/useBreeding';
import type { Wave } from '@/lib/dofus/breeding/waves';
import type { BulkStock } from '@/lib/dofus/breeding/stable';

/** Ce que dit la stratégie retenue, en un mot et une couleur. */
const STRATEGY_LABEL = {
  buy: { label: 'Acheter', className: 'bg-dark-700/60 text-dark-300' },
  capture: { label: 'Capturer', className: 'bg-sky-500/15 text-sky-300' },
  breed: { label: 'Élever', className: 'bg-kamas/15 text-kamas' },
} as const;

/** Étiquette courte, pour l'en-tête de colonne. */
const EXIT_SHORT = {
  sell0: 'vente niv 0',
  sell200: 'vente niv 200',
  sacrifice: 'extraction',
} as const;

const EXIT_LABEL = {
  sell0: 'revendre le poulain',
  sell200: 'monter au 200 puis revendre',
  sacrifice: 'extraire',
} as const;

type Props = {
  row: BreedingRow;
  nameOf: (colorId: string) => string;
  generationOf: (colorId: string) => number;
  stockBySex: Map<string, BulkStock>;
  onSaveBulk: (colorId: string, males: number, females: number) => Promise<void>;
  enclosCount: number;
  /** L'objectif, qui est un plancher : le plan peut en produire davantage. */
  targetCount: number;
  /** Le programme des fournées, pour le seul plan suivi. */
  waves: Wave[] | null;
  /** Le plan sélectionné, s'il porte sur cette couleur. */
  selected: boolean;
  onSelect: () => void;
  onAbandon: () => void;
  onSavePrice: (colorId: string, mountLevel: 0 | 200, price: number) => Promise<boolean>;
};

const ColorRow = ({
  row,
  nameOf,
  generationOf,
  stockBySex,
  onSaveBulk,
  enclosCount,
  targetCount,
  waves,
  selected,
  onSelect,
  onAbandon,
  onSavePrice,
}: Props) => {
  // Le plan sélectionné s'ouvre d'emblée : c'est celui qu'on vient consulter.
  const [open, setOpen] = useState(selected);

  // `useState` ne lit sa valeur initiale qu'au montage, or la ligne est déjà
  // affichée quand on clique « Optimiser » : sans ce rattrapage, sélectionner un
  // plan ne l'ouvrait pas, et depuis que la sélection masque les autres couleurs
  // cela laisserait l'écran sur une unique ligne repliée. On ajuste pendant le
  // rendu plutôt que dans un effet, qui afficherait d'abord l'état périmé.
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    // À la sélection seulement : abandonner un plan ne doit pas refermer la
    // ligne sous les yeux de qui vient de le faire.
    if (selected) setOpen(true);
  }
  const { estimate } = row;
  const strategy = estimate.strategy ? STRATEGY_LABEL[estimate.strategy] : null;

  // La marge suit la sortie retenue — vente ou extraction — et non la seule
  // vente niveau 0 : sans revente, celle-ci est nulle par construction et
  // afficherait « prix manquant » sur toute la liste.
  //
  // Sur une couleur qu'on élève, elle se compte contre le coût **du plan** et
  // non contre celui d'un exemplaire isolé. Les deux diffèrent d'un ordre de
  // grandeur en haute génération, où produire une monture en demande une
  // centaine : afficher l'un à côté du rendement horaire, qui dérive de
  // l'autre, donnerait deux chiffres de signes contraires sur la même ligne.
  const margin = row.planMargin ?? estimate.bestMargin;
  /**
   * Le coût de **tout le processus**, dans la même unité que le gain net.
   *
   * Les deux sont des totaux. Le prix d'une monture prise isolément n'intéresse
   * personne sur un objectif qu'on ne poursuit qu'une fois, et le poser à côté
   * d'un total rendait la ligne impossible à lire.
   */
  const planCost = row.planTotalCost;
  /**
   * Le prix de vente par monture à partir duquel tout le processus est
   * remboursé, taxe d'hôtel de vente comprise.
   *
   * C'est le chiffre qu'un éleveur cherche quand il **fixe** son prix plutôt
   * que de subir le marché : « ça m'a coûté deux millions, je vendrai trois ».
   * Le savoir sur une couleur que personne ne cote est même le seul moyen d'en
   * annoncer un prix qui tienne.
   *
   * Divisé par les montures réellement produites : remplir la dernière fournée
   * en rend parfois quelques-unes de plus, et elles se vendent aussi.
   */
  const produced = row.planned?.plan.targetProduced ?? targetCount;
  const floorPrice =
    planCost !== null && planCost > 0 && produced > 0
      ? planCost / (produced * (1 - HDV_TAX_RATE))
      : null;

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer
          hover:bg-dark-800/40 transition-colors"
      >
        <ChevronRight
          size={16}
          className={`text-dark-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-dark-100 truncate">{row.name}</span>
            <span className="text-[10px] text-dark-500 shrink-0">gen {row.generation}</span>
            {estimate.strategy === 'breed' && !estimate.verified && (
              <span
                title="Ce chemin passe par une recette extraite d'un site tiers, non recoupée en jeu."
                className="shrink-0"
              >
                <TriangleAlert size={13} className="text-amber-400/80" />
              </span>
            )}
          </div>
          {estimate.strategy === 'breed' && estimate.parents && (
            <p className="text-[11px] text-dark-500 mt-0.5">
              parents niveau {estimate.parents.level} ·{' '}
              {Math.round(estimate.parents.successRate * 100)} % de réussite
              {estimate.parents.useOptimakina && ' · Optimakina'}
              {row.planned && ` · ${row.planned.plan.crossings} accouplements`}
              {row.planned?.duration &&
                ` · ${formatHours(row.planned.duration.wallClockHours)}`}
              {row.planned?.funding && !row.planned.funding.affordable && (
                <span className="text-amber-400/80"> · hors budget</span>
              )}
            </p>
          )}
        </div>

        {/* Un coût négatif est exact — les génétons, l'extraction et les bébés
            hors cible peuvent dépasser la dépense — mais « coût : −190 495 » ne
            se lit pas. On retourne la phrase plutôt que le signe : ce n'est plus
            un coût, c'est une recette, et il faut le dire avec ce mot-là. */}
        {/* Le coût du **plan** quand il y en a un, et non l'estimation par
            exemplaire : le gain net se compte déjà sur `plan.totalCost`, donc
            afficher l'autre base laissait deux chiffres irréconciliables côte à
            côte — 295 K de coût en face de 2 M de perte. Pour une couleur qu'on
            achète ou qu'on capture, il n'y a pas de plan et `estimate.cost` est
            justement son prix. */}
        {/* Le coût de tout le processus, pas d'une monture : c'est la question
            qu'on se pose devant l'écran, et c'est aussi la seule unité qui se
            compare au gain net, qui en est déjà un. */}
        <div className="text-right shrink-0 w-32">
          <p
            className="text-[10px] text-dark-500"
            title={`Ce que coûte l'ensemble du processus — tous les croisements, achats et captures, génétons et extractions déduits${produced > 1 ? `, pour les ${produced} montures que le plan produit` : ''}. Négatif quand les recettes dépassent la dépense.`}
          >
            {(planCost ?? 0) < 0 ? 'Rapporte en tout' : 'Coût total'}
            {produced > 1 && <span className="text-dark-600"> ×{produced}</span>}
          </p>
          {planCost === null ? (
            <p className="text-sm text-dark-600">—</p>
          ) : planCost < 0 ? (
            <p className="text-sm font-semibold text-profit">
              +{Math.round(-planCost).toLocaleString('fr-FR')}
            </p>
          ) : (
            <KamasDisplay amount={Math.round(planCost)} size="sm" />
          )}
        </div>

        {/* Le prix à battre. Un éleveur qui vise une couleur que personne ne
            cote ne subit pas le marché, il le fait : ce qu'il lui faut, c'est le
            seuil au-dessus duquel il gagne. */}
        <div className="text-right shrink-0 w-32 hidden md:block">
          <p
            className="text-[10px] text-dark-500"
            title="Le prix de vente, par monture, à partir duquel tout le processus est remboursé — les 2 % de taxe de l'hôtel de vente compris. Vends au-dessus et tu gagnes."
          >
            Vendre au-dessus de
          </p>
          {floorPrice === null ? (
            <p className="text-sm text-dark-600">—</p>
          ) : (
            <p className="text-sm font-semibold text-dark-100">
              {Math.round(floorPrice).toLocaleString('fr-FR')}
            </p>
          )}
        </div>

        <div className="text-right shrink-0 w-32">
          <p
            className="text-[10px] text-dark-500"
            title={`Ce que la meilleure sortie rapporte — ici ${EXIT_LABEL[estimate.bestExit]} — moins ce que la monture t'a coûté à te procurer. Compté contre le coût d'acquisition et non contre le coût d'élevage : ce qu'une couleur rapporte ne dépend pas de la voie par laquelle tu l'as obtenue.`}
          >
            Gain net ({EXIT_SHORT[estimate.bestExit]})
          </p>
          {margin === null ? (
            // Plus « prix manquant » : depuis que la marge se compte contre le
            // coût d'acquisition, l'absence vient d'une couleur qu'on ne sait ni
            // acheter, ni capturer, ni élever — pas d'un prix de vente absent.
            <p className="text-sm text-dark-600">coût inconnu</p>
          ) : (
            <p className={`text-sm font-semibold ${margin > 0 ? 'text-profit' : 'text-loss'}`}>
              {margin > 0 ? '+' : ''}
              {Math.round(margin).toLocaleString('fr-FR')}
            </p>
          )}
        </div>

        {/* La marge horaire, qui est le vrai classement : une gen 10 rapporte
            plus qu'une gen 6 parce qu'elle demande plus de travail, pas parce
            qu'elle est meilleure. Seul le rapport au temps d'enclos les
            départage. */}
        <div className="text-right shrink-0 w-28 hidden sm:block">
          <p
            className="text-[10px] text-dark-500"
            title="Le gain net divisé par les heures d'enclos que le plan mobilise. C'est le seul classement comparable entre générations : une gen 10 rapporte plus qu'une gen 6 parce qu'elle demande plus de travail, pas parce qu'elle est meilleure."
          >
            Par heure d&apos;enclos
          </p>
          {row.marginPerHour === null ? (
            <p className="text-sm text-dark-600">{estimate.strategy === 'breed' ? '—' : 'immédiat'}</p>
          ) : (
            <p
              className={`text-sm font-semibold ${
                row.marginPerHour > 0 ? 'text-profit' : 'text-loss'
              }`}
            >
              {row.marginPerHour > 0 ? '+' : ''}
              {Math.round(row.marginPerHour).toLocaleString('fr-FR')}
            </p>
          )}
        </div>

        {strategy && (
          <span className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium ${strategy.className}`}>
            {strategy.label}
          </span>
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-dark-700/40 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
            <div className="md:col-span-1">
              <p className="text-dark-500 mb-2">Prix à l&apos;hôtel de vente</p>
              <ColorPriceInputs
                colorId={row.colorId}
                level0={estimate.priceLevel0}
                level200={estimate.priceLevel200}
                onSave={onSavePrice}
              />
            </div>
            <div>
              <p className="text-dark-500 mb-1">Meilleure sortie</p>
              <p className="text-dark-200">{EXIT_LABEL[estimate.bestExit]}</p>
            </div>
            <div>
              <p className="text-dark-500 mb-1">Extraction</p>
              <p className="text-dark-200">
                {estimate.sacrificeUnits === 0
                  ? 'impossible en gen 1'
                  : `${estimate.sacrificeUnits} ressources`}
              </p>
            </div>
          </div>

          {estimate.breedRecipe && (
            <div className="text-xs">
              <p className="text-dark-500 mb-1">Recette retenue</p>
              <p className="text-dark-200">
                {estimate.breedRecipe.map(nameOf).join('  +  ')}
                {estimate.genetons > 0 && (
                  <span className="text-dark-500"> · {estimate.genetons} génétons</span>
                )}
              </p>
            </div>
          )}

          {row.source === 'site' && estimate.strategy === 'breed' && (
            <p className="text-[11px] text-amber-400/80">
              Recette extraite d&apos;un site tiers, non recoupée en jeu.
            </p>
          )}

          {/* Le plan complet ne s'ouvre que pour les couleurs qu'on élève :
              acheter une couleur n'a pas d'étapes. */}
          {row.planned && (
            <div className="pt-3 border-t border-dark-700/40">
              <BreedingPlanPanel
                planned={row.planned}
                colorName={row.name}
                nameOf={nameOf}
                generationOf={generationOf}
                stockBySex={stockBySex}
                onSaveBulk={onSaveBulk}
                enclosCount={enclosCount}
                targetCount={targetCount}
                waves={waves}
                selected={selected}
                onSelect={onSelect}
                onAbandon={onAbandon}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ColorRow;
