'use client';

import { useMemo, useState } from 'react';
import { Check, ScanSearch, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  censusRoot,
  nextProbe,
  pinned,
  recordAnswer,
  type Axis,
  type CensusNode,
} from '@/lib/dofus/breeding/reconcile';
import type { Facet, RosterEntry, RosterFilters } from '@/lib/dofus/breeding/roster';
import type { Review } from '@/components/breeding/BreedingStockFilters';

/**
 * Le rapprochement avec le jeu : une poignée de questions, et l'écart localisé.
 *
 * ## Pourquoi il n'y a pas d'écran ici
 *
 * Parce qu'il en existe déjà un, et que c'est **le bon** : `BreedingStockFilters`
 * est la copie du panneau FILTRES du jeu, aux mêmes intitulés et dans le même
 * ordre, faite exprès pour qu'on pose les deux écrans côte à côte. Refaire une
 * grille de comparaison à côté aurait donné deux recensements qui finissent par
 * se contredire, et à l'éleveur deux endroits à lire au lieu d'un.
 *
 * Ce composant ne dessine donc qu'une **barre** : la question, et les deux
 * boutons. Tout le reste se passe dans le panneau du dessous, qui change de
 * couleurs sans changer de forme — les valeurs du croisement en cours en
 * **bleu**, les effectifs à confronter en **jaune**.
 *
 * ## Ce que l'éleveur fait, et rien d'autre
 *
 * Il regarde son jeu, il regarde le panneau, et il dit oui ou non. Sur non, les
 * chiffres jaunes deviennent des champs et il recopie ce qu'il voit. Le moteur
 * — `reconcile.ts` — décide de la question suivante et s'arrête dès qu'une
 * cellule tient assez peu pour se lire nom par nom.
 *
 * Le raisonnement, les mesures et le prix de l'élagage sont là-bas. Ici il n'y a
 * que la conversation.
 */

/** L'axe d'une question, traduit dans le vocabulaire des facettes du panneau. */
const FACET_OF: Record<Axis, Facet> = {
  status: 'status',
  sex: 'sex',
  generation: 'generation',
  color: 'color',
};

/** Ce que le panneau doit teinter, et la barre à afficher. */
export type CensusState = {
  review: Review | null;
  bar: React.ReactNode;
};

const SECTION_LABEL: Record<Axis | 'total', string> = {
  total: 'le total',
  status: 'la colonne FERTILITÉ',
  sex: 'la colonne SEXE',
  generation: 'la colonne GÉNÉRATION',
  color: 'la colonne COULEURS',
};

/** La valeur qu'une cellule fixe sur une facette, ou `null` si elle ne la fixe pas. */
const valueOn = (cell: RosterFilters, facet: Facet): string | number | null => {
  if (facet === 'status') return cell.statuses[0] ?? null;
  if (facet === 'sex') return cell.sexes[0] ?? null;
  if (facet === 'generation') return cell.generations[0] ?? null;
  if (facet === 'color') return cell.colorIds[0] ?? null;
  return null;
};

/**
 * Un **hook** et non un composant, parce qu'il rend deux choses qui vivent à
 * deux endroits : la barre de question, et la teinture du panneau de filtres qui
 * est son voisin. Un composant ne peut pas colorer son frère.
 */
const useCensusBar = ({
  entries,
  nameOf,
  onFocus,
}: {
  entries: RosterEntry[];
  nameOf: (colorId: string) => string;
  /** Pose les filtres d'une cellule sur la liste, pour finir nom par nom. */
  onFocus: (cell: RosterFilters) => void;
}): CensusState => {
  const [root, setRoot] = useState<CensusNode | null>(null);
  /** Les chiffres saisis après un KO, par case. `null` tant qu'on n'a pas dit KO. */
  const [typed, setTyped] = useState<Map<string, string> | null>(null);
  const [asked, setAsked] = useState(0);

  const probe = useMemo(
    () => (root ? nextProbe(root, entries, nameOf) : null),
    [root, entries, nameOf]
  );
  const found = useMemo(() => (root && !probe ? pinned(root, nameOf) : []), [root, probe, nameOf]);

  const keyOf = (value: string | number) => String(value);

  const answerOk = () => {
    if (!root || !probe) return;
    // Un objet neuf : `recordAnswer` mute l'arbre en place — il porte des
    // colonnes construites paresseusement, et les recopier à chaque réponse
    // recalculerait tous les effectifs de la branche. Sans ce `{...}`, React
    // verrait la même référence et ne rendrait pas la question suivante.
    setRoot({ ...recordAnswer(root, probe, { ok: true }, entries, nameOf) });
    setAsked((count) => count + 1);
    setTyped(null);
  };

  const answerKo = () => {
    if (!probe) return;
    setTyped(new Map(probe.cells.map((cell) => [keyOf(valueOn(cell.cell, FACET_OF[probe.axis as Axis]) ?? ''), ''])));
  };

  const submit = () => {
    if (!root || !probe || !typed) return;
    const facet = FACET_OF[probe.axis as Axis];
    const seen = probe.cells.map((cell) => {
      const raw = typed.get(keyOf(valueOn(cell.cell, facet) ?? '')) ?? '';
      const parsed = Number(raw);
      // Une case laissée vide vaut « pareil » : c'est le geste le plus courant
      // quand une seule ligne cloche, et l'exiger partout ferait recopier dix
      // nombres justes pour en corriger un.
      return raw.trim() === '' || !Number.isFinite(parsed) ? cell.held : parsed;
    });
    setRoot({ ...recordAnswer(root, probe, { ok: false, seen }, entries, nameOf) });
    setAsked((count) => count + 1);
    setTyped(null);
  };

  const review: Review | null = probe
    ? {
        fixed: (facet, value) => valueOn(probe.within, facet) === value,
        asked: (facet, value) =>
          probe.axis !== 'total' &&
          FACET_OF[probe.axis as Axis] === facet &&
          probe.cells.some((cell) => valueOn(cell.cell, facet) === value),
        typed: typed ? (_facet, value) => typed.get(keyOf(value)) ?? '' : null,
        onType: (_facet, value, next) =>
          setTyped((current) => new Map(current ?? []).set(keyOf(value), next)),
      }
    : null;

  const bar = (
    <div
      data-testid="census-bar"
      data-asked={asked}
      className="mb-2 px-3 py-2 rounded-xl border border-dark-700/60 bg-dark-800/40 space-y-2"
    >
      {!root && (
        <div className="flex flex-wrap items-center gap-2">
          <ScanSearch size={13} className="text-kamas" />
          <span className="text-[11px] font-semibold text-dark-200">Comparer avec le jeu</span>
          <span className="text-[11px] text-dark-500">
            quelques questions, et l’écart est localisé — ouvre l’écurie du jeu à côté
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            data-testid="census-start"
            onClick={() => {
              setRoot(censusRoot(entries, nameOf));
              setAsked(0);
              setTyped(null);
            }}
          >
            Commencer
          </Button>
        </div>
      )}

      {root && probe && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ScanSearch size={13} className="text-kamas" />
            <span className="text-[11px] text-dark-300">
              Question {asked + 1} — dans le jeu, lis{' '}
              <strong className="text-kamas">{SECTION_LABEL[probe.axis]}</strong>
              {probe.axis === 'total' ? (
                ', sans aucun filtre.'
              ) : (
                <>
                  , avec <strong className="text-info">le filtre bleu</strong> posé.
                </>
              )}{' '}
              Les chiffres <strong className="text-kamas">en jaune</strong> ci-dessous, le jeu les
              montre-t-il pareils ?
            </span>
            {!typed && (
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="secondary" data-testid="census-ok" onClick={answerOk}>
                  <Check size={13} />
                  OK
                </Button>
                <Button size="sm" variant="secondary" data-testid="census-ko" onClick={answerKo}>
                  <X size={13} />
                  KO
                </Button>
              </span>
            )}
          </div>
          {typed && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-dark-400">
                Recopie ce que le jeu affiche dans les cases jaunes. Celles que tu laisses vides
                comptent comme identiques.
              </span>
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                data-testid="census-submit"
                onClick={submit}
              >
                Continuer
              </Button>
            </div>
          )}
        </>
      )}

      {root && !probe && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ScanSearch size={13} className={found.length > 0 ? 'text-loss-light' : 'text-gain'} />
            <span className="text-[11px] text-dark-200">
              {found.length === 0
                ? `L’écurie colle au jeu, en ${asked} question${asked > 1 ? 's' : ''}.`
                : `${found.length} endroit${found.length > 1 ? 's' : ''} où ça ne colle pas, trouvé${
                    found.length > 1 ? 's' : ''
                  } en ${asked} question${asked > 1 ? 's' : ''}.`}
            </span>
            <button
              type="button"
              className="ml-auto text-[10px] text-dark-500 hover:text-dark-200 cursor-pointer"
              data-testid="census-restart"
              onClick={() => setRoot(null)}
            >
              recommencer
            </button>
          </div>

          {found.map((cell) => (
            <div
              key={JSON.stringify(cell.cell)}
              data-testid="census-pinned"
              data-held={cell.held}
              data-seen={cell.seen}
              className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                bg-loss/10 border border-loss/30 text-xs"
            >
              <span className="text-dark-200">{cell.label}</span>
              <span className="text-[11px] text-dark-400 tabular-nums">
                l’app en tient <strong className="text-dark-200">{cell.held}</strong>, le jeu{' '}
                <strong className="text-loss-light">{cell.seen}</strong>
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                data-testid="census-focus"
                onClick={() => onFocus(cell.cell)}
                title="Pose ces filtres sur la liste ci-dessous : c’est là qu’on finit, nom par nom."
              >
                Voir ces {cell.held} montures
              </Button>
            </div>
          ))}

          {/* Le prix de l'élagage, dit et pas tu. Deux erreurs qui se compensent
              dans la même case passent au vert — c'est arrivé le 16/08, sur les
              totaux **et** les compteurs par couleur et par génération. */}
          {found.length === 0 && asked > 0 && (
            <p className="text-[10px] text-dark-500">
              Deux erreurs qui se compensent exactement dans une même case passeraient au vert :
              c’est le prix d’une vérification courte, et c’est déjà arrivé. Le nom par nom reste le
              seul contrôle sans angle mort.
            </p>
          )}
        </div>
      )}
    </div>
  );

  return { review, bar };
};

export default useCensusBar;
