'use client';

import { useMemo, useState } from 'react';
import { ListOrdered, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import KamasDisplay from '@/components/ui/KamasDisplay';
import { useBreedingProject } from '@/lib/hooks/useBreedingProject';
import { formatHours } from '@/lib/utils/date';
import type { FamilyId, MakePlan } from '@/lib/hooks/useBreeding';

/**
 * La marche à suivre pour produire une couleur, étape par étape.
 *
 * Le classement dit *quoi* élever ; ce panneau dit *comment*. Les deux ne
 * peuvent pas être le même écran : un muldo de génération 10 demande une
 * centaine d'exemplaires répartis sur une vingtaine de couleurs, ce qui ne tient
 * pas dans une ligne de tableau.
 *
 * Le plan affiché n'est jamais figé. Il se recalcule à chaque saisie de stock,
 * ce qui est la seule façon honnête de tenir compte de l'aléa : un croisement
 * échoue souvent, et une liste d'étapes cochées une à une mentirait dès le
 * premier échec. Ici, ce qui reste à faire est toujours « ce que je vise, moins
 * ce que j'ai ».
 */

type Props = {
  family: FamilyId;
  colorId: string;
  colorName: string;
  /** Nom lisible d'une couleur, le plan ne portant que des identifiants. */
  nameOf: (colorId: string) => string;
  makePlan: MakePlan;
  /** Enclos possédés, pour traduire les heures d'enclos en délai réel. */
  enclosCount: number;
  /** Panneau replié : rien à charger. */
  open: boolean;
};

const STRATEGY_LABEL = { buy: 'acheter', capture: 'capturer' } as const;

const BreedingPlanPanel = ({
  family,
  colorId,
  colorName,
  nameOf,
  makePlan,
  enclosCount,
  open,
}: Props) => {
  const { project, stock, loading, start, setTargetCount, setStock, abandon } =
    useBreedingProject(family, colorId, open);

  // Sans projet, on montre quand même le plan : c'est ce qui permet de décider
  // s'il vaut la peine d'être lancé.
  const [draftCount, setDraftCount] = useState(1);
  const targetCount = project?.target_count ?? draftCount;

  const planned = useMemo(
    () => makePlan(colorId, targetCount, project ? stock : undefined),
    [makePlan, colorId, targetCount, project, stock]
  );

  if (!planned) return null;
  const { plan, duration } = planned;

  const countField = (value: number, onChange: (next: number) => void, max = 999) => (
    <input
      type="number"
      min={0}
      max={max}
      value={String(value)}
      onChange={(event) => onChange(Math.max(0, Math.min(max, Number(event.target.value) || 0)))}
      className="w-16 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
        text-dark-100 text-xs text-right transition-all hover:border-dark-500
        focus:border-kamas/50"
    />
  );

  const done = plan.steps.length === 0 && plan.purchases.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ListOrdered size={14} className="text-kamas" />
        <span className="text-xs font-semibold text-dark-200">Plan d&apos;élevage</span>

        <label className="flex items-center gap-2 text-[11px] text-dark-500">
          Objectif
          {countField(
            targetCount,
            (next) => {
              const count = Math.max(1, next);
              if (project) setTargetCount(count);
              else setDraftCount(count);
            },
            100
          )}
          {colorName}
        </label>

        {project ? (
          <button
            type="button"
            onClick={abandon}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-dark-500
              hover:text-loss transition-colors cursor-pointer"
          >
            <Trash2 size={12} /> Abandonner le suivi
          </button>
        ) : (
          <Button size="sm" className="ml-auto" onClick={() => start(targetCount)}>
            Suivre ce plan
          </Button>
        )}
      </div>

      {loading && <p className="text-[11px] text-dark-600">Chargement du suivi…</p>}

      {project && (
        <p className="text-[11px] text-dark-600">
          Saisis ce que tu possèdes déjà : le plan se recalcule et ne demande que ce qui
          manque. Ne compte que les montures <strong>fertiles</strong> — une monture déjà
          accouplée est stérile, et son recyclage est déjà pris en compte.
        </p>
      )}

      {done ? (
        <p className="text-xs text-profit">
          Plus rien à produire : le stock couvre l&apos;objectif.
        </p>
      ) : (
        <>
          {plan.purchases.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">
                Montures de base à se procurer
              </p>
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
                    {project &&
                      countField(stock.get(purchase.colorId) ?? 0, (next) =>
                        setStock(purchase.colorId, next)
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.steps.length > 0 && (
            <div>
              <p className="text-[11px] text-dark-500 mb-1.5">
                Croisements, dans l&apos;ordre
              </p>
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
                        <span className="text-dark-100 font-medium">
                          {nameOf(step.colorId)}
                        </span>
                      </p>
                      <p className="text-[10px] text-dark-500 mt-0.5">
                        gen {step.generation} · parents niveau {step.parentLevel} ·{' '}
                        {Math.round(step.successRate * 100)} % de réussite
                        {step.useOptimakina && ' · Optimakina'}
                        {step.owned > 0 && ` · ${step.owned} déjà en stock`}
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
                    {project &&
                      countField(stock.get(step.colorId) ?? 0, (next) =>
                        setStock(step.colorId, next)
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-dark-500 pt-1">
        <span>
          Total :{' '}
          <strong className="text-dark-200">{plan.crossings} accouplements</strong>
        </span>
        <span>
          Coût :{' '}
          <strong className="text-dark-200">
            {Math.round(plan.totalCost).toLocaleString('fr-FR')} kamas
          </strong>
        </span>
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
            jeu. Le coût affiché est donc un majorant, et ce nombre dit de
            combien il pourrait baisser. */}
        {plan.offTargetBabies > 0 && (
          <span>
            Bébés hors cible :{' '}
            <strong className="text-dark-200">{plan.offTargetBabies}</strong>, non déduits
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
              <strong className="text-dark-200">
                {formatHours(duration.wallClockHours)}
              </strong>
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
