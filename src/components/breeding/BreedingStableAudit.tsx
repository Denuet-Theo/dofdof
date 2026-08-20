'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ShieldAlert, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import { auditStable, type AuditFinding } from '@/lib/dofus/breeding/stable-audit';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import {
  ANONYMOUS_NAME,
  carriedGeneration,
  colorsByCode,
  parseMountName,
} from '@/lib/dofus/breeding/naming';
import { FRESH_LEVEL, type Individual, type Stable } from '@/lib/dofus/breeding/stable';
import type { WriteResult } from '@/lib/hooks/useBreeding';

/**
 * Le relevé d'écurie : ce qui ne tient pas debout, et ce qu'il faut aller voir
 * dans le jeu.
 *
 * ## Pourquoi un relevé, et pas un quatrième avertissement
 *
 * L'écran d'élevage a porté beaucoup d'avertissements, et il les a presque tous
 * perdus — parce qu'ils étaient dispersés, chacun à côté de la chose qu'il
 * commentait. Un signal dispersé ne se compte pas, et un signal qui ne se compte
 * pas ne répond pas à la seule question qu'on se pose en sortant d'une séance de
 * saisie : **qu'est-ce que j'ai raté ?**
 *
 * Les règles et leur raisonnement sont dans `stable-audit.ts`. Cet écran est la
 * conversation qui en découle.
 *
 * ## Deux sections, et la frontière est le sujet
 *
 * **Ce qui ne tient pas debout** : l'app a raison sans rien demander à personne.
 * Ça se corrige tout de suite, sans ouvrir le jeu.
 *
 * **À confronter au jeu** : l'app affirme quelque chose de vérifiable, et c'est
 * la partie qui tranche. Rien n'y est faux tant qu'on n'a pas regardé.
 *
 * Les mélanger tuerait les deux. Une liste où l'avéré et le douteux se
 * ressemblent s'ignore en bloc au troisième faux positif — c'est exactement
 * comme ça que les avertissements précédents sont morts.
 *
 * ## Déplié dès qu'il y a un défaut, replié sinon
 *
 * La bannière des anonymes stériles était **toujours visible** quand il y avait
 * un reste, et c'était juste : 255 montures annoncées contre 198 en jeu ne se
 * découvre pas en dépliant un panneau. L'absorber dans un tiroir replié aurait
 * troqué un compte perdu contre un compte caché.
 *
 * ## Ce que ce relevé ne fait pas, et où c'est fait
 *
 * Il ne recense pas. Comparer les totaux, les états, les sexes, les générations
 * et les couleurs face au jeu est le travail des **filtres**, juste en dessous :
 * `BreedingStockFilters` porte les facettes du jeu, à ses intitulés et dans son
 * ordre, précisément pour qu'on pose les deux écrans côte à côte.
 *
 * C'est là — et nulle part ici — que se trouve un **clonage fait en jeu et
 * jamais saisi** : il ne laisse aucune ligne fautive, seulement un total plus
 * bas de un. Depuis qu'on sait qu'un clone revient au niveau 1, aucune règle
 * locale ne le voit, et prétendre le contraire serait pire que se taire.
 */

type Recast = {
  colorId: string;
  sex: 'M' | 'F';
  name: string | null;
  parents: [string, string] | null;
};

type Props = {
  /* Décomposé plutôt qu'un `Stable` reçu tout fait : l'appelant n'en tient pas
     un, il tient ses deux moitiés, et le recomposer dans le JSX rendrait un
     objet neuf à chaque rendu — donc un `useMemo` qui ne mémoïse rien et quatre
     règles rejouées sur deux cents montures à chaque frappe. */
  individuals: Individual[];
  bulk: Stable['bulk'];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  onUpdateIndividual: (
    id: string,
    patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'cycled' | 'name'>>
  ) => Promise<WriteResult>;
  /** Réécrit l'identité d'une ligne — l'issue « le jeu montre un autre nom ». */
  onRecastIndividual: (id: string, identity: Recast) => Promise<WriteResult>;
  /** Retire un lot en une écriture — la purge des anonymes stériles s'en sert. */
  onRemoveIndividuals?: (ids: string[]) => Promise<void>;
};

const BreedingStableAudit = ({
  individuals,
  bulk,
  colors,
  nameOf,
  onUpdateIndividual,
  onRecastIndividual,
  onRemoveIndividuals,
}: Props) => {
  const audit = useMemo(
    () => auditStable({ individuals, bulk }, colors),
    [individuals, bulk, colors]
  );

  /**
   * Le choix de l'éleveur : `null` tant qu'il n'a rien dit.
   *
   * Trois états et non deux, parce que « pas encore décidé » n'est ni ouvert ni
   * fermé — c'est ce qui laisse le défaut décider à sa place la première fois,
   * sans lui reprendre la main ensuite.
   */
  const [open, setOpen] = useState<boolean | null>(null);
  /**
   * Les lignes déjà passées en revue, pour cette ouverture seulement.
   *
   * Volontairement non persistant. Un « vu » gardé en base voudrait dire « cette
   * ligne est bonne », et ce n'est pas ce que le clic a établi : il a établi
   * qu'à un instant donné la partie disait la même chose que l'app.
   */
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  /** Le dernier refus de la base, affiché là où on vient de cliquer. */
  const [refused, setRefused] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Map<string, string>>(new Map());

  /**
   * Ce que le relevé décide à l'ouverture, une fois pour la session : un défaut
   * le déplie, une simple affirmation non.
   *
   * ## Pourquoi un verrou et pas une lecture directe
   *
   * `audit.defects.length > 0` lu à chaque rendu donnerait un panneau qui se
   * **referme tout seul** au moment où l'on vient de corriger le dernier défaut
   * — c'est-à-dire au milieu du travail, en emportant les confirmations et les
   * lignes cochées. Le déclencheur est l'arrivée sur l'écran, pas l'état
   * courant.
   *
   * ## Pourquoi il attend l'écurie
   *
   * Au premier rendu, l'écurie est vide : la lecture est en vol. Verrouiller là
   * dirait « aucun défaut » et le relevé ne s'ouvrirait jamais tout seul, ce qui
   * est précisément la propriété qu'on veut. On attend donc la première écurie
   * non vide, et c'est celle-là qui décide.
   */
  const [auto, setAuto] = useState<boolean | null>(null);
  if (auto === null && individuals.length > 0) setAuto(audit.defects.length > 0);
  const shown = open ?? auto ?? false;

  /**
   * Le relevé **figé à l'ouverture**.
   *
   * Corriger une ligne la fait sortir des règles : une fertile remise au niveau 1
   * n'est plus impossible, un nom rectifié n'est plus périmé. Recalculée, la
   * liste retirait donc la ligne **au moment même où elle confirmait** — et sur
   * l'issue « le clonage n'a pas eu lieu », le message qui suit est justement la
   * seule chose que ce panneau ait à rendre : il manque une seconde stérile que
   * l'app ne sait pas nommer.
   *
   * Même remède que la fournée de `BreedingCloneDialog`, pour la même raison. La
   * réouverture rafraîchit.
   *
   * La purge des anonymes stériles fait exception et se relit en direct : elle
   * retire cinquante-huit lignes d'un coup, et laisser sa bannière à l'écran
   * annoncerait un problème qu'on vient de régler.
   */
  const [batch, setBatch] = useState<AuditFinding[] | null>(null);
  if (shown && batch === null) setBatch(audit.defects);
  if (!shown && batch !== null) {
    setBatch(null);
    setSeen(new Set());
    setFixed(new Map());
    setOpened(null);
    setTyped('');
    setRefused(null);
  }
  const live = new Set(audit.defects.map((finding) => finding.mount.id));
  const defects = (batch ?? audit.defects).filter(
    (finding) => finding.kind !== 'anonymous-sterile' || live.has(finding.mount.id)
  );

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const byCode = useMemo(() => colorsByCode(colors), [colors]);
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 1;

  /**
   * Le nom que le jeu montre, relu en identité.
   *
   * Le même chemin que l'import d'une liste — `parseMountName` puis la table des
   * codes — parce que c'est le même geste : recopier ce que le jeu affiche. Un
   * second lecteur de noms dictés qui divergerait du premier ferait accepter ici
   * ce que l'import refuse là-bas.
   */
  const readName = (
    raw: string
  ): { ok: true; identity: Recast; carried: number } | { ok: false; problem: string } => {
    const parsed = parseMountName(raw);
    if (!parsed) {
      return { ok: false, problem: 'Pas un nom dicté par l’outil — attendu « G3 AM M DO-DO ».' };
    }

    const colorId = byCode.get(parsed.colorCode);
    if (colorId === undefined) {
      return { ok: false, problem: `Code de couleur inconnu : ${parsed.colorCode}.` };
    }
    if (colorId === null) return { ok: false, problem: `Code ambigu : ${parsed.colorCode}.` };

    const parentIds = parsed.parentCodes.map((code) => byCode.get(code));
    const unknown = parsed.parentCodes.filter((_, index) => !parentIds[index]);
    if (unknown.length > 0) return { ok: false, problem: `Parent inconnu : ${unknown.join(', ')}.` };

    const parents = parentIds as [string, string];
    return {
      ok: true,
      identity: { colorId, sex: parsed.sex, name: raw.trim().toUpperCase(), parents },
      carried: carriedGeneration(generationOf(colorId), [
        generationOf(parents[0]),
        generationOf(parents[1]),
      ]),
    };
  };

  const reading = opened ? readName(typed) : null;
  const markSeen = (id: string) => setSeen((current) => new Set(current).add(id));

  /** Une écriture, son refus affiché là où on a cliqué, sa confirmation gardée. */
  const write = async (id: string, run: () => Promise<WriteResult>, done: string) => {
    if (busy) return false;
    setBusy(true);
    setRefused(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setRefused(result.message);
      return false;
    }
    setFixed((current) => new Map(current).set(id, done));
    markSeen(id);
    return true;
  };

  const recast = async (mount: Individual) => {
    if (!reading || !reading.ok) return;
    const identity = reading.identity;
    const ok = await write(
      mount.id,
      () => onRecastIndividual(mount.id, identity),
      `Corrigée : ${identity.name}.`
    );
    if (ok) {
      setOpened(null);
      setTyped('');
    }
  };

  const phantoms = defects.filter((finding) => finding.kind === 'anonymous-sterile');
  const staleNames = defects.filter((finding) => finding.kind === 'stale-name');
  const levels = defects.filter((finding) => finding.kind === 'impossible-level');

  if (defects.length === 0 && audit.claims.length === 0) return null;

  const mountLine = (mount: Individual) => {
    const color = byId.get(mount.colorId);
    const icon = color ? colorIconUrl(color) : null;
    return (
      <>
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="w-5 h-5 object-contain" />
        )}
        <span
          className={mount.sex === 'M' ? 'text-info' : 'text-loss-light'}
          title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
        >
          {mount.sex === 'M' ? '♂' : '♀'}
        </span>
        <span className="text-dark-200">{nameOf(mount.colorId)}</span>
      </>
    );
  };

  const rowTone = (id: string) =>
    seen.has(id)
      ? 'bg-dark-900/30 border-dark-700/40 opacity-60'
      : 'bg-dark-800/50 border-dark-600/50';

  return (
    <div
      data-testid="stable-audit"
      data-defects={defects.length}
      data-claims={audit.claims.length}
      className="mb-2 rounded-xl border border-dark-700/60 bg-dark-800/30"
    >
      <button
        type="button"
        data-testid="stable-audit-toggle"
        onClick={() => setOpen(!shown)}
        title="À faire après une séance de saisie : ce que l’app peut contredire toute seule, et ce qu’il faut aller confronter au jeu."
        className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        {shown ? (
          <ChevronDown size={13} className="text-dark-400" />
        ) : (
          <ChevronRight size={13} className="text-dark-400" />
        )}
        <ShieldAlert size={13} className={defects.length > 0 ? 'text-loss-light' : 'text-kamas'} />
        <span className="text-[11px] font-semibold text-dark-200">Vérifier l’écurie</span>
        <span className="text-[11px] text-dark-500">
          {defects.length > 0 && (
            <strong className="text-loss-light">{defects.length} à corriger</strong>
          )}
          {defects.length > 0 && audit.claims.length > 0 && ' · '}
          {audit.claims.length > 0 && `${audit.claims.length} à confronter au jeu`}
        </span>
      </button>

      {shown && (
        <div className="px-3 pb-3 space-y-3">
          {refused && (
            <p
              data-testid="stable-audit-refusal"
              className="px-3 py-2 rounded-xl bg-loss/15 border border-loss/40 text-[11px] text-loss-light"
            >
              Pas enregistré — {refused}
            </p>
          )}

          {defects.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-loss-light">
                Ce qui ne tient pas debout
                <span className="ml-2 font-normal text-dark-500">
                  faux quoi que dise la partie — ça se corrige sans ouvrir le jeu
                </span>
              </p>

              {/* Les restes, comptés et retirables d'un geste. Une anonyme
                  stérile n'est pas une monture qu'on aurait oublié de nommer,
                  c'est un état que le jeu ne rend pas. */}
              {phantoms.length > 0 && onRemoveIndividuals && (
                <div
                  data-testid="phantom-notice"
                  className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
                    bg-loss/10 border border-loss/30"
                >
                  <span className="text-[11px] text-dark-300">
                    <strong className="text-loss-light">{phantoms.length}</strong> anonyme
                    {phantoms.length > 1 ? 's' : ''} stérile{phantoms.length > 1 ? 's' : ''}
                    {' — '}un état que le jeu ne rend pas. Sans nom il n&apos;y a pas
                    d&apos;ascendance, donc c&apos;est une gen 1 : elle ne s&apos;extrait pas, et le
                    clonage ne prend pas ce qu&apos;on ne sait pas désigner en jeu.
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() => onRemoveIndividuals(phantoms.map((finding) => finding.mount.id))}
                    title="Suppression définitive, en une écriture. Le compte de l’écurie baisse d’autant — c’est le but : il ne compte plus ce que le jeu n’a pas."
                  >
                    <Trash2 size={13} />
                    Retirer {phantoms.length === 1 ? 'la' : 'les'} {phantoms.length}
                  </Button>
                </div>
              )}

              {staleNames.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] text-dark-400">
                    <strong className="text-dark-200">{staleNames.length}</strong> nom
                    {staleNames.length > 1 ? 's' : ''} ne décri
                    {staleNames.length > 1 ? 'vent' : 't'} plus leur monture — couleur, sexe ou
                    ascendance a bougé sans que le nom suive. C’est la seule chose qui se lise dans
                    l’écurie du jeu : renomme en jeu, puis note-le ici.
                  </p>
                  {staleNames.map((finding) => {
                    const expected = finding.kind === 'stale-name' ? finding.expected : '';
                    const mount = finding.mount;
                    const done = fixed.get(mount.id);
                    return (
                      <div
                        key={mount.id}
                        data-testid="stale-name"
                        data-mount-id={mount.id}
                        data-expected={expected}
                        className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border
                          text-xs ${rowTone(mount.id)}`}
                      >
                        {mountLine(mount)}
                        <code className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500 line-through">
                          {mount.name ?? ANONYMOUS_NAME}
                        </code>
                        <span className="text-dark-600">→</span>
                        <CopyableText
                          value={expected}
                          title={`Copier « ${expected} » — le nom à poser sur cette monture dans le jeu`}
                        />
                        {done ? (
                          <span data-testid="audit-fixed" className="ml-auto text-[11px] text-gain">
                            {done}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-auto"
                            disabled={busy}
                            data-testid="stale-name-fix"
                            onClick={() =>
                              write(
                                mount.id,
                                () => onUpdateIndividual(mount.id, { name: expected }),
                                'Noté.'
                              )
                            }
                            title={`Renomme-la « ${expected} » dans le jeu, puis clique ici pour le noter.`}
                          >
                            Renommée en jeu
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {levels.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] text-dark-400">
                    <strong className="text-dark-200">{levels.length}</strong> fertile
                    {levels.length > 1 ? 's' : ''} au-dessus du niveau {FRESH_LEVEL} — un poulain
                    naît au niveau {FRESH_LEVEL}, un clone y revient, et ce qui sort d’un enclos en
                    sort <em>féconde</em>. Rien ne peut donc en produire. Le niveau n’est pas
                    décoratif : il décide du taux de réussite d’un croisement.
                    <br />
                    Elles viennent presque toutes d’un clonage saisi avant que l’app sache qu’un
                    clone revient au niveau 1. Si le clonage a <em>aussi</em> été saisi de travers,
                    les deux gestes du bas demandent ce que la partie montre sous ce nom.
                  </p>
                  {levels.map((finding) => {
                    if (finding.kind !== 'impossible-level') return null;
                    const mount = finding.mount;
                    const done = fixed.get(mount.id);
                    const isOpen = opened === mount.id;

                    return (
                      <div
                        key={mount.id}
                        data-testid="impossible-level"
                        data-mount-id={mount.id}
                        data-level={mount.level}
                        data-steriles={finding.held.sterile}
                        className={`px-3 py-2 rounded-xl border text-xs space-y-1.5 ${rowTone(mount.id)}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {mountLine(mount)}
                          {mount.name ? (
                            <CopyableText
                              value={mount.name}
                              title={`Copier « ${mount.name} » — le nom à chercher dans l’écurie du jeu`}
                            />
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500">
                              {ANONYMOUS_NAME}
                            </span>
                          )}
                          <span className="text-[10px] text-loss-light tabular-nums">
                            niv {mount.level}
                          </span>
                          <span className="ml-auto text-[10px] text-dark-500 tabular-nums">
                            sous ce nom, l’app tient {finding.held.fertile} fertile
                            {finding.held.fertile > 1 ? 's' : ''} · {finding.held.feconde} féconde
                            {finding.held.feconde > 1 ? 's' : ''} · {finding.held.sterile} stérile
                            {finding.held.sterile > 1 ? 's' : ''}
                          </span>
                        </div>

                        {done ? (
                          <p data-testid="audit-fixed" className="text-[11px] text-gain">
                            {done}
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={busy}
                                data-testid="impossible-level-fix"
                                onClick={() =>
                                  write(
                                    mount.id,
                                    () => onUpdateIndividual(mount.id, { level: FRESH_LEVEL }),
                                    `Remise au niveau ${FRESH_LEVEL}.`
                                  )
                                }
                                title="Le cas courant : un clonage saisi avant que l’app sache qu’un clone revient au niveau 1."
                              >
                                Remettre au niveau {FRESH_LEVEL}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                data-testid="impossible-level-bought"
                                onClick={() => markSeen(mount.id)}
                                title="Une monture achetée déjà montée est fertile au-dessus du niveau 1 sans que rien ne soit faux. C’est la seule exception."
                              >
                                <Check size={13} />
                                Achetée à ce niveau
                              </Button>
                            </div>

                            {/* Le second geste, plus petit : un clonage a pu
                                être saisi de travers **en plus** d'avoir reçu le
                                mauvais niveau. Le jeu tire la survivante, et
                                l'éleveur a pu consigner l'autre.

                                Sa phrase d'explication est au-dessus du groupe
                                et non sur chaque ligne : relue à l'écran, elle
                                se répétait trois fois pour une information qui
                                vaut pour tout le lot, et noyait les deux boutons
                                qu'elle est censée introduire. */}
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                data-testid="impossible-level-uncloned"
                                onClick={() =>
                                  write(
                                    mount.id,
                                    () =>
                                      onUpdateIndividual(mount.id, { fertile: false, cycled: false }),
                                    'Remise stérile. Il manque sa partenaire de clonage : l’app ne sait plus laquelle c’était — remets-la depuis son nom dans le jeu.'
                                  )
                                }
                                title="Le jeu montre deux stériles sous ce nom et aucune fertile : le clonage n’a jamais eu lieu."
                              >
                                Le clonage n’a pas eu lieu
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                data-testid="impossible-level-recast"
                                onClick={() => {
                                  setOpened(isOpen ? null : mount.id);
                                  setTyped('');
                                }}
                                title="Le jeu a rendu l’autre stérile : la monture existe, mais sous un autre nom et une autre ascendance."
                              >
                                Le jeu montre un autre nom
                              </Button>
                            </div>

                            {isOpen && (
                              <div className="space-y-1.5 pt-1">
                                <label className="block text-[10px] text-dark-400">
                                  Le nom que le jeu affiche sur la survivante — c’est lui qui porte
                                  sa couleur, son sexe et ses deux parents.
                                </label>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    data-testid="impossible-level-name"
                                    value={typed}
                                    onChange={(event) => setTyped(event.target.value)}
                                    placeholder="G2 ORPO M OR-PO"
                                    className="px-2 py-1 rounded-lg bg-dark-900/70 border
                                      border-dark-600/60 text-[11px] text-dark-100 w-48"
                                  />
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    data-testid="impossible-level-recast-save"
                                    disabled={busy || !reading?.ok}
                                    onClick={() => recast(mount)}
                                  >
                                    Corriger
                                  </Button>
                                </div>
                                {reading && !reading.ok && typed.trim().length > 0 && (
                                  <p
                                    data-testid="impossible-level-unreadable"
                                    className="text-[10px] text-loss-light"
                                  >
                                    {reading.problem}
                                  </p>
                                )}
                                {reading?.ok && (
                                  <p
                                    data-testid="impossible-level-preview"
                                    className="text-[10px] text-dark-400"
                                  >
                                    {reading.identity.sex === 'M' ? '♂' : '♀'}{' '}
                                    {nameOf(reading.identity.colorId)}, né de{' '}
                                    {nameOf(reading.identity.parents![0])} ×{' '}
                                    {nameOf(reading.identity.parents![1])} — porte G
                                    {reading.carried}.
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {audit.claims.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-kamas">
                À confronter au jeu
                <span className="ml-2 font-normal text-dark-500">
                  rien n’est faux ici tant que la partie n’a pas parlé
                </span>
              </p>

              {audit.claims.map((finding) =>
                finding.kind === 'double-counted' ? (
                  <div
                    key={finding.mount.id}
                    data-testid="double-counted"
                    data-mount-id={finding.mount.id}
                    data-bulk={finding.bulk}
                    className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border
                      text-xs ${rowTone(finding.mount.id)}`}
                  >
                    {mountLine(finding.mount)}
                    <span className="text-[10px] text-dark-400">
                      fertile, sans ascendance, et le compteur de vrac en tient déjà{' '}
                      <strong className="text-dark-200">{finding.bulk}</strong> de cette couleur et
                      de ce sexe — c’est peut-être la même, comptée deux fois.
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-auto"
                      disabled={busy}
                      data-testid="double-counted-ok"
                      onClick={() => markSeen(finding.mount.id)}
                      title="Le jeu en montre bien une de plus que le vrac : ce sont deux montures distinctes, rien à corriger."
                    >
                      <Check size={13} />
                      Deux montures distinctes
                    </Button>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Le renvoi au recensement. Sans lui, ce relevé passerait pour la
              vérification complète alors qu'il n'en est que la moitié — celle
              qui ne demande pas le jeu. L'autre moitié est juste en dessous et
              porte déjà les facettes du jeu. */}
          <p className="text-[10px] text-dark-500">
            Pour le reste — le total, l’état, le sexe, la génération, la couleur — les compteurs des
            filtres ci-dessous sont ceux du jeu, aux mêmes intitulés et dans le même ordre : mets les
            deux écrans côte à côte. C’est là, et pas ici, qu’on voit un{' '}
            <strong className="text-dark-400">clonage fait en jeu et jamais saisi</strong> : il ne
            laisse aucune ligne fautive, seulement un total plus bas de un.
          </p>
        </div>
      )}
    </div>
  );
};

export default BreedingStableAudit;
