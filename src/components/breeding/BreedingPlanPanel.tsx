'use client';

import { ListOrdered, TriangleAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import KamasDisplay from '@/components/ui/KamasDisplay';
import StableCountField from '@/components/breeding/StableCountField';
import { formatHours } from '@/lib/utils/date';
import type { PlannedColor } from '@/lib/hooks/useBreeding';
import type { Wave } from '@/lib/dofus/breeding/waves';
import type { BulkStock } from '@/lib/dofus/breeding/stable';

/**
 * La marche à suivre pour produire une couleur, étape par étape.
 *
 * Le classement dit *quoi* élever ; ce panneau dit *comment*. Les deux ne
 * peuvent pas être le même écran : un muldo de génération 10 demande une
 * centaine d'exemplaires répartis sur une vingtaine de couleurs, ce qui ne tient
 * pas dans une ligne de tableau.
 *
 * Le plan affiché n'est jamais figé. Il se recalcule à chaque saisie d'écurie,
 * ce qui est la seule façon honnête de tenir compte de l'aléa : un croisement
 * échoue souvent, et une liste d'étapes cochées une à une mentirait dès le
 * premier échec. Ici, ce qui reste à faire est toujours « ce que je vise, moins
 * ce que j'ai ».
 */

type Props = {
  planned: PlannedColor;
  colorName: string;
  /** Nom lisible d'une couleur, le plan ne portant que des identifiants. */
  nameOf: (colorId: string) => string;
  /** Génération d'une couleur : décide si elle se compte ou se suit une par une. */
  generationOf: (colorId: string) => number;
  stockBySex: Map<string, BulkStock>;
  onSaveBulk: (colorId: string, males: number, females: number) => Promise<void>;
  /** Enclos possédés, pour traduire les heures d'enclos en délai réel. */
  enclosCount: number;
  /** L'objectif, qui est un plancher : le plan peut en produire davantage. */
  targetCount: number;
  /**
   * Le programme des fournées, remplissage compris.
   *
   * Recalculé par la page plutôt que repris du plan : la couleur qui occupe les
   * places libres se lit sur le classement, que le plan ne connaît pas.
   */
  waves: Wave[] | null;
  selected: boolean;
  onSelect: () => void;
  onAbandon: () => void;
};

const STRATEGY_LABEL = { buy: 'acheter', capture: 'capturer' } as const;

const BreedingPlanPanel = ({
  planned,
  colorName,
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
}: Props) => {
  const { plan, duration, gaugeNeeds, funding } = planned;

  /**
   * Ce qu'on possède déjà de cette couleur, mâles et femelles distingués.
   *
   * Le libellé est porté par le champ lui-même plutôt que par un en-tête de
   * colonne : les lignes n'en ont pas, et renvoyer le lecteur vers « la colonne
   * de droite » désignait quelque chose qui n'existait pas à l'écran.
   */
  const countField = (colorId: string) => (
    <StableCountField
      colorId={colorId}
      generation={generationOf(colorId)}
      stockBySex={stockBySex}
      onSaveBulk={onSaveBulk}
    />
  );

  const done = plan.steps.length === 0 && plan.purchases.length === 0;
  const missingFuel = gaugeNeeds.filter((need) => need.cost > 0);
  const cashNeeded = funding?.cashNeeded ?? plan.totalCost;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ListOrdered size={14} className="text-kamas" />
        <span className="text-xs font-semibold text-dark-200">
          Plan pour {colorName}
        </span>

        {selected ? (
          <button
            type="button"
            onClick={onAbandon}
            className="ml-auto text-[11px] text-dark-500 hover:text-loss transition-colors
              cursor-pointer"
          >
            Ce plan est sélectionné — l&apos;abandonner
          </button>
        ) : (
          <Button size="sm" className="ml-auto" onClick={onSelect}>
            Suivre ce plan
          </Button>
        )}
      </div>

      <p className="text-[11px] text-dark-600">
        Renseigne le champ « j&apos;en ai » au bout de chaque ligne : le plan se recalcule et ne
        demande que ce qui manque. Ne compte que les montures <strong>fertiles</strong>.
      </p>

      {funding && !funding.affordable && (
        <p className="flex items-start gap-2 text-[11px] text-amber-400/90">
          <TriangleAlert size={13} className="shrink-0 mt-px" />
          <span>
            Budget dépassé de {Math.round(funding.shortfall).toLocaleString('fr-FR')} kamas
            {funding.blockedAt &&
              ` — ça coince ${
                funding.blockedAt.kind === 'purchase' ? "à l'achat de" : 'au croisement de'
              } ${nameOf(funding.blockedAt.colorId)}`}
            . Réduis l&apos;objectif, ou vends avant d&apos;en arriver là.
          </span>
        </p>
      )}

      {done ? (
        <p className="text-xs text-profit">
          Plus rien à produire : l&apos;écurie couvre l&apos;objectif.
        </p>
      ) : (
        <>
          {plan.purchases.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">Montures de base à se procurer</p>
              <div className="space-y-1">
                {plan.purchases.map((purchase) => (
                  <div
                    key={purchase.colorId}
                    className="flex items-center gap-3 text-xs px-3 py-2 rounded-xl bg-dark-800/40"
                  >
                    <span className="text-dark-200 flex-1 truncate">
                      {nameOf(purchase.colorId)}
                    </span>
                    <span className="text-dark-500 shrink-0">
                      gen {purchase.generation} · {STRATEGY_LABEL[purchase.strategy]}
                    </span>
                    <span className="text-dark-100 font-medium shrink-0 w-12 text-right">
                      ×{purchase.count}
                    </span>
                    <span className="shrink-0 w-24 text-right">
                      <KamasDisplay
                        amount={Math.round(purchase.count * purchase.unitCost)}
                        size="sm"
                      />
                    </span>
                    {countField(purchase.colorId)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.steps.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">Croisements, dans l&apos;ordre</p>
              <div className="space-y-1">
                {plan.steps.map((step, index) => (
                  <div
                    key={step.colorId}
                    className="flex items-start gap-3 text-xs px-3 py-2 rounded-xl bg-dark-800/40"
                  >
                    <span className="text-dark-600 shrink-0 w-5">{index + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-dark-200 truncate">
                        {step.recipe.map(nameOf).join('  +  ')}
                        <span className="text-dark-500"> → </span>
                        <span className="text-dark-100 font-medium">{nameOf(step.colorId)}</span>
                      </p>
                      <p className="text-[10px] text-dark-500 mt-0.5">
                        gen {step.generation} · parents niveau {step.parentLevel} ·{' '}
                        {Math.round(step.successRate * 100)} % de réussite
                        {step.useOptimakina && ' · Optimakina'}
                        {step.owned > 0 && ` · ${step.owned} déjà en écurie`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-dark-100 font-medium">×{step.count}</p>
                      {/* Les tentatives, pas les bébés : c'est le nombre de fois
                          qu'il faut réellement accoupler, ratés compris. */}
                      <p className="text-[10px] text-dark-500">
                        {step.attempts} accouplement{step.attempts > 1 ? 's' : ''}
                      </p>
                    </div>
                    {countField(step.colorId)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Le programme, qui est la seule vue qui réponde à « qu'est-ce que
              je lance maintenant ». La liste de croisements ci-dessus dit
              combien ; celle-ci dit dans quel ordre l'écurie le permet. */}
          {waves && waves.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">
                Programme des fournées — {waves.length} tour{waves.length > 1 ? 's' : ''} de
                cycles, {enclosCount * 10} places par tour
              </p>
              <div className="space-y-1">
                {waves.map((wave) => (
                  <div key={wave.index} className="text-xs px-3 py-2 rounded-xl bg-dark-800/40">
                    <div className="flex items-center gap-3">
                      <span className="text-dark-600 shrink-0 w-16">Vague {wave.index}</span>
                      <span className="text-dark-200 flex-1 truncate">
                        {nameOf(wave.target.colorId)}{' '}
                        <span className="text-dark-500">×{wave.target.crossings}</span> —{' '}
                        {wave.target.mounts} places
                      </span>
                      <span className="text-dark-500 shrink-0">
                        {wave.used}/{wave.capacity}
                      </span>
                    </div>

                    {/* Les places libres sont du carburant déjà payé : les
                        occuper ne coûte que les parents qu'on y met. */}
                    {wave.filler && (
                      <p className="text-[10px] text-dark-500 mt-1 pl-[4.75rem]">
                        + {wave.filler.mounts} places libres :{' '}
                        <span className="text-dark-300">{nameOf(wave.filler.colorId)}</span> ×
                        {wave.filler.crossings}
                      </p>
                    )}

                    {wave.clonings.length > 0 && (
                      <p className="text-[10px] text-dark-500 mt-0.5 pl-[4.75rem]">
                        puis cloner —{' '}
                        {wave.clonings
                          .map((clone) => `${clone.count} × ${nameOf(clone.colorId)}`)
                          .join(', ')}{' '}
                        pour réarmer la vague suivante
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {missingFuel.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">
                Carburant à prévoir, réserve déduite
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-dark-500">
                {missingFuel.map((need) => (
                  <span key={need.gauge}>
                    {need.gauge} :{' '}
                    <strong className="text-dark-200">
                      {Math.round(need.points - need.covered).toLocaleString('fr-FR')} pts
                    </strong>{' '}
                    ({Math.round(need.cost).toLocaleString('fr-FR')} kamas, {need.fuel})
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-dark-500 pt-1">
        <span>
          Total : <strong className="text-dark-200">{plan.crossings} accouplements</strong>
        </span>
        {/* L'écart avec l'objectif se dit, sinon un « ×11 » demandé à 10 passe
            pour une erreur de calcul — c'est au contraire du gratuit. */}
        {plan.targetProduced > targetCount && (
          <span>
            Produites :{' '}
            <strong className="text-dark-200">{plan.targetProduced}</strong> pour {targetCount}{' '}
            demandées — la dernière fournée part pleine, à carburant et délai constants
          </span>
        )}
        {/* `cashNeeded` est écrasé à 0 dès que les génétons et la réserve de
            carburant remboursent plus que le plan ne coûte. Afficher « 0 kamas »
            se lit alors « c'est gratuit » là où la vérité est « c'est
            remboursé » — deux choses différentes, et la seconde mérite d'être
            dite en toutes lettres. */}
        <span>
          À débourser :{' '}
          <strong className="text-dark-200">
            {cashNeeded > 0
              ? `${Math.round(cashNeeded).toLocaleString('fr-FR')} kamas`
              : 'rien — génétons et réserve couvrent la dépense'}
          </strong>
        </span>
        {/* Une consigne, pas une dépense : l'appairage ne coûte ni enclos ni
            carburant, mais sans lui le plan manque de parents. */}
        {plan.clonings > 0 && (
          <span>
            Clonages à faire :{' '}
            <strong className="text-dark-200">{plan.clonings}</strong> — gratuits, deux
            stériles de même rang donnent un fertile
          </span>
        )}
        {plan.genetons > 0 && (
          <span>
            Génétons rendus :{' '}
            <strong className="text-dark-200">
              {plan.genetons} ({Math.round(plan.genetonCredit).toLocaleString('fr-FR')} kamas,
              déduits)
            </strong>
          </span>
        )}
        {/* Ces bébés-là existent mais ne sont pas déduits : leur valeur dépend
            de la répartition des couleurs à l'échec, qui reste à confirmer en
            jeu. Le coût affiché est donc un majorant. */}
        {plan.offTargetBabies > 0 && (
          <span>
            Bébés hors cible : <strong className="text-dark-200">{plan.offTargetBabies}</strong>,
            non déduits
          </span>
        )}
        {duration ? (
          <>
            <span>
              Enclos mobilisés :{' '}
              <strong className="text-dark-200">
                {formatHours(duration.enclosHours)} · {duration.batches} fournées
              </strong>
            </span>
            <span>
              Délai sur {enclosCount} enclos :{' '}
              <strong className="text-dark-200">{formatHours(duration.wallClockHours)}</strong>
            </span>
          </>
        ) : (
          <span className="text-amber-400/80">
            Durées indisponibles — il manque le prix d&apos;un carburant.
          </span>
        )}
      </div>
    </div>
  );
};

export default BreedingPlanPanel;
