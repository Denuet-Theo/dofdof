-- Une monture accouplée n'est pas encore une monture perdue.
--
-- L'écurie ne connaissait que deux états : `fertile` vraie ou fausse. Or le jeu
-- en distingue trois, et les deux derniers ne se remplacent pas :
--
-- * **fertile** — disponible, elle peut être chargée dans une fournée ;
-- * **féconde** — accouplée, elle porte : indisponible, mais un poulain arrive
--   et il faudra le saisir ;
-- * **stérile** — épuisée : il ne lui reste que le clonage et l'extraction.
--
-- Les confondre avait une conséquence concrète et pas seulement cosmétique :
-- `sterileMounts` prend toutes les `fertile = false` et propose de les cloner.
-- Une féconde s'y retrouvait donc **proposée au clonage alors qu'elle est en
-- gestation** — le geste qu'il ne faut surtout pas faire, puisqu'il consomme la
-- monture avant qu'elle ait rendu ce pour quoi on l'a payée.
--
-- Un booléen de plus plutôt qu'une colonne d'état : tout le calcul lit déjà
-- `fertile` comme « disponible pour un accouplement », et c'est exactement ce
-- qu'il doit continuer à lire. La gestation est une information **en plus**, que
-- seuls le clonage et l'écran ont besoin de voir. Voir `mountStatus` dans
-- `stable.ts`, où les deux booléens se relisent comme un état à trois valeurs.

alter table public.user_breeding_individuals
  add column if not exists pregnant boolean not null default false;

comment on column public.user_breeding_individuals.pregnant is
  'Monture accouplée qui porte : indisponible comme une stérile, mais un poulain est attendu et elle ne doit pas être clonée. Va toujours avec fertile = false — les deux vrais ensemble n''ont pas de sens, la contrainte ci-dessous le garantit.';

-- L'invariant se pose ici et non dans le code : trois états valides sur quatre
-- combinaisons, et c'est la base qui doit refuser la quatrième. Une monture à la
-- fois disponible et en gestation serait chargée dans une fournée alors qu'elle
-- porte déjà.
alter table public.user_breeding_individuals
  drop constraint if exists user_breeding_individuals_state_check;

alter table public.user_breeding_individuals
  add constraint user_breeding_individuals_state_check
  check (not (fertile and pregnant));

-- Les montures déjà enregistrées gardent leur état : une `fertile = false`
-- existante devient une stérile, ce qu'elle était déjà pour tout le calcul. Rien
-- ne permet de deviner laquelle porte réellement — et se tromper dans ce sens-là
-- est le sens sûr : une stérile prise pour telle est proposée au clonage, ce qui
-- reste rattrapable, là qu'une féconde clonée est perdue.
