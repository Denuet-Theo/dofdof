-- Trois réglages retirés de l'écran, et qui pilotaient encore le calcul.
--
-- #81 avait retiré de l'écran la case « Ne pas créditer les bébés hors cible »,
-- celle « Ne jamais vendre les montures » et le champ « Niveau Éleveur », en
-- tranchant : le crédit hors cible s'applique toujours, la revente est toujours
-- valorisée, le niveau d'Éleveur ne nourrissait qu'un avertissement.
--
-- Le hook, lui, continuait de lire les deux premières. Une ligne enregistrée
-- avant le 6 août figeait donc le comportement à ce qu'elle portait, sans case
-- pour en changer et sans rien à l'écran qui le signale — le badge « ratés non
-- crédités » ayant disparu avec la case.
--
-- Ce n'est pas resté théorique. Sur l'écurie du 14/08, à réglages égaux par
-- ailleurs :
--
--   | | figé (crédit et revente coupés) | ce que #81 annonçait |
--   | --- | --- | --- |
--   | une gen 10 | 5 073 068 kamas | 702 266 kamas |
--   | niveau des parents retenu | 200 | 19 |
--   | couleurs à marge positive | 0 sur 120 | 2, et 8 sorties par la revente |
--
-- Une écurie où rien n'est rentable et où l'optimiseur pousse les parents à 200
-- ne se lit pas comme une panne : ça ressemble à un marché difficile.
--
-- Les colonnes ne sont pas supprimées ici. Elles ne sont plus ni lues ni
-- écrites — le type applicatif les a perdues, ce qui les met hors de portée du
-- code — mais les effacer perdrait ce que les joueurs y ont posé, sans rien
-- rendre en échange. Ce commentaire est là pour le prochain qui les verra dans
-- le schéma et se demandera pourquoi personne ne les lit.

comment on column public.user_breeding_settings.credit_off_target is
  'Retiré de l''écran par #81 et débranché par #179 : le crédit des bébés hors '
  'cible s''applique toujours. Colonne conservée pour l''historique, plus lue '
  'ni écrite.';

comment on column public.user_breeding_settings.never_sell_mounts is
  'Retiré de l''écran par #81 et débranché par #179 : la revente est toujours '
  'valorisée, l''extraction restant en concurrence dans la même comparaison. '
  'Colonne conservée pour l''historique, plus lue ni écrite.';

comment on column public.user_breeding_settings.breeder_level is
  'Retiré de l''écran par #81 : ne nourrissait qu''un avertissement sur le champ '
  'd''en dessous. Colonne conservée pour l''historique, plus lue ni écrite.';

-- Et les cinq que #94 a retirés de l'écran au nom du même principe — « the model
-- now gives the answer on its own » — mais que le hook lit toujours. Les figer
-- demande de décider quelle réponse le modèle donne, et trois d'entre eux
-- portent des valeurs délibérées qu'un défaut écraserait. Voir #181.

comment on column public.user_breeding_settings.count_net_cost is
  'Retiré de l''écran par #94 mais toujours lu, faute d''une décision sur la '
  'valeur à figer. Voir #181.';
