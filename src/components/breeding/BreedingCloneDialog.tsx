'use client';

import { useMemo, useState } from 'react';
import { Check, Dna } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ANONYMOUS_NAME, borneName } from '@/lib/dofus/breeding/naming';
import type { Individual } from '@/lib/dofus/breeding/stable';
import { indistinguishablePair } from '@/lib/dofus/breeding/cloning';
import type { CloningToRecord } from '@/lib/dofus/breeding/policy';
import type { CloningResult } from '@/lib/hooks/useBreeding';

/**
 * Le clonage, un par un — le pendant de `BreedingBirthDialog`.
 *
 * ## On ne choisit pas : on constate
 *
 * Deux stériles entrent, **une** monture sort, et **c'est le jeu qui tire
 * laquelle**. L'éleveur n'arbitre rien ici — il lit le résultat dans le jeu et
 * le recopie, comme il recopie une naissance.
 *
 * Cet en-tête a longtemps dit l'inverse (« c'est l'éleveur qui décide »), et ça
 * n'était pas une erreur de formulation : deux gardes en sont sortis — un bouton
 * désactivé côté carte, puis un refus au point d'écriture — qui empêchaient tous
 * deux d'**enregistrer** ce que le jeu venait de rendre, sans jamais empêcher le
 * clonage lui-même. La protection est remontée à l'appariement, où elle a un
 * sens : `cloneOptions` et `cloningsToRecord` n'apparient plus que des
 * ascendances de même génération portée, si bien qu'aucune paire proposée ici ne
 * peut coûter une génération, quel que soit le côté que le tirage rend.
 *
 * D'où deux cartes côte à côte plutôt qu'une confirmation : on montre ce que
 * chacune porte, et le clic dit laquelle est **sortie**.
 *
 * ## Le nom, encore
 *
 * Comme pour une naissance, la seule chose qui se lise dans l'écurie du jeu est le
 * **nom**. Le clone hérite de celui qu'on a choisi, donc on le donne à copier au
 * moment du clic — c'est ce qu'on ira chercher devant le coffre, et c'est la raison
 * d'être de cet écran autant que la saisie elle-même.
 *
 * ## Ce qu'il enregistre
 *
 * Les deux stériles disparaissent, une fertile prend la place de celle qu'on a
 * gardée — même couleur, même ascendance, même nom, mais sa reproduction retrouvée.
 * Pas « une des deux redevient fertile » : un clonage consomme bien **deux**
 * montures pour en rendre une, et laisser la seconde traîner fausserait le compte.
 *
 * Une stérile est toujours une monture suivie — le vrac ne porte que des fertiles,
 * par construction du type — donc il n'y a jamais rien à deviner.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les clonages de la fournée, chacun avec ses deux stériles. */
  clonings: CloningToRecord[];
  /** Les montures suivies, pour retrouver nom et ascendance derrière un identifiant. */
  individuals: Individual[];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  /** Enregistre un clonage : deux stériles partent, une fertile entre. */
  onRecord: (entries: { keep: string; drop: string }[]) => Promise<CloningResult>;
};

const BreedingCloneDialog = ({
  isOpen,
  onClose,
  clonings,
  individuals,
  colors,
  nameOf,
  onRecord,
}: Props) => {
  const [saving, setSaving] = useState(false);
  /**
   * Les clonages **déjà écrits en base**, par identifiant de clonage.
   *
   * Un clonage s'enregistre au clic, comme une naissance. Ce n'était pas le cas
   * — tout s'empilait dans un `Map` et partait au bouton final — et c'est la
   * forme exacte qui a coûté 22 montures à la saisie de naissance : un échec, ou
   * une fenêtre refermée, et tout le lot disparaissait sans un mot.
   *
   * On retient donc l'identifiant de ce qui est fait, et non l'indice d'un
   * brouillon : c'est ce qui permet de retirer un clonage du lot restant sans
   * dépendre d'une position dans une liste qui se recalcule.
   */
  const [done, setDone] = useState<Set<string>>(new Set());

  /**
   * Les montures gardées, **photographiées au clic**, dans l'ordre des choix.
   *
   * C'est la seule chose que cet écran doive rendre à l'éleveur : les noms à
   * aller chercher dans l'écurie du jeu.
   *
   * ## Pourquoi une photo et pas un identifiant
   *
   * `recordClonings` **insère le clone** — une ligne neuve, un id neuf — puis
   * **supprime les deux originales**. Au retour de l'écriture, l'identifiant
   * gardé ne désigne donc plus rien, et tout `byId.get(...)` posé dessus rend
   * `undefined`.
   *
   * Le récapitulatif de fin le faisait : il annonçait « les noms à chercher dans
   * l'écurie du jeu » et affichait **« Anonyme » pour chacun**, faute de trouver
   * la ligne. La seule information que cet écran existe pour rendre, il la
   * perdait à l'instant précis où elle devenait utile.
   *
   * Séparé de `done`, et pas fondu dedans : `done` décide de ce qui sort du lot,
   * `kept` de ce qui s'affiche. Les confondre ferait dépendre l'un de l'autre, et
   * une photo manquante rendrait à la liste un clonage déjà écrit — donc une
   * seconde écriture du même geste.
   */
  const [kept, setKept] = useState<Individual[]>([]);
  /** Le dernier refus de la base, affiché là où il faut recliquer. */
  const [refused, setRefused] = useState<string | null>(null);

  /**
   * Les clonages écartés à la main, sans rien écrire.
   *
   * Le lot est figé à l'ouverture, et le jeu, lui, ne l'est pas : une paire
   * proposée peut ne plus exister — les montures ont été clonées entre-temps,
   * ou l'une d'elles a servi ailleurs. Sans porte de sortie, l'écran restait
   * planté sur un clonage infaisable, et le seul geste disponible était de le
   * déclarer fait, c'est-à-dire d'écrire en base un clonage qui n'a pas eu lieu.
   *
   * Écarter n'enregistre donc rien du tout et ne compte pas comme fait : la
   * paire réapparaîtra à la prochaine ouverture si `cloneOptions` la propose
   * encore, ce qui est exactement le comportement voulu — l'outil ne voit pas
   * le jeu, et c'est l'éleveur qui tranche.
   */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  /**
   * Le lot **figé à l'ouverture**, pour la même raison que la fournée de
   * naissances — voir `BreedingBirthDialog`.
   *
   * `clonings` vient de `cloneOptions`, qui réapparie **toute** l'écurie à
   * chaque changement. Or un clonage écrit en retire deux stériles : les paires
   * suivantes se reforment donc autrement, et le lot se réordonne sous les
   * doigts. Mesuré : un « Fait » sur quatorze clonages anonymes en laissait
   * sept, pas treize — les douze stériles restantes s'étaient réappariées
   * différemment.
   *
   * On saisit donc contre le lot qu'on avait sous les yeux en ouvrant, et la
   * réouverture le rafraîchit.
   */
  const [batch, setBatch] = useState<CloningToRecord[] | null>(null);
  if (isOpen && batch === null) setBatch(clonings);
  if (!isOpen && batch !== null) {
    setBatch(null);
    setDone(new Set());
    setKept([]);
    setSkipped(new Set());
    setRefused(null);
  }
  const lot = batch ?? clonings;

  const byId = useMemo(
    () => new Map(individuals.map((mount) => [mount.id, mount])),
    [individuals]
  );
  const iconOf = useMemo(() => {
    const icons = new Map(colors.map((color) => [color.id, colorIconUrl(color)]));
    return (colorId: string) => icons.get(colorId) ?? null;
  }, [colors]);

  /**
   * Tout ce qui arrive ici se tranche.
   *
   * La fenêtre portait un compteur pour les paires **sans ascendance des deux
   * côtés** : rien ne les distinguait, donc « laquelle gardes-tu » n'avait pas
   * de réponse, et elles se soldaient en bloc. Elles ne sont plus proposées du
   * tout — voir `cloningsToRecord`, qui les écarte à la source parce que leur
   * clone est une gen 1 nue, c'est-à-dire ce qui s'achète pour trois fois rien.
   *
   * Il ne reste donc que des clonages où au moins un côté porte une lignée, et
   * l'écran n'a plus qu'un mode.
   */
  const decisions = lot;

  const skip = (entry: CloningToRecord) =>
    setSkipped((current) => new Set(current).add(entry.first));

  /** Ce qui reste à faire : le fait s'en retire écrit, l'écarté s'en retire nu. */
  const pending = (entry: CloningToRecord) =>
    !done.has(entry.first) && !skipped.has(entry.first);
  const remaining = decisions.filter(pending);
  const current = remaining[0] ?? null;

  /**
   * Enregistre un clonage, et ne le retire du lot que s'il est passé.
   *
   * `keep` est l'identifiant gardé ; `entry.first` sert de clé, parce que c'est
   * lui qui identifie le clonage quelle que soit la monture retenue.
   */
  const record = async (entry: CloningToRecord, keep: 'first' | 'second') => {
    if (saving) return;

    // Photographiée **avant** l'écriture, qui détruit les deux originales et
    // insère le clone sous un identifiant neuf : après elle, il n'y a plus rien
    // à relire. Voir `kept`.
    const keptMount = byId.get(keep === 'first' ? entry.first : entry.second) ?? null;

    setSaving(true);
    setRefused(null);
    const result = await onRecord([
      keep === 'first'
        ? { keep: entry.first, drop: entry.second }
        : { keep: entry.second, drop: entry.first },
    ]);
    setSaving(false);

    if (!result.ok) {
      setRefused(result.message);
      return;
    }
    setDone((current) => new Set(current).add(entry.first));
    if (keptMount) setKept((current) => [...current, keptMount]);
  };

  /**
   * La monture du clonage **précédent**, celle qu'on vient de garder.
   *
   * Le clic faisait disparaître la seule information dont l'éleveur a besoin
   * juste après l'avoir donnée : le nom à chercher dans l'écurie du jeu. Un
   * récapitulatif existait, mais en **bout de lot** — donc onze clics trop tard
   * sur une fournée de douze, et emporté dès qu'on refermait la fenêtre.
   *
   * `kept` est dans l'ordre des choix : la dernière photo est le dernier clic.
   */
  const previousKept = kept.length > 0 ? kept[kept.length - 1] : null;

  /**
   * Les deux stériles sont **indiscernables** : deux exemplaires de la même
   * monture.
   *
   * Même couleur, même ascendance, même sexe, même nom — donc deux cartes
   * rigoureusement identiques, côte à côte, avec deux boutons qui font
   * exactement la même chose. C'est `cloneOptions` qui les apparie exprès, et
   * pour la meilleure des raisons : le clone est le même des deux côtés, donc le
   * tirage du jeu ne lance aucune pièce (`keepChance` vaut 1, le sexe est
   * certain). Voir la première passe de `pairTwins`.
   *
   * Il n'y a donc rien à départager, et demander de choisir entre deux choses
   * identiques est une question sans réponse — l'éleveur la relit deux fois avant
   * de comprendre qu'elle n'en attend pas.
   *
   * On montre alors **une** carte et un « × 2 ». Le nom est le même, celui qu'on
   * ira chercher ; la quantité est la seule chose que la seconde carte ajoutait.
   */
  const twinPair = (entry: CloningToRecord): boolean => {
    const a = byId.get(entry.first);
    const b = byId.get(entry.second);
    if (!a || !b) return false;
    // La même notion que celle qui **ordonne** la liste : `cloneOptions` met les
    // doublons en tête parce qu'ils vont cinq fois plus vite en jeu, et cet écran
    // les affiche « × 2 ». Deux définitions séparées finiraient par diverger, et
    // on lirait un « × 2 » sur une paire qui n'a pas été priorisée — ou l'inverse.
    return indistinguishablePair(a, b);
  };

  /**
   * Une des deux stériles, telle qu'on la choisit.
   *
   * L'ascendance est affichée parce que c'est ce qui décide de leurs cibles : même
   * génération — le clonage l'exige — mais pas les mêmes possibilités ensuite.
   *
   * Le **sexe** est affiché parce que c'est ce qui permet de les retrouver. Deux
   * gen 1 anonymes de même couleur et sans ascendance donnaient deux cartes
   * rigoureusement identiques : même vignette, même « Doré », même « sans
   * ascendance connue », même « Anonyme ». L'écran demandait alors de choisir
   * entre deux choses indiscernables, et le choix ne pouvait pas se reporter en
   * jeu — où le sexe est justement le seul tri disponible sur un tas d'Anonymes.
   *
   * Tous les autres écrans d'élevage le portent déjà — l'écurie, l'extraction,
   * la sortie d'enclos, la fenêtre d'accouplement. Celui-ci était le seul à
   * l'oublier, et c'est celui où deux montures se ressemblent le plus.
   */
  const card = (mountId: string, side: 'left' | 'right') => {
    const mount = byId.get(mountId);
    if (!mount) return null;

    /* Le bouton « Perdrait la gén. N », désactivé, vivait ici. Il partait d'une
       erreur sur la mécanique du jeu : on croyait que l'éleveur choisissait la
       survivante. Il ne choisit pas — **le jeu tire au hasard**, et cet écran ne
       fait que consigner ce qui est sorti.

       Un garde ici n'empêchait donc rien : la paire dépareillée continuait
       d'être proposée, le clonage se faisait en jeu, et le seul effet du bouton
       mort était d'interdire d'enregistrer le résultat quand le tirage était
       défavorable — c'est-à-dire de faire mentir l'écurie sur son propre
       contenu, précisément le jour où elle venait de perdre une lignée.

       La règle est remontée là où elle protège quelque chose : `cloneOptions` et
       `cloningsToRecord` n'apparient plus que des ascendances de **même
       génération portée**. Aucune paire qui arrive ici ne peut donc coûter une
       génération, quel que soit le côté que le jeu rend. */
    const icon = iconOf(mount.colorId);
    const parents = mount.parents
      ? `${nameOf(mount.parents[0])} × ${nameOf(mount.parents[1])}`
      : 'sans ascendance connue';

    return (
      // Une carte **et** un bouton, et non une carte qui **est** un bouton.
      //
      // Toute la carte était cliquable, ce qui rendait son texte inatteignable :
      // sélectionner le nom pour le copier revenait à trancher le clonage. Or
      // c'est ce nom-là qu'on va chercher dans l'écurie du jeu — la carte
      // existe pour lui autant que pour le choix.
      //
      // D'où la séparation : le contenu se lit et se sélectionne, et le geste a
      // son bouton, nommé. Ça règle aussi un défaut de structure — `CopyableText`
      // est un bouton, et un bouton dans un bouton n'est pas du HTML valide,
      // donc le nom ne pouvait pas devenir copiable tant que la carte en était un.
      <div
        data-testid="clone-card"
        className="flex-1 flex flex-col items-center gap-2 px-4 py-4 rounded-2xl border
          bg-dark-800/60 border-dark-600/50 transition-all hover:border-dark-500"
      >
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="w-12 h-12 object-contain" />
        )}
        <span className="flex items-center gap-1.5 text-sm font-semibold text-dark-100">
          <span
            data-testid="clone-sex"
            className={mount.sex === 'M' ? 'text-info' : 'text-loss-light'}
            title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
          >
            {mount.sex === 'M' ? '♂' : '♀'}
          </span>
          {nameOf(mount.colorId)}
        </span>
        <span className={`text-[11px] text-dark-400 ${side === 'left' ? 'text-left' : 'text-right'}`}>
          {parents}
        </span>
        {mount.name ? (
          <CopyableText
            value={mount.name}
            title={`Copier « ${mount.name} » — le nom à chercher dans l’écurie du jeu`}
          />
        ) : (
          <span
            className="text-[11px] text-dark-500"
            title="Monture non renommée : prends-en une de ce sexe dans le tas, elles sont interchangeables."
          >
            {ANONYMOUS_NAME}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="mt-1 w-full"
          disabled={saving}
          onClick={() => current && record(current, side === 'left' ? 'first' : 'second')}
          title="Le clone prend sa place, son nom et son ascendance. L’autre stérile disparaît. Enregistré au clic."
        >
          {/* « Celle-ci » suppose un choix. Sur une paire indiscernable il n'y
              en a pas, et poser la question ferait chercher une différence qui
              n'existe pas. */}
          {saving
            ? 'Enregistrement…'
            : current && twinPair(current)
              ? 'Enregistrer le clonage'
              : 'C’est celle-ci qui est sortie'}
        </Button>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        decisions.length === 0
          ? `Clonages — aucun à faire`
          : `Clonage ${decisions.length - remaining.length + (current ? 1 : 0)} / ${decisions.length}`
      }
    >
      <div className="space-y-4">

        {/* Le nom qu'on vient de garder, en haut et copiable.
            C'est ce que le clic effaçait : la monture choisie quitte l'écran au
            moment même où son nom devient utile, puisque c'est elle qu'il faut
            aller chercher dans l'écurie du jeu.

            En haut plutôt qu'en bas : c'est là que le regard revient après le
            clic, le titre « Clonage 2 / 12 » y est déjà, et le récapitulatif de
            fin — qui reste — arrive de toute façon trop tard pour ça. */}
        {previousKept && (
          <div
            data-testid="clone-previous"
            data-mount-id={previousKept.id}
            className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
              bg-kamas/10 border border-kamas/25"
          >
            <span className="text-[11px] text-dark-400">Monture précédente, à garder :</span>
            <span
              className={`text-[11px] ${
                previousKept.sex === 'M' ? 'text-info' : 'text-loss-light'
              }`}
              title={previousKept.sex === 'M' ? 'Mâle' : 'Femelle'}
            >
              {previousKept.sex === 'M' ? '♂' : '♀'}
            </span>
            <span className="text-[11px] text-dark-200">{nameOf(previousKept.colorId)}</span>
            {previousKept.name === null ? (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
                title="Monture non renommée : prends-en une de ce sexe dans le tas, elles sont interchangeables."
              >
                {ANONYMOUS_NAME}
              </span>
            ) : (
              <CopyableText
                value={previousKept.name}
                title={`Copier « ${previousKept.name} »`}
              />
            )}
          </div>
        )}

        {refused && (
          <p
            data-testid="clone-refusal"
            className="px-3 py-2 rounded-xl bg-loss/15 border border-loss/40 text-[11px]
              text-loss-light"
          >
            Pas enregistré — {refused}
          </p>
        )}

        {current ? (
          <>
            {/* Deux phrases, parce qu'il y a deux situations. Demander « laquelle
                est sortie » devant deux exemplaires de la même monture fait
                chercher une différence qui n'existe pas — c'est la question
                elle-même qu'il faut retirer, pas seulement la seconde carte. */}
            {twinPair(current) ? (
              <p className="text-[11px] text-dark-400">
                Les deux stériles sont <strong className="text-dark-200">identiques</strong> —
                même couleur, même ascendance, même sexe, même nom. Le clone est le même quel
                que soit le côté que le jeu rend : rien à départager, il n’y a qu’à consigner
                que c’est fait.
              </p>
            ) : (
              <p className="text-[11px] text-dark-400">
                Deux stériles entrent, une monture sort, et{' '}
                <strong className="text-dark-200">c’est le jeu qui tire laquelle</strong> — dis
                ici celle qui est sortie. Les deux portent la même génération, donc le tirage ne
                te coûte aucune lignée : ce qui change est l’ascendance du clone, et avec elle ce
                qu’il pourra viser.
              </p>
            )}

            <div
              className="flex items-stretch gap-3"
              data-testid="clone-pair"
              /* Ce que chaque côté porte, exposé pour être vérifiable : les deux
                 doivent être égaux, sans quoi le tirage du jeu coûterait une
                 génération une fois sur deux. L'écran ne le dit pas autrement —
                 une anonyme n'a pas de nom pour le porter. */
              data-carried={current.carried.join(',')}
              /* La génération de la paire, et si c'est un doublon : c'est l'ordre
                 de la liste que la suite vérifie — doublons en tête à génération
                 égale, parce qu'ils vont cinq fois plus vite en jeu. Sans
                 attributs il faudrait lire « gén. 2 » et compter des cartes, ce
                 que ce fichier refuse de faire. */
              data-generation={current.generation}
              data-duplicate={twinPair(current) ? 'true' : 'false'}
            >
              {card(current.first, 'left')}
              <div className="flex flex-col items-center justify-center gap-1 px-2">
                <Dna size={18} className="text-kamas" />
                <span className="text-[10px] text-dark-500 tabular-nums">
                  gén. {current.generation}
                </span>
              </div>
              {/* Deux exemplaires de la même monture : un « × 2 » au lieu d'une
                  seconde carte à l'identique. Voir `twinPair`. Le bouton de la
                  carte de gauche suffit — les deux faisaient déjà la même
                  chose. */}
              {twinPair(current) ? (
                <div
                  data-testid="clone-twin"
                  className="flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl
                    border border-dashed border-dark-600/50 bg-dark-800/20"
                  title="Les deux stériles sont identiques — même couleur, même ascendance, même sexe, même nom. Le clone est le même quel que soit le côté que le jeu rend : il n’y a rien à départager."
                >
                  <span className="text-3xl font-bold text-kamas tabular-nums">× 2</span>
                  <span className="text-[11px] text-dark-400 px-3 text-center">
                    deux fois la même — rien à départager
                  </span>
                </div>
              ) : (
                card(current.second, 'right')
              )}
            </div>

            {/* La sortie. Discrète — ce n'est pas le geste courant — mais
                présente, parce que sans elle le seul moyen d'avancer sur une
                paire que le jeu n'a plus était de la déclarer faite. */}
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="clone-skip"
                disabled={saving}
                onClick={() => skip(current)}
                title="Rien n’est enregistré : ce clonage sort de la liste pour cette fois, et reviendra à la prochaine ouverture s’il est encore proposé."
                className="text-[11px] text-dark-500 hover:text-dark-200 transition-colors
                  cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Passer — infaisable en jeu
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-dark-300">
              {decisions.length === 0
                ? 'Aucun clonage ne demande d’arbitrage sur cette fournée.'
                : `Les ${decisions.length} clonages à départager sont tranchés. Les noms à chercher dans l’écurie du jeu :`}
            </p>
            {/* Le sexe accompagne chaque nom, et il n'est pas décoratif sur les
                anonymes : c'est le seul tri dont on dispose devant un tas
                d'« Anonyme » de même couleur. Une liste de six « Anonyme » nus
                ne dit pas lesquelles aller chercher. */}
            <div className="flex flex-wrap gap-2">
              {/* Les photos prises au clic, et non des `byId.get(...)` sur des
                  identifiants que l'écriture a détruits — c'est ce qui faisait
                  afficher « Anonyme » à la place de chaque nom promis. Voir
                  `kept`. */}
              {kept.map((mount, index) => {
                const name = borneName(mount);

                return (
                  <span key={`${mount.id}-${index}`} className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] ${
                        mount.sex === 'M' ? 'text-info' : 'text-loss-light'
                      }`}
                      title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
                    >
                      {mount.sex === 'M' ? '♂' : '♀'}
                    </span>
                    {name === ANONYMOUS_NAME ? (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
                        title="Monture non renommée : prends-en une de ce sexe dans le tas, elles sont interchangeables."
                      >
                        {name}
                      </span>
                    ) : (
                      <CopyableText value={name} title={`Copier « ${name} »`} />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Collée en bas, pour la même raison qu'à la saisie des naissances : un
            bouton qui sort de l'écran fait croire que le geste est fait. Voir
            `BreedingBirthDialog`, où ça a coûté une soirée de saisie.

            Plus de « Revenir » : il défaisait un brouillon, et il n'y en a plus.
            Un clonage écrit est un clonage fait en jeu, où il est irréversible —
            deux montures détruites. Une saisie de travers se corrige dans
            « Mon écurie », qui montre ce qu'il y a vraiment. */}
        <div
          className="sticky bottom-0 -mx-1 px-1 py-3 flex items-center gap-2
            bg-dark-900/95 backdrop-blur-sm border-t border-dark-700/60"
        >
          {/* Les écartés se comptent à part, et surtout pas avec les
              enregistrés : ce compteur dit ce que la base a pris. */}
          <span className="text-[11px] text-dark-500 tabular-nums">
            {done.size} / {lot.length} enregistré{done.size > 1 ? 's' : ''}
            {skipped.size > 0 && ` · ${skipped.size} passé${skipped.size > 1 ? 's' : ''}`}
          </span>
          <Button
            size="sm"
            variant={current ? 'secondary' : 'primary'}
            className="ml-auto"
            disabled={saving}
            onClick={onClose}
          >
            <Check size={13} />
            {current ? 'Fermer — rien ne se perd' : 'Fermer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BreedingCloneDialog;
