'use client';

import { Egg } from 'lucide-react';
import CopyableText from '@/components/ui/CopyableText';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { ANONYMOUS_NAME } from '@/lib/dofus/breeding/naming';

/**
 * Ce qu'on affiche à la place d'un nom quand la monture **reste à acheter**.
 *
 * Ce n'est pas un nom : c'est le contraire d'un nom, puisqu'il n'y a rien à
 * chercher dans le coffre. Voir `Pairing.bought` — la fenêtre annonçait
 * « Anonyme » pour une gen 1 qu'il fallait d'abord aller acheter, et « prends-en
 * une dans le tas » pour un tas qui n'existait pas.
 */
export const TO_BUY = 'achat/capture';
import type { Mate, MatingOutcome } from '@/lib/dofus/breeding/pairing';
import type { Sex } from '@/lib/dofus/breeding/stable';

/**
 * La fenêtre d'accouplement du jeu, reproduite — mais pour **saisir** ce qui est
 * né.
 *
 * Le jeu affiche cet écran avant l'accouplement : le mâle à gauche, la femelle à
 * droite, chacun avec sa couleur, sa génération et sa généalogie, l'œuf au
 * milieu, et en dessous les deux listes « Génération cible » et « Autres ». On
 * reprend cette disposition telle quelle, pour une raison qui n'est pas
 * esthétique : c'est **côte à côte avec le jeu** qu'on s'en sert. Une liste qui
 * range les mêmes informations autrement oblige à traduire d'un écran à
 * l'autre, et c'est là qu'on charge la mauvaise monture.
 *
 * Ce qu'on ajoute au modèle, et qui est toute la raison d'être de l'écran : deux
 * boutons ♂ et ♀ sur chaque issue. Le jeu montre des probabilités *avant* ; nous
 * enregistrons un résultat *après*. Un clic, et le nom à recopier en jeu apparaît
 * — voir `naming.ts` sur pourquoi ce nom est la seule chose qui distingue ensuite
 * deux montures de même couleur.
 */

/** Le glyphe du sexe, celui que le jeu pose en haut de chaque fiche. */
const SEX_GLYPH: Record<Sex, string> = { M: '♂', F: '♀' };
const SEX_LABEL: Record<Sex, string> = { M: 'Mâle', F: 'Femelle' };

type CardProps = {
  mate: Mate;
  sex: Sex;
  /**
   * Les noms portés **en jeu** par les montures de ce côté.
   *
   * Plusieurs quand la fournée charge des montures d'ascendance identique mais
   * nommées différemment — l'une renommée, l'autre pas. C'est ce qu'on cherche
   * dans la liste de l'écurie, donc ça ne peut pas se résumer à un seul.
   */
  names: string[];
  nameOf: (colorId: string) => string;
  generationOf: (colorId: string) => number;
  iconOf: (colorId: string) => string | null;
  codeOf: (colorId: string) => string;
};

const MountCard = ({ mate, sex, names, nameOf, generationOf, iconOf, codeOf }: CardProps) => (
  <div className="relative rounded-2xl bg-dark-800/60 border border-dark-700/50 p-3 space-y-2.5">
    <span
      className={`absolute top-2.5 right-3 text-sm ${sex === 'M' ? 'text-info' : 'text-loss-light'}`}
      title={SEX_LABEL[sex]}
    >
      {SEX_GLYPH[sex]}
    </span>

    <div className="flex items-center gap-3 pr-5">
      <ColorChip
        name={nameOf(mate.colorId)}
        code={codeOf(mate.colorId)}
        icon={iconOf(mate.colorId)}
        size="lg"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-dark-100 truncate">{nameOf(mate.colorId)}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <GenBadge generation={generationOf(mate.colorId)} />
          {/* Le nom se copie : c'est avec lui qu'on va chercher **cette**
              monture-là dans la barre de recherche de l'écurie du jeu, et le
              retaper de mémoire est le geste qui rate. */}
          {names.map((name) =>
            name === TO_BUY ? (
              <span
                key={name}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300
                  border border-amber-500/30"
                title="Cette monture n'est pas dans ton écurie : le plan propose de se la procurer, à l'hôtel de vente ou au filet. Elle arrivera fertile, donc elle passera par l'enclos avant de s'accoupler."
              >
                {name}
              </span>
            ) : name === ANONYMOUS_NAME ? (
              <code
                key={name}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
                title="Monture non renommée : prends-en une dans le tas, elles sont interchangeables."
              >
                {name}
              </code>
            ) : (
              <CopyableText
                key={name}
                value={name}
                title={`Copier « ${name} » — le nom à chercher dans l’écurie du jeu`}
              />
            )
          )}
        </div>
      </div>
    </div>

    {/* La généalogie, et pas pour décorer : c'est elle qui décide de ce que
        l'accouplement vise. Le jeu n'en montre qu'un niveau, et c'est aussi tout
        ce que la base enregistre — voir `pairing.ts`. */}
    <div className="pt-2 border-t border-dark-700/40 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-dark-500">Généalogie</p>
      {mate.parents ? (
        mate.parents.map((parentId, index) => (
          <div key={`${parentId}-${index}`} className="flex items-center gap-2">
            <ColorChip
              name={nameOf(parentId)}
              code={codeOf(parentId)}
              icon={iconOf(parentId)}
              size="sm"
            />
            <span className="flex-1 text-[11px] text-dark-300 truncate">{nameOf(parentId)}</span>
            <GenBadge generation={generationOf(parentId)} />
          </div>
        ))
      ) : (
        <p className="text-[11px] text-dark-600">
          Aucune — achetée ou capturée. Elle ne fera jamais viser plus haut que sa couleur.
        </p>
      )}
    </div>
  </div>
);

/** Une naissance déjà saisie sur ce croisement. */
export type PanelBirth = { colorId: string; sex: Sex; name: string };

type Props = {
  male: Mate;
  female: Mate;
  maleNames: string[];
  femaleNames: string[];
  outcomes: MatingOutcome[];
  /** La génération visée, ou `null` quand l'ascendance sort du catalogue. */
  targetGeneration: number | null;
  /** Génétons rendus par une réussite. Zéro quand aucune couleur ne nomme la cible. */
  genetons: number;
  successRate: number;
  /** Accouplements de cette forme dans la fournée. */
  total: number;
  nameOf: (colorId: string) => string;
  generationOf: (colorId: string) => number;
  iconOf: (colorId: string) => string | null;
  /** Les deux lettres d’une couleur, celles que porte le nom des montures. */
  codeOf: (colorId: string) => string;
  /**
   * Le nom à donner au poulain si telle couleur naît, de tel sexe.
   *
   * Le sexe en fait partie depuis qu'il faut pouvoir désigner **une** monture
   * dans l'écurie du jeu — voir `naming.ts`. Il n'est donc connu qu'au clic, ce
   * qui est aussi le moment où le nom sert.
   */
  nameFor: (colorId: string, sex: Sex) => string;
  births: PanelBirth[];
  onPick: (colorId: string, sex: Sex) => void;
  onUndoLast: () => void;
  /**
   * Une écriture de ce croisement est en vol.
   *
   * Les boutons se ferment le temps de l'aller-retour : un clic écrit désormais
   * en base, et deux clics rapides écriraient deux naissances pour un seul
   * accouplement restant.
   */
  busy?: boolean;
  /**
   * Le refus de la base sur le dernier clic, ou `null`.
   *
   * Affiché ici **en plus** de la bannière globale, parce que c'est ici qu'on
   * recliquera : la bannière dit qu'une écriture est perdue, cette ligne dit
   * laquelle des quatorze.
   */
  refusal?: string | null;
};

const BreedingMatingPanel = ({
  male,
  female,
  maleNames,
  femaleNames,
  outcomes,
  targetGeneration,
  genetons,
  successRate,
  total,
  nameOf,
  generationOf,
  iconOf,
  codeOf,
  nameFor,
  births,
  onPick,
  onUndoLast,
  busy = false,
  refusal = null,
}: Props) => {
  const targets = outcomes.filter((outcome) => outcome.kind === 'target');
  const others = outcomes.filter((outcome) => outcome.kind === 'other');
  const done = births.length;
  const complete = done >= total;

  const row = (outcome: MatingOutcome) => {
    const born = nameOf(outcome.colorId);

    return (
      <div
        key={outcome.colorId}
        className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border ${
          outcome.kind === 'target'
            ? 'bg-kamas/10 border-kamas/25'
            : 'bg-dark-800/50 border-transparent'
        }`}
      >
        <ColorChip name={born} code={codeOf(outcome.colorId)} icon={iconOf(outcome.colorId)} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-dark-100 truncate">{born}</p>
          <p className="text-[11px] text-dark-400 tabular-nums">
            {(outcome.probability * 100).toFixed(2)} %
          </p>
        </div>
        <GenBadge
          generation={generationOf(outcome.colorId)}
          target={outcome.kind === 'target'}
        />
        {/* Le nom ne s'affiche plus sur la ligne : il porte le sexe, donc il y
            en a deux par issue, et les deux ne tiennent pas. Chaque bouton dit
            le sien, et le nom retenu repasse en bas avec de quoi le copier. */}
        <div className="flex gap-1 shrink-0">
          {(['M', 'F'] as const).map((sex) => (
            <button
              key={sex}
              type="button"
              disabled={complete || busy}
              onClick={() => onPick(outcome.colorId, sex)}
              title={
                busy
                  ? 'Enregistrement en cours…'
                  : complete
                    ? 'Tous les accouplements de ce croisement ont déjà leur résultat.'
                    : `Un ${SEX_LABEL[sex].toLowerCase()} ${born} est né — à nommer « ${nameFor(outcome.colorId, sex)} » — enregistré au clic`
              }
              className={`w-7 h-7 rounded-lg text-[12px] border transition-all cursor-pointer
                bg-dark-800/80 border-dark-600/50 hover:border-kamas/50 hover:text-kamas
                disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-dark-600/50
                ${sex === 'M' ? 'text-info' : 'text-loss-light'}`}
            >
              {SEX_GLYPH[sex]}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    // Les `data-testid` sont là pour les tests de bout en bout, et c'est
    // délibéré : les accrocher au texte français rendrait la suite fausse au
    // premier mot réécrit, alors qu'elle doit justement survivre aux
    // reformulations pour surveiller le **comportement**. Voir `e2e/`.
    <div
      data-testid="mating-panel"
      /* La génération visée, exposée pour que la suite vérifie l'**ordre** des
         panneaux : ils descendent en génération croissante depuis que l'éleveur l'a
         demandé, et cet ordre vient du tri de `stablePlan`. Sans attribut, il
         faudrait le lire sur un libellé français, ce que ce fichier refuse
         justement de faire. `''` sur une recopie, qui ne vise rien. */
      data-generation={targetGeneration ?? ''}
      /* L'identité du croisement : les deux couleurs parentes. C'est ce qui
         distingue deux panneaux, et la suite en a besoin pour vérifier qu'elle
         parcourt bien des croisements **différents**. Le nom du poulain ne le
         disait pas : deux croisements distincts peuvent le partager, et les noms
         ne sont de toute façon pas uniques dans cet outil. */
      data-cross={`${male.colorId}+${female.colorId}`}
      className="rounded-2xl border border-dark-700/40 bg-dark-900/40 p-3 sm:p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-dark-200">
          {total} accouplement{total > 1 ? 's' : ''} de cette forme
        </span>
        <span
          data-testid="panel-progress"
          className={`text-[11px] tabular-nums ${complete ? 'text-gain' : 'text-dark-500'}`}
        >
          {done}/{total} enregistré{done > 1 ? 's' : ''}
        </span>
        {busy && <span className="text-[11px] text-dark-500">enregistrement…</span>}
      </div>

      {/* Le refus, à sa place : sur le croisement qu'il faut recliquer. Il ne
          s'efface qu'au clic suivant — voir `write-failures.ts` sur pourquoi
          rien ne disparaît tout seul ici. */}
      {refusal && (
        <p className="px-2.5 py-2 rounded-xl bg-loss/15 border border-loss/40 text-[11px]
          text-loss-light">
          Pas enregistré — {refusal}
        </p>
      )}

      {/* Les deux montures et l'œuf, dans la disposition du jeu. En colonne sous
          640 px : deux fiches côte à côte y deviendraient illisibles. */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <MountCard
          mate={male}
          sex="M"
          names={maleNames}
          nameOf={nameOf}
          generationOf={generationOf}
          iconOf={iconOf}
          codeOf={codeOf}
        />

        <div className="flex sm:flex-col items-center justify-center gap-2 px-2">
          <span
            className="w-12 h-12 rounded-2xl bg-kamas/10 border border-kamas/30 flex items-center
              justify-center"
          >
            <Egg size={22} className="text-kamas" />
          </span>
          {targets.length > 0 && targetGeneration !== null ? (
            <>
              <GenBadge generation={targetGeneration} target />
              <span className="text-[10px] text-dark-500 tabular-nums whitespace-nowrap">
                {(successRate * 100).toFixed(1)} %
              </span>
            </>
          ) : (
            <span
              className="text-[10px] text-dark-500 text-center max-w-24"
              title="Aucune couleur ne porte le nom de cette combinaison à la génération visée : le bébé naîtra forcément dans l’ascendance. C’est le régime d’une purification."
            >
              rien à gagner
            </span>
          )}
        </div>

        <MountCard
          mate={female}
          sex="F"
          names={femaleNames}
          nameOf={nameOf}
          generationOf={generationOf}
          iconOf={iconOf}
          codeOf={codeOf}
        />
      </div>

      {outcomes.length === 0 && (
        <p className="text-[11px] text-amber-400/80">
          Issues inconnues : une couleur de l&apos;ascendance manque au catalogue. Rien à saisir
          ici tant qu&apos;elle n&apos;y est pas.
        </p>
      )}

      {targets.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-dark-300">
            Génération cible{' '}
            <span className="font-normal text-dark-500">
              · {genetons} géneton{genetons > 1 ? 's' : ''} par réussite
            </span>
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">{targets.map(row)}</div>
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-dark-300">
            Autres{' '}
            <span className="font-normal text-dark-500">
              · ce que rend une tentative qui manque la cible, et qui ne paie aucun géneton
            </span>
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">{others.map(row)}</div>
        </div>
      )}

      {/* Ce qui est né, et le nom à aller écrire. C'est la seule chose de cet
          écran qui se fasse ensuite **dans le jeu**, d'où le bouton de copie :
          retaper dix caractères de mémoire est exactement là où l'on se trompe. */}
      {births.length > 0 && (
        <div className="pt-2 border-t border-dark-700/40 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold text-dark-300">
              Nés — à renommer dans le jeu
            </p>
            <button
              type="button"
              onClick={onUndoLast}
              disabled={busy}
              title="Retire ce poulain de l’écurie et rend aux deux parents l’état qu’ils avaient avant le clic."
              className="ml-auto text-[10px] text-dark-500 hover:text-loss transition-colors
                cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              annuler le dernier
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {births.map((birth, index) => (
              <span
                key={`${birth.colorId}-${birth.sex}-${index}`}
                data-testid="birth-chip"
                data-mount-name={birth.name}
                className="flex items-center gap-2 px-2 py-1 rounded-xl bg-gain/10
                  border border-gain/25"
              >
                <span className={`text-[11px] ${birth.sex === 'M' ? 'text-info' : 'text-loss-light'}`}>
                  {SEX_GLYPH[birth.sex]}
                </span>
                <span className="text-[11px] text-dark-200">{nameOf(birth.colorId)}</span>
                <CopyableText value={birth.name} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BreedingMatingPanel;
