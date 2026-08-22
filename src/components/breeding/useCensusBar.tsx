'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ScanSearch, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  censusRoot,
  namesRoot,
  nextProbe,
  pinned,
  recordAnswer,
  type Axis,
  type CensusNode,
  type Probe,
  type ProbeCell,
} from '@/lib/dofus/breeding/reconcile';
import {
  isPristine,
  valueOn,
  type RosterEntry,
  type RosterFilters,
} from '@/lib/dofus/breeding/roster';
import { TOTAL_VALUE, type Review } from '@/components/breeding/BreedingStockFilters';

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
  // Le seul axe qui ne se lise pas dans le panneau du jeu, mais dans la
  // **recherche** de sa liste d'écurie : un début de nom tapé, des lignes à
  // compter.
  name: 'la recherche de l’écurie',
};

/** Un écart signé, dit dans le sens du jeu : « 2 de plus », « 1 de moins ». */
const gapPhrase = (gap: number): string => `${Math.abs(gap)} de ${gap > 0 ? 'plus' : 'moins'}`;

/**
 * Un **hook** et non un composant, parce qu'il rend deux choses qui vivent à
 * deux endroits : la barre de question, et la teinture du panneau de filtres qui
 * est son voisin. Un composant ne peut pas colorer son frère.
 */
const useCensusBar = ({
  entries,
  nameOf,
  onFocus,
  onReveal,
}: {
  entries: RosterEntry[];
  nameOf: (colorId: string) => string;
  /** Pose les filtres d'une cellule sur la liste, pour finir nom par nom. */
  onFocus: (cell: RosterFilters) => void;
  /**
   * Pose les filtres **et amène la liste sous les yeux**.
   *
   * Deux rappels et non un, parce que les deux gestes n'ont pas le même moment.
   * Pendant les questions, `onFocus` recoche le panneau à chaque nouvelle
   * question ; faire défiler là ferait sauter l'écran sous celui qui lit ses
   * chiffres. À la fin, « Voir ces N montures » est une promesse d'aller
   * quelque part : onze cellules pointées repoussent la liste de trois cents
   * pixels sous la ligne de flottaison, et le bouton posait alors ses filtres
   * dans un écran que personne ne voyait — un bouton qui « ne fait rien ».
   */
  onReveal: (cell: RosterFilters) => void;
}): CensusState => {
  const [root, setRoot] = useState<CensusNode | null>(null);
  /**
   * La seconde passe, celle des noms — `null` tant qu'on ne l'a pas demandée.
   *
   * Deux arbres et non un : ils coupent la même écurie sur deux choses qui n'ont
   * rien à voir, les comptes et les noms, et une passe qui n'a pas été lancée ne
   * doit rien pointer. Voir `namesRoot`.
   */
  const [names, setNames] = useState<CensusNode | null>(null);
  /** Les chiffres saisis après un KO, par case. `null` tant qu'on n'a pas dit KO. */
  const [typed, setTyped] = useState<Map<string, string> | null>(null);
  const [asked, setAsked] = useState(0);

  /** L'arbre qui pose les questions : celui des noms dès qu'il existe. */
  const current = names ?? root;
  const setCurrent = names ? setNames : setRoot;

  const probe = useMemo(
    () => (current ? nextProbe(current, entries, nameOf) : null),
    [current, entries, nameOf]
  );
  const found = useMemo(
    () =>
      probe || !root
        ? []
        : [...pinned(root, nameOf), ...(names ? pinned(names, nameOf) : [])],
    [root, names, probe, nameOf]
  );

  /**
   * Le croisement de la question est **posé pour de vrai** sur le panneau.
   *
   * Pas seulement teinté en bleu : coché. C'est ce qui rend les chiffres jaunes
   * justes, et ça ne se voyait pas au premier essai — le panneau calcule ses
   * effectifs sur ses propres filtres, donc la colonne SEXE affichait 106 et 97,
   * les totaux de l'écurie, là où la question portait sur les **fécondes** par
   * sexe. On lisait une question sur une population et des nombres sur une
   * autre.
   *
   * Poser le filtre plutôt que de recalculer à côté a un second mérite : c'est
   * exactement le geste que l'éleveur fait dans le jeu au même moment, et les
   * deux écrans restent superposables.
   *
   * La référence garde le dernier posé : sans elle, l'effet réécrirait les
   * filtres à chaque rendu et l'éleveur ne pourrait plus rien toucher.
   */
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!probe) {
      applied.current = null;
      return;
    }
    const wanted = JSON.stringify(probe.within);
    if (applied.current === wanted) return;
    applied.current = wanted;
    onFocus(probe.within);
  }, [probe, onFocus]);

  const keyOf = (value: string | number) => String(value);

  /** La clé de saisie d'une case : sa valeur de facette, ou le total. */
  const keyFor = (cell: RosterFilters): string =>
    probe && probe.axis !== 'total' ? keyOf(valueOn(cell, probe.axis) ?? '') : TOTAL_VALUE;

  /** Des cases vides pour toute la colonne : vide vaut « pareil ». */
  const blank = (question: Probe): Map<string, string> =>
    question.axis === 'total'
      ? new Map([[TOTAL_VALUE, '']])
      : new Map(question.cells.map((cell) => [keyFor(cell.cell), '']));

  /**
   * Les cases ouvertes : celles que le KO a ouvertes, ou celles qu'une colonne à
   * écart **déjà déclaré** ouvre d'office.
   *
   * Une colonne partitionne sa cellule : si l'éleveur vient de dire qu'il y a un
   * fertile mâle de plus qu'annoncé, les générations de ces fertiles mâles ne
   * peuvent pas toutes coller. Lui demander « est-ce pareil ? » est lui demander
   * de répondre non à une question dont il vient de donner la réponse, puis de
   * cliquer une troisième fois pour ouvrir les cases. Elles s'ouvrent seules, et
   * la seule question qui reste est posée : **où**.
   *
   * Dérivé plutôt que posé dans un effet : c'est une lecture de la question en
   * cours, pas un état à synchroniser, et un `setState` dans un effet fait
   * cascader les rendus.
   */
  const fields = typed ?? (probe && probe.owed !== null ? blank(probe) : null);

  const answerOk = () => {
    if (!current || !probe) return;
    // Un objet neuf : `recordAnswer` mute l'arbre en place — il porte des
    // colonnes construites paresseusement, et les recopier à chaque réponse
    // recalculerait tous les effectifs de la branche. Sans ce `{...}`, React
    // verrait la même référence et ne rendrait pas la question suivante.
    setCurrent({ ...recordAnswer(current, probe, { ok: true }, entries, nameOf) });
    setAsked((count) => count + 1);
    setTyped(null);
  };

  const answerKo = () => {
    if (!probe) return;
    setTyped(blank(probe));
  };

  /** Ce que l'éleveur a saisi sur une case, ou l'effectif de l'app si rien. */
  const seenOn = (cell: ProbeCell): number => {
    const raw = fields?.get(keyFor(cell.cell)) ?? '';
    const parsed = Number(raw);
    return raw.trim() === '' || !Number.isFinite(parsed) ? cell.held : parsed;
  };

  /**
   * Ce qu'il reste de l'écart déclaré à placer dans la colonne.
   *
   * Un compteur vivant plutôt qu'un contrôle : il dit à quel moment la saisie
   * rend compte de ce qui a été annoncé au-dessus, sans jamais bloquer — deux
   * écarts qui se compensent dans la colonne restent une réponse recevable, et
   * c'est à la cellule suivante de les départager.
   */
  const left =
    probe && probe.owed !== null && fields
      ? probe.owed - probe.cells.reduce((sum, cell) => sum + (seenOn(cell) - cell.held), 0)
      : 0;

  const submit = () => {
    if (!current || !probe || !fields) return;
    const seen = probe.cells.map((cell) => {
      const raw = fields.get(keyFor(cell.cell)) ?? '';
      const parsed = Number(raw);
      // Une case laissée vide vaut « pareil » : c'est le geste le plus courant
      // quand une seule ligne cloche, et l'exiger partout ferait recopier dix
      // nombres justes pour en corriger un.
      return raw.trim() === '' || !Number.isFinite(parsed) ? cell.held : parsed;
    });
    setCurrent({ ...recordAnswer(current, probe, { ok: false, seen }, entries, nameOf) });
    setAsked((count) => count + 1);
    setTyped(null);
  };

  const review: Review | null = probe
    ? {
        // Le total ne fixe rien — il se lit sans un seul filtre posé.
        fixed: (facet, value) => facet !== 'total' && valueOn(probe.within, facet) === value,
        asked: (facet, value) =>
          facet === 'total'
            ? probe.axis === 'total'
            : probe.axis === facet &&
              probe.cells.some((cell) => valueOn(cell.cell, facet) === value),
        typed: fields ? (_facet, value) => fields.get(keyOf(value)) ?? '' : null,
        onType: (_facet, value, next) =>
          setTyped((entered) => new Map(entered ?? fields ?? []).set(keyOf(value), next)),
        // Le panneau n'a pas de quoi énumérer des débuts de nom : c'est la
        // question qui les porte, avec la profondeur qu'elle a choisie.
        names:
          probe.axis === 'name'
            ? [
                // Le préfixe déjà posé, en tête et en bleu. Il n'a de ligne
                // nulle part ailleurs — les quatre facettes en ont une dans leur
                // colonne, lui non — et la consigne annonce « le filtre bleu
                // posé » : sans cette ligne elle désignait un chiffre que
                // l'écran ne montrait pas. Son effectif est la somme de ses
                // cases, qui le partitionnent.
                ...(probe.within.namePrefix
                  ? [
                      {
                        value: probe.within.namePrefix,
                        count: probe.cells.reduce((sum, cell) => sum + cell.held, 0),
                      },
                    ]
                  : []),
                ...probe.cells.map((cell) => ({
                  // Le préfixe seul, et non le libellé de la cellule : c'est ce
                  // qu'on tape dans la recherche du jeu, pas ce qui la décrit.
                  value: String(valueOn(cell.cell, 'name') ?? ''),
                  count: cell.held,
                })),
              ]
            : [],
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
              setNames(null);
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
              Question {asked + 1} —{' '}
              {/* Les noms ne se lisent pas, ils se cherchent : la consigne dit le
                  geste, qui n'est pas le même que devant une colonne. */}
              {probe.axis === 'name' ? (
                <>
                  dans le jeu, tape chaque{' '}
                  <strong className="text-kamas">début de nom en jaune</strong> dans{' '}
                  <strong className="text-kamas">{SECTION_LABEL.name}</strong> et compte les
                  lignes
                  {/* La recherche du jeu porte sur l'écurie entière : sans les
                      filtres posés à côté, elle rendrait des montures que la
                      cellule n'a jamais comptées. */}
                  {isPristine(probe.within) ? (
                    '.'
                  ) : (
                    <>
                      , <strong className="text-info">le filtre bleu</strong> posé.
                    </>
                  )}
                </>
              ) : (
                <>
                  dans le jeu, lis{' '}
                  <strong className="text-kamas">{SECTION_LABEL[probe.axis]}</strong>
                  {/* Les quatre marges se lisent à l'ouverture, sans rien cocher :
                      annoncer « le filtre bleu » quand il n'y en a aucun envoyait
                      chercher une couleur absente de l'écran. */}
                  {isPristine(probe.within) ? (
                    ', sans aucun filtre.'
                  ) : (
                    <>
                      , avec <strong className="text-info">le filtre bleu</strong> posé.
                    </>
                  )}
                </>
              )}{' '}
              {probe.owed !== null ? (
                <>
                  Tu viens de dire qu&apos;ici le jeu en compte{' '}
                  <strong className="text-loss-light">{gapPhrase(probe.owed)}</strong> : dans
                  quelle ligne <strong className="text-kamas">en jaune</strong> ? Recopie celles
                  qui diffèrent, laisse les autres vides.
                </>
              ) : probe.axis === 'total' ? (
                <>
                  Le chiffre <strong className="text-kamas">en jaune</strong> ci-dessous, sur la
                  ligne TYPE, le jeu le montre-t-il pareil ?
                </>
              ) : (
                <>
                  Les chiffres <strong className="text-kamas">en jaune</strong> ci-dessous, le jeu
                  les montre-t-il pareils ?
                </>
              )}
            </span>
            {/* Pas d'OK sur une colonne dont l'écart est déjà déclaré : il n'y a
                rien à valider, et le laisser paraître le temps d'une frame le
                rendrait cliquable. */}
            {!fields && (
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
          {fields && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Une seule consigne pour toutes les questions, le total compris :
                  sa case est désormais dans le panneau comme les autres, sur la
                  ligne du Type. */}
              <span className="text-[11px] text-dark-400" data-testid="census-left" data-left={left}>
                {probe.owed === null ? (
                  <>
                    Recopie ce que le jeu affiche dans les cases jaunes. Celles que tu laisses vides
                    comptent comme identiques.
                  </>
                ) : left === 0 ? (
                  <>L’écart annoncé est placé.</>
                ) : (
                  <>
                    Reste à placer : <strong className="text-loss-light">{gapPhrase(left)}</strong>.
                  </>
                )}
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
            {/* La seconde passe, proposée et jamais imposée : elle coûte une
                recherche par ligne dans le jeu, là où une colonne coûte un coup
                d'œil. Voir `namesRoot`. */}
            {root && !names && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                data-testid="census-names"
                onClick={() => setNames(namesRoot(root))}
                title="Les comptes ne voient pas un nom faux : même couleur, même sexe, même génération, aucun compteur ne bouge. Cette passe confronte les noms par la recherche de l’écurie du jeu."
              >
                <ScanSearch size={13} />
                Vérifier les noms
              </Button>
            )}
            <button
              type="button"
              className={`text-[10px] text-dark-500 hover:text-dark-200 cursor-pointer ${
                root && !names ? '' : 'ml-auto'
              }`}
              data-testid="census-restart"
              onClick={() => {
                setRoot(null);
                setNames(null);
              }}
            >
              recommencer
            </button>
          </div>

          {/* Ce qu'un compte ne peut pas voir, dit avant qu'on croie l'avoir
              vérifié : c'est le cas du 22/08, une fournée qui réclame une
              monture que le jeu connaît sous un autre nom. */}
          {!names && (
            <p className="text-[10px] text-dark-500">
              Les comptes ne voient pas un nom faux : une monture bien comptée sous un mauvais nom
              ne bouge aucun compteur, et c’est le nom qui sert à la retrouver devant l’enclos.
            </p>
          )}

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
              {/*
                Ce qu'il reste à faire, et il n'est pas le même dans les deux
                sens.

                « G4 — l'app en tient 41, le jeu 42 » a été rendu tel quel le
                22/08, avec un bouton « Voir ces 41 montures » : exact, et
                inutilisable. Le surplus est une monture que l'app **ne sait pas
                nommer** — aucune colonne ne peut la désigner, puisqu'elle
                n'existe dans aucun de ses comptes. Ce qui reste est un
                vis-à-vis : les deux listes sont rangées pareil, celle du jeu
                porte une ligne de plus, et c'est elle qu'on saisit.

                Dans l'autre sens il n'y a rien à chercher côté jeu : l'app tient
                des montures que le jeu n'a plus, et c'est dans sa liste à elle
                que ça se corrige.
              */}
              {cell.held > 0 && (
                <span className="text-[11px] text-dark-500 basis-full">
                  {cell.seen > cell.held ? (
                    <>
                      Le jeu en porte {cell.seen - cell.held} que l’app ne connaît pas — elle ne
                      peut donc pas {names ? 'les nommer' : 'les désigner'}. Ouvre les {cell.held}{' '}
                      ci-dessous : elles sont rangées comme l’écurie du jeu, descends les deux
                      listes, la ligne en trop côté jeu est celle à ajouter.
                    </>
                  ) : (
                    <>
                      L’app en tient {cell.held - cell.seen} que le jeu n’a plus : ouvre les{' '}
                      {cell.held} ci-dessous et retire celle{cell.held - cell.seen > 1 ? 's' : ''}{' '}
                      qui ne s’y retrouve{cell.held - cell.seen > 1 ? 'nt' : ''} pas.
                    </>
                  )}
                </span>
              )}
              {/* Rien à ouvrir quand l'app n'en tient aucune : il n'y a pas de
                  liste à comparer, seulement des montures à saisir. C'est le cas
                  d'une case que le croisement vide et que le jeu remplit. */}
              {cell.held === 0 ? (
                <span className="ml-auto text-[11px] text-dark-400">
                  L’app n’en connaît aucune — à ajouter à l’écurie.
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  data-testid="census-focus"
                  onClick={() => onReveal(cell.cell)}
                  title="Pose ces filtres sur la liste ci-dessous : c’est là qu’on finit, nom par nom."
                >
                  {/* Le bouton dit le geste, pas seulement la destination : sur
                      un surplus côté jeu, il n'y a rien à « voir » dans l'app —
                      il y a deux listes à descendre en vis-à-vis. Une seule
                      monture, depuis que l'axe des noms descend jusque-là. */}
                  {cell.seen > cell.held
                    ? `Comparer ces ${cell.held} noms`
                    : cell.held === 1
                      ? 'Voir cette monture'
                      : `Voir ces ${cell.held} montures`}
                </Button>
              )}
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
