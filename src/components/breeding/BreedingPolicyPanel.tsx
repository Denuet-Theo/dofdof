'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Dna,
  Egg,
  Gem,
  Heart,
  Lock,
  LockOpen,
  LogOut,
  RefreshCw,
  Hammer,
  Store,
  Trophy,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import BreedingBirthDialog from '@/components/breeding/BreedingBirthDialog';
import BreedingCloneDialog from '@/components/breeding/BreedingCloneDialog';
import BreedingCloneAdvice from '@/components/breeding/BreedingCloneAdvice';
import BreedingEnclosExitDialog, {
  type EnclosExitResult,
} from '@/components/breeding/BreedingEnclosExitDialog';
import BreedingExtraction from '@/components/breeding/BreedingExtraction';
import BreedingHdv from '@/components/breeding/BreedingHdv';
import BreedingSuccess from '@/components/breeding/BreedingSuccess';
import { sellSheet, type HdvContext } from '@/lib/dofus/breeding/hdv';
import { couplesToRecord, type StablePlan } from '@/lib/dofus/breeding/policy';
import {
  nextPenIndex,
  pennedUnits,
  type BatchPen,
  type BatchUnit,
} from '@/lib/dofus/breeding/batch';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import { unavailableFor } from '@/lib/dofus/breeding/batch';
import { formatCountdown } from '@/lib/dofus/breeding/countdown';
import { acquiredMountId } from '@/lib/dofus/breeding/unit-plan';
import { BULK_MATE_LEVEL } from '@/lib/dofus/breeding/pairing';
import type { BreedingColor } from '@/lib/dofus/breeding/costs';
import type { CloneOption, SterileMount } from '@/lib/dofus/breeding/cloning';
import type { ExtractionCandidate } from '@/lib/dofus/breeding/extraction';
import type { Stable } from '@/lib/dofus/breeding/stable';
import RecipeModal from '@/components/recipes/RecipeModal';
import type { PriceTarget } from '@/components/recipes/RecipeDetails';
import type { ItemPrice } from '@/lib/supabase/types';
import type { RecipeIndex } from '@/lib/utils/recipes';
import type { BreedingRow, DEFAULT_SETTINGS } from '@/lib/hooks/useBreeding';

type Settings = typeof DEFAULT_SETTINGS;
import { MINUTE_MS, useWallClock } from '@/lib/hooks/useWallClock';
import type { Couple, Individual } from '@/lib/dofus/breeding/stable';
import type {
  BirthEntry,
  BirthRecord,
  CloningResult,
  RecordBirthsResult,
} from '@/lib/hooks/useBreeding';
import type { BreedingBatchState } from '@/lib/hooks/useBreedingBatch';

/**
 * Un montant en kamas, court : les millions au centième, sinon les milliers.
 *
 * Le rythme mensuel se compte en millions et une fournée en dizaines de milliers,
 * donc une seule échelle rendrait l'un des deux illisible — « 0,03 M » ne se
 * compare pas de tête à « 0,76 M », alors que « 25 500 » et « 0,76 M » se lisent.
 */
const kamasOf = (value: number): string =>
  Math.abs(value) >= 1e6
    ? `${(value / 1e6).toFixed(2).replace('.', ',')} M`
    : `${Math.round(value).toLocaleString('fr-FR')}`;

/** Le rythme, toujours en millions — c'est l'unité dans laquelle il a été mesuré. */
const millionsLabel = (value: number): string =>
  `${(value / 1e6).toFixed(2).replace('.', ',')} M`;

/**
 * Les deux prix d'une Optimakina : celui qu'on paie, et celui qu'on évite.
 *
 * La liste disait « À fabriquer » et donnait un montant, sans dire à quoi il se
 * comparait. C'est un ordre sans sa raison : devant l'hôtel de vente, l'éleveur
 * voit une enchère et n'a rien pour savoir si elle bat sa recette — il a demandé
 * la comparaison, et c'est elle.
 *
 * Le prix retenu est en kamas, l'autre **barré** : le trait dit « celui-là, tu ne
 * le paies pas » sans qu'il faille relire l'en-tête de la liste. L'écart suit,
 * parce qu'un chiffre absolu ne dit pas s'il vaut le détour par l'atelier.
 *
 * L'écart est toujours une économie, et ce n'est pas une supposition :
 * `OptimakinaAdvice` garantit que la source non retenue n'est jamais moins
 * chère. Le cas nul est donc « même prix », qui arrive à égalité — l'achat gagne
 * alors, parce qu'il est immédiat.
 *
 * **Et le plafond ferme la ligne.** Il vivait dans l'infobulle, donc nulle part :
 * une infobulle ne se lit pas au moment où l'on compare des enchères à l'hôtel de
 * vente. C'est pourtant le seul des quatre nombres qui vaille pour **demain** —
 * les deux prix sont ceux du jour, l'écart en découle, tandis que « rentable
 * jusqu'à 14 940 » se garde en tête et tranche une enchère qu'on n'avait pas
 * prévue. L'éleveur l'a demandé directement à l'écran, et c'est là qu'il sert.
 */
const OptimakinaPrices = ({
  source,
  price,
  buy,
  craft,
  ceiling,
}: {
  source: 'achat' | 'fabrication';
  price: number;
  buy: number | null;
  craft: number | null;
  ceiling: number;
}) => {
  const mine = source === 'achat' ? 'HDV' : 'fabrication';
  const other = source === 'achat' ? craft : buy;
  const otherLabel = source === 'achat' ? 'fabrication' : 'HDV';
  // Pourquoi l'autre source manque, et non un silence : « aucun prix HDV » et
  // « fabrication non chiffrable » se corrigent, l'un en relevant une enchère,
  // l'autre en tarifant un ingrédient. Un tiret ne se corrige pas.
  const absent = source === 'achat' ? 'fabrication non chiffrable' : 'aucun prix HDV';

  return (
    <span
      data-testid="optimakina-comparison"
      data-source={source}
      data-alternative={other ?? ''}
      data-ceiling={Math.round(ceiling)}
      className="text-[10px] leading-none text-dark-500 tabular-nums"
    >
      <span className="text-kamas">
        {mine} {Math.round(price).toLocaleString('fr-FR')}
      </span>
      {' · '}
      {other === null ? (
        <span className="italic">{absent}</span>
      ) : (
        <>
          <span className="line-through decoration-dark-500/70">
            {otherLabel} {Math.round(other).toLocaleString('fr-FR')}
          </span>
          {' · '}
          <span>
            {other > price ? `−${Math.round((1 - price / other) * 100)} %` : 'même prix'}
          </span>
        </>
      )}
      {' · '}
      <span className="text-dark-400">
        rentable jusqu’à {Math.round(ceiling).toLocaleString('fr-FR')}
      </span>
    </span>
  );
};

/**
 * Ce que la politique fait de l'écurie : quatre gestes, **un seul à l'écran**.
 *
 * ## Pourquoi les onglets sont étanches
 *
 * Ils ne l'étaient pas. L'onglet ne changeait que l'en-tête et son bouton ;
 * en dessous, le même bloc déroulait toujours tout — la fournée découpée en
 * enclos, les fécondations, les clonages, la liste à sortir du coffre. Choisir
 * « Accouplement » affichait donc cinq enclos à charger, et l'écran donnait
 * quatre consignes simultanées pour un joueur qui n'a qu'une fenêtre de jeu
 * ouverte devant lui.
 *
 * Chaque geste se fait dans le jeu, une monture à la fois, en cherchant un nom.
 * Un onglet montre **ce geste-là** et rien d'autre.
 *
 * ## Pourquoi la fournée se charge enclos par enclos, avec un verrou
 *
 * C'est le défaut que plusieurs joueurs ont remonté dans les mêmes termes : on
 * charge les enclos le matin, on revient le soir pour les sortir, « et ce ne
 * sont plus les mêmes ». Ce n'était pas une impression. La fournée était
 * recalculée à chaque rendu depuis l'écurie du moment ; entre le chargement et
 * la sortie, l'écurie bouge — naissances saisies, achats, clonages — donc la
 * politique reproposait une autre fournée et la fenêtre de sortie offrait des
 * montures qui n'avaient jamais vu l'enclos.
 *
 * Le verrou écrit ce que le jeu, lui, sait déjà : cet enclos-ci contient ces
 * dix montures-là depuis telle heure. Voir `batch.ts`. Une fois posé, plus rien
 * ne le recalcule.
 *
 * D'où un enclos à la fois : c'est le geste réel — on ouvre un enclos, on y met
 * dix montures, on le referme, on passe au suivant. La liste complète des cinq
 * enclos obligeait à retrouver soi-même où l'on en était au milieu.
 */

type Step = 'mate' | 'clone' | 'load' | 'extract' | 'hdv' | 'success';

const STEPS: { id: Step; label: string; icon: typeof Heart }[] = [
  { id: 'mate', label: 'Accouplement', icon: Heart },
  { id: 'clone', label: 'Clonage', icon: Dna },
  { id: 'load', label: 'Fournée', icon: Egg },
  { id: 'extract', label: 'Extraction', icon: Gem },
  // Le dernier geste de la journée, et le seul qui se fasse hors de l'écurie :
  // ce qu'on met en vente et ce qu'on accepte de payer. Après l'extraction parce
  // qu'on y arrive avec ce qu'on vient d'en tirer.
  { id: 'hdv', label: 'HDV', icon: Store },
  // Le succès de collection, en dernier : c'est le seul onglet qui ne dise rien
  // du geste à faire maintenant. Il arbitre ce que la politique poursuit, pas
  // comment on charge l'enclos.
  { id: 'success', label: 'Succès', icon: Trophy },
];

type Props = {
  /** Ce que la politique ferait de l'écurie, ou `null` si elle ne peut pas répondre. */
  fill: StablePlan | null;
  /** La fournée réellement en enclos, et les gestes qui la font avancer. */
  batch: BreedingBatchState;
  /** Tous les accouplements réalisables maintenant, bouclés par la page (#165). */
  couples?: Couple[];
  /** Ce que valent les stériles de l'écurie, à l'onglet « Clonage ». */
  cloneAdvice?: CloneOption[];
  /**
   * Combien de clonages la **fournée d'accouplements** suppose en tout.
   *
   * Distinct de `cloneAdvice`, qui n'énumère que les paires formables tout de
   * suite. La boucle de `couplesToRecordAll` en suppose davantage : chaque vague
   * saisie stérilise ses parents, et deux stériles de même génération sont une
   * paire de plus. Elle planifiait donc sur une écurie déjà clonée sans que
   * l'écran l'ait jamais demandé — 22 clonages tenus pour acquis sur l'écurie du
   * 15/08, et quatre accouplements qui repoussaient faute de les avoir faits.
   */
  assumedCloningCount?: number;
  /** Les stériles que le projet protège et qu'aucun clonage n'apparie encore. */
  cloneHeld?: SterileMount[];
  /** La couleur visée par le projet, pour nommer ce qu'une monture protégée sert. */
  objectiveName?: string | null;
  /** Ce qui s'extrait, et rien d'autre, à l'onglet « Extraction ». */
  extraction?: ExtractionCandidate[];
  /** Ambre, neurone ou corne : ce que l'extraction rend dans cette famille. */
  sacrificeName?: string;
  nameOf: (colorId: string) => string;
  /**
   * Les Optimakina qui se remboursent, et par quelle source les avoir.
   *
   * Deux usages, et c'est pour ça qu'elles arrivent en liste plutôt qu'en
   * fonction : au-dessus du bouton d'accouplement pour savoir **quoi préparer
   * avant** la fournée, et entre les deux montures au moment d'accoupler pour
   * savoir laquelle poser **maintenant**. Voir `worthwhileOptimakina`.
   */
  optimakina?: {
    generation: number;
    /** L'item, pour ouvrir sa carte de recette. */
    itemId: number;
    name: string;
    source: 'achat' | 'fabrication';
    price: number;
    /** Les deux prix relevés, pour montrer ce que la source retenue fait gagner. */
    buy: number | null;
    craft: number | null;
    ceiling: number;
    /** L'icône de l'item, ou `null` s'il n'est pas tarifé. */
    iconUrl?: string | null;
  }[];
  /**
   * Les prix relevés, pour la carte de recette qu'une puce d'Optimakina ouvre.
   *
   * La table entière et non les seuls montants : la carte montre les noms, les
   * icônes et **l'ancienneté** de chaque saisie, et c'est cette dernière qui
   * répond à « est-ce que les prix ont bougé depuis ». Absente, la puce reste ce
   * qu'elle était et ne s'ouvre pas.
   */
  itemPrices?: Map<number, ItemPrice>;
  /** L'index qui a chiffré la puce — voir `useOptimakinaCraft`. */
  craftIndex?: RecipeIndex;
  /** Un prix confirmé par la base, à répercuter sur le conseil sans recharger. */
  onItemPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
  individuals?: Individual[];
  colors?: BreedingColor[];
  /** Les coûts de revient par couleur, pour l'onglet « HDV ». */
  rows?: BreedingRow[];
  /** L'écurie entière — le vrac compte, et les partenaires d'un raccourci aussi. */
  stable?: Stable;
  /** Les couleurs déjà nées, pour l'onglet « Succès ». */
  hatched?: ReadonlySet<string>;
  /** Les réglages et leur écriture : l'onglet « Succès » porte `success_mode`. */
  settings?: Settings;
  onSaveSettings?: (next: Settings) => Promise<boolean>;
  onRecordBirths?: (entries: BirthEntry[]) => Promise<RecordBirthsResult>;
  onUndoBirth?: (record: BirthRecord) => Promise<boolean>;
  onRecordClonings?: (entries: { keep: string; drop: string }[]) => Promise<CloningResult>;
  /** Sortie d'enclos : niveaux relevés, lot passé en fécondes. */
  onEnclosExit?: (entries: { id: string; level: number }[]) => Promise<EnclosExitResult>;
  /**
   * Extraction faite en jeu : la monture quitte l'écurie.
   *
   * L'onglet « Extraction » disait quoi extraire sans offrir de le dire, si bien
   * qu'une extraction réelle laissait la stérile en base et l'écran continuait de
   * la proposer.
   */
  onExtract?: (mountId: string) => Promise<void>;
};

/**
 * Une unité d'enclos rendue lisible comme une monture.
 *
 * La fenêtre de sortie parle en `Individual` — c'est ce que `recordEnclosExit`
 * attend, identifiants fabriqués compris. L'instantané en porte exactement les
 * champs utiles : le reste (ascendance, fertilité) n'entre pas dans une sortie
 * d'enclos.
 */
const asIndividual = (unit: BatchUnit): Individual => ({
  id: unit.id,
  colorId: unit.colorId,
  name: unit.name,
  sex: unit.sex,
  level: unit.level,
  fertile: true,
  cycled: false,
  parents: null,
});

const BreedingPolicyPanel = ({
  fill,
  batch,
  couples,
  cloneAdvice = [],
  assumedCloningCount = 0,
  cloneHeld = [],
  objectiveName = null,
  extraction = [],
  sacrificeName = 'ambre',
  nameOf,
  optimakina = [],
  itemPrices,
  craftIndex,
  onItemPriceSaved,
  individuals = [],
  colors,
  rows,
  stable,
  hatched,
  settings,
  onSaveSettings,
  onRecordBirths,
  onUndoBirth,
  onRecordClonings,
  onEnclosExit,
  onExtract,
}: Props) => {
  /**
   * Le contexte de prix et la feuille de vente de l'onglet HDV.
   *
   * Ici plutôt que dans `BreedingHdv` parce que le **badge** de l'onglet en a
   * besoin : il annonce combien de montures ne doivent pas partir au prix de leur
   * couleur, et c'est la même liste. `null` tant que les prix ou l'écurie
   * manquent.
   */
  const hdv = useMemo(() => {
    if (!rows || !stable || !colors) return null;
    const estimates = new Map(rows.map((row) => [row.colorId, row.estimate]));
    const context: HdvContext = {
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
      costOf: (id) => estimates.get(id)?.cost ?? null,
      strategyOf: (id) => estimates.get(id)?.strategy ?? null,
    };
    return { context, sheet: sellSheet(stable, context) };
  }, [rows, stable, colors]);

  const [step, setStep] = useState<Step>('mate');
  /** La fenêtre ouverte : saisie de naissances, de clonages, ou sortie d'un enclos. */
  const [open, setOpen] = useState<'mate' | 'clone' | { exit: number } | null>(null);
  /**
   * L'item dont la carte de recette est ouverte, `null` si aucune.
   *
   * Un identifiant et non une recette : `RecipeModal` sait la charger seul, et
   * c'est ce qui permet de **repointer la même fenêtre** sur un ingrédient au
   * lieu d'en empiler une deuxième. Une descente de profondeur libre pour un état
   * de plus, voir `onOpenSubRecipe`.
   */
  const [recipeItemId, setRecipeItemId] = useState<number | null>(null);
  /**
   * Une naissance au moins a été écrite depuis l'ouverture de la fenêtre.
   *
   * Une `ref` et non un `state` : personne ne l'affiche, elle ne décide que de
   * l'onglet à ouvrir à la fermeture.
   */
  const birthsWritten = useRef(false);

  /**
   * L'heure, pour dater les enclos verrouillés.
   *
   * `null` tant que le composant n'est pas monté : le serveur n'a pas d'heure à
   * laquelle l'éleveur regarde, et un `Date.now()` initial produirait un écart
   * d'hydratation sur chaque « chargé il y a … ». Voir `useWallClock`.
   */
  const now = useWallClock(MINUTE_MS);

  const toRecord = useMemo(
    () => couples ?? (fill ? couplesToRecord(fill) : []),
    [couples, fill]
  );
  /**
   * Les clonages à saisir — **la même liste que celle qui est affichée**.
   *
   * Elles étaient deux, produites indépendamment : `cloneOptions` pour ce que
   * l'écurie permet, `cloningsToRecord` pour ce que la recherche planifie. Les
   * deux s'affichaient au même onglet, sous le même compte, et ne disaient pas la
   * même chose — « 12 clonages à faire » ouvrait une fenêtre dont le premier
   * couple n'était pas le premier de la liste juste au-dessus, ni le deuxième, ni
   * aucun. L'éleveur lit une liste et en exécute une autre.
   *
   * C'est `cloneOptions` qui reste, parce que c'est elle qui porte les règles :
   * les jumelles d'abord, le sexe certain à valeur égale, le projet avant les
   * kamas, et aucune anonyme. Le plan, lui, apparie ce que la recherche a tiré —
   * il ignore les trois. Ce que la politique planifie continue d'exister dans le
   * plan ; ce qui a disparu, c'est un second écran qui le contredisait.
   */
  /**
   * Les accouplements **immédiats** qui restent, par génération visée.
   *
   * C'est ce qui décide de la quantité d'Optimakina à se procurer, et le relevé
   * de l'éleveur dit pourquoi : « pas d'achat d'Optimakina gen 10 s'il n'y en a
   * pas de prévu ». La liste conseillait jusque-là toutes les générations qui se
   * remboursent, sans regarder si la fournée en visait une seule.
   *
   * On compte sur `toRecord` et non sur la fournée entière : l'Optimakina se pose
   * dans la fenêtre de jeu qu'on ouvre **maintenant**, et les croisements qui
   * attendent la sortie d'enclos se rachèteront à leur tour. Acheter d'avance pour
   * eux, c'est immobiliser des kamas sur un plan qui aura changé d'ici là.
   *
   * `targetGeneration` et non la génération de `targetColorId` : sur une recopie
   * la couleur est celle du mâle — voir `Couple.targetGeneration` — et la compter
   * ferait acheter pour un croisement qui ne monte nulle part.
   */
  const immediateByGeneration = useMemo(() => {
    const out = new Map<number, number>();
    for (const couple of toRecord) {
      if (couple.targetGeneration === null) continue;
      out.set(couple.targetGeneration, (out.get(couple.targetGeneration) ?? 0) + 1);
    }
    return out;
  }, [toRecord]);

  /**
   * Ce qu'il faut vraiment se procurer : le conseil, croisé avec la fournée.
   *
   * Une Optimakina qui se rembourse mais dont aucun accouplement immédiat ne vise
   * le rang ne sert à rien aujourd'hui, et l'annoncer fait acheter pour rien. Le
   * croisement est donc un **filtre** autant qu'une quantité.
   */
  const besoin = useMemo(
    () =>
      optimakina.flatMap((offer) => {
        const quantity = immediateByGeneration.get(offer.generation) ?? 0;
        return quantity > 0 ? [{ ...offer, quantity }] : [];
      }),
    [optimakina, immediateByGeneration]
  );

  const toClone = useMemo(
    () =>
      cloneAdvice
        // Les deux identifiants existent toujours ici : `sterileMounts` ne lit
        // que des individus, et le vrac n'a pas de stériles à suivre.
        .filter((option) => option.keep.id !== null && option.partner.id !== null)
        .map((option) => ({
          generation: option.keep.generation,
          first: option.keep.id!,
          second: option.partner.id!,
          carried: [option.keep.carried, option.partner.carried] as [number, number],
        })),
    [cloneAdvice]
  );

  /**
   * La fournée que la politique **propose**, découpée en enclos de dix places.
   *
   * ## Un enclos ne marie personne
   *
   * On pourrait croire qu'il faut y ranger les deux parents d'un croisement
   * ensemble. Non : l'enclos paie le **cycle de fécondité**, et l'appariement se
   * décide après, à la fenêtre d'accouplement. Deux montures qui s'accoupleront
   * peuvent avoir été fécondées dans deux enclos différents, à deux jours
   * d'écart. Le découpage est donc libre — on aligne les montures et on coupe
   * tous les dix.
   *
   * ## L'ordre, lui, n'est pas libre
   *
   * Les nommées passent devant, triées par nom : ce sont les seules qu'on ait à
   * **chercher** dans l'écurie du jeu, et les grouper évite d'ouvrir la
   * recherche dix fois pour dix enclos. Les anonymes suivent, prises au tas.
   *
   * Ce n'est qu'une proposition : dès qu'un enclos est verrouillé, c'est
   * l'instantané qui fait foi et cette liste n'est plus lue. Voir `batch.ts`.
   */
  const proposed = useMemo((): BatchPen[] => {
    if (!fill) return [];
    const byId = new Map(individuals.map((mount) => [mount.id, mount]));
    const units: BatchUnit[] = [];

    for (const line of fill.couples) {
      for (let index = 0; index < line.count; index += 1) {
        for (const [sex, sideOf] of [
          ['M', line.male],
          ['F', line.female],
        ] as const) {
          // Le cycle est déjà payé : elle ne passe pas par l'enclos.
          if (sideOf.cycled) continue;
          // Une ligne mêle le coffre et l'achat : les identifiants d'abord, et ce
          // qui dépasse est à procurer. Une monture procurée n'existe nulle part
          // encore — `acquiredMountId` lui fabrique l'identité que la sortie
          // d'enclos saura relire pour l'inscrire à l'écurie.
          const id = sideOf.mountIds[index];
          const mount = id ? byId.get(id) : undefined;
          units.push({
            id: id ?? acquiredMountId(sideOf.colorId, sex, units.length),
            colorId: sideOf.colorId,
            sex,
            name: mount?.name ?? null,
            level: mount?.level ?? BULK_MATE_LEVEL,
            banked: false,
            toBuy: id === undefined,
          });
        }
      }
    }

    // Les fécondations sans croisement occupent une place chacune, dans les mêmes
    // enclos que le reste : les compter ailleurs faisait dire « 38 montures » sous
    // « 40/40 places ».
    for (const entry of fill.cycles) {
      for (const id of entry.mountIds) {
        const mount = byId.get(id);
        units.push({
          id,
          colorId: entry.colorId,
          sex: mount?.sex ?? 'M',
          name: mount?.name ?? null,
          level: mount?.level ?? BULK_MATE_LEVEL,
          banked: true,
          toBuy: false,
        });
      }
    }

    units.sort(
      (a, b) =>
        Number(!a.name) - Number(!b.name) ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        nameOf(a.colorId).localeCompare(nameOf(b.colorId)) ||
        a.sex.localeCompare(b.sex)
    );

    /**
     * Une monture, une place — même si le plan la nommait deux fois.
     *
     * La politique ne devrait jamais engager la même monture dans deux
     * croisements, mais cette liste-là **crée des montures** : la sortie
     * d'enclos inscrit à l'écurie tout identifiant compté qu'elle ne connaît
     * pas. Un doublon y deviendrait une monture fantôme, née d'une ligne
     * dupliquée à l'affichage. Les identifiants fabriqués pour les achats sont
     * uniques par construction, donc seul un vrai doublon tombe ici.
     */
    const once = [...new Map(units.map((unit) => [unit.id, unit])).values()];

    const pens: BatchPen[] = [];
    for (let index = 0; index < once.length; index += ENCLOS_SLOTS) {
      pens.push({ units: once.slice(index, index + ENCLOS_SLOTS), lockedAt: null });
    }
    return pens;
  }, [fill, individuals, nameOf]);

  /**
   * Ce que l'écran montre : l'instantané dès qu'il existe, la proposition sinon.
   *
   * Le premier verrou fige la fournée entière — enclos à venir compris — donc
   * `proposed` n'est plus lu de toute la fournée. C'est le cœur du correctif :
   * ne figer que l'enclos verrouillé laisserait les suivants changer sous les
   * doigts, soit le même défaut décalé d'un enclos.
   */
  const pens = batch.pens.length > 0 ? batch.pens : proposed;
  const current = nextPenIndex(pens);

  /**
   * Les montures d'un enclos **à venir** qui ne peuvent plus y entrer.
   *
   * La fournée se fige au premier verrou, enclos à venir compris, et c'est juste
   * — sans ça la liste change sous les doigts pendant qu'on remplit. Mais
   * l'écurie, elle, continue de bouger, et rien ne reliait les deux : une
   * monture corrigée en stérile restait inscrite à l'enclos 3, l'écran
   * continuait de la réclamer, et on allait la chercher dans le jeu **pour
   * rien**. Un F5 n'y changeait rien, ce qui est la pire forme du défaut :
   * l'outil a l'air cassé alors qu'il fait exactement ce qu'on lui a demandé.
   *
   * Relevé le 20/08 sur `G2 EB M DOEB-DOIN`, et le seul recours était
   * d'abandonner la fournée entière — donc de perdre aussi le contenu des enclos
   * déjà refermés.
   *
   * Les identifiants fabriqués — vrac `couleur#M3`, achat `couleur+F0` — n'ont
   * pas de ligne à confronter : ils décrivent une quantité ou un achat, pas une
   * monture suivie. Les regarder ferait se signaler toute fournée qui achète.
   */
  const unloadable = useMemo(() => {
    if (current === null || batch.pens.length === 0) return [];
    const out = unavailableFor(
      pens[current].units.map((unit) => unit.id),
      individuals
    );
    return pens[current].units.filter((unit) => out.has(unit.id));
  }, [batch.pens.length, current, individuals, pens]);
  const locked = pens
    .map((pen, index) => ({ pen, index }))
    .filter((entry) => entry.pen.lockedAt !== null);

  const loadTotal = pens.reduce((total, pen) => total + pen.units.length, 0);
  /**
   * Les fécondations sans croisement de la fournée **entière**.
   *
   * Affiché parce qu'on ne peut pas le compter soi-même : l'écran ne montre
   * qu'un enclos à la fois, et c'est sur les cinq que ce geste-là se juge. Une
   * fécondation prépare un croisement du tour suivant ; en voir la moitié d'un
   * enclos veut dire que la politique thésaurise au lieu de produire, et c'est
   * exactement ce que `pairedBanking` borne.
   */
  const bankedTotal = pens.reduce(
    (total, pen) => total + pen.units.filter((unit) => unit.banked).length,
    0
  );
  /**
   * Les montures **physiquement en enclos**, celles que la page a retirées de
   * l'entrée de la politique. Comptées sur l'instantané en base et non sur
   * `pens`, qui vaut la proposition tant qu'aucun verrou n'a été posé.
   */
  const penned = pennedUnits(batch.pens).length;

  /** Les identifiants que l'écurie ne peut plus fournir — voir `unloadable`. */
  const unloadableIds = useMemo(
    () => new Set(unloadable.map((unit) => unit.id)),
    [unloadable]
  );

  /**
   * Les nommées d'un enclos : une ligne par nom, comptée si elle se répète.
   *
   * `gone` compte celles de la ligne que l'écurie ne peut plus fournir. Un
   * décompte et non un drapeau, parce que le regroupement fond plusieurs
   * montures sous un même nom : deux `G2 DOEB F DO-EB` dont une seule est
   * devenue stérile donnent « × 2 · 1 indisponible », et barrer la ligne entière
   * ferait renoncer à celle qui reste.
   */
  const namedGroups = (units: BatchUnit[]) => {
    const groups = new Map<string, { unit: BatchUnit; count: number; gone: number }>();
    for (const unit of units.filter((entry) => entry.name)) {
      const key = `${unit.name}|${unit.colorId}|${unit.sex}|${unit.banked}`;
      const group = groups.get(key) ?? { unit, count: 0, gone: 0 };
      group.count += 1;
      if (unloadableIds.has(unit.id)) group.gone += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) =>
      (a.unit.name ?? '').localeCompare(b.unit.name ?? '')
    );
  };

  /**
   * Les anonymes d'un enclos, regroupées — et elles seules.
   *
   * Deux anonymes de même couleur et de même sexe sont interchangeables : rien
   * ne permet de les distinguer en jeu, donc les lister séparément demanderait
   * de choisir entre deux choses identiques.
   */
  const anonymousGroups = (units: BatchUnit[]) => {
    const groups = new Map<string, { unit: BatchUnit; count: number }>();
    for (const unit of units.filter((entry) => !entry.name)) {
      const key = `${unit.colorId}|${unit.sex}|${unit.toBuy}|${unit.banked}`;
      const group = groups.get(key) ?? { unit, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (a, b) =>
        b.count - a.count || nameOf(a.unit.colorId).localeCompare(nameOf(b.unit.colorId))
    );
  };

  /** « il y a 3 h » sur un enclos verrouillé, une fois l'heure connue. */
  const since = (at: string | null) => {
    if (at === null || now === null) return null;
    const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
    return formatCountdown(seconds);
  };

  const nothing =
    !fill ||
    (fill.couples.length === 0 &&
      fill.cycles.length === 0 &&
      fill.clonings.length === 0 &&
      fill.purchases.length === 0);

  /** L'enclos dont on est en train de sortir les montures. */
  const exiting = typeof open === 'object' && open !== null ? pens[open.exit] : undefined;

  /**
   * Ce que l'enclos qu'on sort réclame et que l'écurie ne peut plus donner.
   *
   * `unloadable` ne regarde que l'enclos **en cours de remplissage** : c'est là
   * qu'on part chercher des montures dans le jeu, donc là qu'il faut dire de ne
   * pas y aller. Mais un enclos verrouillé vieillit lui aussi, et la sortie
   * sautait alors ses montures en silence tout en se déclarant complète. Voir
   * `recordEnclosExit`.
   */
  const exitBlocked = useMemo(
    () => unavailableFor((exiting?.units ?? []).map((unit) => unit.id), individuals),
    [exiting, individuals]
  );

  return (
    <div
      data-testid="policy-panel"
      className="glass rounded-2xl px-5 py-4 space-y-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Heart size={15} className="text-kamas shrink-0" />
        <span className="text-sm font-semibold text-dark-200">Ce que fait la politique</span>
        <span className="text-xs text-dark-500">un geste à la fois, dans l&apos;ordre du jeu</span>
        {fill && (
          <span
            data-testid="policy-summary"
            className="ml-auto text-[11px] text-dark-500 tabular-nums"
          >
            {fill.raw.crossings.length} accouplement{fill.raw.crossings.length > 1 ? 's' : ''} ·{' '}
            {fill.places}/{fill.capacity} places
          </span>
        )}
      </div>

      {/* ## Le rythme, en millions de kamas par mois

          C'est l'unité dans laquelle la politique a été choisie — le Rust imprime
          des mois, parce qu'une fournée par jour est la contrainte de la Mangeoire
          — et elle n'arrivait pas jusqu'ici. L'éleveur lisait « 32 accouplements ·
          56/60 places » et devait traduire lui-même.

          Le titre porte les trois réserves, et elles comptent : c'est un rythme à
          fournée constante, les naissances sont en espérance, et l'écoulement du
          marché n'y est pas. La première est la plus trompeuse sur une écurie
          neuve, où les ventes du premier mois liquident un stock qui ne revient
          pas. */}
      {fill && (
        <p
          data-testid="policy-earnings"
          data-per-month={Math.round(fill.earnings.perMonth)}
          className="-mt-2 mb-3 text-[11px] text-dark-500 tabular-nums"
          title={
            `À une fournée par jour, trente par mois. Génétons ${kamasOf(fill.earnings.genetons)} ` +
            `+ ventes ${kamasOf(fill.earnings.sales)} − chargement ${kamasOf(fill.earnings.loadKamas)} ` +
            `− achats ${kamasOf(fill.earnings.purchases)}` +
            (fill.earnings.optimakina > 0 ? ` − Optimakina ${kamasOf(fill.earnings.optimakina)}` : '') +
            `. Un rythme, pas une prévision : la fournée de demain n'est pas celle-ci, ` +
            `les naissances sont en espérance, et la baisse du marché à la vente n'y est pas.`
          }
        >
          <span
            className={
              fill.earnings.perMonth >= 0 ? 'font-medium text-kamas' : 'font-medium text-red-400'
            }
          >
            {millionsLabel(fill.earnings.perMonth)}
          </span>{' '}
          par mois à ce rythme — {kamasOf(fill.earnings.net)} par fournée
          {/* Un poste nul faute de prix saisi, et non faute de recette. Sur une
              fournée qui ne vend pas encore beaucoup, ce seul zéro suffit à rendre
              le rythme négatif, et il se lirait comme une politique qui perd de
              l'argent. Voir `genetonsPriced`. */}
          {!fill.earnings.genetonsPriced && (
            <span data-testid="earnings-no-geneton" className="text-amber-500/80">
              {' '}— sans le prix du géneton, que tu n&apos;as pas saisi
            </span>
          )}
        </p>
      )}

      {/* ## La couronne retenue, dite en toutes lettres

          Le plan vise **une** gen 10, et depuis que le projet pèse au lieu
          d'imposer il lui arrive de céder à une couleur nettement mieux payée —
          9 fois sur 10 il gagne, pas 10.

          Le relevé du 14/08 se plaignait exactement de ce silence : le projet
          demandait Azur-Doré depuis huit jours et le plan visait Ambre-Doré « sans
          que rien ne le dise ». On ne force pas le choix pour autant : forcer coupait
          le plan sur une seule route et rendait inemployable une gen 9 d'une autre
          couleur. On l'affiche. */}
      {fill?.crown && (
        <p
          data-testid="policy-crown"
          className={`mb-3 text-[11px] ${
            fill.crown.asked && fill.crown.asked !== fill.crown.colorId
              ? 'text-amber-400'
              : 'text-dark-500'
          }`}
        >
          Le plan vise{' '}
          <span className="font-medium text-dark-200">{nameOf(fill.crown.colorId)}</span>
          {fill.crown.asked && fill.crown.asked !== fill.crown.colorId && (
            <>
              {' '}— tu demandais{' '}
              <span className="font-medium">{nameOf(fill.crown.asked)}</span>, qui vaut
              moins cher aujourd&apos;hui. Le projet pèse sur le choix, il ne l&apos;impose
              plus.
            </>
          )}
          {fill.crown.asked === fill.crown.colorId && ' , comme ton projet le demande.'}
        </p>
      )}

      {/* Ce que la politique **ne voit pas**, dit en toutes lettres.
          Les montures verrouillées sont retirées de tous les arbitrages — le jeu
          ne les laisse ni s'accoupler ni se faire cloner tant que leur cycle
          tourne — mais « Mes stocks » continue de les compter, à juste titre :
          elles sont toujours à vous. Sans cette ligne, les deux décomptes se
          contredisent en silence, et un écran qui se contredit sans le dire est
          exactement ce qu'on vient de corriger ailleurs. */}
      {penned > 0 && (
        <p data-testid="penned-notice" className="text-[11px] text-dark-500">
          <strong className="text-dark-300 tabular-nums">{penned}</strong>
          {penned > 1 ? ' montures en enclos, mises' : ' monture en enclos, mise'} de côté : le
          jeu ne {penned > 1 ? 'les' : 'la'} laissera ni s&apos;accoupler, ni se faire cloner, ni
          se faire sacrifier tant que le cycle tourne.{' '}
          {penned > 1 ? 'Elles reviennent' : 'Elle revient'} à la sortie d&apos;enclos.
        </p>
      )}

      {/* Les quatre gestes. Un onglet vide reste cliquable et le dit : la liste
          des stériles a de la valeur même quand la politique ne propose rien. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map(({ id, label, icon: Icon }) => {
          const count =
            id === 'mate'
              ? toRecord.length
              : id === 'clone'
                ? toClone.length
                : id === 'load'
                  ? loadTotal
                  : id === 'extract'
                    ? extraction.length
                    // L'HDV compte ce qui demande une décision : les montures dont
                    // l'ascendance vaut plus que leur couleur. Les lignes de
                    // couleur, elles, ne sont pas une liste de gestes à faire.
                    : id === 'hdv'
                      ? (hdv?.sheet.named.length ?? 0)
                      // Le succès compte ce qui reste à faire naître, et non ce
                      // qui est acquis : c'est le travail devant, comme les
                      // quatre premiers onglets.
                      : (colors && hatched
                          ? colors.filter((color) => !hatched.has(color.id)).length
                          : 0);
          const active = step === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`step-${id}`}
              onClick={() => setStep(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px]
                font-medium border transition-all cursor-pointer ${
                  active
                    ? 'bg-kamas/15 text-kamas border-kamas/40'
                    : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                }`}
            >
              <Icon size={13} />
              {label}
              <span
                className={`tabular-nums ${
                  // Un zéro se dit mat : l'onglet reste là — on veut pouvoir y
                  // aller pour vérifier — mais il n'appelle pas le regard.
                  count > 0 ? (active ? 'text-kamas' : 'text-dark-200') : 'text-dark-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ce que l'échelle a refusé. Rien n'est retiré en silence : un plan amputé
          sans le dire est ce qui rend un outil impossible à croire. Ça vaut pour
          les trois onglets qui produisent des croisements, donc ça reste au-dessus. */}
      {fill && fill.refused.barren + fill.refused.offPlan > 0 && (
        <p className="text-[11px] text-amber-400/80">
          {fill.refused.barren > 0 && (
            <>
              {fill.refused.barren} accouplement{fill.refused.barren > 1 ? 's' : ''} écarté
              {fill.refused.barren > 1 ? 's' : ''} — <strong>rien à gagner</strong> : la cible
              n&apos;est nommée par aucune couleur, donc le croisement recopie l&apos;ascendance
              et stérilise ses deux parents pour zéro géneton.
            </>
          )}
          {fill.refused.offPlan > 0 && (
            <>
              {fill.refused.barren > 0 ? ' ' : ''}
              {fill.refused.offPlan} écarté{fill.refused.offPlan > 1 ? 's' : ''} comme{' '}
              <strong>hors plan</strong> : la cible existe, mais elle ne sert aucun barreau de
              l&apos;échelle.
            </>
          )}
        </p>
      )}

      {/* ------------------------------------------------------ accouplement -- */}
      {step === 'mate' && (
        <div data-testid="pane-mate" className="space-y-2">
          {/* Les Optimakina **avant** le bouton, parce qu'il faut les avoir en
              poche quand on ouvre la fenêtre du jeu : une fois devant l'enclos,
              partir en acheter coûte le geste qu'on venait faire.

              Deux listes plutôt qu'une, et une génération ne paraît que dans la
              moins chère des deux : se voir proposer la même à l'achat et à la
              fabrication ne dit pas quoi faire. Voir `worthwhileOptimakina`.

              Et **une quantité**, celle des accouplements immédiats qui visent ce
              rang : une génération que la fournée ne vise pas ne paraît plus du
              tout. La liste conseillait jusque-là tout ce qui se rembourse, ce qui
              faisait lire « gen 10 » à quelqu'un qui n'a aucun croisement de gen 10
              à faire. Voir `immediateByGeneration`. */}
          {besoin.length > 0 && (
            <div data-testid="optimakina-advice" className="space-y-1.5">
              {(['achat', 'fabrication'] as const).map((source) => {
                const list = besoin.filter((offer) => offer.source === source);
                if (list.length === 0) return null;
                return (
                  <div key={source} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug">
                    <span className="text-dark-500">
                      {source === 'achat' ? 'À acheter' : 'À fabriquer'} :
                    </span>
                    {list.map((offer) => (
                      <button
                        key={offer.generation}
                        type="button"
                        data-testid="optimakina-line"
                        data-generation={offer.generation}
                        data-quantity={offer.quantity}
                        // Sans la table des prix il n'y a pas de carte à ouvrir, et
                        // un bouton qui ne fait rien vaut moins qu'un bouton éteint.
                        disabled={!itemPrices}
                        onClick={() => setRecipeItemId(offer.itemId)}
                        className={`inline-flex flex-col items-start gap-0.5 rounded-lg border
                          border-kamas/25 bg-kamas/5 px-2 py-1 text-left transition-colors
                          ${itemPrices ? 'hover:border-kamas/60 hover:bg-kamas/10' : ''}`}
                        title={
                          `${offer.name} — ${offer.price.toLocaleString('fr-FR')} kamas pièce, ` +
                          `${offer.quantity} pour les ${offer.quantity} accouplement${offer.quantity > 1 ? 's' : ''} ` +
                          `de gen ${offer.generation} qui restent. ` +
                          `Elle se rembourse jusqu’à ${Math.round(offer.ceiling).toLocaleString('fr-FR')}.` +
                          (itemPrices ? ' Cliquer pour ouvrir la recette et l’âge de ses prix.' : '')
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {/* L'icône d'abord : c'est elle qu'on cherche des yeux dans
                              l'hôtel de vente, pas le mot « gen ». Absente quand
                              l'item n'est pas tarifé — on retombe alors sur le texte,
                              qui suffit. */}
                          {offer.iconUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={offer.iconUrl}
                              alt=""
                              width={18}
                              height={18}
                              className="h-[18px] w-[18px] shrink-0"
                            />
                          )}
                          <span className="font-semibold text-kamas tabular-nums">
                            ×{offer.quantity}
                          </span>
                          <span className="text-dark-400">gen {offer.generation}</span>
                          <span className="text-dark-500 tabular-nums">
                            {(offer.price * offer.quantity).toLocaleString('fr-FR')}
                          </span>
                          {/* Le marteau dit que la puce s'ouvre. Sans lui, la
                              carte existait sans que rien ne l'annonce — et une
                              vérification qu'on ne sait pas possible n'est pas
                              une vérification. */}
                          {itemPrices && (
                            <Hammer size={11} className="shrink-0 text-dark-500" />
                          )}
                        </span>
                        {/* La comparaison **sous** le total, et à l'unité : le total
                            dit combien sortir, la comparaison dit pourquoi de ce
                            côté-là. Les mêler sur une ligne ferait quatre nombres
                            dans deux unités. */}
                        <OptimakinaPrices
                          source={offer.source}
                          price={offer.price}
                          buy={offer.buy}
                          craft={offer.craft}
                          ceiling={offer.ceiling}
                        />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {toRecord.length > 0 ? (
            <>
              <Button size="md" variant="primary" onClick={() => setOpen('mate')}>
                <Heart size={14} />
                {toRecord.length} reproduction{toRecord.length > 1 ? 's' : ''} à faire
              </Button>
              <p className="text-[11px] text-dark-500">
                Un croisement à la fois, avec ses issues et le nom du poulain à recopier dans le
                jeu. Chaque clic enregistre aussitôt.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-dark-500">
              Aucun accouplement possible tout de suite — il faut d&apos;abord une fournée
              d&apos;enclos, ou de quoi apparier ce qui en est sorti.
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- clonage -- */}
      {step === 'clone' && (
        <div data-testid="pane-clone" className="space-y-2">
          {toClone.length > 0 ? (
            <>
              <Button size="md" variant="primary" onClick={() => setOpen('clone')}>
                <Dna size={14} />
                {toClone.length} clonage{toClone.length > 1 ? 's' : ''} à faire
              </Button>
              <p className="text-[11px] text-dark-500">
                Deux stériles, une survivante — c&apos;est toi qui choisis laquelle.
              </p>
              {assumedCloningCount > toClone.length && (
                /* Ce que la fournée d'accouplements suppose, et qu'elle ne disait
                   pas. Les manquants n'existent pas encore : leurs stériles
                   naîtront de la saisie. Sans eux la liste d'accouplements
                   repousse, ce qui se lisait comme un défaut alors que c'était une
                   consigne incomplète. */
                <p data-testid="clonings-assumed" className="text-[11px] text-kamas">
                  La fournée d&apos;accouplements en suppose {assumedCloningCount} en tout.
                  Les {assumedCloningCount - toClone.length} autres deviendront possibles
                  à mesure que tu saisis les naissances — sans eux, la liste
                  d&apos;accouplements repoussera.
                </p>
              )}
            </>
          ) : cloneHeld.length > 0 ? (
            /* Rien à apparier, mais quelque chose à ne pas détruire : la liste des
               gardées suffit à justifier l'onglet. */
            <p className="text-[11px] text-dark-500">
              Aucune paire à faire pour l&apos;instant — mais l&apos;écurie porte des stériles
              que le projet protège, plus bas.
            </p>
          ) : (
            <p className="text-[11px] text-dark-500">
              Aucun clonage possible — deux stériles ne s&apos;apparient qu&apos;à génération
              affichée égale. Ce qui reste dépareillé est dans « Extraction ».
            </p>
          )}

          <BreedingCloneAdvice
            clonings={cloneAdvice}
            held={cloneHeld}
            objectiveName={objectiveName}
            nameOf={nameOf}
            individuals={individuals}
          />
        </div>
      )}

      {/* ----------------------------------------------------------- fournée -- */}
      {step === 'load' && (
        <div data-testid="pane-load" className="space-y-3">
          {pens.length === 0 ? (
            <p className="text-[11px] text-dark-500">
              Rien à mettre en enclos : la politique n&apos;a aucun croisement à préparer, ou
              toutes les montures qu&apos;elle vise ont déjà payé leur cycle.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-semibold text-dark-200">
                  {pens.length} enclos · {loadTotal} monture{loadTotal > 1 ? 's' : ''}
                </span>
                {bankedTotal > 0 && (
                  <span
                    data-testid="load-banked"
                    data-banked={bankedTotal}
                    className="text-[11px] text-dark-500 tabular-nums"
                    title="Mises en enclos sans être croisées : elles en sortent fécondes et s'accoupleront sans repasser par l'enclos. C'est une préparation, pas une production — il en faut peu."
                  >
                    dont {bankedTotal} à féconder sans croiser
                  </span>
                )}
                <span className="text-[11px] text-dark-500 tabular-nums">
                  {locked.length}/{pens.length} verrouillé{locked.length > 1 ? 's' : ''}
                </span>
                <span
                  className="text-[10px] text-dark-600"
                  title="Les fécondes n'y sont pas : leur cycle est payé, elles s'accouplent sans repasser par l'enclos. Qui s'accouple avec qui se décide après, à la fenêtre d'accouplement."
                >
                  fécondes exclues
                </span>
                {batch.pens.length > 0 && (
                  <button
                    type="button"
                    onClick={batch.discard}
                    className="ml-auto text-[10px] text-dark-500 hover:text-loss transition-colors
                      cursor-pointer"
                    title="Oublier cette fournée sans rien écrire sur les montures. À faire si elle ne correspond plus à ce que tu as réellement en enclos."
                  >
                    abandonner cette fournée
                  </button>
                )}
              </div>

              {/* Les enclos déjà refermés, en une ligne chacun. Ils n'ont plus
                  rien à charger — seulement à être sortis, quand ils auront
                  tourné. Le contenu reste consultable, mais replié : ce qui
                  compte ici est « depuis quand », pas « lesquelles ». */}
              {locked.map(({ pen, index }) => (
                <div
                  key={index}
                  data-testid="locked-pen"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 rounded-xl
                    bg-emerald-500/8 border border-emerald-500/25"
                >
                  <Lock size={14} className="text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-dark-100">Enclos {index + 1}</span>
                  <span className="text-[11px] text-dark-400 tabular-nums">
                    {pen.units.length} monture{pen.units.length > 1 ? 's' : ''}
                  </span>
                  {since(pen.lockedAt) && (
                    <span className="text-[11px] text-dark-500 tabular-nums">
                      chargé il y a {since(pen.lockedAt)}
                    </span>
                  )}
                  {onEnclosExit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="exit-pen"
                      className="ml-auto"
                      onClick={() => setOpen({ exit: index })}
                    >
                      <LogOut size={13} />
                      Les sortir de l&apos;enclos
                    </Button>
                  )}
                </div>
              ))}

              {/* L'enclos en cours, en grand. Un seul : devant le jeu on ouvre un
                  enclos, on y met dix montures, on le referme. Afficher les cinq
                  obligeait à retrouver soi-même où l'on en était. */}
              {current !== null ? (
                <div
                  data-testid="current-pen"
                  className="rounded-2xl border border-kamas/30 bg-kamas/5 px-4 py-3 space-y-2"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-dark-100">
                      Enclos {current + 1}
                    </span>
                    <span className="text-[11px] text-dark-500 tabular-nums">
                      {pens[current].units.length}/{ENCLOS_SLOTS} places
                    </span>
                    <span className="text-[11px] text-dark-500">
                      à remplir maintenant, puis à verrouiller
                    </span>
                  </div>

                  {/* Ce que la liste réclame et que l'écurie ne peut plus donner.
                      Ici, sur la carte, et pas dans un panneau à côté : c'est
                      devant cet écran qu'on part chercher une monture dans le
                      jeu, donc c'est ici qu'il faut dire de ne pas y aller. */}
                  {unloadable.length > 0 && (
                    <div
                      data-testid="pen-unloadable"
                      data-count={unloadable.length}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
                        bg-loss/10 border border-loss/30"
                    >
                      <AlertTriangle size={13} className="text-loss-light shrink-0" />
                      <span className="text-[11px] text-dark-300">
                        {unloadable.length === 1 ? (
                          <>
                            <strong className="text-loss-light">
                              {unloadable[0].name ?? nameOf(unloadable[0].colorId)}
                            </strong>{' '}
                            ne peut plus entrer en enclos
                          </>
                        ) : (
                          <>
                            <strong className="text-loss-light">{unloadable.length}</strong> montures
                            de cette liste ne peuvent plus entrer en enclos
                          </>
                        )}
                        {' — '}stérile{unloadable.length > 1 ? 's' : ''} ou retirée
                        {unloadable.length > 1 ? 's' : ''} de l’écurie depuis que la fournée a été
                        figée. Ne va pas {unloadable.length > 1 ? 'les' : 'la'} chercher dans le jeu.
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        onClick={() => batch.refresh(proposed)}
                        title="Refait la liste des enclos pas encore verrouillés à partir de l’écurie d’aujourd’hui. Les enclos déjà refermés ne bougent pas : ce sont des objets fermés dans le jeu."
                      >
                        <RefreshCw size={13} />
                        Recalculer les enclos à venir
                      </Button>
                    </div>
                  )}

                  {namedGroups(pens[current].units).length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-dark-500">
                        Nommées — à chercher par leur nom
                      </p>
                      {namedGroups(pens[current].units).map(({ unit, count, gone }) => (
                        <div
                          key={`${unit.name}-${unit.sex}-${unit.banked}`}
                          data-testid="load-named"
                          data-gone={gone}
                          /* Atténuée quand toute la ligne est indisponible : le
                             bandeau au-dessus dit de ne pas y aller, et la
                             laisser à l'identique en dessous redonne la consigne
                             inverse à l'endroit même où on lit ce qu'il faut
                             chercher. */
                          className={`flex flex-wrap items-center gap-2 text-xs ${
                            gone >= count ? 'opacity-45' : ''
                          }`}
                        >
                          <span
                            className={unit.sex === 'M' ? 'text-info' : 'text-loss-light'}
                            title={unit.sex === 'M' ? 'Mâle' : 'Femelle'}
                          >
                            {unit.sex === 'M' ? '♂' : '♀'}
                          </span>
                          <span className="text-dark-200">{nameOf(unit.colorId)}</span>
                          <CopyableText
                            value={unit.name!}
                            title={`Copier « ${unit.name} » — le nom à chercher dans l’écurie du jeu`}
                          />
                          {count > 1 && (
                            <span className="text-[10px] text-dark-500">× {count}</span>
                          )}
                          {gone > 0 && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-md bg-loss/15 text-loss-light"
                              title="Stérile ou retirée de l’écurie depuis que la fournée a été figée : elle ne peut plus entrer en enclos. Recalcule les enclos à venir pour la retirer de la liste."
                            >
                              {gone >= count ? 'ne peut plus entrer' : `${gone} indisponible`}
                            </span>
                          )}
                          {unit.banked && (
                            <em
                              className="not-italic text-[10px] text-dark-400"
                              title="En enclos sans croiser : elle en sort féconde et reste en écurie."
                            >
                              à féconder sans croiser
                            </em>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {anonymousGroups(pens[current].units).length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-dark-500">
                        Anonymes — à prendre au tas
                      </p>
                      {anonymousGroups(pens[current].units).map(({ unit, count }) => (
                        <div
                          key={`${unit.colorId}-${unit.sex}-${unit.toBuy}-${unit.banked}`}
                          data-testid="load-anonymous"
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <span className="text-dark-300 font-semibold tabular-nums w-6 shrink-0 text-right">
                            {count} ×
                          </span>
                          <span
                            className={unit.sex === 'M' ? 'text-info' : 'text-loss-light'}
                            title={unit.sex === 'M' ? 'Mâle' : 'Femelle'}
                          >
                            {unit.sex === 'M' ? '♂' : '♀'}
                          </span>
                          <span className="text-dark-200">{nameOf(unit.colorId)}</span>
                          {unit.toBuy && (
                            <em className="not-italic text-[10px] text-amber-400/80">
                              à procurer — achat ou capture
                            </em>
                          )}
                          {unit.banked && (
                            <em
                              className="not-italic text-[10px] text-dark-400"
                              title="En enclos sans croiser : elle en sort féconde et reste en écurie."
                            >
                              à féconder sans croiser
                            </em>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Le verrou. Gros, parce que c'est le seul geste de cet écran
                      qui écrive quelque chose d'irréversible pour la journée :
                      après lui, cet enclos-là ne bougera plus, quoi que la
                      politique repense de l'écurie entre-temps. */}
                  <button
                    type="button"
                    data-testid="lock-pen"
                    onClick={() => batch.lock(proposed)}
                    className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-3
                      rounded-xl bg-kamas/20 border border-kamas/50 text-kamas text-sm
                      font-bold uppercase tracking-wider transition-all cursor-pointer
                      hover:bg-kamas/30 hover:border-kamas/70"
                    title="Cet enclos est rempli et refermé. Son contenu est figé : c'est lui qu'on retrouvera à la sortie, même dans douze heures."
                  >
                    <Lock size={16} />
                    Lock — enclos {current + 1} chargé
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl
                  bg-dark-800/60 border border-dark-600/50">
                  <Check size={14} className="text-gain shrink-0" />
                  <span className="text-xs text-dark-200">
                    Tous les enclos sont chargés. Reviens les sortir quand le cycle aura tourné.
                  </span>
                  <button
                    type="button"
                    onClick={batch.unlock}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] text-dark-500
                      hover:text-dark-300 transition-colors cursor-pointer"
                    title="Rouvrir le dernier enclos verrouillé — un clic de trop, rien de plus."
                  >
                    <LockOpen size={11} />
                    rouvrir le dernier
                  </button>
                </div>
              )}

              {/* Le récapitulatif par couleur, qui se lit devant le coffre : on y
                  va une fois, pas une fois par enclos. Il décrit la fournée
                  entière — c'est justement ce qu'on veut avant d'ouvrir le
                  premier enclos. */}
              {fill && fill.pull.length > 0 && batch.pens.length === 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2
                  border-t border-dark-700/40">
                  <span className="text-[11px] text-dark-400">
                    À sortir de l&apos;écurie, pour toute la fournée
                  </span>
                  {fill.pull.map((pull) => (
                    <span key={pull.colorId} className="text-xs text-dark-300">
                      {nameOf(pull.colorId)}{' '}
                      <span className="tabular-nums font-semibold text-dark-100">
                        {pull.males > 0 && `${pull.males}♂`}
                        {pull.males > 0 && pull.females > 0 && ' '}
                        {pull.females > 0 && `${pull.females}♀`}
                      </span>
                      {pull.exhausts && (
                        <span
                          className="text-[10px] text-amber-400/70"
                          title="La fournée vide cette couleur : il n'en restera aucune fertile."
                        >
                          {' '}
                          vidée
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- extraction -- */}
      {step === 'extract' && (
        <div data-testid="pane-extract">
          <BreedingExtraction
            candidates={extraction}
            nameOf={nameOf}
            individuals={individuals}
            resourceName={sacrificeName}
            onExtract={onExtract}
          />
        </div>
      )}

      {/* Une écurie sur laquelle la politique n'a rien à dire se dit, plutôt que
          de laisser trois onglets vides qu'on prendrait pour un défaut
          d'affichage. L'extraction s'en passe : une écurie sans fertile est
          justement celle qui a le plus de stériles à vider. */}
      {step === 'hdv' && (
        <div data-testid="pane-hdv">
          {hdv && stable && colors ? (
            <BreedingHdv
              sheet={hdv.sheet}
              context={hdv.context}
              stable={stable}
              colors={colors}
              nameOf={nameOf}
            />
          ) : (
            <p className="text-[11px] text-dark-500">
              Les prix de couleurs ne sont pas encore chargés.
            </p>
          )}
        </div>
      )}

      {step === 'success' && (
        <div data-testid="pane-success">
          {colors && hatched && stable && settings && onSaveSettings ? (
            <BreedingSuccess
              colors={colors}
              hatched={hatched}
              stable={stable}
              settings={settings}
              onSaveSettings={onSaveSettings}
              nameOf={nameOf}
            />
          ) : (
            <p className="text-[11px] text-dark-500">La collection n’est pas encore chargée.</p>
          )}
        </div>
      )}

      {/* L'HDV et le succès s'en passent comme l'extraction : une écurie sans
          fertile a justement le plus de choses à vendre, et le succès arbitre ce
          qu'on poursuit plutôt que ce qu'on charge. */}
      {nothing && step !== 'extract' && step !== 'hdv' && step !== 'success' && (
        <p className="text-[11px] text-dark-500">
          La politique ne propose rien sur cette écurie : soit elle n&apos;a plus de monture
          fertile, soit les prix ne sont pas saisis et tout lui paraît sans valeur.
        </p>
      )}

      {/* La carte de recette d'une Optimakina : ses ingrédients, leurs prix, et
          **depuis quand** chacun est saisi. C'est cette dernière colonne qui
          répond à la question posée — la puce affirme « fabrication 600 », la
          carte dit sur quels relevés, et de quel âge.

          `RecipeModal` porte sa propre `PriceModal`, donc un prix qui a bougé se
          corrige sans quitter l'écran ; `onItemPriceSaved` remonte ce que la base
          a confirmé et la puce se recalcule aussitôt. Voir `applyItemPrice`.

          Une seule fenêtre, repointée : `onOpenSubRecipe` descend dans un
          ingrédient lui-même craftable au lieu d'empiler une deuxième carte. */}
      {itemPrices && (
        <RecipeModal
          isOpen={recipeItemId !== null}
          onClose={() => setRecipeItemId(null)}
          itemId={recipeItemId ?? undefined}
          prices={itemPrices}
          index={craftIndex}
          onOpenSubRecipe={(item: PriceTarget) => setRecipeItemId(item.id)}
          onPriceSaved={onItemPriceSaved}
        />
      )}

      {colors && onRecordBirths && (
        <BreedingBirthDialog
          isOpen={open === 'mate'}
          couples={toRecord}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          optimakinaFor={(generation) =>
            optimakina.find((offer) => offer.generation === generation) ?? null
          }
          onRecord={async (entries) => {
            const result = await onRecordBirths(entries);
            if (result.ok && result.born.length > 0) birthsWritten.current = true;
            return result;
          }}
          onUndo={async (record) => (onUndoBirth ? onUndoBirth(record) : false)}
          onClose={() => {
            setOpen(null);
            if (birthsWritten.current) setStep('clone');
            birthsWritten.current = false;
          }}
        />
      )}

      {colors && (
        <BreedingCloneDialog
          isOpen={open === 'clone'}
          clonings={toClone}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          onRecord={async (entries) =>
            (await onRecordClonings?.(entries)) ?? { ok: true as const }
          }
          onClose={() => {
            setOpen(null);
            setStep('load');
          }}
        />
      )}

      {colors && onEnclosExit && (
        <BreedingEnclosExitDialog
          isOpen={exiting !== undefined}
          onClose={() => setOpen(null)}
          mounts={(exiting?.units ?? []).map(asIndividual)}
          blocked={exitBlocked}
          colors={colors}
          nameOf={nameOf}
          onConfirm={async (entries) => {
            const result = await onEnclosExit(entries);
            // L'enclos ne quitte la fournée que si **tout** a été écrit. Un
            // compte positif ne suffit pas : une sortie dont l'insertion des
            // comptées a été refusée en rend un, et retirer l'enclos là-dessus
            // rendrait ces montures introuvables — encore en enclos dans le jeu,
            // nulle part dans l'app. Tant qu'il manque une écriture l'enclos
            // reste verrouillé à l'écran, ce qui est la vérité, et le geste se
            // reprend.
            if (typeof open === 'object' && open !== null) {
              if (result.complete) {
                await batch.release(open.exit);
                // Le cycle vient d'être payé : c'est exactement le moment où de
                // nouveaux accouplements deviennent possibles.
                setStep('mate');
              } else if (result.settled.length > 0) {
                // Une sortie partielle allège l'enclos de ce qui est passé, et
                // le laisse porter le reste. Le retirer entier rendrait les
                // non-écrites introuvables ; le laisser intact ferait réinsérer
                // les comptées au reclic, une monture achetée en devenant deux.
                await batch.settle(open.exit, result.settled);
              }
            }
            return result;
          }}
          onRelease={async () => {
            if (typeof open === 'object' && open !== null) await batch.release(open.exit);
          }}
        />
      )}
    </div>
  );
};

export default BreedingPolicyPanel;
