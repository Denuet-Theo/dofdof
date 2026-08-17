-- Ce que la politique fait du succès de collection.
--
-- La table `user_breeding_hatched` est arrivée sans réglage (migration
-- 20260817160000) : l'écran montrait la collection et les trois modes grisés,
-- parce qu'un réglage que la politique ne lit pas est un réglage sans effet — la
-- panne que #181 et #216 ont passé deux PR à retirer de cet écran.
--
-- La politique les lit maintenant, donc la colonne peut exister.
--
--   ignore    la politique n'en tient aucun compte. Le défaut, et il le reste.
--
--   free      détourne un croisement **déjà prévu** : un parent est remplacé par
--             un autre de même génération pour viser une couleur jamais obtenue.
--             Même rang atteint, même nombre de croisements. Le remplaçant
--             s'achète s'il manque à l'écurie — une gen 1, 4 à 6 000 kamas — et
--             cette place de cycle est alors facturée.
--
--   priority  ajoute en plus des croisements dédiés dans les places qui restent,
--             autorisés à dépenser des montures que l'échelle réclamait : une
--             gen 3 avec une gen 5 donne une gen 6 qu'on n'obtiendrait jamais en
--             montant.
--
-- ## Aucun des deux n'est neutre, et c'est mesuré
--
-- Un croisement **n'est jamais gratuit, même sur une place inoccupée** : il
-- stérilise ses deux parents définitivement. `loadout.ts` a mesuré que remplir
-- les places libres de croisements coûtait quatre fournées et 3,5 % de kamas. Ce
-- qui est gratuit sur une place libre, c'est la fécondation, et `fillSparePlaces`
-- y met déjà celle-là.
--
-- Et détourner casse la propriété que `check-recipes.mjs` verrouille — le jeu de
-- gen 2 retenu doit être une union disjointe de cliques, faute de quoi 27 % de la
-- masse utile part hors cible.
--
-- Le PR qui introduit cette colonne chiffre les deux modes sur vingt écuries.

alter table public.user_breeding_settings
  add column if not exists success_mode text not null default 'ignore'
    check (success_mode in ('ignore', 'free', 'priority'));

comment on column public.user_breeding_settings.success_mode is
  'Ce que la politique fait du succès de collection : ignore (défaut), free '
  '(détourne un croisement déjà prévu, achat d''une gen 1 permis), priority (en '
  'plus, des croisements dédiés qui sacrifient ce que l''échelle réclamait). '
  'Contrôlé sur l''onglet « Succès ».';
