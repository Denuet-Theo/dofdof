import { borneName } from './naming';
import type { Individual } from './stable';

/**
 * Désigner un lot de montures **par leurs noms**, collés depuis le jeu.
 *
 * ## Le geste que ce module existe pour rendre possible
 *
 * Après la fournée du 23/08, cinquante montures étaient à repasser fécondes au
 * niveau 44. La correction en lot sait le faire d'un coup — mais il faut encore
 * les **désigner**, et cinquante cases à cocher dans une liste de deux cents,
 * avec trois homonymes à départager à l'œil, est exactement la tâche où l'on se
 * trompe. On ne s'en aperçoit qu'ensuite, quand la politique planifie sur une
 * écurie fausse.
 *
 * Or la désignation existe déjà, ailleurs : c'est la liste de l'écran d'enclos
 * du jeu. Chaque monture y porte le nom que l'outil lui a dicté. On la copie, on
 * la colle, et le lot est désigné sans un seul clic — le même raisonnement que
 * `BreedingImportMounts`, qui relit une écurie entière depuis ces noms plutôt
 * que de la ressaisir.
 *
 * ## Ce qui se lit, et ce qui est ignoré
 *
 * Une ligne = une monture. Le nom est pris tel quel, ce que la liste du jeu
 * affiche : `G3 AM M EBOR-INPO`. Tout ce qui suit — la colonne `GEN. 3`, le
 * niveau, les icônes de jauges recopiées au passage — est **écarté**, parce
 * qu'une liste copiée d'une interface de jeu ramène toujours du décor et qu'un
 * décor qui fait rejeter la ligne est une monture qui manque au lot sans que
 * rien ne le dise.
 *
 * Un `×2` à la fin dit qu'on en veut deux du même nom, parce que c'est ainsi
 * qu'on écrit un relevé et que deux lignes identiques se perdent à la relecture.
 */

/** Une ligne collée qui n'a pas trouvé son compte. */
export type PickMiss = {
  name: string;
  /** Combien la ligne en demandait. */
  wanted: number;
  /** Combien l'écurie pouvait en donner. */
  found: number;
};

export type PickResult = {
  /** Les montures désignées, dans l'ordre des lignes collées. */
  ids: string[];
  /** Ce que l'écurie n'a pas pu fournir — dit, jamais tu. */
  misses: PickMiss[];
  /**
   * Combien de montures les lignes **demandaient**, `×2` compris.
   *
   * Et non le nombre de lignes : une ligne qui en demande deux comptait pour
   * une, si bien que « 6 désignées sur 8 lignes » se lisait comme deux
   * manquantes quand il en manquait trois. Le compte qui rassure doit être le
   * compte qui alerte.
   */
  wanted: number;
};

/**
 * Le nom d'une ligne collée, et combien elle en demande.
 *
 * `null` pour une ligne vide ou qui ne porte pas de nom lisible : mieux vaut
 * l'écarter en silence qu'inventer une monture. Les lignes réellement fautives —
 * un nom qui ne désigne rien — ressortent dans `misses`, où elles se voient.
 */
const readLine = (raw: string): { name: string; wanted: number } | null => {
  const line = raw.trim();
  if (line === '') return null;

  // `×2`, `x2` ou `× 2` en fin de ligne : un relevé s'écrit comme ça.
  const times = line.match(/[×x]\s*(\d+)\s*$/i);
  const wanted = times ? Math.max(1, Number(times[1])) : 1;
  const withoutTimes = times ? line.slice(0, times.index).trim() : line;

  /*
   * Un nom dicté fait quatre mots : `G3 AM M EBOR-INPO`. On garde exactement
   * ces quatre-là et on jette la suite, qui est du décor recopié — `GEN. 3`, un
   * niveau, une fertilité. Les prendre pour des mots du nom faisait rejeter
   * toute ligne copiée telle quelle de l'écran du jeu, c'est-à-dire toutes.
   */
  const words = withoutTimes.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  if (!/^G\d+$/i.test(words[0])) return null;
  return { name: words.slice(0, 4).join(' ').toUpperCase(), wanted };
};

/**
 * Les montures que ces lignes désignent.
 *
 * ## Comment se départage un homonyme
 *
 * Plusieurs sœurs portent souvent le même nom — le nom encode la couleur, le
 * sexe et les deux parents, pas l'individu — et l'écurie du 15/08 en compte
 * jusqu'à sept sous `G4 DOAM M AM-DO`. Il faut donc une règle, et elle est
 * dictée par l'usage : ce qu'on colle vient d'un enclos, et **une monture entrée
 * en enclos y est entrée fertile et non féconde**. On pioche donc parmi
 * celles-là d'abord, du niveau le plus bas — une monture dont le niveau n'a
 * jamais été relevé vaut 1, et c'est très exactement celle qui sort d'un enclos
 * sans que l'app le sache.
 *
 * Le tri n'exclut pas les autres, il les met derrière : sans candidate fertile,
 * on retombe sur une homonyme quelconque plutôt que de rendre la ligne
 * introuvable. Ce que l'éleveur corrige alors est visible à l'écran, et le
 * compte de `misses` reste juste.
 */
export const pickByNames = (
  pasted: string,
  individuals: readonly Individual[]
): PickResult => {
  const wantedBy = new Map<string, number>();
  let wanted = 0;
  for (const raw of pasted.split('\n')) {
    const read = readLine(raw);
    if (!read) continue;
    wanted += read.wanted;
    wantedBy.set(read.name, (wantedBy.get(read.name) ?? 0) + read.wanted);
  }

  const byName = new Map<string, Individual[]>();
  for (const mount of individuals) {
    const key = borneName(mount).toUpperCase();
    byName.set(key, [...(byName.get(key) ?? []), mount]);
  }

  const ids: string[] = [];
  const misses: PickMiss[] = [];
  for (const [name, count] of wantedBy) {
    const rows = byName.get(name) ?? [];
    const ranked = [...rows].sort(
      (a, b) =>
        // Les fertiles non fécondes d'abord : ce sont les seules qu'un enclos
        // ait pu prendre, et donc les seules qu'il puisse rendre.
        Number(b.fertile && !b.cycled) - Number(a.fertile && !a.cycled) ||
        a.level - b.level ||
        a.id.localeCompare(b.id)
    );
    const take = ranked.slice(0, count);
    for (const mount of take) ids.push(mount.id);
    if (take.length < count) misses.push({ name, wanted: count, found: take.length });
  }

  return { ids, misses, wanted };
};
