'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ShieldAlert, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import { FRESH_LEVEL, type CloneClaim } from '@/lib/dofus/breeding/clone-audit';
import { auditStable, type AuditFinding } from '@/lib/dofus/breeding/stable-audit';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ANONYMOUS_NAME, carriedGeneration, colorsByCode, parseMountName } from '@/lib/dofus/breeding/naming';
import type { Individual, Stable } from '@/lib/dofus/breeding/stable';
import type { WriteResult } from '@/lib/hooks/useBreeding';

/**
 * Le relevé d'écurie : ce qui ne tient pas debout, et ce qu'il faut aller voir
 * dans le jeu.
 *
 * ## Pourquoi un relevé, et pas un troisième avertissement
 *
 * L'écran d'élevage a porté beaucoup d'avertissements, et il les a presque tous
 * perdus — parce qu'ils étaient dispersés, chacun à côté de la chose qu'il
 * commentait. Un signal dispersé ne se compte pas, et un signal qui ne se compte
 * pas ne répond pas à la seule question qu'on se pose en sortant d'une séance de
 * saisie : **qu'est-ce que j'ai raté ?**
 *
 * Trois signaux existaient déjà et vivaient chacun de son côté : la bannière des
 * anonymes stériles, un petit bouton ambre au fil de deux cents lignes pour les
 * noms périmés, et rien du tout pour les clonages. Ils se rejoignent ici. Le
 * raisonnement de chaque règle est dans `stable-audit.ts` et `clone-audit.ts` ;
 * cet écran est la conversation.
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
 * Elle garde donc sa force : un défaut ouvre le relevé. Une simple affirmation à
 * vérifier, non — ce n'est pas une alerte, c'est un travail qu'on vient faire.
 *
 * ## Ce que ce relevé ne fait pas, et où c'est fait
 *
 * Il ne recense pas. Comparer les totaux, les états, les sexes, les générations
 * et les couleurs face au jeu est le travail des **filtres**, juste en dessous :
 * `BreedingStockFilters` porte les facettes du jeu, à ses intitulés et dans son
 * ordre, précisément pour qu'on pose les deux écrans côte à côte. Refaire ça ici
 * donnerait deux recensements qui se contrediraient un jour.
 *
 * Les deux se complètent et ne se remplacent pas : le relevé trouve ce qui est
 * faux en soi, le recensement trouve ce que l'app croit vrai sans raison de se
 * méfier — une stérile recyclée en jeu, un niveau faux, une féconde qui n'a
 * jamais vu d'enclos.
 */

type Recast = { colorId: string; sex: 'M' | 'F'; name: string | null; parents: [string, string] | null };

type Props = {
  /* Décomposé plutôt qu'un `Stable` reçu tout fait : l'appelant n'en tient pas
     un, il tient ses deux moitiés, et le recomposer dans le JSX rendrait un
     objet neuf à chaque rendu — donc un `useMemo` qui ne mémoïse rien et trois
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
   * Les affirmations déjà passées en revue, pour cette ouverture seulement.
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
   * Les affirmations **figées à l'ouverture**, et les défauts laissés vivants.
   *
   * Ce n'est pas une inconséquence, c'est la différence entre les deux tas.
   *
   * Un **défaut corrigé disparaît**, et sa disparition est la confirmation : le
   * compteur d'anonymes stériles qui tombe de 58 à 0 dit tout ce qu'il y a à
   * dire. Le figer laisserait à l'écran une bannière qui annonce un problème
   * résolu, ce qui est le contraire d'un signal.
   *
   * Une **affirmation vérifiée**, elle, n'a souvent rien changé — « le jeu la
   * montre bien » n'écrit rien — et quand elle change quelque chose, la ligne
   * cesse d'être une affirmation : une fertile repassée stérile n'est plus un
   * clone. Recalculée, la liste retirait donc la ligne **au moment même où elle
   * confirmait**, et le seul message que ce panneau ait à rendre après un clic
   * n'était jamais lu. Même remède que la fournée de `BreedingCloneDialog`, pour
   * la même raison.
   */
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

  const [batch, setBatch] = useState<AuditFinding[] | null>(null);
  if (shown && batch === null) setBatch(audit.claims);
  if (!shown && batch !== null) {
    setBatch(null);
    setSeen(new Set());
    setFixed(new Map());
    setOpened(null);
    setTyped('');
    setRefused(null);
  }
  const claims = batch ?? audit.claims;

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
    if (!parsed) return { ok: false, problem: 'Pas un nom dicté par l’outil — attendu « G3 AM M DO-DO ».' };

    const colorId = byCode.get(parsed.colorCode);
    if (colorId === undefined) return { ok: false, problem: `Code de couleur inconnu : ${parsed.colorCode}.` };
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

  /** L'issue « le clonage n'a pas eu lieu » : la ligne redevient une stérile. */
  const putBack = (mount: Individual) =>
    write(
      mount.id,
      () => onUpdateIndividual(mount.id, { fertile: false, cycled: false }),
      'Remise stérile. Il manque sa partenaire de clonage : l’app ne sait plus laquelle c’était — remets-la depuis son nom dans le jeu.'
    );

  /** L'issue « le jeu montre un autre nom » : la ligne prend l'identité lue. */
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

  const phantoms = audit.defects.filter((finding) => finding.kind === 'anonymous-sterile');
  const staleNames = audit.defects.filter((finding) => finding.kind === 'stale-name');

  if (audit.defects.length === 0 && claims.length === 0) return null;

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

  return (
    <div
      data-testid="stable-audit"
      data-defects={audit.defects.length}
      data-claims={claims.length}
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
        <ShieldAlert size={13} className={audit.defects.length > 0 ? 'text-loss-light' : 'text-kamas'} />
        <span className="text-[11px] font-semibold text-dark-200">Vérifier l’écurie</span>
        <span className="text-[11px] text-dark-500">
          {audit.defects.length > 0 && (
            <strong className="text-loss-light">
              {audit.defects.length} à corriger
            </strong>
          )}
          {audit.defects.length > 0 && claims.length > 0 && ' · '}
          {claims.length > 0 && `${claims.length} à confronter au jeu`}
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

          {audit.defects.length > 0 && (
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
                <div data-testid="stale-name-group" className="space-y-1">
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
                        className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                          bg-dark-800/50 border border-dark-600/50 text-xs"
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
                          <span className="ml-auto text-[11px] text-gain">{done}</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-auto"
                            disabled={busy}
                            data-testid="stale-name-fix"
                            onClick={() =>
                              write(mount.id, () => onUpdateIndividual(mount.id, { name: expected }), 'Noté.')
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
            </div>
          )}

          {claims.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-kamas">
                À confronter au jeu
                <span className="ml-2 font-normal text-dark-500">
                  rien n’est faux ici tant que la partie n’a pas parlé
                </span>
              </p>

              {audit.tally.length > 0 && (
                <div
                  data-testid="clone-audit-tally"
                  className="px-3 py-2 rounded-xl bg-dark-900/50 border border-dark-700/50 space-y-1"
                >
                  <p className="text-[11px] text-dark-300">
                    Les clones. Dans le jeu,{' '}
                    <strong className="text-dark-100">FILTRES → FERTILITÉ = fertile</strong>, puis{' '}
                    <strong className="text-dark-100">NIVEAUX</strong> resserré sur un seul niveau.
                    L’app en tient :
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {audit.tally.map((line) => (
                      <span
                        key={line.level}
                        data-testid="clone-audit-level"
                        data-level={line.level}
                        data-count={line.count}
                        className="px-2 py-0.5 rounded-lg bg-kamas/10 text-[11px] text-dark-200 tabular-nums"
                      >
                        niveau {line.level} : <strong className="text-kamas">{line.count}</strong>
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-dark-500">
                    Le jeu en montre <strong className="text-dark-300">plus</strong> ? un clonage
                    fait en jeu n’a pas été enregistré — refais-le passer par « Cloner ». Il en
                    montre <strong className="text-dark-300">moins</strong> ? une des lignes
                    ci-dessous n’existe pas dans la partie.
                  </p>
                  {/* L'invariante dont tout ceci dépend, dite plutôt que
                      supposée. Elle tient à un réglage de la mangeoire que rien
                      ici ne peut lire, et une invariante tue est une invariante
                      qu'on ne pense pas à revérifier le jour où elle cesse
                      d'être vraie. */}
                  <p className="text-[10px] text-dark-500">
                    Une fertile est au niveau {FRESH_LEVEL} tant que rien ne l’a fait monter — un
                    poulain naît ainsi, et une monture qui sort d’enclos en sort féconde. Ce qui
                    dépasse a été cloné, acheté, ou porte un niveau faux. Vaut mangeoire réglée au
                    niveau {FRESH_LEVEL}.
                  </p>
                </div>
              )}

              {claims.map((finding) =>
                finding.kind === 'double-counted' ? (
                  <div
                    key={finding.mount.id}
                    data-testid="double-counted"
                    data-mount-id={finding.mount.id}
                    data-bulk={finding.bulk}
                    className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                      seen.has(finding.mount.id)
                        ? 'bg-dark-900/30 border-dark-700/40 opacity-60'
                        : 'bg-dark-800/50 border-dark-600/50'
                    }`}
                  >
                    {mountLine(finding.mount)}
                    <span className="text-[10px] text-dark-400">
                      fertile, sans ascendance, et le compteur de vrac en tient déjà{' '}
                      <strong className="text-dark-200">{finding.bulk}</strong> de cette couleur et
                      de ce sexe — c’est peut-être la même, comptée deux fois.
                    </span>
                    {fixed.get(finding.mount.id) ? (
                      <span className="ml-auto text-[11px] text-gain">
                        {fixed.get(finding.mount.id)}
                      </span>
                    ) : (
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
                    )}
                  </div>
                ) : finding.kind === 'clone-claim' ? (
                  <CloneRow
                    key={finding.mount.id}
                    claim={finding.claim}
                    seen={seen.has(finding.mount.id)}
                    done={fixed.get(finding.mount.id)}
                    busy={busy}
                    opened={opened === finding.mount.id}
                    typed={typed}
                    reading={reading}
                    nameOf={nameOf}
                    iconOf={(colorId) => {
                      const color = byId.get(colorId);
                      return color ? colorIconUrl(color) : null;
                    }}
                    onSeen={() => markSeen(finding.mount.id)}
                    onPutBack={() => putBack(finding.mount)}
                    onOpen={() => {
                      setOpened(opened === finding.mount.id ? null : finding.mount.id);
                      setTyped('');
                    }}
                    onType={setTyped}
                    onRecast={() => recast(finding.mount)}
                  />
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
            deux écrans côte à côte. Ce relevé-ci ne trouve que ce qui est faux <em>en soi</em>.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Une ligne de clonage à trancher.
 *
 * Sortie du corps principal parce qu'elle porte trois issues, un champ de saisie
 * et sa relecture — soit plus de balisage que les deux autres classes réunies.
 * Les états restent au parent : c'est lui qui écrit, et une ligne qui garderait
 * son propre « en cours » pourrait afficher deux écritures simultanées là où il
 * n'y en a qu'une.
 */
const CloneRow = ({
  claim,
  seen,
  done,
  busy,
  opened,
  typed,
  reading,
  nameOf,
  iconOf,
  onSeen,
  onPutBack,
  onOpen,
  onType,
  onRecast,
}: {
  claim: CloneClaim;
  seen: boolean;
  done: string | undefined;
  busy: boolean;
  opened: boolean;
  typed: string;
  reading: { ok: true; identity: Recast; carried: number } | { ok: false; problem: string } | null;
  nameOf: (colorId: string) => string;
  iconOf: (colorId: string) => string | null;
  onSeen: () => void;
  onPutBack: () => void;
  onOpen: () => void;
  onType: (value: string) => void;
  onRecast: () => void;
}) => {
  const mount = claim.clone;
  const icon = iconOf(mount.colorId);

  return (
    <div
      data-testid="clone-audit-claim"
      data-mount-id={mount.id}
      data-level={mount.level}
      data-steriles={claim.held.sterile}
      /* Les originales encore là : deux ou plus, et l'effacement a peut-être
         échoué. Ce n'est pas un verdict — l'éleveur peut avoir tenu six stériles
         identiques et n'en avoir cloné que deux — donc c'est un attribut et une
         phrase, pas un bouton de correction. */
      data-survivors={claim.survivors.length}
      className={`px-3 py-2 rounded-xl border text-xs space-y-1.5 ${
        seen ? 'bg-dark-900/30 border-dark-700/40 opacity-60' : 'bg-dark-800/50 border-dark-600/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
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
        {mount.name ? (
          <CopyableText
            value={mount.name}
            title={`Copier « ${mount.name} » — le nom à chercher dans l’écurie du jeu`}
          />
        ) : (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
            title="Sans nom, la recherche de l’écurie ne sert à rien : toutes les anonymes se ressemblent. Cette ligne ne se vérifie que par le compte au niveau, ci-dessus."
          >
            {ANONYMOUS_NAME}
          </span>
        )}
        <span className="text-[10px] text-dark-500 tabular-nums">niv {mount.level}</span>
        <span className="ml-auto text-[10px] text-dark-500 tabular-nums">
          sous ce nom, l’app tient {claim.held.fertile} fertile
          {claim.held.fertile > 1 ? 's' : ''} · {claim.held.feconde} féconde
          {claim.held.feconde > 1 ? 's' : ''} · {claim.held.sterile} stérile
          {claim.held.sterile > 1 ? 's' : ''}
        </span>
      </div>

      {claim.survivors.length >= 2 && (
        <p className="text-[10px] text-dark-400">
          {claim.survivors.length} stériles portent encore cette identité exacte. Si le clonage en a
          mangé deux, la partie doit en montrer{' '}
          <strong className="text-dark-200">{claim.survivors.length - 2}</strong> — sinon
          l’effacement des originales a été refusé, et il reste à les retirer de la liste plus bas.
        </p>
      )}

      {done ? (
        <p data-testid="clone-audit-fixed" className="text-[11px] text-gain">
          {done}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="clone-audit-ok"
              onClick={onSeen}
              title="Le jeu montre bien cette monture, fertile, sous ce nom : rien à corriger."
            >
              <Check size={13} />
              Le jeu la montre
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="clone-audit-undo"
              onClick={onPutBack}
              title="Le jeu montre deux stériles sous ce nom et aucune fertile : le clonage n’a jamais eu lieu. La ligne redevient stérile."
            >
              Le clonage n’a pas eu lieu
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="clone-audit-recast"
              onClick={onOpen}
              title="Le jeu a rendu l’autre stérile : la monture existe, mais sous un autre nom et une autre ascendance."
            >
              Le jeu montre un autre nom
            </Button>
          </div>

          {opened && (
            <div className="space-y-1.5 pt-1">
              <label className="block text-[10px] text-dark-400">
                Le nom que le jeu affiche sur la survivante — c’est lui qui porte sa couleur, son
                sexe et ses deux parents.
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  data-testid="clone-audit-name"
                  value={typed}
                  onChange={(event) => onType(event.target.value)}
                  placeholder="G2 ORPO M OR-PO"
                  className="px-2 py-1 rounded-lg bg-dark-900/70 border border-dark-600/60
                    text-[11px] text-dark-100 w-48"
                />
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="clone-audit-recast-save"
                  disabled={busy || !reading?.ok}
                  onClick={onRecast}
                >
                  Corriger
                </Button>
              </div>
              {reading && !reading.ok && typed.trim().length > 0 && (
                <p data-testid="clone-audit-unreadable" className="text-[10px] text-loss-light">
                  {reading.problem}
                </p>
              )}
              {reading?.ok && (
                <p data-testid="clone-audit-preview" className="text-[10px] text-dark-400">
                  {reading.identity.sex === 'M' ? '♂' : '♀'} {nameOf(reading.identity.colorId)}, né
                  de {nameOf(reading.identity.parents![0])} ×{' '}
                  {nameOf(reading.identity.parents![1])} — porte G{reading.carried}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BreedingStableAudit;
