-- Le suivi individuel se décide sur l'ascendance, plus sur la seule génération.
--
-- Relevé en jeu (issue #59) : deux muldos **Ébène et Orchidée gen 2**, portant
-- tous deux une *Amande* gen 3 en ascendance, visent la **génération 4**. La
-- règle du jeu n'est pas « génération des parents + 1 » mais « génération
-- maximale de toute la généalogie + 1 » — elle ne pose donc pas seulement un
-- plancher d'échec, elle relève la cible.
--
-- Ces gen 2 à ascendance haute sont les bébés hors cible d'un croisement haut :
-- un accouplement rend toujours un bébé, d'une couleur tirée dans la généalogie.
-- Le seuil « gen 3 et plus » les renvoyait au compteur de vrac, où leur
-- ascendance disparaissait — c'est-à-dire exactement ce qui fait leur valeur.
--
-- Aucune structure ne change : la table n'a jamais porté de contrainte de
-- génération, et les lignes existantes restent valides. Seule change la règle
-- qui décide où atterrit une naissance, et elle vit dans le code
-- (`tracksIndividually`). Ce commentaire cesse simplement de dire le contraire.

comment on table public.user_breeding_individuals is
  'Montures suivies une par une : celles dont la généalogie porte une génération 3 ou plus, la leur ou celle d''un parent. La distribution des couleurs à l''échec dépend de la généalogie de l''individu, et son ascendance décide de la génération que ses accouplements visent.';

comment on column public.user_breeding_individuals.parent_a_color is
  'Couleur du premier parent. Avec parent_b_color, forme l''ascendance visible : le jeu n''expose qu''un niveau, donc ces deux couleurs suffisent à calculer la génération que cette monture fait viser à ses accouplements.';
