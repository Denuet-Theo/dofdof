'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import {
  carriedGeneration,
  colorCoder,
  colorsByCode,
  parseMountName,
} from '@/lib/dofus/breeding/naming';
import { MOUNT_STATUS_LABEL, type MountStatus, type Sex } from '@/lib/dofus/breeding/stable';
import type { AddResult } from '@/lib/hooks/useBreeding';

/**
 * Recharger une écurie entière depuis la liste de noms du jeu.
 *
 * L'assistant saisit **une** monture, et c'est le bon geste pour une naissance.
 * Ce n'en est pas un pour cent trente : à ce volume, la question n'est plus
 * « quelle couleur, quel sexe, quels parents » — elle est déjà répondue, et
 * elle l'est **dans le jeu**. Chaque monture y porte le nom que l'outil lui a
 * dicté, et ce nom encode exactement ce que la base enregistre : la couleur, le
 * sexe et les deux parents.
 *
 * Il suffit donc de relire. On copie la liste de l'écurie du jeu, on la colle
 * ici, une ligne par monture, et `parseMountName` fait le chemin inverse de
 * `mountName`.
 *
 * ## Ce que le nom ne porte pas
 *
 * Le **niveau** et l'**état**. Ils sont donc demandés une fois pour tout le lot,
 * avec une surcharge par ligne pour les exceptions — `G3 AM M DO-DO 120 féconde`.
 * Un lot est presque toujours homogène : on recharge un parc entier de fécondes,
 * ou une portée qui vient de naître au niveau 1.
 *
 * Sauf qu'une écurie relue depuis le jeu ne l'est pas : elle mélange les stériles
 * déjà dépensées, les fécondes prêtes et les nouveau-nés fertiles, et c'est
 * exactement ce mélange qui décide de ce qu'on peut lancer demain. La surcharge
 * par ligne n'est donc pas le cas rare, c'est le cas courant — d'où une lecture
 * qui prend le niveau et l'état **où qu'ils soient** sur la ligne plutôt qu'à la
 * fin seulement. Un état écrit devant faisait rejeter la ligne entière, et une
 * ligne rejetée est une monture qui manque à l'écurie sans que rien d'autre ne le
 * dise. La colonne `GEN. 4` que la liste du jeu affiche est ignorée au passage :
 * elle est redondante avec le nom, et son chiffre passait pour un niveau.
 *
 * ## La monture qui n'a pas de nom à recopier
 *
 * Tout ce qui précède suppose un nom dicté par l'outil, donc une **généalogie**.
 * Une monture achetée ou capturée n'en a pas : elle s'appelle « Anonyme » en jeu,
 * et cent lignes identiques ne se distinguent par rien. Elle n'avait donc aucun
 * chemin ici, et le seul autre — le compteur de vrac — ne sait dire ni féconde
 * ni stérile (`onSaveBulk` n'écrit que `males` et `females`, et la table n'a pas
 * de colonne pour les stériles du tout).
 *
 * D'où `EB M anon`, avec un `×12` facultatif : le code de couleur, le sexe, et
 * la déclaration explicite qu'il n'y a pas d'ascendance. Réservé aux **gen 1**,
 * parce qu'au-delà une monture est née chez soi et porte forcément des parents,
 * et au seul état **féconde** : la fertile a déjà sa porte au compteur de vrac
 * et l'importer en individu la compterait deux fois, et la stérile n'existe pas
 * — sans ascendance elle ne s'extrait ni ne se clone, elle ne fait que gonfler
 * le compte. Voir `ANONYMOUS_STATUSES`.
 *
 * ## Pourquoi une prévisualisation, et pas un simple bouton
 *
 * Une ligne mal recopiée ne doit pas passer en silence. Chacune est donc relue
 * et affichée avec sa couleur, son sexe et ses parents **avant** d'écrire quoi
 * que ce soit : ce qui ne se lit pas est signalé à sa ligne, et le reste
 * s'importe quand même. Refuser tout le lot pour une faute de frappe ferait
 * recommencer cent trente lignes.
 *
 * La génération inscrite dans le nom est **redondante** — elle se déduit de la
 * couleur et des parents. C'est justement pour ça qu'elle est vérifiée : c'est
 * le seul contrôle disponible sur une ligne écrite à la main.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  colors: BreedingColor[];
  onAdd: (mount: {
    colorId: string;
    sex: Sex;
    level: number;
    status: MountStatus;
    parents: [string, string] | null;
  }) => Promise<AddResult>;
};

/** Une ligne relue : soit une monture prête à écrire, soit ce qui cloche. */
type Row =
  | {
      ok: true;
      line: number;
      raw: string;
      colorId: string;
      sex: Sex;
      /** `null` pour une anonyme : achetée ou capturée, elle n'a pas d'ascendance. */
      parents: [string, string] | null;
      level: number;
      status: MountStatus;
      /** Combien d'exemplaires cette ligne écrit. Toujours 1 hors ligne anonyme. */
      count: number;
      /** Signalé sans bloquer : la génération écrite ne colle pas au calcul. */
      warning: string | null;
    }
  | { ok: false; line: number; raw: string; problem: string };

/**
 * Les mots qui disent un état, une fois ramenés à leurs lettres nues.
 *
 * `plainWord` ôte accents et ponctuation avant de chercher ici, si bien qu'un
 * seul mot par état suffit : « STÉRILE » recopié de la liste du jeu, « sterile »
 * tapé sans accent et « Stérile, » collé depuis un tableur tombent tous sur
 * `sterile`. `fecond` est là parce que le jeu écrit l'adjectif au masculin sur
 * les mâles, et qu'une monture non reconnue vaut une ligne rejetée.
 */
const STATUS_BY_WORD = new Map<string, MountStatus>([
  ['fertile', 'fertile'],
  ['feconde', 'feconde'],
  ['fecond', 'feconde'],
  ['sterile', 'sterile'],
]);

/** Un mot réduit à ses lettres latines minuscules — voir `plain` dans `naming`. */
const plainWord = (token: string): string =>
  token.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();

/**
 * Les mots qui disent « cette monture n'a pas d'ascendance ».
 *
 * `plainWord` ôte accents et ponctuation, donc « Anonyme » recopié de l'écurie du
 * jeu, « anon » tapé vite et « ANONYME, » collé d'un tableur tombent tous ici.
 */
const ANONYMOUS_WORDS = new Set(['anon', 'anonyme']);

/**
 * Le multiplicateur d'une ligne : `×12`, `x12`, `*12`.
 *
 * Marqué et non écrit en clair, parce qu'un nombre nu est déjà le **niveau** et
 * que les deux se ressemblent trop pour être devinés — « 12 » sur une ligne
 * anonyme ne peut pas vouloir dire les deux.
 */
const COUNT_TOKEN = /^[x×*](\d{1,3})$/i;

/** Ce qu'une ligne porte en plus du nom, et ce qui cloche s'il y a lieu. */
type LineExtras = {
  /** La ligne débarrassée du niveau, de l'état et du bruit de la liste du jeu. */
  name: string;
  /** `null` quand la ligne s'en remet au réglage du lot. */
  level: number | null;
  status: MountStatus | null;
  /** La ligne se déclare sans ascendance : `EB M anon`. */
  anonymous: boolean;
  /** `null` quand la ligne n'en porte pas — donc un exemplaire. */
  count: number | null;
  problem: string | null;
};

/**
 * Sépare le nom du reste de la ligne, sans exiger d'ordre.
 *
 * On lit **mot à mot** plutôt qu'à coups d'expressions ancrées en fin de ligne :
 * le niveau et l'état sont deux annotations libres, et personne ne se souvient
 * dans quel ordre les écrire. Ce qui n'est ni un état, ni un niveau, ni la
 * colonne `GEN. n` du jeu est rendu au nom — donc une ligne mal recopiée échoue
 * à sa relecture par `parseMountName`, à sa ligne, au lieu de passer avec une
 * annotation avalée en silence.
 *
 * Deux états ou deux niveaux sur la même ligne sont **signalés** plutôt
 * qu'arbitrés : « 48 61 » est une ligne recopiée de travers, et l'importer choisi
 * pour elle écrirait une monture que l'éleveur ne retrouvera pas.
 */
const readExtras = (raw: string): LineExtras => {
  const kept: string[] = [];
  let level: number | null = null;
  let status: MountStatus | null = null;
  let anonymous = false;
  let count: number | null = null;
  let problem: string | null = null;

  const tokens = raw.trim().split(/\s+/);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const word = plainWord(token);

    // « GEN. 4 » : la colonne de génération de la liste du jeu. Elle se déduit
    // déjà du nom, et son chiffre se serait fait prendre pour un niveau.
    if (word === 'gen') {
      if (/^\d{1,2}$/.test(tokens[index + 1] ?? '')) index += 1;
      continue;
    }

    const known = STATUS_BY_WORD.get(word);
    if (known) {
      if (status !== null && status !== known) problem = 'Deux états sur la même ligne.';
      status = known;
      continue;
    }

    if (ANONYMOUS_WORDS.has(word)) {
      anonymous = true;
      continue;
    }

    const multiplier = token.match(COUNT_TOKEN);
    if (multiplier) {
      const value = Number(multiplier[1]);
      if (value >= 1) {
        if (count !== null && count !== value) problem = 'Deux quantités sur la même ligne.';
        count = value;
        continue;
      }
    }

    if (/^\d{1,3}$/.test(token)) {
      const value = Number(token);
      if (value >= 1 && value <= 200) {
        if (level !== null && level !== value) problem = 'Deux niveaux sur la même ligne.';
        level = value;
        continue;
      }
    }

    kept.push(token);
  }

  return { name: kept.join(' '), level, status, anonymous, count, problem };
};

/**
 * Le seul état dans lequel une gen 1 sans ascendance mérite sa propre ligne.
 *
 * Une gen 1 **fertile** sans ascendance est exactement ce que le vrac
 * représente — c'est son compteur, dans « Mon écurie », et l'importer en
 * individu la compterait deux fois. La **féconde** n'a pas cette porte :
 * `onSaveBulk` n'écrit que `males` et `females`, si bien qu'aucun écran ne sait
 * le dire au vrac. Le suivi individuel est donc la seule façon de l'enregistrer,
 * et c'est la seule raison pour laquelle on l'ouvre à une génération qui,
 * autrement, n'a rien à y faire.
 *
 * ## La stérile en sortait, et n'aurait jamais dû y entrer
 *
 * Elle y était pour la même raison — `user_breeding_mounts` ne sait pas dire
 * « stérile » non plus. Mais l'argument s'arrête là où celui de la féconde
 * continue : une féconde anonyme **sert**, elle entre dans une fournée. Une
 * stérile anonyme ne peut rien. Sans nom il n'y a pas d'ascendance, donc c'est
 * une gen 1 : le jeu ne l'extrait pas, et le clonage ne prend pas ce qu'on ne
 * sait pas désigner devant son écurie.
 *
 * Ce n'est donc pas une monture qu'on aurait oublié de nommer, c'est un reste —
 * et il gonfle le seul chiffre que l'éleveur compare au jeu. L'écurie en a porté
 * **cinquante-sept d'un coup**, 255 contre 198 au recensement du 16/08.
 *
 * Une ligne `EB M anon stérile` est donc refusée, et le dit. La refuser plutôt
 * que la convertir en féconde est délibéré : l'import recopie ce que le jeu
 * affiche, et corriger une lecture en silence est exactement ce qui fait
 * diverger les deux écuries.
 */
const ANONYMOUS_STATUSES: MountStatus[] = ['feconde'];

const BreedingImportMounts = ({ isOpen, onClose, colors, onAdd }: Props) => {
  const [text, setText] = useState('');
  const [level, setLevel] = useState(1);
  /**
   * L'état par défaut du lot : **fertile**, comme dans l'assistant monture par
   * monture.
   *
   * Il valait « féconde », sur l'idée qu'on recharge un parc déjà cyclé. Deux
   * raisons d'en changer, et la seconde suffit.
   *
   * D'abord le défaut a le sens le plus prudent quand il est faux : une fertile
   * annoncée féconde fait croire à la politique que son cycle est payé, elle ne
   * lui réserve donc pas de place d'enclos, et l'accouplement échoue devant le
   * jeu. L'inverse coûte une place de plus dans une fournée, qui se rattrape à la
   * suivante.
   *
   * Ensuite et surtout, les deux saisies doivent répondre pareil. Importer cent
   * montures et en ajouter une à la main sont le même geste à deux volumes, et
   * deux défauts opposés font que la même monture n'entre pas dans le même état
   * selon le chemin pris — un écart qu'on ne voit qu'en relisant l'écurie.
   */
  const [status, setStatus] = useState<MountStatus>('fertile');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ added: number; failures: string[] } | null>(null);

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const code = useMemo(() => colorCoder(colors), [colors]);

  /** La table qui traduit un code en couleur — voir `colorsByCode`. */
  const colorByCode = useMemo(() => colorsByCode(colors), [colors]);

  const nameOf = (colorId: string) => byId.get(colorId)?.name ?? colorId;
  const generationOf = useCallback(
    (colorId: string) => byId.get(colorId)?.generation ?? 1,
    [byId]
  );
  /** Le même que `nameOf`, mais stable : la relecture des lignes le mémoïse. */
  const nameOfColor = useCallback(
    (colorId: string) => byId.get(colorId)?.name ?? colorId,
    [byId]
  );
  const iconOf = (colorId: string) => {
    const color = byId.get(colorId);
    return color ? colorIconUrl(color) : null;
  };

  const rows = useMemo<Row[]>(() => {
    return text
      .split('\n')
      .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
      .filter(({ raw }) => raw.length > 0)
      .map(({ raw, line }): Row => {
        // Le niveau et l'état sont deux annotations libres : on les retire d'où
        // qu'elles soient avant de relire ce qui reste comme un nom.
        const extras = readExtras(raw);
        if (extras.problem) return { ok: false, line, raw, problem: extras.problem };

        const lineLevel = extras.level ?? level;
        const lineStatus = extras.status ?? status;
        const lineCount = extras.count ?? 1;

        /**
         * `EB M anon` : une gen 1 sans ascendance, en autant d'exemplaires qu'on
         * en demande.
         *
         * Elle ne passe pas par `parseMountName`, et pour une raison de fond : ce
         * format encode une **généalogie**, et celle-ci n'en a pas. Lui en
         * inventer une pour pouvoir la relire serait écrire dans la base une
         * ascendance qui n'existe pas — exactement ce que `addIndividual` refuse
         * de faire en laissant son nom à `null`.
         *
         * L'ordre des deux morceaux est libre : `EB M anon` et `anon M EB`
         * disent la même chose, et personne ne se souvient de la convention d'un
         * format qu'on tape trois fois par an.
         */
        if (extras.anonymous) {
          const words = extras.name.split(/\s+/).filter(Boolean);
          const sexIndex = words.findIndex((word) => /^[MF]$/i.test(word));
          if (sexIndex === -1 || words.length !== 2) {
            return {
              ok: false,
              line,
              raw,
              problem: 'Attendu « EB M anon » — un code de couleur, un sexe, et rien d’autre.',
            };
          }

          const sex = words[sexIndex].toUpperCase() as Sex;
          const colorId = colorByCode.get(words[1 - sexIndex].toUpperCase());
          if (colorId === undefined) {
            return {
              ok: false,
              line,
              raw,
              problem: `Code de couleur inconnu : ${words[1 - sexIndex].toUpperCase()}.`,
            };
          }
          if (colorId === null) {
            return { ok: false, line, raw, problem: `Code ambigu : ${words[1 - sexIndex]}.` };
          }

          if (generationOf(colorId) !== 1) {
            return {
              ok: false,
              line,
              raw,
              problem:
                `${nameOfColor(colorId)} est de génération ${generationOf(colorId)} : au-delà ` +
                'de la première, une monture est née chez toi et porte donc une ascendance. ' +
                'Écris son nom.',
            };
          }

          if (!ANONYMOUS_STATUSES.includes(lineStatus)) {
            return {
              ok: false,
              line,
              raw,
              // Deux refus, deux raisons — et les confondre laisserait croire
              // qu'une anonyme stérile a une porte ailleurs. Elle n'en a aucune.
              problem:
                lineStatus === 'sterile'
                  ? 'Une anonyme ne peut pas être stérile : sans ascendance c’est une gen 1, ' +
                    'que le jeu n’extrait pas et que le clonage ne sait pas désigner. Elle ne ' +
                    'sert à rien et fausse le compte de l’écurie — ne l’importe pas.'
                  : 'Une gen 1 fertile sans ascendance, c’est du vrac : compte-la au compteur ' +
                    'de « Mon écurie ». Seule la féconde, que le vrac ne sait pas dire, ' +
                    's’importe une par une.',
            };
          }

          return {
            ok: true,
            line,
            raw,
            colorId,
            sex,
            parents: null,
            level: lineLevel,
            status: lineStatus,
            count: lineCount,
            warning: null,
          };
        }

        const parsed = parseMountName(extras.name);
        if (!parsed) {
          return {
            ok: false,
            line,
            raw,
            problem: 'Pas un nom dicté par l’outil — attendu « G3 AM M DO-DO ».',
          };
        }

        const colorId = colorByCode.get(parsed.colorCode);
        if (colorId === undefined) {
          return { ok: false, line, raw, problem: `Code de couleur inconnu : ${parsed.colorCode}.` };
        }
        if (colorId === null) {
          return { ok: false, line, raw, problem: `Code ambigu : ${parsed.colorCode}.` };
        }

        const parentIds = parsed.parentCodes.map((parentCode) => colorByCode.get(parentCode));
        const unknown = parsed.parentCodes.filter((_, index) => !parentIds[index]);
        if (unknown.length > 0) {
          return { ok: false, line, raw, problem: `Parent inconnu : ${unknown.join(', ')}.` };
        }

        const parents = parentIds as [string, string];
        const expected = carriedGeneration(generationOf(colorId), [
          generationOf(parents[0]),
          generationOf(parents[1]),
        ]);

        return {
          ok: true,
          line,
          raw,
          colorId,
          sex: parsed.sex,
          parents,
          level: lineLevel,
          status: lineStatus,
          count: lineCount,
          warning:
            expected === parsed.carriedGeneration
              ? null
              : `Le nom annonce G${parsed.carriedGeneration}, la généalogie donne G${expected}.`,
        };
      });
  }, [text, level, status, colorByCode, generationOf, nameOfColor]);

  const valid = rows.filter((row): row is Extract<Row, { ok: true }> => row.ok);
  const broken = rows.filter((row): row is Extract<Row, { ok: false }> => !row.ok);

  /**
   * Le décompte de ce qui va s'écrire, par sexe et par état.
   *
   * C'est le seul contrôle qui se fasse **sans relire ligne à ligne** : le jeu
   * affiche les mêmes totaux au-dessus de sa propre liste, donc deux chiffres qui
   * ne tombent pas juste disent qu'une ligne manque ou qu'un état a été recopié
   * de travers — avant l'écriture, pas après.
   */
  const tally = useMemo(() => {
    const counts = {
      males: 0,
      females: 0,
      status: { fertile: 0, feconde: 0, sterile: 0 } as Record<MountStatus, number>,
    };
    for (const row of valid) {
      // `count` et non 1 : une ligne anonyme en écrit plusieurs, et c'est
      // précisément ce total-là qu'on vient comparer à celui du jeu.
      if (row.sex === 'M') counts.males += row.count;
      else counts.females += row.count;
      counts.status[row.status] += row.count;
    }
    return counts;
  }, [valid]);

  /** Les montures que l'import va écrire, lignes anonymes déployées. */
  const total = valid.reduce((sum, row) => sum + row.count, 0);

  const run = async () => {
    setRunning(true);
    setDone(null);
    let added = 0;
    const failures: string[] = [];

    // En série et non en parallèle : cinquante insertions simultanées sur une
    // base partagée n'iront pas plus vite qu'elles, et une erreur au milieu doit
    // pouvoir être rapportée à **sa** ligne.
    for (const row of valid) {
      // Une ligne anonyme en écrit `count`, une à une : elles sont
      // interchangeables mais ce sont bien N montures distinctes en base, et un
      // échec au milieu doit se rapporter à sa ligne comme les autres.
      for (let copy = 0; copy < row.count; copy += 1) {
        const result = await onAdd({
          colorId: row.colorId,
          sex: row.sex,
          level: row.level,
          status: row.status,
          parents: row.parents,
        });
        if (result.ok) added += 1;
        else {
          failures.push(
            `ligne ${row.line}${row.count > 1 ? ` (${copy + 1}/${row.count})` : ''} — ${result.message}`
          );
          // Quarante échecs identiques sur la même ligne n'apprennent rien de
          // plus que le premier, et noieraient les autres lignes.
          break;
        }
      }
    }

    setRunning(false);
    setDone({ added, failures });
    // Ce qui est passé est retiré du texte : relancer après avoir corrigé les
    // lignes fautives ne doit pas re-créer ce qui existe déjà.
    if (failures.length === 0) setText('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Importer une écurie" size="xl">
      <div className="space-y-4">
        <p className="text-[11px] text-dark-500">
          Une ligne par monture, avec le nom qu&apos;elle porte <strong>dans le jeu</strong> — il
          encode déjà sa couleur, son sexe et ses deux parents. Copie la liste depuis l&apos;écurie
          du jeu et colle-la ici. Le niveau et l&apos;état ne sont pas dans le nom : ils se règlent
          une fois pour tout le lot, et se surchargent ligne par ligne
          {' — '}
          <code className="text-dark-400">G3 AM M DO-DO 120 féconde</code>. Leur place sur la
          ligne est libre, accents et majuscules indifférents, et la colonne{' '}
          <code className="text-dark-400">GEN. 4</code> de la liste du jeu est ignorée.
        </p>

        {/* Le format anonyme, expliqué là où on le taperait. Il ne se devine pas
            — rien dans l'écurie du jeu ne ressemble à « EB M anon » — et la
            restriction aux gen 1 fécondes ou stériles a une raison qu'il vaut
            mieux lire ici que découvrir sur un refus. */}
        <p className="text-[11px] text-dark-500">
          {/* Les espaces après une balise fermante sont explicites : sans elles
              le rendu recolle « ascendancen'a » et « ×12pour ». */}
          Une monture <strong>sans ascendance</strong>{' '}
          n&apos;a pas de nom à recopier : écris-la{' '}
          <code className="text-dark-400">EB M anon</code> — code de couleur, sexe,{' '}
          <code className="text-dark-400">anon</code>, dans l&apos;ordre que tu veux. Ajoute{' '}
          <code className="text-dark-400">×12</code>{' '}
          pour en écrire douze d&apos;un coup. Réservé aux{' '}
          <strong>gen 1 fécondes ou stériles</strong> : au-delà de la première génération une
          monture est née chez toi et porte une ascendance, et une gen 1 fertile est déjà comptée
          au compteur de vrac de « Mon écurie » — l&apos;importer ici la compterait deux fois.
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-dark-400 mb-1 block">Niveau du lot</label>
            <input
              type="number"
              min={1}
              max={200}
              value={String(level)}
              onChange={(event) =>
                setLevel(Math.max(1, Math.min(200, Number(event.target.value) || 1)))
              }
              className="w-24 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm text-right transition-all hover:border-dark-500
                focus:border-kamas/50"
            />
          </div>
          <div>
            <span className="text-xs text-dark-400 mb-1 block">État du lot</span>
            <div className="flex flex-wrap gap-2">
              {(['fertile', 'feconde', 'sterile'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatus(value)}
                  className={`px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                    status === value
                      ? 'bg-kamas/15 border-kamas/40 text-kamas'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
                >
                  {MOUNT_STATUS_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'G3 AM M DO-DO\nG3 AM F DO-DO\nG4 RO M AM-DO 120\nEB M anon ×12 stérile'}
          className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-100 text-xs font-mono placeholder:text-dark-600 transition-all
            hover:border-dark-500 focus:border-kamas/50"
        />

        {valid.length > 0 && (
          <p className="text-[11px] text-dark-400">
            À écrire : <span className="text-info">{tally.males} ♂</span>
            {' · '}
            <span className="text-loss-light">{tally.females} ♀</span>
            {' — '}
            {(['feconde', 'fertile', 'sterile'] as const)
              .filter((value) => tally.status[value] > 0)
              .map((value) => `${tally.status[value]} ${MOUNT_STATUS_LABEL[value].toLowerCase()}s`)
              .join(', ')}
            . Ces totaux se comparent à ceux du jeu avant d&apos;écrire quoi que ce soit.
          </p>
        )}

        {rows.length > 0 && (
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
            {rows.map((row) =>
              row.ok ? (
                <div
                  key={row.line}
                  className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-dark-800/40"
                >
                  <span className="text-[10px] text-dark-600 w-6 tabular-nums">{row.line}</span>
                  <ColorChip
                    name={nameOf(row.colorId)}
                    code={code(nameOf(row.colorId))}
                    icon={iconOf(row.colorId)}
                    size="sm"
                  />
                  <span className="text-xs text-dark-200">{nameOf(row.colorId)}</span>
                  <GenBadge generation={generationOf(row.colorId)} />
                  <span className={row.sex === 'M' ? 'text-info' : 'text-loss-light'}>
                    {row.sex === 'M' ? '♂' : '♀'}
                  </span>
                  {row.count > 1 && (
                    <span className="text-[10px] text-kamas font-semibold tabular-nums">
                      × {row.count}
                    </span>
                  )}
                  <span className="text-[10px] text-dark-500">niv. {row.level}</span>
                  <span className="text-[10px] text-dark-500">
                    {MOUNT_STATUS_LABEL[row.status]}
                  </span>
                  {row.parents ? (
                    <span className="text-[10px] text-dark-600 truncate">
                      ← {row.parents.map(nameOf).join(' × ')}
                    </span>
                  ) : (
                    <span
                      className="text-[10px] text-dark-600"
                      title="Achetée ou capturée : aucune ascendance, donc elle restera « Anonyme » en jeu — c'est déjà son nom."
                    >
                      sans ascendance
                    </span>
                  )}
                  {row.warning && (
                    <span className="text-[10px] text-amber-400/80" title={row.warning}>
                      ⚠ génération
                    </span>
                  )}
                </div>
              ) : (
                <div
                  key={row.line}
                  className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-loss/10"
                >
                  <span className="text-[10px] text-dark-600 w-6 tabular-nums">{row.line}</span>
                  <code className="text-[11px] text-dark-300">{row.raw}</code>
                  <span className="text-[10px] text-loss">{row.problem}</span>
                </div>
              )
            )}
          </div>
        )}

        {done && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] text-gain">
              <Check size={12} /> {done.added} monture{done.added > 1 ? 's' : ''} enregistrée
              {done.added > 1 ? 's' : ''}.
            </p>
            {done.failures.map((failure) => (
              <p key={failure} className="flex items-start gap-1.5 text-[11px] text-loss">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {failure}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={running || valid.length === 0} onClick={run}>
            <Upload size={13} />
            {running
              ? 'Import en cours…'
              : `Importer ${total} monture${total > 1 ? 's' : ''}`}
          </Button>
          {broken.length > 0 && (
            <span className="text-[11px] text-amber-400/80">
              {broken.length} ligne{broken.length > 1 ? 's' : ''} illisible
              {broken.length > 1 ? 's' : ''} — elle{broken.length > 1 ? 's' : ''} ser
              {broken.length > 1 ? 'ont' : 'a'} ignorée{broken.length > 1 ? 's' : ''}, le reste
              passe.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default BreedingImportMounts;
