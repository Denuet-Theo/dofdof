-- Le vrac ne savait pas porter l'état **fécond**.
--
-- `breeding_feconde` a ajouté `cycled` à `user_breeding_individuals` et s'est
-- arrêtée là. Or le seuil de suivi individuel commence à la génération 2 : une
-- gen 1 vit donc en vrac, et une gen 1 **féconde** — sortie de l'enclos sans
-- avoir été accouplée — n'avait aucun endroit où être dite.
--
-- La conséquence n'était pas cosmétique. La politique lit `cycled` pour savoir
-- ce qui s'accouple **sans passer par l'enclos** : deux fécondes, c'est un clic,
-- zéro place. Vues comme de simples fertiles, elles se voyaient réserver une
-- place chacune, et le plan proposait d'acheter des gen 1 à l'hôtel de vente
-- pendant que soixante fécondes attendaient dans l'écurie.
--
-- Deux colonnes et non une : les sexes ne sont pas interchangeables, un
-- accouplement demandant un mâle **et** une femelle. C'est déjà pourquoi
-- `count` avait été scindé en `males` / `females`.
alter table public.user_breeding_mounts
  add column if not exists cycled_males integer not null default 0
    check (cycled_males >= 0),
  add column if not exists cycled_females integer not null default 0
    check (cycled_females >= 0);

comment on column public.user_breeding_mounts.cycled_males is
  'Parmi `males`, combien ont déjà payé leur cycle de fécondité : elles
   s''accouplent sans repasser par l''enclos. Un sous-ensemble et non une
   partition — `males` continue de compter tout ce qui garde sa reproduction,
   comme `FERTILE_*` face à `CYCLED_*` dans l''encodage du réseau.';

comment on column public.user_breeding_mounts.cycled_females is
  'Voir `cycled_males`.';
