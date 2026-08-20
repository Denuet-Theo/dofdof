'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import { auditClones, FRESH_LEVEL, type CloneClaim } from '@/lib/dofus/breeding/clone-audit';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ANONYMOUS_NAME, carriedGeneration, colorsByCode, parseMountName } from '@/lib/dofus/breeding/naming';
import type { Individual } from '@/lib/dofus/breeding/stable';
import type { WriteResult } from '@/lib/hooks/useBreeding';

/**
 * Vérifier une séance de clonage contre le jeu, et rattraper ce qui a dérapé.
 *
 * Le raisonnement — pourquoi une fertile au-dessus du niveau 1 est un clone, ce
 * que la liste ne peut pas voir, et pourquoi l'outil ne peut rien trancher tout
 * seul — est dans `clone-audit.ts`. Cet écran est la conversation qui en
 * découle, et elle tient en trois mouvements : **vérifier** un nombre, puis
 * **chercher** une poignée de noms dans le jeu, puis **corriger** ce que la
 * comparaison a dénoncé.
 *
 * ## Replié par défaut, et ce n'est pas de la timidité
 *
 * Un clone est une ligne parfaitement normale. La grande majorité de ce qui
 * s'affiche ici n'a **rien** d'anormal, et la voisine — la bannière des anonymes
 * stériles — dit exactement le contraire : elle ne paraît que quand il y a un
 * reste, et son nombre est un défaut à corriger.
 *
 * Les mettre au même niveau visuel apprendrait à ignorer les deux. Ce panneau
 * s'ouvre donc quand on vient le chercher, après une séance de clonage, et il
 * annonce un **compte** et non une alerte. C'est un outil de vérification, pas
 * un avertissement : la différence tient dans le fait qu'aucune des lignes n'est
 * accusée de quoi que ce soit tant que le jeu n'a pas parlé.
 *
 * ## Les trois issues, et pourquoi elles sont écrites en toutes lettres
 *
 * Devant l'écurie du jeu, l'éleveur cherche un nom et compte trois nombres. Ce
 * qu'il en conclut n'est pas évident — « une fertile de moins » et « une
 * stérile de plus » ne se lisent pas de la même façon selon ce qui manque — et
 * s'être trompé de conclusion coûte une seconde correction par-dessus la
 * première. Chaque issue porte donc sa phrase et son geste, côte à côte.
 *
 * ## Ce que cet écran refuse de faire
 *
 * Deviner la seconde stérile. Un clonage consomme deux montures et n'en garde
 * qu'une en mémoire — celle qui est ressortie. Quand le clonage n'a pas eu lieu,
 * l'app peut rendre son état à la ligne qu'elle a gardée, et **rien** ne lui dit
 * quelle était l'autre : `recordClonings` l'a supprimée, et la paire n'est
 * consignée nulle part.
 *
 * Fabriquer une jumelle plausible serait une invention rangée au milieu de
 * faits, c'est-à-dire précisément ce qu'un audit existe pour empêcher. On rend
 * donc la moitié qu'on sait, on dit clairement qu'il en manque une, et on
 * renvoie à l'import — où le nom lu dans le jeu suffit à la reposer.
 */

type Recast = { colorId: string; sex: 'M' | 'F'; name: string | null; parents: [string, string] | null };

type Props = {
  individuals: Individual[];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  /** Remet une monture dans son état — l'issue « le clonage n'a pas eu lieu ». */
  onUpdateIndividual: (
    id: string,
    patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'cycled' | 'name'>>
  ) => Promise<WriteResult>;
  /** Réécrit l'identité d'une ligne — l'issue « le jeu montre un autre nom ». */
  onRecastIndividual: (id: string, identity: Recast) => Promise<WriteResult>;
};

/** L'issue en cours de saisie sur une ligne : rien, ou le champ du bon nom. */
type Opened = { id: string } | null;

const BreedingCloneAudit = ({
  individuals,
  colors,
  nameOf,
  onUpdateIndividual,
  onRecastIndividual,
}: Props) => {
  const [open, setOpen] = useState(false);
  /**
   * Les lignes déjà passées en revue, pour cette ouverture seulement.
   *
   * Volontairement non persistant. Un « vu » gardé en base voudrait dire « ce
   * clone est bon », et ce n'est pas ce que le clic a établi : il a établi qu'à
   * un instant donné la partie disait la même chose que l'app. La séance
   * suivante rouvrira la même liste, ce qui coûte cinq recherches et évite de
   * faire confiance à une coche posée il y a trois semaines.
   */
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Opened>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  /** Le dernier refus de la base, affiché là où on vient de cliquer. */
  const [refused, setRefused] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Map<string, string>>(new Map());

  const live = useMemo(() => auditClones(individuals), [individuals]);

  /**
   * Le relevé **figé à l'ouverture**, comme la fournée de `BreedingCloneDialog`.
   *
   * Corriger une ligne la fait cesser d'être un clone : la fertile repasse
   * stérile, ou change d'identité, et `auditClones` ne la rend plus. Recalculée
   * à chaque changement, la liste retirait donc la ligne **au moment même où
   * elle confirmait** — le « Remise stérile. Il manque sa partenaire… » n'était
   * jamais lu, alors que c'est la seule chose que ce panneau ait à dire après un
   * clic.
   *
   * C'est le défaut que la fenêtre de clonage a déjà rencontré deux fois, sous
   * deux formes : le lot qui se réapparie sous les doigts, et le nom gardé qui
   * s'efface à l'instant d'être utile. Même remède, pour la même raison — on
   * travaille contre le relevé qu'on avait sous les yeux en ouvrant, et la
   * réouverture le rafraîchit.
   *
   * Le compte par niveau est figé avec : il sert à une comparaison qu'on fait
   * **avant** de corriger quoi que ce soit, et le voir baisser pendant qu'on
   * corrige inviterait à le recomparer au jeu, qui lui n'a pas bougé.
   */
  const [batch, setBatch] = useState<ReturnType<typeof auditClones> | null>(null);
  if (open && batch === null) setBatch(live);
  if (!open && batch !== null) {
    setBatch(null);
    setSeen(new Set());
    setFixed(new Map());
    setOpened(null);
    setTyped('');
    setRefused(null);
  }
  const audit = batch ?? live;
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
  const readName = (raw: string): { ok: true; identity: Recast; carried: number } | { ok: false; problem: string } => {
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

  /** L'issue « le clonage n'a pas eu lieu » : la ligne redevient une stérile. */
  const putBack = async (claim: CloneClaim) => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const result = await onUpdateIndividual(claim.clone.id, { fertile: false, cycled: false });
    setBusy(false);
    if (!result.ok) {
      setRefused(result.message);
      return;
    }
    setFixed((current) =>
      new Map(current).set(
        claim.clone.id,
        'Remise stérile. Il manque sa partenaire de clonage : l’app ne sait plus laquelle c’était — remets-la depuis son nom dans le jeu.'
      )
    );
    markSeen(claim.clone.id);
  };

  /** L'issue « le jeu montre un autre nom » : la ligne prend l'identité lue. */
  const recast = async (claim: CloneClaim) => {
    if (busy || !reading || !reading.ok) return;
    setBusy(true);
    setRefused(null);
    const result = await onRecastIndividual(claim.clone.id, reading.identity);
    setBusy(false);
    if (!result.ok) {
      setRefused(result.message);
      return;
    }
    setFixed((current) =>
      new Map(current).set(claim.clone.id, `Corrigée : ${reading.identity.name}.`)
    );
    setOpened(null);
    setTyped('');
    markSeen(claim.clone.id);
  };

  if (audit.claims.length === 0) return null;

  const left = audit.claims.filter((claim) => !seen.has(claim.clone.id)).length;

  return (
    <div
      data-testid="clone-audit"
      data-claims={audit.claims.length}
      className="mb-2 rounded-xl border border-dark-700/60 bg-dark-800/30"
    >
      <button
        type="button"
        data-testid="clone-audit-toggle"
        onClick={() => setOpen((current) => !current)}
        title="À faire après une séance de clonage : chaque ligne est une affirmation sur ce que la partie contient, et se vérifie par une recherche de nom dans l’écurie du jeu."
        className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        {open ? (
          <ChevronDown size={13} className="text-dark-400" />
        ) : (
          <ChevronRight size={13} className="text-dark-400" />
        )}
        <ShieldAlert size={13} className="text-kamas" />
        <span className="text-[11px] font-semibold text-dark-200">Vérifier les clonages</span>
        <span className="text-[11px] text-dark-500">
          {audit.claims.length} ligne{audit.claims.length > 1 ? 's' : ''} à confronter au jeu
          {open && left !== audit.claims.length && ` · ${left} restante${left > 1 ? 's' : ''}`}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Le contrôle qui trouve ce que la liste ne peut pas voir : un
              clonage fait en jeu et jamais enregistré ne laisse aucune ligne.
              Il ne se voit que par un total, et le jeu sait le rendre en deux
              filtres. Voir `tally` dans `clone-audit.ts`. */}
          <div
            data-testid="clone-audit-tally"
            className="px-3 py-2 rounded-xl bg-dark-900/50 border border-dark-700/50 space-y-1"
          >
            <p className="text-[11px] text-dark-300">
              Dans le jeu, <strong className="text-dark-100">FILTRES → FERTILITÉ = fertile</strong>,
              puis <strong className="text-dark-100">NIVEAUX</strong> resserré sur un seul niveau.
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
              Le jeu en montre <strong className="text-dark-300">plus</strong> ? un clonage fait en
              jeu n’a pas été enregistré — refais-le passer par « Cloner ». Il en montre{' '}
              <strong className="text-dark-300">moins</strong> ? une des lignes ci-dessous n’existe
              pas dans la partie.
            </p>
            {/* L'invariante dont tout ceci dépend, dite plutôt que supposée.
                Elle tient à un réglage de la mangeoire que rien ici ne peut
                lire, et une invariante tue est une invariante qu'on ne pense
                pas à revérifier le jour où elle cesse d'être vraie. */}
            {/* `dark-500` et non `dark-600` : relu à l'écran, le gris le plus
                sombre passait sous le seuil de lecture sur ce fond, et c'est la
                phrase qui porte l'hypothèse dont tout le panneau dépend. Une
                note de bas de page se lit en petit, pas en invisible. */}
            <p className="text-[10px] text-dark-500">
              Une fertile est au niveau {FRESH_LEVEL} tant que rien ne l’a fait monter — un poulain
              naît ainsi, et une monture qui sort d’enclos en sort féconde. Ce qui dépasse a été
              cloné, acheté, ou porte un niveau faux. Vaut mangeoire réglée au niveau {FRESH_LEVEL}.
            </p>
          </div>

          {refused && (
            <p
              data-testid="clone-audit-refusal"
              className="px-3 py-2 rounded-xl bg-loss/15 border border-loss/40 text-[11px] text-loss-light"
            >
              Pas enregistré — {refused}
            </p>
          )}

          <div className="space-y-1.5">
            {audit.claims.map((claim) => {
              const mount = claim.clone;
              const color = byId.get(mount.colorId);
              const icon = color ? colorIconUrl(color) : null;
              const done = fixed.get(mount.id);
              const isOpen = opened?.id === mount.id;

              return (
                <div
                  key={mount.id}
                  data-testid="clone-audit-claim"
                  data-mount-id={mount.id}
                  data-level={mount.level}
                  data-steriles={claim.held.sterile}
                  /* Les originales encore là : deux ou plus, et l'effacement a
                     peut-être échoué. Ce n'est pas un verdict — voir
                     `survivors` — donc c'est un attribut et une phrase, pas un
                     bouton de correction. */
                  data-survivors={claim.survivors.length}
                  className={`px-3 py-2 rounded-xl border text-xs space-y-1.5 ${
                    seen.has(mount.id)
                      ? 'bg-dark-900/30 border-dark-700/40 opacity-60'
                      : 'bg-dark-800/50 border-dark-600/50'
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
                      {claim.survivors.length} stériles portent encore cette identité exacte. Si le
                      clonage en a mangé deux, la partie doit en montrer{' '}
                      <strong className="text-dark-200">{claim.survivors.length - 2}</strong> — sinon
                      l’effacement des originales a été refusé, et il reste à les retirer de la
                      liste plus bas.
                    </p>
                  )}

                  {done ? (
                    <p data-testid="clone-audit-fixed" className="text-[11px] text-gain">
                      {done}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {/* `secondary` comme ses deux voisines, et non `ghost`.
                            En gris atténué à côté de deux boutons pleins, elle
                            se lisait **désactivée** — or c'est l'issue la plus
                            fréquente des trois, celle qui fait avancer la
                            revue. L'icône la distingue sans l'éteindre. */}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          data-testid="clone-audit-ok"
                          onClick={() => markSeen(mount.id)}
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
                          onClick={() => putBack(claim)}
                          title="Le jeu montre deux stériles sous ce nom et aucune fertile : le clonage n’a jamais eu lieu. La ligne redevient stérile."
                        >
                          Le clonage n’a pas eu lieu
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          data-testid="clone-audit-recast"
                          onClick={() => {
                            setOpened(isOpen ? null : { id: mount.id });
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
                            Le nom que le jeu affiche sur la survivante — c’est lui qui porte sa
                            couleur, son sexe et ses deux parents.
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              data-testid="clone-audit-name"
                              value={typed}
                              onChange={(event) => setTyped(event.target.value)}
                              placeholder="G2 ORPO M OR-PO"
                              className="px-2 py-1 rounded-lg bg-dark-900/70 border border-dark-600/60
                                text-[11px] text-dark-100 w-48"
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              data-testid="clone-audit-recast-save"
                              disabled={busy || !reading?.ok}
                              onClick={() => recast(claim)}
                            >
                              Corriger
                            </Button>
                          </div>
                          {reading && !reading.ok && typed.trim().length > 0 && (
                            <p
                              data-testid="clone-audit-unreadable"
                              className="text-[10px] text-loss-light"
                            >
                              {reading.problem}
                            </p>
                          )}
                          {reading?.ok && (
                            <p data-testid="clone-audit-preview" className="text-[10px] text-dark-400">
                              {reading.identity.sex === 'M' ? '♂' : '♀'}{' '}
                              {nameOf(reading.identity.colorId)}, né de{' '}
                              {nameOf(reading.identity.parents![0])} ×{' '}
                              {nameOf(reading.identity.parents![1])} — porte G{reading.carried}.
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
        </div>
      )}
    </div>
  );
};

export default BreedingCloneAudit;
