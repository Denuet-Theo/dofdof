-- Deux réglages rendus à l'écran, quatre figés, et la bande 2 par défaut.
--
-- #94 avait retiré six réglages de l'écran d'élevage, avec un raisonnement juste
-- — « the model now gives the answer on its own », et « a wrong value there
-- silently moves every figure on the screen ». Mais aucun ne s'est arrêté d'être
-- lu. Une ligne enregistrée avant le 6 août gardait donc sa valeur à vie, sans
-- contrôle pour en changer ni rien à l'écran qui le dise. C'est la même panne que
-- #179, et c'est #181.
--
-- Mesuré sur l'export du 17/08, la réponse n'est pas la même pour les six : deux
-- ont un effet réel et sont des faits sur la façon de jouer, quatre n'ont aucun
-- effet observable.
--
--   | colonne             | relevé  | effet réel                          | sort     |
--   | ---                 | ---     | ---                                 | ---      |
--   | count_net_cost      | false   | met le prix des filets à zéro       | rendu    |
--   | gauge_cap           | 90000   | force la bande, donc les durées     | rendu    |
--   | kamas_per_hour      | 0       | aucun — égal au défaut              | figé     |
--   | minutes_per_fight   | 1       | aucun — multiplié par kamas_per_hour | figé    |
--   | net_recovery_rate   | 0.8     | aucun — égal au défaut              | figé     |
--   | recycle_steriles    | true    | aucun — égal au défaut              | figé     |
--
-- `minutes_per_fight` est le seul qui divergeait de son défaut, et le seul dont
-- il fallait prouver l'innocuité : le coût en temps d'une capture vaut
-- `(minutes / 60) × (kamas_per_hour / captures)`, donc zéro à kamas_per_hour nul,
-- quel que soit le nombre de minutes. Douze contre un, multiplié par zéro.
--
-- Les quatre figés ne sont pas supprimés : ils quittent le type applicatif, ce
-- qui les met hors de portée du code et les sort de l'`upsert`. Effacer les
-- colonnes perdrait ce que les joueurs y ont posé sans rien rendre.

comment on column public.user_breeding_settings.count_net_cost is
  'Rendu à l''écran par #181, dans « Mes stocks » : à false, seul le temps de '
  'combat compte — le régime de qui récolte ses propres matériaux.';

comment on column public.user_breeding_settings.gauge_cap is
  'Rendu à l''écran par #181, dans « Mes stocks ». Le plafond du carburant '
  'racheté, qui décide du débit de la jauge : 40000, 70000, 90000 ou 100000 pour '
  '1, 2, 3 ou 4 points par seconde. null = le moins cher au point, sans regarder '
  'la vitesse. Défaut 70000, la bande 2.';

comment on column public.user_breeding_settings.kamas_per_hour is
  'Retiré de l''écran par #94 et figé par #181 à 0 : une heure de jeu ne se '
  'convertit pas en kamas. C''est lui qui commande tous les termes de temps du '
  'calcul, donc le rendre réglable se fera avec minutes_per_fight et '
  'net_recovery_rate, pas seul. Colonne conservée pour l''historique, plus lue ni '
  'écrite.';

comment on column public.user_breeding_settings.minutes_per_fight is
  'Retiré de l''écran par #94 et figé par #181 à son défaut de 12 : sans valeur '
  'de l''heure, le coût en temps d''une capture est nul quel que soit ce nombre. '
  'Colonne conservée pour l''historique, plus lue ni écrite.';

comment on column public.user_breeding_settings.net_recovery_rate is
  'Retiré de l''écran par #94 et figé par #181 à son défaut de 0,8 : quatre '
  'filets sur cinq se récupèrent. Colonne conservée pour l''historique, plus lue '
  'ni écrite.';

comment on column public.user_breeding_settings.recycle_steriles is
  'Retiré de l''écran par #94 et figé par #181 à son défaut : les stériles se '
  'clonent par deux plutôt que de partir en ambre. Colonne conservée pour '
  'l''historique, plus lue ni écrite.';

-- La bande 2 par défaut, et non plus `null`.
--
-- C'est un relevé, pas un milieu prudent : la bande 2 est celle que la guilde
-- tient, et le défaut d'un réglage qu'on vient de rendre doit être ce que font
-- les gens. `null` reste choisissable — « le moins cher, sans regarder la
-- vitesse » — mais ce n'est plus ce qu'on applique faute de réponse.
--
-- L'ancien défaut disait « laisse l'arbitrage temps/kamas décider », et il ne
-- pouvait plus rien arbitrer : cet arbitrage passe entièrement par
-- `kamas_per_hour`, nul et sans contrôle depuis #94. À temps sans valeur, le
-- moins cher au point gagne toujours — donc la bande la plus lente, choisie sans
-- l'avoir dit.

alter table public.user_breeding_settings
  alter column gauge_cap set default 70000;

-- Les lignes d'avant, où l'option n'était pas choisissable.
--
-- **Ceci écrit dans des données existantes.** Un `null` posé avant aujourd'hui ne
-- peut pas être un choix : le contrôle avait disparu avec #94, et le seul écran
-- qui écrivait la ligne recopiait la valeur chargée. Chaque `null` est donc une
-- absence de réponse, et le combler est ce qui rend le nouveau défaut réel.
--
-- Réversible d'un clic : le sélecteur de « Mes stocks » porte l'option.

update public.user_breeding_settings
  set gauge_cap = 70000
  where gauge_cap is null;
